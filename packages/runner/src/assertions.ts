import { type Assertion, assertionSchema, isPageLevelAssertion } from '@atp/model'
import type { Locator, Page } from 'playwright'

export interface AssertionOutcome {
  type: string
  expected?: string
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

const DEFAULT_TIMEOUT_MS = 5000
const POLL_INTERVAL_MS = 100

interface Attempt {
  ok: boolean
  actual: string
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** 轮询直到通过或超时；最后一次的 actual 用于失败报告 */
async function pollUntil(fn: () => Promise<Attempt>, timeoutMs: number): Promise<Attempt> {
  const deadline = Date.now() + timeoutMs
  let last: Attempt = { ok: false, actual: '' }
  while (true) {
    try {
      last = await fn()
    } catch (err) {
      last = { ok: false, actual: err instanceof Error ? err.message : String(err) }
    }
    if (last.ok) return last
    if (Date.now() >= deadline) return last
    await delay(POLL_INTERVAL_MS)
  }
}

function norm(value: string, ignoreCase?: boolean): string {
  const trimmed = value.trim()
  return ignoreCase ? trimmed.toLowerCase() : trimmed
}

function matches(actual: string, expected: string, ignoreCase?: boolean): boolean {
  return norm(actual, ignoreCase) === norm(expected, ignoreCase)
}

/**
 * 执行断言。locator 为元素首个匹配；base 用于 count/存在性（不做 .first()）。
 * 页面级断言不传 locator/base。
 */
export async function performAssertion(
  page: Page,
  locator: Locator | null,
  base: Locator | null,
  raw: unknown,
): Promise<AssertionOutcome> {
  const a = assertionSchema.parse(raw)
  const timeoutMs = a.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const element = (): Locator => {
    if (!locator) throw new Error('断言缺少目标元素')
    return locator
  }

  if (isPageLevelAssertion(a)) {
    if (a.type === 'urlEquals' || a.type === 'urlContains') {
      const attempt = await pollUntil(async () => {
        const actual = page.url()
        const ok = a.type === 'urlEquals' ? actual === a.expected : actual.includes(a.expected)
        return { ok, actual }
      }, timeoutMs)
      return finish(a, a.expected, attempt)
    }
    if (a.type === 'titleEquals' || a.type === 'titleContains') {
      const attempt = await pollUntil(async () => {
        const actual = await page.title()
        const ok = a.type === 'titleEquals' ? actual === a.expected : actual.includes(a.expected)
        return { ok, actual }
      }, timeoutMs)
      return finish(a, a.expected, attempt)
    }
    // pageText
    if (a.type === 'pageText') {
      const attempt = await pollUntil(async () => {
        const actual = await page.locator('body').innerText()
        const ok =
          a.match === 'equals' ? norm(actual) === norm(a.expected) : actual.includes(a.expected)
        return { ok, actual: actual.slice(0, 200) }
      }, timeoutMs)
      return finish(a, a.expected, attempt)
    }
    throw new Error(`未知的页面级断言：${a.type}`)
  }

  switch (a.type) {
    case 'visible':
    case 'hidden': {
      const wantVisible = a.type === 'visible'
      const attempt = await pollUntil(async () => {
        const visible = await element().isVisible()
        return { ok: wantVisible ? visible : !visible, actual: visible ? 'visible' : 'hidden' }
      }, timeoutMs)
      return finish(a, wantVisible ? 'visible' : 'hidden', attempt)
    }
    case 'exists':
    case 'notExists': {
      const wantExists = a.type === 'exists'
      const attempt = await pollUntil(async () => {
        const count = base ? await base.count() : 0
        return {
          ok: wantExists ? count > 0 : count === 0,
          actual: `匹配 ${count} 个元素`,
        }
      }, timeoutMs)
      return finish(a, wantExists ? '存在' : '不存在', attempt)
    }
    case 'enabled':
    case 'disabled': {
      const wantEnabled = a.type === 'enabled'
      const attempt = await pollUntil(async () => {
        const enabled = await element().isEnabled()
        return {
          ok: wantEnabled ? enabled : !enabled,
          actual: enabled ? 'enabled' : 'disabled',
        }
      }, timeoutMs)
      return finish(a, wantEnabled ? 'enabled' : 'disabled', attempt)
    }
    case 'checked':
    case 'unchecked': {
      const wantChecked = a.type === 'checked'
      const attempt = await pollUntil(async () => {
        const checked = await element().isChecked()
        return { ok: wantChecked ? checked : !checked, actual: checked ? 'checked' : 'unchecked' }
      }, timeoutMs)
      return finish(a, wantChecked ? 'checked' : 'unchecked', attempt)
    }
    case 'count': {
      const expected = `${a.op} ${a.expected}`
      const attempt = await pollUntil(async () => {
        const count = base ? await base.count() : 0
        const ok =
          a.op === '='
            ? count === a.expected
            : a.op === '>='
              ? count >= a.expected
              : count <= a.expected
        return { ok, actual: String(count) }
      }, timeoutMs)
      return finish(a, expected, attempt)
    }
    case 'text':
    case 'textContains':
    case 'textMatches': {
      const attempt = await pollUntil(async () => {
        const actual = await element().innerText()
        const ok =
          a.type === 'text'
            ? matches(actual, a.expected, a.ignoreCase)
            : a.type === 'textContains'
              ? norm(actual, a.ignoreCase).includes(norm(a.expected, a.ignoreCase))
              : new RegExp(a.expected).test(actual)
        return { ok, actual }
      }, timeoutMs)
      return finish(a, a.expected, attempt)
    }
    case 'value':
    case 'valueContains': {
      const attempt = await pollUntil(async () => {
        const actual = await element().inputValue()
        const ok =
          a.type === 'value'
            ? matches(actual, a.expected, a.ignoreCase)
            : norm(actual, a.ignoreCase).includes(norm(a.expected, a.ignoreCase))
        return { ok, actual }
      }, timeoutMs)
      return finish(a, a.expected, attempt)
    }
    case 'attribute': {
      const expected =
        a.match === 'exists' ? `${a.name} 存在` : `${a.name} ${a.match} ${a.expected ?? ''}`
      const attempt = await pollUntil(async () => {
        const actual = await element().getAttribute(a.name)
        const ok =
          a.match === 'exists'
            ? actual !== null
            : actual !== null &&
              (a.match === 'equals' ? actual === a.expected : actual.includes(a.expected ?? ''))
        return { ok, actual: actual ?? '(null)' }
      }, timeoutMs)
      return finish(a, expected, attempt)
    }
    case 'css': {
      const attempt = await pollUntil(async () => {
        const actual = await element().evaluate(
          (el, name) => window.getComputedStyle(el).getPropertyValue(name),
          a.name,
        )
        return { ok: actual.trim() === a.expected.trim(), actual }
      }, timeoutMs)
      return finish(a, `${a.name} = ${a.expected}`, attempt)
    }
    case 'fieldInvalid': {
      const attempt = await pollUntil(async () => {
        const invalid = await element().evaluate((el) => {
          const input = el as HTMLInputElement
          if (input.getAttribute('aria-invalid') === 'true') return true
          try {
            if (typeof input.checkValidity === 'function' && !input.checkValidity()) return true
          } catch {
            // 非原生表单控件没有 checkValidity
          }
          // Element Plus / Ant Design 的错误态不一定在 6 层祖先内
          if (
            el.closest(
              '.is-error, .ant-form-item-has-error, [data-invalid="true"], .el-form-item__content.is-error',
            )
          ) {
            return true
          }
          const formItem = el.closest('.el-form-item, .ant-form-item, .form-item, [data-form-item]')
          const errorNode = formItem?.querySelector(
            '.el-form-item__error, .ant-form-item-explain-error, [role="alert"], .atp-field-error',
          )
          if (errorNode) {
            const style = window.getComputedStyle(errorNode)
            const text = (errorNode.textContent ?? '').trim()
            if (text && style.display !== 'none' && style.visibility !== 'hidden') return true
          }
          let node: Element | null = el
          for (let depth = 0; depth < 6 && node; depth += 1) {
            if (
              node.matches(
                '[data-invalid="true"], .is-error, .el-form-item.is-error, .ant-form-item-has-error, .atp-field-invalid',
              )
            ) {
              return true
            }
            node = node.parentElement
          }
          return false
        })
        return { ok: invalid, actual: invalid ? 'invalid' : 'valid' }
      }, timeoutMs)
      return finish(a, 'invalid', attempt)
    }
    case 'fieldError': {
      const expected = a.expected ?? '存在错误提示'
      const attempt = await pollUntil(async () => {
        const actual = await element().evaluate((el, want) => {
          const input = el as HTMLInputElement
          if (typeof input.validationMessage === 'string' && input.validationMessage.trim()) {
            const text = input.validationMessage.trim()
            return want ? (text.includes(want) ? text : '') : text
          }
          const selectors = [
            '[role="alert"]',
            '.el-form-item__error',
            '.ant-form-item-explain-error',
            '.atp-field-error',
          ].join(',')
          let node: Element | null = el
          for (let depth = 0; depth < 6 && node; depth += 1) {
            const candidates = Array.from(node.querySelectorAll(selectors))
            for (const candidate of candidates) {
              const style = window.getComputedStyle(candidate)
              if (style.display === 'none' || style.visibility === 'hidden') continue
              const text = (candidate.textContent ?? '').trim()
              if (!text) continue
              if (!want || text.includes(want)) return text.slice(0, 200)
            }
            node = node.parentElement
          }
          return ''
        }, a.expected ?? '')
        return { ok: actual.length > 0, actual: actual || '(无错误提示)' }
      }, timeoutMs)
      return finish(a, expected, attempt)
    }
  }
  throw new Error(`未知断言类型：${(a as Assertion).type}`)
}

function finish(a: Assertion, expected: string, attempt: Attempt): AssertionOutcome {
  if (!attempt.ok) {
    throw new AssertionError(
      `断言失败（${a.type}）：期望「${expected}」实际「${attempt.actual}」`,
      {
        type: a.type,
        expected,
        actual: attempt.actual,
      },
    )
  }
  return { type: a.type, expected, actual: attempt.actual }
}
