import { z } from 'zod'

/** 断言超时：默认 5s，可逐条覆盖 */
const timeout = { timeoutMs: z.number().int().positive().optional() }

/**
 * 断言库：元素状态 / 文本 / 值 / 属性 / 样式 / 数量 / 页面级。
 * 页面级断言（url/title/pageText）不依赖元素。
 */
export const assertionSchema = z.discriminatedUnion('type', [
  // 元素状态
  z.object({ type: z.literal('visible'), ...timeout }),
  z.object({ type: z.literal('hidden'), ...timeout }),
  z.object({ type: z.literal('exists'), ...timeout }),
  z.object({ type: z.literal('notExists'), ...timeout }),
  z.object({ type: z.literal('enabled'), ...timeout }),
  z.object({ type: z.literal('disabled'), ...timeout }),
  z.object({ type: z.literal('checked'), ...timeout }),
  z.object({ type: z.literal('unchecked'), ...timeout }),
  z.object({
    type: z.literal('count'),
    op: z.enum(['=', '>=', '<=']).default('='),
    expected: z.number().int().nonnegative(),
    ...timeout,
  }),

  // 文本
  z.object({
    type: z.literal('text'),
    expected: z.string(),
    ignoreCase: z.boolean().optional(),
    ...timeout,
  }),
  z.object({
    type: z.literal('textContains'),
    expected: z.string(),
    ignoreCase: z.boolean().optional(),
    ...timeout,
  }),
  z.object({ type: z.literal('textMatches'), expected: z.string(), ...timeout }),

  // 输入值
  z.object({
    type: z.literal('value'),
    expected: z.string(),
    ignoreCase: z.boolean().optional(),
    ...timeout,
  }),
  z.object({
    type: z.literal('valueContains'),
    expected: z.string(),
    ignoreCase: z.boolean().optional(),
    ...timeout,
  }),

  // 表单语义
  z.object({ type: z.literal('fieldInvalid'), ...timeout }),
  z.object({
    type: z.literal('fieldError'),
    expected: z.string().optional(),
    ...timeout,
  }),

  // 属性 / 样式
  z.object({
    type: z.literal('attribute'),
    name: z.string().min(1),
    match: z.enum(['exists', 'equals', 'contains']).default('equals'),
    expected: z.string().optional(),
    ...timeout,
  }),
  z.object({
    type: z.literal('css'),
    name: z.string().min(1),
    expected: z.string(),
    ...timeout,
  }),

  // 页面级
  z.object({ type: z.literal('urlEquals'), expected: z.string(), ...timeout }),
  z.object({ type: z.literal('urlContains'), expected: z.string(), ...timeout }),
  z.object({ type: z.literal('titleEquals'), expected: z.string(), ...timeout }),
  z.object({ type: z.literal('titleContains'), expected: z.string(), ...timeout }),
  z.object({
    type: z.literal('pageText'),
    match: z.enum(['contains', 'equals']).default('contains'),
    expected: z.string(),
    ...timeout,
  }),
])

export type Assertion = z.infer<typeof assertionSchema>

/** 不依赖元素、可直接在页面级执行的断言类型 */
export const PAGE_LEVEL_ASSERTIONS = new Set<Assertion['type']>([
  'urlEquals',
  'urlContains',
  'titleEquals',
  'titleContains',
  'pageText',
])

export function isPageLevelAssertion(a: Assertion): boolean {
  return PAGE_LEVEL_ASSERTIONS.has(a.type)
}

/** 只有这些断言需要「期望值」输入 */
export function assertionNeedsExpected(type: Assertion['type']): boolean {
  return ![
    'visible',
    'hidden',
    'exists',
    'notExists',
    'enabled',
    'disabled',
    'checked',
    'unchecked',
    'count',
    'fieldInvalid',
  ].includes(type)
}
