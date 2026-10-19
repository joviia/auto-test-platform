import {
  type AiCaseProposal,
  type CaseFile,
  caseFileSchema,
  caseGroupSchema,
  elementSchema,
  stepSchema,
} from '@atp/model'
import { z } from 'zod'

/**
 * 用例修改建议的操作集。
 *
 * 不让模型直接提交一整份新用例，而是提交「改哪几步」：
 * 1. 待修改的步骤不需要原样回显，减少无关字段被意外丢掉；
 * 2. 平台上能按 step id 生成准确的 diff；
 * 3. 应用前可以做引用完整性校验。
 */
export const caseProposalOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('remove_step'),
    stepId: z.string().min(1),
  }),
  z.object({
    op: z.literal('update_step'),
    step: stepSchema,
  }),
  z.object({
    op: z.literal('add_step'),
    step: stepSchema,
    /** 插到这一步之后；省略时追加到末尾 */
    afterStepId: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal('move_step'),
    stepId: z.string().min(1),
    /** 移到这一步之后；省略时移到末尾 */
    afterStepId: z.string().min(1).optional(),
  }),
  z.object({
    op: z.literal('update_case'),
    name: z.string().min(1).optional(),
    startUrl: z.string().min(1).optional(),
    /** 传空字符串清空 */
    intent: z.string().optional(),
    /** 整体替换；传 [] 清空分组 */
    groups: z.array(caseGroupSchema).optional(),
    /** 整体替换 */
    variables: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    op: z.literal('upsert_element'),
    element: elementSchema,
  }),
  z.object({
    op: z.literal('remove_element'),
    elementId: z.string().min(1),
  }),
])

export const caseProposalOpsSchema = z.array(caseProposalOpSchema).min(1).max(200)

export type CaseProposalOp = z.infer<typeof caseProposalOpSchema>

export interface CaseProposalDiff {
  added: number
  removed: number
  changed: number
  reordered: boolean
  /** 名称、起始地址、意图、分组或变量有变化 */
  metaChanged: boolean
  totalBefore: number
  totalAfter: number
}

function sameStep(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function caseMeta(file: CaseFile) {
  return {
    name: file.case.name,
    startUrl: file.case.startUrl,
    intent: file.case.intent,
    groups: file.case.groups,
    variables: file.case.variables,
  }
}

/**
 * 按顺序应用操作集，并校验引用完整性。
 * 任何一步失败都抛错，不返回半成品。
 */
export function applyCaseProposal(current: CaseFile, operations: CaseProposalOp[]): CaseFile {
  const steps = [...current.case.steps]
  const elements = { ...current.elements }
  const patch: {
    name?: string
    startUrl?: string
    intent?: string
    groups?: CaseFile['case']['groups']
    variables?: Record<string, string>
  } = {}

  for (const operation of operations) {
    switch (operation.op) {
      case 'remove_step': {
        const index = steps.findIndex((step) => step.id === operation.stepId)
        if (index < 0) throw new Error(`要删除的步骤不存在：${operation.stepId}`)
        steps.splice(index, 1)
        break
      }
      case 'update_step': {
        const index = steps.findIndex((step) => step.id === operation.step.id)
        if (index < 0) throw new Error(`要修改的步骤不存在：${operation.step.id}`)
        steps[index] = operation.step
        break
      }
      case 'add_step': {
        if (steps.some((step) => step.id === operation.step.id)) {
          throw new Error(`新增步骤的 id 已存在：${operation.step.id}`)
        }
        const after = operation.afterStepId
          ? steps.findIndex((step) => step.id === operation.afterStepId)
          : -1
        if (operation.afterStepId && after < 0) {
          throw new Error(`插入位置不存在：${operation.afterStepId}`)
        }
        steps.splice(after < 0 ? steps.length : after + 1, 0, operation.step)
        break
      }
      case 'move_step': {
        const index = steps.findIndex((step) => step.id === operation.stepId)
        if (index < 0) throw new Error(`要移动的步骤不存在：${operation.stepId}`)
        const [moved] = steps.splice(index, 1)
        const after = operation.afterStepId
          ? steps.findIndex((step) => step.id === operation.afterStepId)
          : -1
        if (operation.afterStepId && after < 0) {
          throw new Error(`移动位置不存在：${operation.afterStepId}`)
        }
        steps.splice(after < 0 ? steps.length : after + 1, 0, moved)
        break
      }
      case 'update_case': {
        if (operation.name !== undefined) patch.name = operation.name
        if (operation.startUrl !== undefined) patch.startUrl = operation.startUrl
        if (operation.intent !== undefined) patch.intent = operation.intent
        if (operation.groups !== undefined) patch.groups = operation.groups
        if (operation.variables !== undefined) patch.variables = operation.variables
        break
      }
      case 'upsert_element': {
        elements[operation.element.id] = operation.element
        break
      }
      case 'remove_element': {
        if (!(operation.elementId in elements)) {
          throw new Error(`要删除的元素不存在：${operation.elementId}`)
        }
        const usedBy = steps.find((step) => step.elementId === operation.elementId)
        if (usedBy) throw new Error(`元素仍被步骤 ${usedBy.id} 引用，不能删除`)
        delete elements[operation.elementId]
        break
      }
    }
  }

  if (steps.length === 0) throw new Error('用例至少需要保留一个步骤')

  const ids = new Set<string>()
  for (const step of steps) {
    if (ids.has(step.id)) throw new Error(`步骤 id 重复：${step.id}`)
    ids.add(step.id)
  }

  const missing = steps.filter((step) => step.elementId && !elements[step.elementId])
  if (missing.length > 0) {
    throw new Error(
      `步骤引用了不存在的元素：${missing.map((step) => `${step.id} → ${step.elementId}`).join('，')}`,
    )
  }

  const nextCase = {
    ...current.case,
    ...patch,
    steps,
  }
  if (nextCase.groups?.length) {
    const groupIds = new Set(nextCase.groups.map((group) => group.id))
    const orphan = steps.find((step) => step.groupId && !groupIds.has(step.groupId))
    if (orphan) throw new Error(`步骤 ${orphan.id} 引用了不存在的分组 ${orphan.groupId}`)
  }

  return caseFileSchema.parse({ case: nextCase, elements })
}

export function diffCase(before: CaseFile, after: CaseFile): CaseProposalDiff {
  const beforeById = new Map(before.case.steps.map((step) => [step.id, step]))
  const afterById = new Map(after.case.steps.map((step) => [step.id, step]))

  const removed = before.case.steps.filter((step) => !afterById.has(step.id)).length
  const added = after.case.steps.filter((step) => !beforeById.has(step.id)).length
  const changed = after.case.steps.filter((step) => {
    const previous = beforeById.get(step.id)
    return previous !== undefined && !sameStep(previous, step)
  }).length

  const beforeCommon = before.case.steps
    .filter((step) => afterById.has(step.id))
    .map((step) => step.id)
  const afterCommon = after.case.steps
    .filter((step) => beforeById.has(step.id))
    .map((step) => step.id)
  const reordered = afterCommon.some((id, index) => id !== beforeCommon[index])

  return {
    added,
    removed,
    changed,
    reordered,
    metaChanged: JSON.stringify(caseMeta(before)) !== JSON.stringify(caseMeta(after)),
    totalBefore: before.case.steps.length,
    totalAfter: after.case.steps.length,
  }
}

export interface CaseProposalInput {
  summary: string
  operations: CaseProposalOp[]
}

export function buildCaseProposal(
  current: CaseFile,
  input: CaseProposalInput,
  meta: { proposalId: string; baseUpdatedAt: string; createdAt: string },
): { proposal: AiCaseProposal; diff: CaseProposalDiff } {
  const after = applyCaseProposal(current, input.operations)
  const diff = diffCase(current, after)
  const before = caseFileSchema.parse(current)
  if (diff.added + diff.removed + diff.changed === 0 && !diff.reordered && !diff.metaChanged) {
    throw new Error('提案没有产生任何变化，请检查操作列表')
  }

  return {
    proposal: {
      proposalId: meta.proposalId,
      caseId: current.case.id,
      caseName: current.case.name,
      summary: input.summary,
      baseUpdatedAt: meta.baseUpdatedAt,
      before,
      after,
      createdAt: meta.createdAt,
    },
    diff,
  }
}
