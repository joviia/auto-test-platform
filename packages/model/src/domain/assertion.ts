import { z } from 'zod'

/** 断言三型（M1）：可见性 / 文本 / 值 */
export const assertionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('visible') }),
  z.object({ type: z.literal('text'), expected: z.string() }),
  z.object({ type: z.literal('value'), expected: z.string() }),
])

export type Assertion = z.infer<typeof assertionSchema>
