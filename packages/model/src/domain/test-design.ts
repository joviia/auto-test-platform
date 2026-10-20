import { z } from 'zod'
import { caseFileSchema } from './case.js'

/** 测试设计：规范、控件分类、约束、场景、数据记录、矩阵与生成结果 */

/** 页面探测到的原始字段（只作为证据，不直接决定测什么） */
export const designPageFieldSchema = z.object({
  ref: z.string().min(1),
  label: z.string(),
  role: z.string(),
  tag: z.string(),
  inputType: z.string().optional(),
  placeholder: z.string().optional(),
  contentEditable: z.boolean().optional(),
  required: z.boolean().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  value: z.string().optional(),
  options: z.array(z.string()).optional(),
  multiple: z.boolean().optional(),
  formItemText: z.string().optional(),
  disabled: z.boolean().optional(),
  readonly: z.boolean().optional(),
})

export const designControlTypeSchema = z.enum([
  'shortText',
  'longText',
  'number',
  'date',
  'dateRange',
  'select',
  'multiSelect',
  'checkbox',
  'radio',
  'upload',
  'unknown',
])

export const designSemanticTypeSchema = z.enum([
  'text',
  'email',
  'phone',
  'url',
  'name',
  'code',
  'amount',
  'date',
  'enum',
  'unknown',
])

export const designConstraintKindSchema = z.enum([
  'required',
  'minLength',
  'maxLength',
  'pattern',
  'min',
  'max',
  'unique',
  'enum',
  'dateRange',
])

export const designConstraintSourceSchema = z.enum([
  'standard',
  'page',
  'requirement',
  'api_schema',
  'ai',
  'user',
  'project',
])

export const designConstraintStatusSchema = z.enum(['applied', 'pending', 'rejected'])
export const designScenarioStatusSchema = z.enum([
  'ready',
  'partial',
  'pending',
  'accepted',
  'rejected',
  'excluded',
])
export const designDataRecordStatusSchema = z.enum(['ready', 'pending', 'excluded'])
export const designTestLevelSchema = z.enum(['ui', 'api'])

const designConstraintValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
])

export const designConstraintSchema = z.object({
  kind: designConstraintKindSchema,
  value: designConstraintValueSchema.optional(),
  /** 边界语义：默认包含（≤ / ≥） */
  operator: z.enum(['lte', 'lt', 'gte', 'gt']).optional(),
  source: designConstraintSourceSchema,
  status: designConstraintStatusSchema,
  /** 规范对该控件类型的默认值，用于解释与冲突判断 */
  standardDefault: z
    .object({
      kind: designConstraintKindSchema,
      value: designConstraintValueSchema.optional(),
    })
    .optional(),
  note: z.string().optional(),
})

/** 被测对象中的一个字段：控件分类 + 有效约束 */
export const designFieldSchema = z.object({
  id: z.string().min(1),
  ref: z.string().min(1),
  label: z.string(),
  controlType: designControlTypeSchema,
  semanticType: designSemanticTypeSchema,
  required: z.boolean(),
  constraints: z.array(designConstraintSchema),
  options: z.array(z.string()).optional(),
  /** 当前值；下拉可能是已选项文本 */
  value: z.string().optional(),
  /** 用于填充非目标字段的合法基线值 */
  baseline: z.string().optional(),
  fillable: z.boolean(),
  disabled: z.boolean().optional(),
  readonly: z.boolean().optional(),
  /** 自定义组件无法自动填写时，保留原因 */
  note: z.string().optional(),
  classification: z.object({
    confidence: z.number(),
    evidence: z.array(z.string()),
  }),
})

export const designSubmitSchema = z.object({
  ref: z.string().min(1),
  name: z.string(),
})

export const designScenarioSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1),
  ruleName: z.string().min(1),
  title: z.string().min(1),
  /** 单字段规则的目标字段；跨字段规则取第一个字段 */
  fieldRef: z.string().min(1),
  /** 跨字段规则（如日期范围）涉及的全部字段 */
  fieldRefs: z.array(z.string()).optional(),
  fieldLabel: z.string(),
  kind: z.enum(['negative', 'positive']),
  /** invalid / success；同一场景的数据行共享该预期 */
  expected: z.enum(['invalid', 'success']),
  expectedText: z.string().optional(),
  priority: z.enum(['blocker', 'critical', 'normal']),
  tags: z.array(z.string()),
  /** ready/partial/pending 由数据行派生；accepted/rejected 为审阅状态 */
  status: designScenarioStatusSchema,
  /** 会创建业务数据，执行前需要用户确认 */
  requiresWrite: z.boolean().optional(),
  /** 规范来源说明，例如 standard:short-text.length */
  source: z.string().optional(),
  /** pending 的原因 */
  reason: z.string().optional(),
  /** 该场景包含的数据行；场景是模板，行是迭代 */
  dataRecordIds: z.array(z.string().min(1)).min(1),
})

export const designSkippedSchema = z.object({
  ruleId: z.string().min(1),
  ruleName: z.string().min(1),
  fieldLabel: z.string().optional(),
  reason: z.string().min(1),
})

export const designDataRecordSchema = z.object({
  id: z.string().min(1),
  /** 行标签，例如「255 字」「空值」「257 字（截断）」 */
  label: z.string().min(1),
  /** fieldRef -> value */
  values: z.record(z.string(), designConstraintValueSchema),
  kind: z.enum(['negative', 'positive']),
  /** 复制场景预期，便于 UI 与用例生成直接读取 */
  expected: z.enum(['invalid', 'success']),
  expectedText: z.string().optional(),
  /** 期望的输入值；用于验证 maxlength 截断等边界 */
  expectedValue: z.string().optional(),
  status: designDataRecordStatusSchema,
  testLevel: designTestLevelSchema,
  /** empty / validTypical / validMax / invalidOverMax / duplicate / dateRange … */
  partition: z.string(),
  tags: z.array(z.string()),
  /** 该行为待确认时的原因 */
  reason: z.string().optional(),
  source: z.enum(['generated', 'manual', 'existing']),
  seed: z.string().optional(),
  preconditions: z.array(z.string()).optional(),
  cleanup: z.array(z.string()).optional(),
  /** 已保存到用例库时记录用例 id */
  savedCaseId: z.string().optional(),
  /** 最近一次设计执行结果，用于刷新后恢复覆盖 */
  lastRun: z
    .object({
      runId: z.string().min(1),
      status: z.enum(['passed', 'failed', 'stopped']),
      at: z.string(),
    })
    .optional(),
})

export const designCoverageSchema = z.object({
  /** 可执行行 / 适用行 */
  designCoverage: z.number().min(0).max(1),
  /** 已接受行 / 适用行 */
  acceptCoverage: z.number().min(0).max(1),
  /** 已执行行 / 适用行 */
  executionCoverage: z.number().min(0).max(1),
  /** 通过 / 已执行 */
  passRate: z.number().min(0).max(1),
  scenarios: z.number().int().nonnegative(),
  readyScenarios: z.number().int().nonnegative(),
  partialScenarios: z.number().int().nonnegative(),
  pendingScenarios: z.number().int().nonnegative(),
  acceptedScenarios: z.number().int().nonnegative(),
  rejectedScenarios: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  readyRows: z.number().int().nonnegative(),
  pendingRows: z.number().int().nonnegative(),
  acceptedRows: z.number().int().nonnegative(),
  savedRows: z.number().int().nonnegative(),
  executedRows: z.number().int().nonnegative(),
  passedRows: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
})

export const designSelectionSchema = z.object({
  scenarioId: z.string().min(1),
  dataRecordId: z.string().min(1),
})

export const designMatrixSchema = z.object({
  schemaVersion: z.literal(2),
  /** 乐观并发版本；每次持久化递增 */
  revision: z.number().int().nonnegative(),
  /** 设计会话 / 矩阵 id；持久化后由 Agent 补齐 */
  id: z.string().optional(),
  sessionId: z.string().optional(),
  url: z.string(),
  title: z.string(),
  fields: z.array(designFieldSchema),
  submit: designSubmitSchema.optional(),
  /** 列表页打开表单的入口；弹窗表单回放前需要先点击它 */
  entry: designSubmitSchema.optional(),
  /** 当前分析的弹窗/抽屉标题 */
  scopeLabel: z.string().optional(),
  /** 分析过程中的动作说明 */
  note: z.string().optional(),
  scenarios: z.array(designScenarioSchema),
  skipped: z.array(designSkippedSchema),
  stats: z.object({
    fields: z.number().int().nonnegative(),
    rules: z.number().int().nonnegative(),
    scenarios: z.number().int().nonnegative(),
    rows: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    readyRows: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    pendingRows: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  coverage: designCoverageSchema,
  /** 本次使用的规范包 */
  standards: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        version: z.string(),
      }),
    )
    .optional(),
  /** 场景引用的数据记录快照 */
  dataRecords: z.record(z.string(), designDataRecordSchema).optional(),
  successText: z.string(),
  createdAt: z.string(),
})

export const designStepResultSchema = z.object({
  index: z.number().int().positive(),
  stepId: z.string(),
  action: z.string(),
  status: z.enum(['passed', 'failed']),
  durationMs: z.number().nonnegative(),
  error: z.string().optional(),
  skipped: z.boolean().optional(),
  screenshotUrl: z.string().optional(),
})

export const designResultSchema = z.object({
  scenarioId: z.string().min(1),
  dataRecordId: z.string().min(1),
  runId: z.string().min(1),
  status: z.enum(['passed', 'failed', 'stopped']),
  error: z.string().optional(),
  steps: z.array(designStepResultSchema),
})

export const designCaseSchema = z.object({
  scenarioId: z.string().min(1),
  dataRecordId: z.string().min(1),
  caseFile: caseFileSchema,
})

export type DesignPageField = z.infer<typeof designPageFieldSchema>
export type DesignControlType = z.infer<typeof designControlTypeSchema>
export type DesignSemanticType = z.infer<typeof designSemanticTypeSchema>
export type DesignConstraintKind = z.infer<typeof designConstraintKindSchema>
export type DesignConstraintSource = z.infer<typeof designConstraintSourceSchema>
export type DesignConstraintStatus = z.infer<typeof designConstraintStatusSchema>
export type DesignConstraint = z.infer<typeof designConstraintSchema>
export type DesignField = z.infer<typeof designFieldSchema>
export type DesignSubmit = z.infer<typeof designSubmitSchema>
export type DesignScenarioStatus = z.infer<typeof designScenarioStatusSchema>
export type DesignDataRecordStatus = z.infer<typeof designDataRecordStatusSchema>
export type DesignTestLevel = z.infer<typeof designTestLevelSchema>
export type DesignScenario = z.infer<typeof designScenarioSchema>
export type DesignSkipped = z.infer<typeof designSkippedSchema>
export type DesignDataRecord = z.infer<typeof designDataRecordSchema>
export type DesignCoverage = z.infer<typeof designCoverageSchema>
export type DesignSelection = z.infer<typeof designSelectionSchema>
export type DesignMatrix = z.infer<typeof designMatrixSchema>
export type DesignStepResult = z.infer<typeof designStepResultSchema>
export type DesignResult = z.infer<typeof designResultSchema>
export type DesignCase = z.infer<typeof designCaseSchema>
