import { z } from 'zod'

/**
 * 定位器候选，按优先级排序使用：
 * testId（data-testid）→ role（角色 + 可访问名）→ text（文本）→ css
 */
export const locatorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('testId'), value: z.string().min(1) }),
  z.object({
    type: z.literal('role'),
    value: z.string().min(1),
    name: z.string().optional(),
  }),
  z.object({ type: z.literal('text'), value: z.string().min(1) }),
  z.object({ type: z.literal('css'), value: z.string().min(1) }),
])

export type Locator = z.infer<typeof locatorSchema>
