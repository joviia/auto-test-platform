import { z } from 'zod'
import {
  actionSchema,
  assertionSchema,
  candidateAttemptSchema,
  locatorHitSchema,
  locatorSchema,
  stepConditionSchema,
} from '../domain/index.js'

/** 七张表的行 DTO（locators/params/assertion 落 JSON 列，进库前用 domain schema 校验） */

export const projectRowSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string(),
})

export const moduleRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parentId: z.string().nullable(),
  name: z.string().min(1),
  createdAt: z.string(),
})

export const caseRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  moduleId: z.string().nullable(),
  name: z.string().min(1),
  startUrl: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const caseStepRowSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  idx: z.number().int().nonnegative(),
  action: actionSchema,
  elementId: z.string().nullable(),
  params: z.record(z.string(), z.unknown()).optional(),
  assertion: assertionSchema.optional(),
  condition: stepConditionSchema.optional(),
})

export const elementRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1),
  locators: z.array(locatorSchema),
  framePath: z.array(z.number().int().nonnegative()).optional(),
})

export const suiteRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1),
  description: z.string().nullable(),
  caseCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const planRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1),
  suiteId: z.string().nullable(),
  retries: z.number().int().nonnegative(),
  timeoutMs: z.number().int().positive(),
  continueOnFailure: z.boolean(),
  caseCount: z.number().int().nonnegative(),
  lastRunStatus: z.enum(['running', 'passed', 'failed', 'cancelled']).nullable(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const planRunStatusSchema = z.enum(['running', 'passed', 'failed', 'cancelled'])

export const planRunRowSchema = z.object({
  id: z.string(),
  planId: z.string(),
  status: planRunStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  error: z.string().nullable(),
})

export const runRowSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  caseName: z.string().optional(),
  planRunId: z.string().nullable().optional(),
  attempt: z.number().int().positive().nullable().optional(),
  status: z.enum(['passed', 'failed']),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  videoPath: z.string().nullable(),
  error: z.string().nullable(),
})

export const runStepRowSchema = z.object({
  id: z.string(),
  runId: z.string(),
  idx: z.number().int().nonnegative(),
  stepId: z.string(),
  action: actionSchema,
  status: z.enum(['passed', 'failed']),
  durationMs: z.number().nonnegative(),
  error: z.string().nullable(),
  locatorHit: locatorHitSchema.nullable(),
  triedCandidates: z.array(candidateAttemptSchema).nullable(),
  assertion: z
    .object({
      type: z.string(),
      expected: z.string().nullable().optional(),
      actual: z.string().nullable().optional(),
    })
    .nullable(),
  skipped: z.boolean().nullable().optional(),
  screenshotPath: z.string().nullable(),
})

export type ProjectRow = z.infer<typeof projectRowSchema>
export type ModuleRow = z.infer<typeof moduleRowSchema>
export type CaseRow = z.infer<typeof caseRowSchema>
export type CaseStepRow = z.infer<typeof caseStepRowSchema>
export type ElementRow = z.infer<typeof elementRowSchema>
export type SuiteRow = z.infer<typeof suiteRowSchema>
export type PlanRow = z.infer<typeof planRowSchema>
export type PlanRunRow = z.infer<typeof planRunRowSchema>
export type PlanRunStatus = z.infer<typeof planRunStatusSchema>
export type RunRow = z.infer<typeof runRowSchema>
export type RunStepRow = z.infer<typeof runStepRowSchema>
