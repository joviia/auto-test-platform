import { getDb } from '@atp/core'
import type { DesignDataRecord, DesignMatrix, DesignScenario, DesignSelection } from '@atp/model'
import { z } from 'zod'
import type { AiTool, AiToolContext, ToolOutcome } from './tools.js'

/**
 * 测试设计工具：AI 在工作台里直接操作当前矩阵。
 *
 * 直接执行范围：读摘要、筛选/选择、改数据行、标记接受/拒绝、执行非写数据行。
 * 保存入库与写数据执行仍由用户在工作台里确认。
 */

function sessionIdOf(ctx: AiToolContext): string {
  const id = ctx.environment?.design?.sessionId
  if (!id) throw new Error('当前没有打开测试设计工作台：请先生成测试设计')
  return id
}

async function loadSession(ctx: AiToolContext): Promise<DesignMatrix> {
  const matrix = await getDb().uow().designSessions.get(sessionIdOf(ctx))
  if (!matrix) throw new Error('设计会话不存在或已过期：请重新分析当前页面')
  return matrix
}

function assertRevision(matrix: DesignMatrix, ctx: AiToolContext): void {
  const expected = ctx.environment?.design?.revision
  if (expected !== undefined && expected !== matrix.revision) {
    throw new Error('设计会话已更新，请刷新后重试')
  }
}

function recordsOf(matrix: DesignMatrix, scenario: DesignScenario): DesignDataRecord[] {
  return scenario.dataRecordIds
    .map((id) => matrix.dataRecords?.[id])
    .filter((record): record is DesignDataRecord => Boolean(record))
}

function deriveStatus(
  scenario: DesignScenario,
  records: DesignDataRecord[],
  reset: boolean,
): DesignScenario['status'] {
  if (!reset && ['accepted', 'rejected', 'excluded'].includes(scenario.status)) {
    return scenario.status
  }
  const ready = records.filter((record) => record.status === 'ready').length
  if (records.length > 0 && ready === records.length) return 'ready'
  if (ready > 0) return 'partial'
  return 'pending'
}

/** 与 Web store 相同口径：按行重算场景状态、统计与覆盖率 */
function recompute(matrix: DesignMatrix, resetScenarioIds: string[] = []): DesignMatrix {
  const reset = new Set(resetScenarioIds)
  const scenarios = matrix.scenarios.map((scenario) => ({
    ...scenario,
    status: deriveStatus(scenario, recordsOf(matrix, scenario), reset.has(scenario.id)),
  }))
  const scenarioByRecord = new Map<string, DesignScenario>()
  for (const scenario of scenarios) {
    for (const id of scenario.dataRecordIds) scenarioByRecord.set(id, scenario)
  }
  const allRecords = Object.values(matrix.dataRecords ?? {})
  const activeRecords = allRecords.filter((record) => {
    const scenario = scenarioByRecord.get(record.id)
    return (
      Boolean(scenario) &&
      scenario?.status !== 'rejected' &&
      scenario?.status !== 'excluded' &&
      record.status !== 'excluded'
    )
  })
  const readyRows = activeRecords.filter((record) => record.status === 'ready').length
  const pendingRows = activeRecords.filter((record) => record.status === 'pending').length
  const acceptedRows = scenarios
    .filter((scenario) => scenario.status === 'accepted')
    .flatMap((scenario) => scenario.dataRecordIds)
    .map((id) => activeRecords.find((record) => record.id === id))
    .filter((record): record is DesignDataRecord => Boolean(record))
    .filter((record) => record.status === 'ready').length
  const savedRows = activeRecords.filter((record) => record.savedCaseId).length
  const executedRows = activeRecords.filter((record) => record.lastRun).length
  const passedRows = activeRecords.filter((record) => record.lastRun?.status === 'passed').length
  const applicableRows = readyRows + pendingRows
  const count = (status: DesignScenario['status']): number =>
    scenarios.filter((scenario) => scenario.status === status).length
  return {
    ...matrix,
    scenarios,
    stats: {
      ...matrix.stats,
      scenarios: scenarios.length,
      rows: activeRecords.length,
      ready: count('ready') + count('partial'),
      readyRows,
      pending: count('pending'),
      pendingRows,
      accepted: count('accepted'),
    },
    coverage: {
      ...matrix.coverage,
      designCoverage: applicableRows === 0 ? 0 : readyRows / applicableRows,
      acceptCoverage: applicableRows === 0 ? 0 : acceptedRows / applicableRows,
      executionCoverage: applicableRows === 0 ? 0 : executedRows / applicableRows,
      passRate: executedRows === 0 ? 0 : passedRows / executedRows,
      scenarios: scenarios.length,
      readyScenarios: count('ready'),
      partialScenarios: count('partial'),
      pendingScenarios: count('pending'),
      acceptedScenarios: count('accepted'),
      rejectedScenarios: count('rejected'),
      rows: activeRecords.length,
      readyRows,
      pendingRows,
      acceptedRows,
      savedRows,
      executedRows,
      passedRows,
    },
  }
}

async function persist(
  ctx: AiToolContext,
  matrix: DesignMatrix,
  label: string,
): Promise<DesignMatrix> {
  const saved = await getDb().uow().designSessions.save({ matrix, baseRevision: matrix.revision })
  ctx.platform.designUpdated(saved, label)
  return saved
}

async function mutate(
  ctx: AiToolContext,
  change: (matrix: DesignMatrix) => { matrix: DesignMatrix; changed: number; label: string },
): Promise<ToolOutcome> {
  const matrix = await loadSession(ctx)
  assertRevision(matrix, ctx)
  const result = change(matrix)
  if (result.changed === 0) {
    return {
      result: { ok: true, changed: 0, revision: matrix.revision },
      label: '没有需要修改的内容',
    }
  }
  const saved = await persist(ctx, result.matrix, result.label)
  return {
    result: { ok: true, changed: result.changed, revision: saved.revision },
    label: result.label,
  }
}

function fieldRefsMatching(matrix: DesignMatrix, input: MatchInput): Set<string> {
  const refs = new Set<string>()
  for (const field of matrix.fields) {
    if (input.fieldRefs?.includes(field.ref)) refs.add(field.ref)
    for (const label of input.fieldLabels ?? []) {
      if (field.label === label || field.label.includes(label) || label.includes(field.label)) {
        refs.add(field.ref)
      }
    }
  }
  return refs
}

interface MatchInput {
  scenarioIds?: string[]
  dataRecordIds?: string[]
  fieldRefs?: string[]
  fieldLabels?: string[]
  ruleIds?: string[]
  ruleNames?: string[]
  statuses?: string[]
}

function matchScenarios(matrix: DesignMatrix, input: MatchInput): DesignScenario[] {
  const refs = fieldRefsMatching(matrix, input)
  const ids = new Set(input.scenarioIds ?? [])
  const recordIds = new Set(input.dataRecordIds ?? [])
  const rules = [...(input.ruleIds ?? []), ...(input.ruleNames ?? [])]
  const statuses = new Set(input.statuses ?? [])
  return matrix.scenarios.filter((scenario) => {
    if (ids.size > 0 && !ids.has(scenario.id)) return false
    if (recordIds.size > 0 && !scenario.dataRecordIds.some((id) => recordIds.has(id))) {
      return false
    }
    if (refs.size > 0 && !refs.has(scenario.fieldRef)) return false
    if (
      rules.length > 0 &&
      !rules.some(
        (rule) =>
          rule === scenario.ruleId ||
          rule === scenario.ruleName ||
          scenario.ruleName.includes(rule),
      )
    ) {
      return false
    }
    if (statuses.size > 0 && !statuses.has(scenario.status)) return false
    return true
  })
}

function readySelections(matrix: DesignMatrix, scenarios: DesignScenario[]): DesignSelection[] {
  const selections: DesignSelection[] = []
  for (const scenario of scenarios) {
    if (scenario.status === 'rejected' || scenario.status === 'excluded') continue
    for (const record of recordsOf(matrix, scenario)) {
      if (record.status === 'ready') {
        selections.push({ scenarioId: scenario.id, dataRecordId: record.id })
      }
    }
  }
  return selections
}

const matchShape = {
  scenarioIds: z.array(z.string()).optional().describe('场景 id，来自 design_query'),
  dataRecordIds: z.array(z.string()).optional().describe('数据行 id，来自 design_query'),
  fieldRefs: z.array(z.string()).optional().describe('字段 ref'),
  fieldLabels: z.array(z.string()).optional().describe('字段显示名，允许部分匹配'),
  ruleIds: z.array(z.string()).optional().describe('规范 id，例如 length / format'),
  ruleNames: z.array(z.string()).optional().describe('规范名称，例如 长度 / 格式'),
  statuses: z
    .array(z.string())
    .optional()
    .describe('场景状态：ready/partial/pending/accepted/rejected'),
}

const designQuerySchema = z.object({
  scenarioId: z.string().optional().describe('只看一个场景的完整数据行'),
})

const designSelectSchema = z.object({
  ...matchShape,
  clear: z.boolean().optional().describe('清空选择'),
  view: z.enum(['scenarios', 'matrix']).optional(),
  filter: z
    .object({
      fieldRef: z.string().optional(),
      ruleId: z.string().optional(),
      ruleIds: z.array(z.string()).optional(),
      status: z.string().optional(),
    })
    .nullable()
    .optional()
    .describe('设置工作台筛选；null 表示清除'),
})

const designUpdateDataSchema = z.object({
  updates: z
    .array(
      z.object({
        scenarioId: z.string().optional().describe('目标场景；与 dataRecordId 二选一'),
        dataRecordId: z.string().optional().describe('目标数据行 id'),
        fieldRef: z
          .string()
          .optional()
          .describe('场景不明确时用字段定位；仍不唯一则先 design_query'),
        rowIndex: z.number().int().nonnegative().optional().describe('0 起的行序号'),
        value: z.string().optional().describe('新的数据值'),
        expectedValue: z
          .string()
          .nullable()
          .optional()
          .describe('期望输入值；null 表示清除。省略时按 maxlength 自动推导'),
      }),
    )
    .min(1),
})

const designDecideSchema = z.object({
  ...matchShape,
  decision: z.enum(['accepted', 'rejected']),
})

const designRunSchema = z.object({
  ...matchShape,
  allReady: z.boolean().optional().describe('执行所有可执行行'),
})

function pickRecord(
  matrix: DesignMatrix,
  input: {
    scenarioId?: string
    dataRecordId?: string
    fieldRef?: string
    rowIndex?: number
  },
): { scenario: DesignScenario; record: DesignDataRecord } {
  if (input.dataRecordId) {
    const scenario = matrix.scenarios.find((item) =>
      item.dataRecordIds.includes(input.dataRecordId as string),
    )
    const record = scenario ? matrix.dataRecords?.[input.dataRecordId] : undefined
    if (scenario && record) return { scenario, record }
    throw new Error(`数据行不存在：${input.dataRecordId}`)
  }
  let scenario = input.scenarioId
    ? matrix.scenarios.find((item) => item.id === input.scenarioId)
    : undefined
  if (!scenario && input.fieldRef) {
    const candidates = matrix.scenarios.filter((item) => item.fieldRef === input.fieldRef)
    if (candidates.length === 1) scenario = candidates[0]
    else if (candidates.length > 1) {
      throw new Error(
        `字段 ${input.fieldRef} 有多个场景，请先用 design_query 确认 scenarioId：${candidates
          .map((item) => `${item.id}（${item.title}）`)
          .join('、')}`,
      )
    }
  }
  if (!scenario) {
    throw new Error(
      `找不到目标场景：${input.scenarioId ?? input.fieldRef ?? '未提供 scenarioId/dataRecordId'}`,
    )
  }
  const records = recordsOf(matrix, scenario)
  const index = input.rowIndex ?? 0
  const record = records[index]
  if (!record) {
    throw new Error(`场景 ${scenario.title} 只有 ${records.length} 行数据，rowIndex=${index} 越界`)
  }
  return { scenario, record }
}

function maxLengthOf(matrix: DesignMatrix, fieldRef: string): number | undefined {
  const field = matrix.fields.find((item) => item.ref === fieldRef)
  const constraint = field?.constraints.find(
    (item) => item.kind === 'maxLength' && item.status !== 'rejected',
  )
  return typeof constraint?.value === 'number' ? constraint.value : undefined
}

export const DESIGN_TOOLS: AiTool[] = [
  {
    name: 'design_query',
    description:
      '读取当前测试设计会话：场景、数据行、覆盖与待确认原因。修改数据或执行前先调用，拿到 scenarioId/dataRecordId。',
    schema: designQuerySchema,
    run: async (raw, ctx): Promise<ToolOutcome> => {
      const input = designQuerySchema.parse(raw)
      const matrix = await loadSession(ctx)
      const scenarios = input.scenarioId
        ? matrix.scenarios.filter((scenario) => scenario.id === input.scenarioId)
        : matrix.scenarios
      return {
        label: '读取测试设计',
        result: {
          sessionId: matrix.sessionId ?? matrix.id,
          revision: matrix.revision,
          title: matrix.scopeLabel ?? matrix.title,
          url: matrix.url,
          note: matrix.note,
          stats: matrix.stats,
          coverage: matrix.coverage,
          fields: matrix.fields.map((field) => ({
            ref: field.ref,
            label: field.label,
            controlType: field.controlType,
            required: field.required,
            fillable: field.fillable,
            constraints: field.constraints.map((constraint) => ({
              kind: constraint.kind,
              value: constraint.value,
              source: constraint.source,
              status: constraint.status,
            })),
          })),
          scenarios: scenarios.map((scenario) => ({
            id: scenario.id,
            title: scenario.title,
            ruleId: scenario.ruleId,
            ruleName: scenario.ruleName,
            fieldRef: scenario.fieldRef,
            fieldLabel: scenario.fieldLabel,
            kind: scenario.kind,
            expected: scenario.expected,
            expectedText: scenario.expectedText,
            status: scenario.status,
            priority: scenario.priority,
            requiresWrite: scenario.requiresWrite,
            reason: scenario.reason,
            rows: recordsOf(matrix, scenario).map((record) => ({
              id: record.id,
              label: record.label,
              values: record.values,
              expected: record.expected,
              expectedValue: record.expectedValue,
              status: record.status,
              testLevel: record.testLevel,
              partition: record.partition,
              reason: record.reason,
              savedCaseId: record.savedCaseId,
              lastRun: record.lastRun,
            })),
          })),
          skipped: matrix.skipped,
        },
      }
    },
  },
  {
    name: 'design_select',
    description:
      '在当前测试设计工作台里按字段/规范/状态/场景/数据行选中，或设置筛选与视图。用于「只保留长度场景」「选中写数据行」等请求。',
    schema: designSelectSchema,
    run: async (raw, ctx): Promise<ToolOutcome> => {
      const input = designSelectSchema.parse(raw)
      const matrix = await loadSession(ctx)
      const hasCriteria =
        Boolean(input.scenarioIds?.length) ||
        Boolean(input.dataRecordIds?.length) ||
        Boolean(input.fieldRefs?.length) ||
        Boolean(input.fieldLabels?.length) ||
        Boolean(input.ruleIds?.length) ||
        Boolean(input.ruleNames?.length) ||
        Boolean(input.statuses?.length)
      const scenarios = input.clear || !hasCriteria ? [] : matchScenarios(matrix, input)
      let selections = readySelections(matrix, scenarios)
      if (input.dataRecordIds?.length) {
        const allowed = new Set(input.dataRecordIds)
        selections = selections.filter((selection) => allowed.has(selection.dataRecordId))
      }
      ctx.platform.designCommand({ command: 'select', selections })
      if (input.filter !== undefined) {
        ctx.platform.designCommand({
          command: 'filter',
          filter: input.filter ?? {},
        })
      }
      if (input.view) ctx.platform.designCommand({ command: 'view', view: input.view })
      const label = input.clear
        ? '清空设计选择'
        : selections.length === 0
          ? '没有匹配到可执行行'
          : `选中 ${new Set(selections.map((item) => item.scenarioId)).size} 个场景 / ${selections.length} 行`
      return {
        label,
        result: {
          ok: true,
          matchedScenarios: scenarios.length,
          selectedRows: selections.length,
        },
      }
    },
  },
  {
    name: 'design_update_data',
    description:
      '修改测试设计数据行的值或期望输入值。会直接写库并同步工作台，可撤销；执行前先 design_query 确认 id。',
    schema: designUpdateDataSchema,
    run: async (raw, ctx): Promise<ToolOutcome> => {
      const input = designUpdateDataSchema.parse(raw)
      return mutate(ctx, (matrix) => {
        const dataRecords = { ...matrix.dataRecords }
        const resetIds = new Set<string>()
        let changed = 0
        for (const update of input.updates) {
          if (update.value === undefined && update.expectedValue === undefined) continue
          const { scenario, record } = pickRecord(matrix, update)
          const next: DesignDataRecord = {
            ...record,
            values: { ...record.values },
            source: 'manual',
          }
          if (update.value !== undefined) {
            next.values[scenario.fieldRef] = update.value
            if (update.expectedValue === undefined && record.expectedValue !== undefined) {
              const max = maxLengthOf(matrix, scenario.fieldRef)
              next.expectedValue = max !== undefined ? update.value.slice(0, max) : update.value
            }
          }
          if (update.expectedValue !== undefined) {
            if (update.expectedValue === null) delete next.expectedValue
            else next.expectedValue = update.expectedValue
          }
          dataRecords[record.id] = next
          resetIds.add(scenario.id)
          changed += 1
        }
        const label = `更新 ${changed} 行设计数据`
        return {
          changed,
          label,
          matrix: recompute({ ...matrix, dataRecords }, [...resetIds]),
        }
      })
    },
  },
  {
    name: 'design_decide',
    description: '把当前测试设计中的场景标记为已接受或已拒绝（只改设计状态，不写入用例库）。',
    schema: designDecideSchema,
    run: async (raw, ctx): Promise<ToolOutcome> => {
      const input = designDecideSchema.parse(raw)
      return mutate(ctx, (matrix) => {
        const targets = matchScenarios(matrix, input)
        if (targets.length === 0) {
          throw new Error('没有匹配到场景：请先 design_query 确认字段、规范或 scenarioId')
        }
        const ids = new Set(targets.map((scenario) => scenario.id))
        const label =
          input.decision === 'accepted'
            ? `接受 ${targets.length} 个场景（未入库）`
            : `拒绝 ${targets.length} 个场景`
        return {
          changed: targets.length,
          label,
          matrix: recompute({
            ...matrix,
            scenarios: matrix.scenarios.map((scenario) =>
              ids.has(scenario.id) ? { ...scenario, status: input.decision } : scenario,
            ),
          }),
        }
      })
    },
  },
  {
    name: 'design_run',
    description:
      '执行当前设计中选中的可执行数据行（非写数据直接执行；写数据行会返回 needsConfirmation，由用户在工作台确认）。',
    schema: designRunSchema,
    run: async (raw, ctx): Promise<ToolOutcome> => {
      const input = designRunSchema.parse(raw)
      const matrix = await loadSession(ctx)
      assertRevision(matrix, ctx)
      const scenarios = input.allReady ? matrix.scenarios : matchScenarios(matrix, input)
      let selections = readySelections(matrix, scenarios)
      if (input.dataRecordIds?.length) {
        const allowed = new Set(input.dataRecordIds)
        selections = selections.filter((selection) => allowed.has(selection.dataRecordId))
      }
      if (selections.length === 0) {
        throw new Error('没有可执行的数据行：待确认行需要先补数据或确认约束')
      }
      const writeRows = selections.filter((selection) => {
        const scenario = matrix.scenarios.find((item) => item.id === selection.scenarioId)
        return scenario?.requiresWrite === true
      })
      if (writeRows.length > 0) {
        ctx.platform.designCommand({ command: 'select', selections: writeRows })
        return {
          label: '写数据行需要确认',
          result: {
            ok: false,
            needsConfirmation: true,
            writeRows: writeRows.length,
            selectedRows: selections.length,
            message: `选中行中有 ${writeRows.length} 行会写入业务数据，已为你选中；请在工作台底部点击「执行选中」确认后执行。`,
          },
        }
      }
      const run = await ctx.platform.runDesignSelection(selections)
      return {
        label: `执行 ${run.cases} 行测试数据`,
        result: { ok: true, cases: run.cases, selections: selections.length },
      }
    },
  },
]
