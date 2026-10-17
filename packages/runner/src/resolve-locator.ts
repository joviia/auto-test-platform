import type { CandidateAttempt, Element, Locator as ModelLocator } from '@atp/model'
import type { Frame, Locator, Page } from 'playwright'

const CANDIDATE_TIMEOUT_MS = 2500
const ASSERTION_CANDIDATE_TIMEOUT_MS = 800

/** 页面或 iframe 都能作为定位根 */
export type LocatorRoot = Page | Frame

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

function rootOf(page: Page, element: Element): LocatorRoot | null {
  if (!element.framePath || element.framePath.length === 0) return page
  return resolveFrame(page, element.framePath)
}

/** 把模型定位器候选翻译成 Playwright 定位器 */
export function toPlaywrightLocator(root: LocatorRoot, loc: ModelLocator): Locator {
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
  }
}

export interface ResolveOutcome {
  locator: Locator | null
  hit: { tier: number; locator: ModelLocator } | null
  attempts: CandidateAttempt[]
}

/** 按候选顺序逐个尝试：第一个「可见」的候选胜出，全部失败返回 null */
export async function resolveElement(page: Page, element: Element): Promise<ResolveOutcome> {
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
  for (const [tier, loc] of element.locators.entries()) {
    const candidate = toPlaywrightLocator(root, loc).first()
    try {
      await candidate.waitFor({ state: 'visible', timeout: CANDIDATE_TIMEOUT_MS })
      return { locator: candidate, hit: { tier, locator: loc }, attempts }
    } catch {
      attempts.push({
        locator: loc,
        ok: false,
        error: `${CANDIDATE_TIMEOUT_MS}ms 内未出现可见元素`,
      })
    }
  }
  return { locator: null, hit: null, attempts }
}

export interface AssertionResolveOutcome {
  /** 未取 .first() 的 locator，供 count/存在性断言使用 */
  base: Locator | null
  hit: { tier: number; locator: ModelLocator } | null
  attempts: CandidateAttempt[]
}

/**
 * 断言专用解析：只要元素在 DOM 中存在（attached）即可，
 * 不要求可见——hidden / notExists 等断言需要能定位到隐藏元素。
 */
export async function resolveElementForAssertion(
  page: Page,
  element: Element,
): Promise<AssertionResolveOutcome> {
  const attempts: CandidateAttempt[] = []
  const root = rootOf(page, element)
  if (!root) {
    return {
      base: null,
      hit: null,
      attempts: element.locators.map((locator) => ({
        locator,
        ok: false,
        error: `找不到 iframe 路径 ${element.framePath?.join('/')}`,
      })),
    }
  }
  for (const [tier, loc] of element.locators.entries()) {
    const base = toPlaywrightLocator(root, loc)
    try {
      await base.first().waitFor({ state: 'attached', timeout: ASSERTION_CANDIDATE_TIMEOUT_MS })
      return { base, hit: { tier, locator: loc }, attempts }
    } catch {
      attempts.push({
        locator: loc,
        ok: false,
        error: `${ASSERTION_CANDIDATE_TIMEOUT_MS}ms 内未出现元素`,
      })
    }
  }
  return { base: null, hit: null, attempts }
}
