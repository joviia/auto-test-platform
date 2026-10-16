import { z } from 'zod'
import {
  actionSchema,
  assertionSchema,
  candidateAttemptSchema,
  locatorHitSchema,
  locatorSchema,
} from '../domain'

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
})

export const elementRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1),
  locators: z.array(locatorSchema),
})

export const runRowSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  caseName: z.string().optional(),
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
      type: z.enum(['visible', 'text', 'value']),
      expected: z.string().nullable().optional(),
      actual: z.string().nullable().optional(),
    })
    .nullable(),
  screenshotPath: z.string().nullable(),
})

export type ProjectRow = z.infer<typeof projectRowSchema>
export type ModuleRow = z.infer<typeof moduleRowSchema>
export type CaseRow = z.infer<typeof caseRowSchema>
export type CaseStepRow = z.infer<typeof caseStepRowSchema>
export type ElementRow = z.infer<typeof elementRowSchema>
export type RunRow = z.infer<typeof runRowSchema>
export type RunStepRow = z.infer<typeof runStepRowSchema>
