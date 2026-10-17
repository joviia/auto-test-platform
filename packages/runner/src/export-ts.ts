import type { CaseFile, Element, Step } from '@atp/model'

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
        ? `page.getByRole(${quote(loc.value)})`
        : `page.getByRole(${quote(loc.value)}, { name: ${quote(loc.name)} })`
    case 'text':
      return `page.getByText(${quote(loc.value)}, { exact: true })`
    case 'css':
      return `page.locator(${quote(loc.value)})`
  }
}

function stepLines(step: Step, elements: Record<string, Element>): string[] {
  const element = step.elementId ? elements[step.elementId] : undefined
  const loc = element ? locatorExpr(element) : null
  const comment = element ? `// ${element.name}` : '// 页面级操作'
  const lines: string[] = [comment]

  switch (step.action) {
    case 'click':
      if (loc) lines.push(`await ${loc}.click()`)
      break
    case 'fill':
      if (loc) lines.push(`await ${loc}.fill(${quote(String(step.params?.value ?? ''))})`)
      break
    case 'select':
      if (loc) lines.push(`await ${loc}.selectOption(${quote(String(step.params?.value ?? ''))})`)
      break
    case 'press':
      lines.push(`await page.keyboard.press(${quote(String(step.params?.key ?? 'Enter'))})`)
      break
    case 'assert': {
      if (!loc || !step.assertion) break
      const a = step.assertion
      if (a.type === 'visible') lines.push(`await expect(${loc}).toBeVisible()`)
      if (a.type === 'text') lines.push(`await expect(${loc}).toHaveText(${quote(a.expected)})`)
      if (a.type === 'value') lines.push(`await expect(${loc}).toHaveValue(${quote(a.expected)})`)
      break
    }
  }
  return lines
}

/** 用例 → 可执行的 Playwright TS 测试脚本（@playwright/test 风格） */
export function toPlaywrightSpec(caseFile: CaseFile): string {
  const { case: c, elements } = caseFile
  const body = c.steps.flatMap((step) => stepLines(step, elements).map((l) => `    ${l}`))

  return `// 由自动化测试平台导出 · 用例「${c.name}」(${c.id})
// 定位器取元素库第一候选；多候选回退逻辑见平台内回放引擎
import { expect, test } from '@playwright/test'

test(${quote(c.name)}, async ({ page }) => {
    await page.goto(${quote(c.startUrl)})
${body.join('\n')}
})
`
}
