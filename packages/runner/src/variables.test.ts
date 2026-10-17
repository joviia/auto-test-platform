import type { Step } from '@atp/model'
import { describe, expect, it } from 'vitest'
import { evaluateCondition, substituteStep, substituteVariables } from './variables'

describe('substituteVariables', () => {
  it('替换已知变量并保留未知占位符', () => {
    expect(substituteVariables('${user}/${missing}', { user: 'admin' })).toBe('admin/${missing}')
  })

  it('替换步骤参数、断言期望与条件值', () => {
    const step: Step = {
      id: 's1',
      action: 'assert',
      elementId: 'el-1',
      assertion: { type: 'text', expected: '${expected}' },
      condition: { variable: 'mode', operator: '=', value: '${mode}' },
    }
    const next = substituteStep(step, { expected: '登录成功', mode: 'prod' })
    expect(next.assertion).toEqual({ type: 'text', expected: '登录成功' })
    expect(next.condition?.value).toBe('prod')
  })
})

describe('evaluateCondition', () => {
  it('未配置条件时执行', () => {
    expect(evaluateCondition(undefined, {})).toBe(true)
  })

  it('支持字符串、数值与存在性比较', () => {
    const vars = { env: 'prod', count: '12' }
    expect(evaluateCondition({ variable: 'env', operator: '=', value: 'prod' }, vars)).toBe(true)
    expect(evaluateCondition({ variable: 'env', operator: '!=', value: 'dev' }, vars)).toBe(true)
    expect(evaluateCondition({ variable: 'env', operator: 'contains', value: 'ro' }, vars)).toBe(
      true,
    )
    expect(evaluateCondition({ variable: 'count', operator: '>', value: '10' }, vars)).toBe(true)
    expect(evaluateCondition({ variable: 'count', operator: '<=', value: '10' }, vars)).toBe(false)
    expect(evaluateCondition({ variable: 'env', operator: 'exists' }, vars)).toBe(true)
    expect(evaluateCondition({ variable: 'missing', operator: 'notExists' }, vars)).toBe(true)
    expect(evaluateCondition({ variable: 'missing', operator: '=', value: 'x' }, vars)).toBe(false)
  })
})
