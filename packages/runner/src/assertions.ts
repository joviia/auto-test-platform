import { type Assertion, assertionSchema } from '@atp/model'
import type { Locator } from 'playwright'

export interface AssertionOutcome {
  type: Assertion['type']
  expected: string
  actual: string
}

export class AssertionError extends Error {
  constructor(
    message: string,
    readonly outcome: AssertionOutcome,
  ) {
    super(message)
  }
}

const ASSERT_TIMEOUT_MS = 5000

export async function performAssertion(locator: Locator, raw: unknown): Promise<AssertionOutcome> {
  const a = assertionSchema.parse(raw)

  if (a.type === 'visible') {
    try {
      await locator.waitFor({ state: 'visible', timeout: ASSERT_TIMEOUT_MS })
    } catch {
      throw new AssertionError('断言失败：元素不可见', {
        type: a.type,
        expected: 'visible',
        actual: 'hidden',
      })
    }
    return { type: a.type, expected: 'visible', actual: 'visible' }
  }

  if (a.type === 'text') {
    const actual = (await locator.innerText()).trim()
    if (actual !== a.expected) {
      throw new AssertionError('断言失败：文本不匹配', {
        type: a.type,
        expected: a.expected,
        actual,
      })
    }
    return { type: a.type, expected: a.expected, actual }
  }

  const actual = await locator.inputValue()
  if (actual !== a.expected) {
    throw new AssertionError('断言失败：输入值不匹配', {
      type: a.type,
      expected: a.expected,
      actual,
    })
  }
  return { type: a.type, expected: a.expected, actual }
}
