import type {
  CandidateAttempt,
  Element as ElementModel,
  LocatorHit,
  Locator as ModelLocator,
} from '@atp/model'
import type { Frame, Locator, Page } from 'playwright'

/** 单个候选的最长等待；整体解析有总超时兜底 */
const CANDIDATE_TIMEOUT_MS = 1200
const RESOLVE_TIMEOUT_MS = 6000
const ASSERTION_CANDIDATE_TIMEOUT_MS = 800
const POLL_INTERVAL_MS = 80

/** 页面 / iframe / 作用域 locator 都可以作为定位根 */
export type LocatorRoot = Page | Frame | Locator

type Role = Parameters<Page['getByRole']>[0]

/** 按索引链找到目标 iframe；找不到返回 null */
export function resolveFrame(page: Page, framePath: number[]): Frame | null {
  let cur: Frame = page.mainFrame()
  for (const idx of framePath) {
    const child = cur.childFrames()[idx]
    if (!child) return null
    cur = child
  }
  return cur
}

function rootOf(page: Page, element: ElementModel): LocatorRoot | null {
  if (!element.framePath || element.framePath.length === 0) return page
  return resolveFrame(page, element.framePath)
}

/** 把简单定位器翻译成 Playwright 定位器（within 由 collectMatches 展开） */
export function toPlaywrightLocator(root: LocatorRoot, loc: ModelLocator): Locator {
  if (loc.type === 'within') throw new Error('within 定位器需要先展开作用域')
  switch (loc.type) {
    case 'testId':
      return root.getByTestId(loc.value)
    case 'role':
      return root.getByRole(
        loc.value as Role,
        loc.name === undefined ? undefined : { name: loc.name },
      )
    case 'text':
      return root.getByText(loc.value, { exact: true })
    case 'css':
      return root.locator(loc.value)
    case 'xpath':
      return root.locator(`xpath=${loc.value}`)
  }
}

/** 作用域命中多个时取最上层：优先 z-index，其次 DOM 顺序 */
async function topmostOf(matches: Locator[]): Promise<Locator> {
  let best = matches[matches.length - 1]
  let bestZ = Number.NEGATIVE_INFINITY
  for (const match of matches) {
    const z = await match
      .evaluate((el) => {
        let cur: Element | null = el
        let depth = 0
        while (cur && depth < 20) {
          const n = Number.parseInt(getComputedStyle(cur).zIndex, 10)
          if (Number.isFinite(n)) return n
          cur = cur.parentElement
          depth++
        }
        return 0
      })
      .catch(() => 0)
    if (z >= bestZ) {
      bestZ = z
      best = match
    }
  }
  return best
}

/**
 * 展开候选的所有匹配元素（within 会先解析作用域，再在作用域内找目标）。
 * 返回的 Locator 都是具体到某个元素的 nth()。
 */
export async function collectMatches(root: LocatorRoot, loc: ModelLocator): Promise<Locator[]> {
  if (loc.type === 'within') {
    const scopes = await collectMatches(root, loc.scope)
    if (scopes.length === 0) return []
    const chosenScopes = loc.topmost && scopes.length > 1 ? [await topmostOf(scopes)] : scopes
    const out: Locator[] = []
    for (const scope of chosenScopes) {
      out.push(...(await collectMatches(scope, loc.target)))
    }
    return out
  }
  const base = toPlaywrightLocator(root, loc)
  const count = await base.count().catch(() => 0)
  const out: Locator[] = []
  for (let i = 0; i < count; i++) out.push(base.nth(i))
  return out
}

export interface MatchInfo {
  visible: boolean
  actionable: boolean
  reason?: string
  coveredBy?: string
}

async function inspectMatch(locator: Locator): Promise<MatchInfo> {
  try {
    return await locator.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const visible =
        r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
      if (!visible) return { visible: false, actionable: false, reason: 'not-visible' }

      const disabled =
        (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true'
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      const label = top?.closest('label')
      const viaLabel = Boolean(
        label && ((label as HTMLLabelElement).control === el || label.contains(el)),
      )
      const hit = Boolean(top && (top === el || el.contains(top) || viaLabel))
      if (!hit) {
        return {
          visible: true,
          actionable: false,
          reason: 'covered',
          coveredBy: top
            ? `${top.tagName.toLowerCase()}${
                top.className ? `.${String(top.className).trim().split(/\s+/)[0]}` : ''
              }`
            : 'offscreen',
        }
      }
      if (disabled) return { visible: true, actionable: false, reason: 'disabled' }
      return { visible: true, actionable: true }
    })
  } catch {
    return { visible: false, actionable: false, reason: 'stale' }
  }
}

async function inspectMatches(matches: Locator[]): Promise<MatchInfo[]> {
  return Promise.all(matches.map((m) => inspectMatch(m)))
}

/** 目标本身是结构定位（css/xpath）时，标记为降级命中 */
function isStructural(loc: ModelLocator): boolean {
  if (loc.type === 'within') return isStructural(loc.target)
  return loc.type === 'css' || loc.type === 'xpath'
}

function describeFailure(matches: Locator[], infos: MatchInfo[]): string {
  if (matches.length === 0) return '未找到元素'
  const actionable = infos.filter((i) => i.actionable).length
  if (actionable > 1) return `匹配到 ${actionable} 个可交互元素（歧义）`
  const reasons = [...new Set(infos.map((i) => i.reason).filter(Boolean))]
  return `匹配到 ${matches.length} 个元素但不可交互（${reasons.join(' / ') || '原因未知'}）`
}

function toAttempt(loc: ModelLocator, matches: Locator[], infos: MatchInfo[]): CandidateAttempt {
  return {
    locator: loc,
    ok: false,
    error: describeFailure(matches, infos),
    matchCount: matches.length,
    matches: infos.map((info, index) => ({
      index,
      visible: info.visible,
      actionable: info.actionable,
      ...(info.reason ? { reason: info.reason } : {}),
      ...(info.coveredBy ? { coveredBy: info.coveredBy } : {}),
    })),
  }
}

export interface ResolveOutcome {
  locator: Locator | null
  hit: LocatorHit | null
  attempts: CandidateAttempt[]
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 动作解析：
 * 候选顺序 testId → 作用域语义 → 全局语义 → 结构兜底（css/xpath）。
 * 每个候选收集全部匹配，只有「恰好一个可交互」才胜出；
 * 多命中/被遮挡/找不到都会继续尝试下一候选，并在 attempts 里留下诊断。
 */
export async function resolveElement(page: Page, element: ElementModel): Promise<ResolveOutcome> {
  const attempts: CandidateAttempt[] = []
  const root = rootOf(page, element)
  if (!root) {
    return {
      locator: null,
      hit: null,
      attempts: element.locators.map((locator) => ({
        locator,
        ok: false,
        error: `找不到 iframe 路径 ${element.framePath?.join('/')}`,
      })),
    }
  }

  const overallDeadline = Date.now() + RESOLVE_TIMEOUT_MS
  for (const [tier, loc] of element.locators.entries()) {
    if (Date.now() >= overallDeadline) break
    const candidateDeadline = Math.min(overallDeadline, Date.now() + CANDIDATE_TIMEOUT_MS)

    let matches: Locator[] = []
    let infos: MatchInfo[] = []
    while (true) {
      matches = await collectMatches(root, loc)
      infos = await inspectMatches(matches)
      const actionable = infos.filter((i) => i.actionable)
      if (actionable.length === 1) {
        const index = infos.indexOf(actionable[0])
        return {
          locator: matches[index],
          hit: {
            tier,
            locator: loc,
            matchCount: matches.length,
            ...(isStructural(loc) ? { degraded: true } : {}),
          },
          attempts,
        }
      }
      // 多命中（歧义）不会因为等待而变好；被遮挡/未出现则给页面一点时间
      if (actionable.length > 1) break
      if (Date.now() >= candidateDeadline) break
      await delay(POLL_INTERVAL_MS)
    }
    attempts.push(toAttempt(loc, matches, infos))
  }
  return { locator: null, hit: null, attempts }
}

export interface AssertionResolveOutcome {
  /** 未取 .first() 的 locator，供 count/存在性断言使用 */
  base: Locator | null
  /** 已选定具体实例的 locator，供 visible/text/value 等断言使用 */
  locator: Locator | null
  hit: LocatorHit | null
  attempts: CandidateAttempt[]
}

/** within 的作用域选定后，返回该作用域内的 base（保留 count 语义） */
async function resolveBase(
  root: LocatorRoot,
  loc: ModelLocator,
): Promise<{ base: Locator | null; matches: Locator[] }> {
  if (loc.type !== 'within') {
    const base = toPlaywrightLocator(root, loc)
    const count = await base.count().catch(() => 0)
    const matches: Locator[] = []
    for (let i = 0; i < count; i++) matches.push(base.nth(i))
    return { base, matches }
  }
  const scopes = await collectMatches(root, loc.scope)
  if (scopes.length === 0) return { base: null, matches: [] }
  const scope = loc.topmost && scopes.length > 1 ? await topmostOf(scopes) : scopes[0]
  return resolveBase(scope, loc.target)
}

/**
 * 断言解析：只要 attached 即可（hidden/notExists 需要能定位隐藏元素）。
 * 多命中时优先唯一可见实例；否则取首个 attached，供断言与诊断使用。
 */
export async function resolveElementForAssertion(
  page: Page,
  element: ElementModel,
): Promise<AssertionResolveOutcome> {
  const attempts: CandidateAttempt[] = []
  const root = rootOf(page, element)
  if (!root) {
    return {
      base: null,
      locator: null,
      hit: null,
      attempts: element.locators.map((locator) => ({
        locator,
        ok: false,
        error: `找不到 iframe 路径 ${element.framePath?.join('/')}`,
      })),
    }
  }

  for (const [tier, loc] of element.locators.entries()) {
    let base: Locator | null = null
    let matches: Locator[] = []
    const deadline = Date.now() + ASSERTION_CANDIDATE_TIMEOUT_MS
    while (true) {
      const resolved = await resolveBase(root, loc)
      base = resolved.base
      matches = resolved.matches
      if (matches.length > 0) break
      if (Date.now() >= deadline) break
      await delay(POLL_INTERVAL_MS)
    }
    if (!base || matches.length === 0) {
      attempts.push({ locator: loc, ok: false, error: '未找到元素', matchCount: 0 })
      continue
    }

    const infos = await inspectMatches(matches)
    const visible = infos.map((info, index) => ({ info, index })).filter(({ info }) => info.visible)
    const chosenIndex =
      matches.length === 1 ? 0 : visible.length > 0 ? visible[visible.length - 1].index : 0

    return {
      base,
      locator: matches[chosenIndex],
      hit: {
        tier,
        locator: loc,
        matchCount: matches.length,
        ...(isStructural(loc) ? { degraded: true } : {}),
      },
      attempts,
    }
  }
  return { base: null, locator: null, hit: null, attempts }
}
