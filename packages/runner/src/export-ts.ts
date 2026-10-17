import type { Assertion, CaseFile, Element, Step } from '@atp/model'
import { isPageLevelAssertion } from '@atp/model'
import { evaluateCondition, substituteStep } from './variables'

function quote(s: string): string {
  return JSON.stringify(s)
}

/** 元素 → Playwright 定位器表达式（取第一候选，语义优先） */
function locatorExpr(element: Element): string {
  const loc = element.locators[0]
  switch (loc.type) {
    case 'testId':
      return `page.getByTestId(${quote(loc.value)})`
    case 'role':
      return loc.name === undefined
        ? `page.getByRole('${loc.value}')`
        : `page.getByRole('${loc.value}', { name: ${quote(loc.name)} })`
    case 'text':
      return `page.getByText(${quote(loc.value)}, { exact: true })`
    case 'css':
      return `page.locator(${quote(loc.value)})`
  }
}

function regexLiteral(pattern: string): string {
  return `new RegExp(${quote(pattern)})`
}

function assertionLines(a: Assertion, loc: string | null): string[] {
  if (isPageLevelAssertion(a)) {
    switch (a.type) {
      case 'urlEquals':
        return [`await expect(page).toHaveURL(${quote(a.expected)})`]
      case 'urlContains':
        return [`await expect(page).toHaveURL(${regexLiteral(a.expected)})`]
      case 'titleEquals':
        return [`await expect(page).toHaveTitle(${quote(a.expected)})`]
      case 'titleContains':
        return [`await expect(page).toHaveTitle(${regexLiteral(a.expected)})`]
      case 'pageText':
        return [
          a.match === 'equals'
            ? `await expect(page.locator('body')).toHaveText(${quote(a.expected)})`
            : `await expect(page.locator('body')).toContainText(${quote(a.expected)})`,
        ]
    }
  }
  if (!loc) return ['// 断言缺少目标元素，已跳过']
  switch (a.type) {
    case 'visible':
      return [`await expect(${loc}).toBeVisible()`]
    case 'hidden':
      return [`await expect(${loc}).toBeHidden()`]
    case 'exists':
      return [`await expect(${loc}).toHaveCount(1)`]
    case 'notExists':
      return [`await expect(${loc}).toHaveCount(0)`]
    case 'enabled':
      return [`await expect(${loc}).toBeEnabled()`]
    case 'disabled':
      return [`await expect(${loc}).toBeDisabled()`]
    case 'checked':
      return [`await expect(${loc}).toBeChecked()`]
    case 'unchecked':
      return [`await expect(${loc}).not.toBeChecked()`]
    case 'count':
      if (a.op === '=') return [`await expect(${loc}).toHaveCount(${a.expected})`]
      return [
        `expect(await ${loc}.count()).${a.op === '>=' ? 'toBeGreaterThanOrEqual' : 'toBeLessThanOrEqual'}(${a.expected})`,
      ]
    case 'text':
      return [`await expect(${loc}).toHaveText(${quote(a.expected)})`]
    case 'textContains':
      return [`await expect(${loc}).toContainText(${quote(a.expected)})`]
    case 'textMatches':
      return [`await expect(${loc}).toHaveText(${regexLiteral(a.expected)})`]
    case 'value':
      return [`await expect(${loc}).toHaveValue(${quote(a.expected)})`]
    case 'valueContains':
      return [`await expect(${loc}).toHaveValue(${regexLiteral(a.expected)})`]
    case 'attribute':
      return [
        a.match === 'exists'
          ? `await expect(${loc}).toHaveAttribute(${quote(a.name)})`
          : a.match === 'equals'
            ? `await expect(${loc}).toHaveAttribute(${quote(a.name)}, ${quote(a.expected ?? '')})`
            : `await expect(${loc}).toHaveAttribute(${quote(a.name)}, ${regexLiteral(a.expected ?? '')})`,
      ]
    case 'css':
      return [`await expect(${loc}).toHaveCSS(${quote(a.name)}, ${quote(a.expected)})`]
  }
  return ['// 未支持的断言类型']
}

function stepLines(step: Step, elements: Record<string, Element>): string[] {
  const element = step.elementId ? elements[step.elementId] : undefined
  const loc = element ? locatorExpr(element) : null
  const comment = element ? `// ${element.name}` : '// 页面级操作'
  const lines: string[] = [comment]
  const params = step.params ?? {}

  switch (step.action) {
    case 'click':
      if (loc) lines.push(`await ${loc}.click()`)
      break
    case 'fill':
      if (loc) lines.push(`await ${loc}.fill(${quote(String(params.value ?? ''))})`)
      break
    case 'select':
      if (loc) lines.push(`await ${loc}.selectOption(${quote(String(params.value ?? ''))})`)
      break
    case 'press':
      lines.push(`await page.keyboard.press(${quote(String(params.key ?? 'Enter'))})`)
      break
    case 'drag':
      if (loc) {
        const startX = params.startX === undefined ? 'box.width / 2' : Number(params.startX)
        const startY = params.startY === undefined ? 'box.height / 2' : Number(params.startY)
        lines.push(
          '{',
          `  const box = await ${loc}.boundingBox()`,
          '  if (box) {',
          `    const sx = box.x + ${startX}`,
          `    const sy = box.y + ${startY}`,
          '    await page.mouse.move(sx, sy)',
          '    await page.mouse.down()',
          `    await page.mouse.move(sx + ${Number(params.dx ?? 0)}, sy + ${Number(params.dy ?? 0)}, { steps: ${Number(params.steps ?? 24)} })`,
          '    await page.mouse.up()',
          '  }',
          '}',
        )
      }
      break
    case 'scroll':
      lines.push(
        `await page.evaluate(() => window.scrollTo({ left: ${Number(params.x ?? 0)}, top: ${Number(params.y ?? 0)} }))`,
      )
      break
    case 'wait': {
      const kind = String(params.kind ?? 'timeout')
      if (kind === 'networkIdle') lines.push("await page.waitForLoadState('networkidle')")
      else if (kind === 'timeout')
        lines.push(`await page.waitForTimeout(${Number(params.ms ?? 1000)})`)
      else if (loc)
        lines.push(
          `await ${loc}.waitFor({ state: ${quote(kind === 'hidden' ? 'hidden' : 'visible')} })`,
        )
      break
    }
    case 'assert': {
      if (!step.assertion) break
      lines.push(...assertionLines(step.assertion, loc))
      break
    }
  }
  return lines
}

/** 用例 → 可执行的 Playwright TS 测试脚本（@playwright/test 风格） */
export function toPlaywrightSpec(caseFile: CaseFile): string {
  const { case: c, elements } = caseFile
  const variables = c.variables ?? {}
  const body: string[] = []

  for (const rawStep of c.steps) {
    const step = substituteStep(rawStep, variables)
    const lines = stepLines(step, elements)
    if (step.condition && !evaluateCondition(step.condition, variables)) {
      body.push(`    // 条件不满足，回放时将跳过：${step.id}`)
      continue
    }
    for (const line of lines) body.push(`    ${line}`)
  }

  return `// 由自动化测试平台导出 · 用例「${c.name}」(${c.id})
// 定位器取元素库第一候选；多候选回退逻辑见平台内回放引擎
import { expect, test } from '@playwright/test'

const variables = ${JSON.stringify(variables, null, 2)}

test(${quote(c.name)}, async ({ page }) => {
    await page.goto(${quote(c.startUrl)})
${body.join('\n')}
})
`
}
