import { z } from 'zod'
import { assertionSchema, isPageLevelAssertion } from './assertion'

/** M1 动作集：点击 / 输入 / 选择 / 按键 / 断言 / 滚动 / 等待 */
export const actionSchema = z.enum(['click', 'fill', 'select', 'press', 'assert', 'scroll', 'wait'])

export type Action = z.infer<typeof actionSchema>

export const fillParamsSchema = z.object({ value: z.string() })
export const selectParamsSchema = z.object({ value: z.string() })
export const pressParamsSchema = z.object({ key: z.string() })
/** 页面滚动：绝对坐标（录制时取 window.scrollX/Y） */
export const scrollParamsSchema = z.object({ x: z.number(), y: z.number() })
/** 等待：元素可见/隐藏、网络空闲、固定延时 */
export const waitParamsSchema = z.object({
  kind: z.enum(['visible', 'hidden', 'networkIdle', 'timeout']).default('timeout'),
  ms: z.number().int().nonnegative().optional(),
})

/** 步骤级条件：变量不满足时跳过该步 */
export const stepConditionSchema = z.object({
  variable: z.string().min(1),
  operator: z.enum([
    '=',
    '!=',
    '>',
    '<',
    '>=',
    '<=',
    'contains',
    'notContains',
    'exists',
    'notExists',
  ]),
  value: z.string().optional(),
})

export type StepCondition = z.infer<typeof stepConditionSchema>

export const stepSchema = z
  .object({
    id: z.string().min(1),
    action: actionSchema,
    /** press / scroll / wait / 页面级断言可以没有目标元素 */
    elementId: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    assertion: assertionSchema.optional(),
    condition: stepConditionSchema.optional(),
  })
  .superRefine((step, ctx) => {
    if (step.action === 'assert' && !step.assertion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'assert 步骤必须包含 assertion',
      })
      return
    }
    if (step.action === 'click' || step.action === 'fill' || step.action === 'select') {
      if (!step.elementId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${step.action} 步骤必须指定 elementId`,
        })
      }
      return
    }
    if (
      step.action === 'assert' &&
      step.assertion &&
      !isPageLevelAssertion(step.assertion) &&
      !step.elementId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '元素级断言必须指定 elementId',
      })
    }
    if (
      step.action === 'wait' &&
      (step.params?.kind === 'visible' || step.params?.kind === 'hidden') &&
      !step.elementId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '等待元素可见/隐藏时必须指定 elementId',
      })
    }
  })

export type Step = z.infer<typeof stepSchema>
