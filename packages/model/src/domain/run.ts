import { z } from 'zod'
import { locatorSchema } from './locator'
import { actionSchema } from './step'

export const stepStatusSchema = z.enum(['passed', 'failed'])

export type StepStatus = z.infer<typeof stepStatusSchema>

/** 单个候选定位器的尝试结果 */
export const candidateAttemptSchema = z.object({
  locator: locatorSchema,
  ok: z.boolean(),
  error: z.string().optional(),
})

export type CandidateAttempt = z.infer<typeof candidateAttemptSchema>

/** 命中的候选：第几层（tier 从 0 起）与具体定位器 */
export const locatorHitSchema = z.object({
  tier: z.number().int().nonnegative(),
  locator: locatorSchema,
})

export type LocatorHit = z.infer<typeof locatorHitSchema>

/** 步骤级结果 —— 证据落到步骤粒度（方案 §4.3） */
export const stepResultSchema = z.object({
  stepId: z.string(),
  index: z.number().int().nonnegative(),
  action: actionSchema,
  status: stepStatusSchema,
  durationMs: z.number().nonnegative(),
  error: z.string().optional(),
  locatorHit: locatorHitSchema.optional(),
  triedCandidates: z.array(candidateAttemptSchema).optional(),
  assertion: z
    .object({
      type: z.string(),
      expected: z.string().optional(),
      actual: z.string().optional(),
    })
    .optional(),
  /** 条件不满足而跳过 */
  skipped: z.boolean().optional(),
  screenshotPath: z.string().optional(),
})

export type StepResult = z.infer<typeof stepResultSchema>

/** 一次回放的完整记录（执行记录，与用例定义分离） */
export const runResultSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  caseName: z.string(),
  startUrl: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  status: stepStatusSchema,
  error: z.string().optional(),
  videoPath: z.string().optional(),
  steps: z.array(stepResultSchema),
})

export type RunResult = z.infer<typeof runResultSchema>
