import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CaseFile } from '@atp/model'
import { caseFileSchema } from '@atp/model'
import { describe, expect, it } from 'vitest'
import { toPlaywrightSpec } from './export-ts.js'

const example = JSON.parse(
  readFileSync(resolve(__dirname, '../examples/login-success.case.json'), 'utf8'),
) as unknown

describe('toPlaywrightSpec', () => {
  it('示例用例导出为可读的 playwright 脚本', () => {
    const file = caseFileSchema.parse(example) as CaseFile
    const code = toPlaywrightSpec(file)
    expect(code).toContain("import { expect, test, type Locator } from '@playwright/test'")
    expect(code).toContain('await page.goto(')
    expect(code).toContain('page.getByTestId("username-input").fill("admin")')
    expect(code).toContain('page.getByTestId("login-submit").click()')
    expect(code).toContain('toHaveText("登录成功")')
  })

  it('表单语义断言导出为 toBeInvalid', () => {
    const file = caseFileSchema.parse(example) as CaseFile
    file.case.steps.push(
      {
        id: 's-005',
        action: 'assert',
        elementId: 'el-username',
        assertion: { type: 'fieldInvalid' },
      },
      {
        id: 's-006',
        action: 'assert',
        elementId: 'el-username',
        assertion: { type: 'fieldError', expected: '用户名' },
      },
    )
    const code = toPlaywrightSpec(file)
    expect(code.match(/toBeInvalid\(\)/g)).toHaveLength(2)
    expect(code).toContain('期望字段错误提示包含：用户名')
  })
})
