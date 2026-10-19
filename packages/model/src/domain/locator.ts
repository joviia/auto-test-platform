import { z } from 'zod'

/**
 * 定位器候选。语义优先、结构兜底：
 * testId → role → text → css → xpath
 * within 表示「在某个作用域内查找目标」，用于区分页面/弹窗/行/Tab 中的同名元素。
 */
export type Locator =
  | { type: 'testId'; value: string }
  | { type: 'role'; value: string; name?: string }
  | { type: 'text'; value: string }
  | { type: 'css'; value: string }
  | { type: 'xpath'; value: string }
  | { type: 'within'; scope: Locator; target: Locator; topmost?: boolean }

export const locatorSchema: z.ZodType<Locator> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('testId'), value: z.string().min(1) }),
    z.object({
      type: z.literal('role'),
      value: z.string().min(1),
      name: z.string().optional(),
    }),
    z.object({ type: z.literal('text'), value: z.string().min(1) }),
    z.object({ type: z.literal('css'), value: z.string().min(1) }),
    z.object({ type: z.literal('xpath'), value: z.string().min(1) }),
    z.object({
      type: z.literal('within'),
      scope: locatorSchema,
      target: locatorSchema,
      /** scope 命中多个时取最上层（按 z-index / DOM 顺序） */
      topmost: z.boolean().optional(),
    }),
  ]),
)

/** 人类可读的定位器描述（报告 / 元素库 / CLI 共用） */
export function formatLocator(loc: Locator): string {
  switch (loc.type) {
    case 'role':
      return loc.name ? `${loc.value}「${loc.name}」` : loc.value
    case 'within':
      return `${formatLocator(loc.scope)}${loc.topmost ? '（最上层）' : ''} → ${formatLocator(loc.target)}`
    default:
      return loc.value
  }
}
