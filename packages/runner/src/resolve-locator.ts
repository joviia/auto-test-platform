import type { CandidateAttempt, Element, Locator as ModelLocator } from '@atp/model'
import type { Page } from 'playwright'
import type { Locator } from 'playwright'

const CANDIDATE_TIMEOUT_MS = 2500

type Role = Parameters<Page['getByRole']>[0]

/** 把模型定位器候选翻译成 Playwright 定位器 */
export function toPlaywrightLocator(page: Page, loc: ModelLocator): Locator {
  switch (loc.type) {
    case 'testId':
      return page.getByTestId(loc.value)
    case 'role':
      return page.getByRole(
        loc.value as Role,
        loc.name === undefined ? undefined : { name: loc.name },
      )
    case 'text':
      return page.getByText(loc.value, { exact: true })
    case 'css':
      return page.locator(loc.value)
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
  for (const [tier, loc] of element.locators.entries()) {
    const candidate = toPlaywrightLocator(page, loc).first()
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

const ASSERTION_CANDIDATE_TIMEOUT_MS = 800

/**
 * 断言专用解析：只要元素在 DOM 中存在（attached）即可，
 * 不要求可见——hidden / notExists 等断言需要能定位到隐藏元素。
 */
export async function resolveElementForAssertion(
  page: Page,
  element: Element,
): Promise<AssertionResolveOutcome> {
  const attempts: CandidateAttempt[] = []
  for (const [tier, loc] of element.locators.entries()) {
    const base = toPlaywrightLocator(page, loc)
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
