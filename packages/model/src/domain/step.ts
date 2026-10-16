import { z } from 'zod'
import { assertionSchema } from './assertion'

/** M1 支持的五种动作 */
export const actionSchema = z.enum(['click', 'fill', 'select', 'press', 'assert'])

export type Action = z.infer<typeof actionSchema>

export const fillParamsSchema = z.object({ value: z.string() })
export const selectParamsSchema = z.object({ value: z.string() })
export const pressParamsSchema = z.object({ key: z.string() })

export const stepSchema = z
  .object({
    id: z.string().min(1),
    action: actionSchema,
    /** press 为页面级按键，可无目标元素；其余动作必须有 elementId */
    elementId: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    assertion: assertionSchema.optional(),
  })
  .superRefine((step, ctx) => {
    if (step.action === 'assert' && !step.assertion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assert 步骤必须包含 assertion',
      })
    }
    if (step.action !== 'press' && step.action !== 'assert' && !step.elementId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${step.action} 步骤必须指定 elementId`,
      })
    }
  })

export type Step = z.infer<typeof stepSchema>
