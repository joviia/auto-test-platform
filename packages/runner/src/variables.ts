import type { Step, StepCondition } from '@atp/model'

/** 替换字符串中的 ${name}（未定义时保留原样，便于在报告里看出漏配变量） */
export function substituteVariables(value: string, variables: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (raw, name: string) => variables[name.trim()] ?? raw)
}

/** 步骤参数/断言期望/条件值中的变量替换 */
export function substituteStep(step: Step, variables: Record<string, string>): Step {
  const params = step.params
  const nextParams = params
    ? Object.fromEntries(
        Object.entries(params).map(([key, value]) => [
          key,
          typeof value === 'string' ? substituteVariables(value, variables) : value,
        ]),
      )
    : undefined

  const assertion = step.assertion
  let nextAssertion = assertion
  if (assertion && 'expected' in assertion && typeof assertion.expected === 'string') {
    nextAssertion = {
      ...assertion,
      expected: substituteVariables(assertion.expected, variables),
    } as typeof assertion
  }

  const condition = step.condition
  const nextCondition =
    condition?.value === undefined
      ? condition
      : { ...condition, value: substituteVariables(condition.value, variables) }

  return { ...step, params: nextParams, assertion: nextAssertion, condition: nextCondition }
}

export function evaluateCondition(
  condition: StepCondition | undefined,
  variables: Record<string, string>,
): boolean {
  if (!condition) return true
  const { variable, operator, value = '' } = condition
  const exists = Object.hasOwn(variables, variable)
  const actual = exists ? variables[variable] : ''

  if (operator === 'exists') return exists
  if (operator === 'notExists') return !exists
  if (!exists) return false

  switch (operator) {
    case '=':
      return actual === value
    case '!=':
      return actual !== value
    case 'contains':
      return actual.includes(value)
    case 'notContains':
      return !actual.includes(value)
    case '>':
    case '<':
    case '>=':
    case '<=': {
      const a = Number(actual)
      const b = Number(value)
      if (Number.isNaN(a) || Number.isNaN(b)) {
        if (operator === '>') return actual > value
        if (operator === '<') return actual < value
        if (operator === '>=') return actual >= value
        return actual <= value
      }
      if (operator === '>') return a > b
      if (operator === '<') return a < b
      if (operator === '>=') return a >= b
      return a <= b
    }
    default:
      return false
  }
}
