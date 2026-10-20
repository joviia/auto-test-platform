import type {
  Assertion,
  DesignConstraint,
  DesignDataRecord,
  DesignDataRecordStatus,
  DesignField,
  DesignMatrix,
  DesignPageField,
  DesignScenario,
  DesignScenarioStatus,
  DesignSkipped,
  DesignSubmit,
  DesignTestLevel,
} from '@atp/model'

export interface DesignPageInput {
  url: string
  title: string
  fields: DesignPageField[]
  submit?: DesignSubmit
  entry?: DesignSubmit
  successText?: string
  scopeLabel?: string
}

export interface BlueprintStep {
  action: 'fill' | 'select' | 'click' | 'assert'
  ref?: string
  value?: string
  mode?: 'native' | 'custom'
  assertion?: Assertion
}

export interface CaseBlueprint {
  scenarioId: string
  dataRecordId: string
  label: string
  name: string
  intent: string
  startUrl: string
  steps: BlueprintStep[]
}

export interface DesignSelection {
  scenarioId: string
  dataRecordId: string
}

const SHORT_TEXT_MAX = 256
const LONG_TEXT_MAX = 1000
const DEFAULT_SUCCESS_TEXT = '保存成功'
const PAGE_CONTROL_LABEL = /^(页|页码|当前页|每页|跳至|显示条数|条\/页)$/
const NAME_LIKE = /名称|姓名|标题|合同名|用户名|登录名/
const CODE_LIKE = /编号|编码|代码|工号|订单号/
const UNIQUE_LIKE = /合同名称|名称|编号|编码|用户名|登录名/
const START_DATE_LIKE = /开始|起始|起|from|start/i
const END_DATE_LIKE = /结束|截止|止|to|end/i

const STANDARDS = [
  { id: 'required', name: '必填校验', version: '1.0.0' },
  { id: 'short-text.length', name: '短文本长度', version: '1.0.0' },
  { id: 'long-text.length', name: '长文本长度', version: '1.0.0' },
  { id: 'format', name: '格式校验', version: '1.0.0' },
  { id: 'select', name: '下拉必填', version: '1.0.0' },
  { id: 'duplicate', name: '重复校验', version: '1.0.0' },
  { id: 'date-range', name: '日期范围', version: '1.0.0' },
  { id: 'happy-path', name: '正常流', version: '1.0.0' },
] as const

const STANDARD_BY_RULE = new Map<string, (typeof STANDARDS)[number]>(
  STANDARDS.map((standard) => [standard.id, standard]),
)

interface Classification {
  controlType: DesignField['controlType']
  semanticType: DesignField['semanticType']
  confidence: number
  evidence: string[]
}

interface RowDraft {
  label: string
  partition: string
  kind: 'negative' | 'positive'
  expected: 'invalid' | 'success'
  testLevel: DesignTestLevel
  status: DesignDataRecordStatus
  values: Record<string, string | string[]>
  expectedValue?: string
  expectedText?: string
  tags?: string[]
  reason?: string
}

type ScenarioDraft = Omit<DesignScenario, 'id' | 'status' | 'dataRecordIds'> & {
  status?: DesignScenarioStatus
  dataRecordIds?: string[]
  rows: RowDraft[]
}

function clean(value: string | undefined | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function classify(raw: DesignPageField): Classification {
  const tag = raw.tag.toLowerCase()
  const type = (raw.inputType ?? '').toLowerCase()
  const text = `${raw.label} ${raw.placeholder ?? ''}`.trim()
  const lower = text.toLowerCase()
  const evidence = [`tag=${tag}`, `type=${type || '(none)'}`]
  if (text) evidence.push(`label=${text.slice(0, 60)}`)

  if (raw.contentEditable || tag === 'textarea' || /富文本|编辑器|editor/.test(lower)) {
    return { controlType: 'longText', semanticType: 'text', confidence: 0.9, evidence }
  }
  if (tag === 'select' || raw.role === 'combobox') {
    return {
      controlType: tag === 'select' && raw.multiple ? 'multiSelect' : 'select',
      semanticType: 'enum',
      confidence: tag === 'select' ? 0.95 : 0.75,
      evidence,
    }
  }
  if (tag === 'input') {
    if (type === 'checkbox') {
      return { controlType: 'checkbox', semanticType: 'enum', confidence: 0.95, evidence }
    }
    if (type === 'radio') {
      return { controlType: 'radio', semanticType: 'enum', confidence: 0.95, evidence }
    }
    if (type === 'number') {
      return { controlType: 'number', semanticType: 'amount', confidence: 0.9, evidence }
    }
    if (type === 'date' || type === 'datetime-local' || type === 'month') {
      return { controlType: 'date', semanticType: 'date', confidence: 0.9, evidence }
    }
    if (type === 'email' || /邮箱|电子邮件|email|e-mail/.test(lower)) {
      return { controlType: 'shortText', semanticType: 'email', confidence: 0.9, evidence }
    }
    if (type === 'tel' || /手机|电话|联系方式|phone|mobile|tel/.test(lower)) {
      return { controlType: 'shortText', semanticType: 'phone', confidence: 0.85, evidence }
    }
    if (type === 'url' || /网址|链接|url|website/.test(lower)) {
      return { controlType: 'shortText', semanticType: 'url', confidence: 0.85, evidence }
    }
    if (NAME_LIKE.test(text)) {
      return { controlType: 'shortText', semanticType: 'name', confidence: 0.75, evidence }
    }
    if (CODE_LIKE.test(text)) {
      return { controlType: 'shortText', semanticType: 'code', confidence: 0.75, evidence }
    }
    if (type === 'text' || type === 'search' || type === 'password') {
      return { controlType: 'shortText', semanticType: 'text', confidence: 0.8, evidence }
    }
  }
  return { controlType: 'unknown', semanticType: 'unknown', confidence: 0.2, evidence }
}

function isFillable(raw: DesignPageField, classification: Classification): boolean {
  if (raw.disabled || raw.readonly) return false
  // 自定义下拉/自定义编辑器：P0 不自动操作，留给必填留空与待确认
  if (raw.tag !== 'select' && raw.role === 'combobox') return false
  if (classification.controlType === 'unknown' || classification.controlType === 'upload') {
    return false
  }
  if (classification.controlType === 'checkbox' || classification.controlType === 'radio') {
    return true
  }
  if (classification.controlType === 'select' || classification.controlType === 'multiSelect') {
    return true
  }
  if (!raw.tag || raw.tag === 'input' || raw.tag === 'textarea') {
    return ['shortText', 'longText', 'number', 'date', 'dateRange'].includes(
      classification.controlType,
    )
  }
  return false
}

function maxLengthConstraint(field: DesignField): DesignConstraint | undefined {
  return field.constraints.find(
    (constraint) => constraint.kind === 'maxLength' && constraint.status !== 'rejected',
  )
}

function minLengthConstraint(field: DesignField): DesignConstraint | undefined {
  return field.constraints.find(
    (constraint) => constraint.kind === 'minLength' && constraint.status !== 'rejected',
  )
}

function minLengthOf(field: DesignField): number | undefined {
  const constraint = minLengthConstraint(field)
  return typeof constraint?.value === 'number' ? constraint.value : undefined
}

function buildConstraints(
  raw: DesignPageField,
  classification: Classification,
): DesignConstraint[] {
  const constraints: DesignConstraint[] = []
  if (raw.required === true) {
    constraints.push({ kind: 'required', value: true, source: 'page', status: 'applied' })
  }

  if (classification.controlType === 'shortText' || classification.controlType === 'longText') {
    const standardMax = classification.controlType === 'longText' ? LONG_TEXT_MAX : SHORT_TEXT_MAX
    const pageMax = raw.maxLength && raw.maxLength > 0 ? raw.maxLength : undefined
    if (pageMax) {
      constraints.push({
        kind: 'maxLength',
        value: pageMax,
        operator: 'lte',
        source: 'page',
        status: pageMax <= standardMax ? 'applied' : 'pending',
        standardDefault: { kind: 'maxLength', value: standardMax },
        ...(pageMax > standardMax
          ? { note: `页面 maxlength=${pageMax} 超过规范默认 ${standardMax}` }
          : {}),
      })
    } else {
      constraints.push({
        kind: 'maxLength',
        value: standardMax,
        operator: 'lte',
        source: 'standard',
        status: 'applied',
      })
    }
    if (raw.minLength && raw.minLength > 0) {
      constraints.push({
        kind: 'minLength',
        value: raw.minLength,
        operator: 'gte',
        source: 'page',
        status: 'applied',
      })
    }
  }

  if (
    classification.semanticType === 'email' ||
    classification.semanticType === 'phone' ||
    classification.semanticType === 'url'
  ) {
    constraints.push({
      kind: 'pattern',
      value: classification.semanticType,
      source: 'standard',
      status: 'applied',
    })
  }

  if (classification.controlType === 'select' && raw.options && raw.options.length > 0) {
    constraints.push({
      kind: 'enum',
      value: raw.options,
      source: 'page',
      status: 'applied',
    })
  }

  if (
    (classification.semanticType === 'name' || classification.semanticType === 'code') &&
    UNIQUE_LIKE.test(raw.label)
  ) {
    constraints.push({
      kind: 'unique',
      value: true,
      source: 'ai',
      status: 'pending',
      note: '需要已有记录作为重复数据；P0 不自动造数',
    })
  }

  return constraints
}

function baselineValue(
  raw: DesignPageField,
  classification: Classification,
  constraints: DesignConstraint[],
  stamp: string,
): string {
  if (classification.controlType === 'checkbox' || classification.controlType === 'radio') {
    return raw.required ? 'true' : ''
  }
  if (classification.controlType === 'select' || classification.controlType === 'multiSelect') {
    if (raw.value?.trim()) return raw.value
    const options = raw.options ?? []
    return options.find((option) => !/请选择|请选取|全部/.test(option)) ?? options[0] ?? ''
  }
  if (classification.semanticType === 'email') return `qa_${stamp}@example.com`
  if (classification.semanticType === 'phone') return '13800138000'
  if (classification.semanticType === 'url') return `https://example.com/${stamp}`
  if (classification.controlType === 'number') {
    const min = raw.min ?? 1
    const max = raw.max ?? min + 10
    return String(min <= max ? min : max)
  }
  if (classification.controlType === 'date') {
    return new Date().toISOString().slice(0, 10)
  }

  const maxConstraint = constraints.find((constraint) => constraint.kind === 'maxLength')
  const minConstraint = constraints.find((constraint) => constraint.kind === 'minLength')
  const max = typeof maxConstraint?.value === 'number' ? maxConstraint.value : undefined
  const min = typeof minConstraint?.value === 'number' ? minConstraint.value : undefined
  let value = `规范测试_${stamp}`
  if (max && value.length > max) value = value.slice(0, max)
  if (min && value.length < min) value = value.padEnd(min, '测')
  return value
}

function buildField(raw: DesignPageField, index: number, stamp: string): DesignField {
  const classification = classify(raw)
  const constraints = buildConstraints(raw, classification)
  const fillable = isFillable(raw, classification)
  const label = clean(raw.label) || raw.ref
  return {
    id: `f-${String(index + 1).padStart(3, '0')}`,
    ref: raw.ref,
    label,
    controlType: classification.controlType,
    semanticType: classification.semanticType,
    required: raw.required === true,
    constraints,
    ...(raw.options ? { options: raw.options } : {}),
    ...(raw.value !== undefined ? { value: raw.value } : {}),
    baseline: baselineValue(raw, classification, constraints, stamp),
    fillable,
    ...(raw.disabled !== undefined ? { disabled: raw.disabled } : {}),
    ...(raw.readonly !== undefined ? { readonly: raw.readonly } : {}),
    ...(!fillable
      ? {
          note:
            raw.tag !== 'select' && raw.role === 'combobox'
              ? '自定义下拉：P0 不自动操作，必填留空可测，正常流待确认'
              : '控件无法自动填写，正常流可能待确认',
        }
      : {}),
    classification: {
      confidence: classification.confidence,
      evidence: classification.evidence,
    },
  }
}

function repeat(char: string, length: number): string {
  if (length <= 0) return ''
  return char.repeat(length)
}

const EMAIL_SUFFIX = '@b.co'
const URL_BASE = 'http://a.co'

/**
 * 构造指定长度、且满足语义格式的数据。
 * 长度校验必须和其他格式约束同时成立，否则“合法边界值”本身就是非法数据。
 * 无法同时满足时返回 undefined，由调用方标记待确认，而不是生成假阳性场景。
 */
function lengthValue(field: DesignField, length: number): string | undefined {
  if (!Number.isInteger(length) || length < 0) return undefined
  if (field.semanticType === 'email') {
    // local part 1-64，整体不超过 254
    const local = length - EMAIL_SUFFIX.length
    if (local < 1 || local > 64) return undefined
    return `${'a'.repeat(local)}${EMAIL_SUFFIX}`
  }
  if (field.semanticType === 'url') {
    if (length < URL_BASE.length) return undefined
    if (length === URL_BASE.length) return URL_BASE
    return `${URL_BASE}/${'a'.repeat(length - URL_BASE.length - 1)}`
  }
  if (field.semanticType === 'phone') {
    // 中国大陆手机号固定 11 位
    return length === 11 ? '13800138000' : undefined
  }
  return repeat('测', length)
}

function lengthSkipReason(field: DesignField, length: number): string {
  return `无法构造 ${length} 字且格式合法的数据（${field.semanticType}）`
}

function scenarioStatusOf(rows: RowDraft[]): DesignScenarioStatus {
  const ready = rows.filter((row) => row.status === 'ready').length
  if (ready === rows.length) return 'ready'
  if (ready > 0) return 'partial'
  return 'pending'
}

function addScenarioGroup(
  drafts: ScenarioDraft[],
  records: DesignDataRecord[],
  baseline: Record<string, string | string[]>,
  input: ScenarioDraft,
): void {
  const { rows, status, ...scenario } = input
  if (rows.length === 0) return
  const dataRecordIds = rows.map((row) => {
    const id = `dr-${String(records.length + 1).padStart(3, '0')}`
    records.push({
      id,
      label: row.label,
      values: { ...baseline, ...row.values },
      kind: row.kind,
      expected: row.expected,
      ...((row.expectedText ?? scenario.expectedText)
        ? { expectedText: row.expectedText ?? scenario.expectedText }
        : {}),
      ...(row.expectedValue !== undefined ? { expectedValue: row.expectedValue } : {}),
      status: row.status,
      testLevel: row.testLevel,
      partition: row.partition,
      tags: [...new Set([...scenario.tags, ...(row.tags ?? [])])],
      ...(row.reason ? { reason: row.reason } : {}),
      source: 'generated',
    })
    return id
  })
  drafts.push({
    ...scenario,
    rows,
    status: status ?? scenarioStatusOf(rows),
    dataRecordIds,
  })
}

function invalidFormatValue(field: DesignField, raw: DesignPageField): string | undefined {
  switch (field.semanticType) {
    case 'email':
      return 'not-an-email'
    case 'phone':
      return '12345'
    case 'url':
      return 'not-a-url'
    default: {
      if (field.controlType !== 'number') return undefined
      if (raw.max !== undefined) return String(raw.max + 1)
      if (raw.min !== undefined && raw.min > 0) return String(raw.min - 1)
      return undefined
    }
  }
}

function dateOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function currentPath(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return ''
  }
}

/** 从页面字段生成测试设计矩阵：规范决定测什么，页面只提供控件与覆盖值 */
export function buildDesignMatrix(page: DesignPageInput): DesignMatrix {
  const stamp = Date.now().toString(36).slice(-5)
  const fields = page.fields
    .filter((raw) => !raw.disabled && !raw.readonly)
    .map((raw, index) => buildField(raw, index, stamp))
  const baseline: Record<string, string | string[]> = Object.fromEntries(
    fields.map((field) => [field.ref, field.baseline ?? '']),
  )
  const drafts: ScenarioDraft[] = []
  const records: DesignDataRecord[] = []
  const skipped: DesignSkipped[] = []
  const canSubmit = Boolean(page.submit)

  if (fields.length === 0) {
    skipped.push({
      ruleId: 'fields',
      ruleName: '字段识别',
      reason: '未识别到可编辑的输入字段',
    })
  }
  if (!page.submit) {
    skipped.push({
      ruleId: 'submit',
      ruleName: '提交按钮',
      reason: '未识别到可用的保存/提交按钮',
    })
  }

  const searchMode = page.submit ? /查询|搜索/.test(page.submit.name) : false
  if (searchMode) {
    skipped.push({
      ruleId: 'page-kind',
      ruleName: '页面类型',
      reason: `检测到「${page.submit?.name}」按钮，当前更像查询/列表页；请打开新建/编辑表单后再分析`,
    })
  }

  const unknownFields = fields.filter((field) => field.controlType === 'unknown')
  for (const field of unknownFields) {
    skipped.push({
      ruleId: 'control-type',
      ruleName: '控件分类',
      fieldLabel: field.label,
      reason: '控件类型无法判断，需要人工确认；未生成场景',
    })
  }

  const baseRowStatus: DesignDataRecordStatus = canSubmit ? 'ready' : 'pending'
  const baseReason = canSubmit ? undefined : '未识别到提交按钮，场景先标记待确认'

  if (!searchMode) {
    for (const field of fields) {
      const raw = page.fields.find((item) => item.ref === field.ref)
      if (!raw) continue
      const label = field.label

      if (PAGE_CONTROL_LABEL.test(label)) {
        skipped.push({
          ruleId: 'page-control',
          ruleName: '分页控件',
          fieldLabel: label,
          reason: '分页/工具栏控件不纳入表单设计',
        })
        continue
      }

      // 必填
      if (field.required) {
        const selectLike =
          field.controlType === 'select' ||
          field.controlType === 'multiSelect' ||
          field.controlType === 'checkbox' ||
          field.controlType === 'radio'
        const hasDefault = Boolean(raw.value?.trim())
        const pending = selectLike && hasDefault
        addScenarioGroup(drafts, records, baseline, {
          ruleId: 'required',
          ruleName: '必填校验',
          title: `${label}-必填`,
          fieldRef: field.ref,
          fieldLabel: label,
          kind: 'negative',
          expected: 'invalid',
          priority: 'blocker',
          tags: ['required', label],
          source: 'standard:required',
          ...(pending
            ? {
                reason: `字段已有默认值「${raw.value}」，需要确认组件能否清空；无法清空时不生成必然失败的场景`,
              }
            : baseReason
              ? { reason: baseReason }
              : {}),
          rows: [
            {
              label: '空值',
              partition: 'empty',
              kind: 'negative',
              expected: 'invalid',
              testLevel: 'ui',
              status: pending ? 'pending' : baseRowStatus,
              values: { [field.ref]: '' },
              ...(pending
                ? {
                    reason: `字段已有默认值「${raw.value}」，需要先确认能否清空`,
                  }
                : {}),
            },
          ],
        })
      }

      // 长度：规范默认值 + 页面 maxlength 覆盖；同一规范按预期拆成合法/非法场景
      const maxConstraint = maxLengthConstraint(field)
      if (
        (field.controlType === 'shortText' || field.controlType === 'longText') &&
        maxConstraint &&
        !field.fillable
      ) {
        skipped.push({
          ruleId: 'length',
          ruleName: '长度校验',
          fieldLabel: label,
          reason: '控件无法自动填写，长度场景未生成',
        })
      } else if (
        (field.controlType === 'shortText' || field.controlType === 'longText') &&
        maxConstraint
      ) {
        const max = typeof maxConstraint.value === 'number' ? maxConstraint.value : undefined
        const min = minLengthOf(field)
        if (max === undefined) {
          skipped.push({
            ruleId: 'length',
            ruleName: '长度校验',
            fieldLabel: label,
            reason: '长度约束值无法解析',
          })
        } else if (maxConstraint.status === 'pending') {
          const pendingValue = lengthValue(field, max + 1) ?? repeat('测', max + 1)
          addScenarioGroup(drafts, records, baseline, {
            ruleId: 'length',
            ruleName: '长度校验',
            title: `${label}-长度-待确认`,
            fieldRef: field.ref,
            fieldLabel: label,
            kind: 'negative',
            expected: 'invalid',
            priority: 'critical',
            tags: ['length', label],
            source: 'standard:length',
            reason: maxConstraint.note ?? '页面长度约束与规范冲突，需要人工确认',
            rows: [
              {
                label: `${max + 1} 字`,
                partition: 'invalidOverMax',
                kind: 'negative',
                expected: 'invalid',
                testLevel: 'ui',
                status: 'pending',
                values: { [field.ref]: pendingValue },
                reason: maxConstraint.note ?? '页面长度约束与规范冲突，需要人工确认',
              },
            ],
          })
        } else {
          const maxValue = lengthValue(field, max)
          const lowerValue = max > 1 ? lengthValue(field, max - 1) : undefined
          const overValue = lengthValue(field, max + 1)
          const over = overValue ?? repeat('测', max + 1)
          const validRows: RowDraft[] = []

          if (max > 1) {
            if (lowerValue === undefined) {
              skipped.push({
                ruleId: 'length',
                ruleName: '长度校验',
                fieldLabel: label,
                reason: lengthSkipReason(field, max - 1),
              })
            } else {
              validRows.push({
                label: `${max - 1} 字`,
                partition: 'validMax-1',
                kind: 'positive',
                expected: 'success',
                testLevel: 'ui',
                status: baseRowStatus,
                values: { [field.ref]: lowerValue },
              })
            }
          }

          if (maxValue === undefined) {
            skipped.push({
              ruleId: 'length',
              ruleName: '长度校验',
              fieldLabel: label,
              reason: lengthSkipReason(field, max),
            })
          } else {
            validRows.push({
              label: `${max} 字`,
              partition: 'validMax',
              kind: 'positive',
              expected: 'success',
              testLevel: 'ui',
              status: baseRowStatus,
              values: { [field.ref]: maxValue },
            })
          }

          if (raw.maxLength && raw.maxLength === max) {
            if (maxValue !== undefined) {
              // 截断只关心 maxlength 行为：让超长值的前 max 位恰为合法边界值，
              // 截断后仍然是合法数据；超长值本身不提交，无需格式合法。
              validRows.push({
                label: `${max + 1} 字（截断）`,
                partition: 'invalidOverMax',
                kind: 'positive',
                expected: 'success',
                testLevel: 'ui',
                status: baseRowStatus,
                values: { [field.ref]: `${maxValue}a` },
                expectedValue: maxValue,
                tags: ['truncate'],
              })
            } else {
              validRows.push({
                label: `${max + 1} 字（截断待确认）`,
                partition: 'invalidOverMax',
                kind: 'positive',
                expected: 'success',
                testLevel: 'ui',
                status: 'pending',
                values: { [field.ref]: over },
                reason: `无法构造 ${max} 字且格式合法的数据，截断后预期未知，需人工提供`,
              })
            }
          }

          if (min !== undefined && min > 0 && min !== max) {
            const minValue = lengthValue(field, min)
            if (minValue === undefined) {
              skipped.push({
                ruleId: 'length',
                ruleName: '长度校验',
                fieldLabel: label,
                reason: lengthSkipReason(field, min),
              })
            } else {
              validRows.push({
                label: `${min} 字（最小）`,
                partition: 'validMin',
                kind: 'positive',
                expected: 'success',
                testLevel: 'ui',
                status: baseRowStatus,
                values: { [field.ref]: minValue },
              })
            }
          }

          if (validRows.length > 0) {
            addScenarioGroup(drafts, records, baseline, {
              ruleId: 'length',
              ruleName: '长度校验',
              title: `${label}-长度-合法边界`,
              fieldRef: field.ref,
              fieldLabel: label,
              kind: 'positive',
              expected: 'success',
              priority: 'critical',
              tags: ['length', label],
              source: 'standard:length',
              requiresWrite: true,
              ...(baseReason ? { reason: baseReason } : {}),
              rows: validRows,
            })
          }

          const invalidRows: RowDraft[] = []
          if (!(raw.maxLength && raw.maxLength === max)) {
            invalidRows.push({
              label: `${max + 1} 字（UI 待确认）`,
              partition: 'invalidOverMax',
              kind: 'negative',
              expected: 'invalid',
              testLevel: 'ui',
              status: 'pending',
              values: { [field.ref]: over },
              reason: '未检测到页面 maxlength；UI 校验位置未知，先标记待确认',
            })
          }
          invalidRows.push({
            label: `${max + 1} 字（API）`,
            partition: 'invalidOverMax',
            kind: 'negative',
            expected: 'invalid',
            testLevel: 'api',
            status: 'pending',
            values: { [field.ref]: over },
            tags: ['api'],
            reason: `P0 只执行 UI；API 层应拒绝 ${max + 1} 字`,
          })
          if (min !== undefined && min > 1) {
            const under = lengthValue(field, min - 1)
            if (under === undefined) {
              skipped.push({
                ruleId: 'length',
                ruleName: '长度校验',
                fieldLabel: label,
                reason: lengthSkipReason(field, min - 1),
              })
            } else {
              invalidRows.push({
                label: `${min - 1} 字（小于最小）`,
                partition: 'invalidUnderMin',
                kind: 'negative',
                expected: 'invalid',
                testLevel: 'ui',
                status: baseRowStatus,
                values: { [field.ref]: under },
              })
            }
          }
          if (invalidRows.length > 0) {
            addScenarioGroup(drafts, records, baseline, {
              ruleId: 'length',
              ruleName: '长度校验',
              title: `${label}-长度-非法边界`,
              fieldRef: field.ref,
              fieldLabel: label,
              kind: 'negative',
              expected: 'invalid',
              priority: 'critical',
              tags: ['length', label],
              source: 'standard:length',
              ...(baseReason ? { reason: baseReason } : {}),
              rows: invalidRows,
            })
          }
        }
      }

      // 格式
      if (
        (field.semanticType === 'email' ||
          field.semanticType === 'phone' ||
          field.semanticType === 'url' ||
          field.controlType === 'number') &&
        !field.fillable
      ) {
        skipped.push({
          ruleId: 'format',
          ruleName: '格式校验',
          fieldLabel: label,
          reason: '控件无法自动填写，格式/数值边界场景未生成',
        })
      } else if (
        field.semanticType === 'email' ||
        field.semanticType === 'phone' ||
        field.semanticType === 'url' ||
        field.controlType === 'number'
      ) {
        const invalid = invalidFormatValue(field, raw)
        if (invalid !== undefined) {
          addScenarioGroup(drafts, records, baseline, {
            ruleId: 'format',
            ruleName: '格式校验',
            title: field.controlType === 'number' ? `${label}-数值边界` : `${label}-格式校验`,
            fieldRef: field.ref,
            fieldLabel: label,
            kind: 'negative',
            expected: 'invalid',
            priority: 'critical',
            tags: ['format', label],
            source: 'standard:format',
            ...(baseReason ? { reason: baseReason } : {}),
            rows: [
              {
                label: field.controlType === 'number' ? `数值 ${invalid}` : '非法值',
                partition: field.controlType === 'number' ? 'invalidRange' : 'invalidFormat',
                kind: 'negative',
                expected: 'invalid',
                testLevel: 'ui',
                status: baseRowStatus,
                values: { [field.ref]: invalid },
              },
            ],
          })
        } else if (field.controlType === 'number') {
          skipped.push({
            ruleId: 'format',
            ruleName: '数值边界',
            fieldLabel: label,
            reason: '数字字段没有 min/max，无法确定边界',
          })
        }
      }

      // 重复：需要已有记录，P0 只生成待确认项
      if (field.constraints.some((constraint) => constraint.kind === 'unique')) {
        addScenarioGroup(drafts, records, baseline, {
          ruleId: 'duplicate',
          ruleName: '重复校验',
          title: `${label}-重复校验`,
          fieldRef: field.ref,
          fieldLabel: label,
          kind: 'negative',
          expected: 'invalid',
          priority: 'critical',
          tags: ['duplicate', label],
          source: 'ai:unique',
          reason: '需要已有记录作为重复数据；P0 不自动造数',
          rows: [
            {
              label: '已存在值',
              partition: 'duplicate',
              kind: 'negative',
              expected: 'invalid',
              testLevel: 'ui',
              status: 'pending',
              values: { [field.ref]: '' },
              reason: '需要已有记录作为重复数据；P0 不自动造数',
            },
          ],
        })
      }
    }

    // 日期范围：跨字段规则，先以待确认项呈现
    const dateFields = fields.filter((field) => field.controlType === 'date')
    const startField = dateFields.find((field) => START_DATE_LIKE.test(field.label))
    const endField = dateFields.find((field) => END_DATE_LIKE.test(field.label))
    if (startField && endField) {
      addScenarioGroup(drafts, records, baseline, {
        ruleId: 'date-range',
        ruleName: '日期范围',
        title: `${startField.label}-日期范围`,
        fieldRef: startField.ref,
        fieldRefs: [startField.ref, endField.ref],
        fieldLabel: startField.label,
        kind: 'negative',
        expected: 'invalid',
        priority: 'critical',
        tags: ['date-range', startField.label, endField.label],
        source: 'standard:date-range',
        reason: '跨字段校验位置待确认；P0 先记录，不生成必然失败的用例',
        rows: [
          {
            label: '开始晚于结束',
            partition: 'dateRange',
            kind: 'negative',
            expected: 'invalid',
            testLevel: 'ui',
            status: 'pending',
            values: {
              [startField.ref]: dateOffset(2),
              [endField.ref]: dateOffset(1),
            },
            reason: '跨字段校验位置待确认；P0 先记录，不生成必然失败的用例',
          },
        ],
      })
    }

    // 正常流
    if (page.submit && fields.length > 0) {
      const unfillableRequired = fields.filter(
        (field) => field.required && !field.fillable && !field.value,
      )
      const target = fields.find((field) => field.fillable) ?? fields[0]
      if (unfillableRequired.length > 0) {
        addScenarioGroup(drafts, records, baseline, {
          ruleId: 'happy-path',
          ruleName: '正常流',
          title: `${page.title || '表单'}-正常流`,
          fieldRef: target.ref,
          fieldLabel: target.label,
          kind: 'positive',
          expected: 'success',
          priority: 'normal',
          tags: ['happy-path'],
          source: 'standard:happy-path',
          reason: `存在无法自动填写的必填字段：${unfillableRequired
            .map((field) => field.label)
            .join('、')}`,
          requiresWrite: true,
          rows: [
            {
              label: '基线数据',
              partition: 'validTypical',
              kind: 'positive',
              expected: 'success',
              testLevel: 'ui',
              status: 'pending',
              values: { [target.ref]: target.baseline ?? '' },
              reason: `存在无法自动填写的必填字段：${unfillableRequired
                .map((field) => field.label)
                .join('、')}`,
            },
          ],
        })
      } else {
        addScenarioGroup(drafts, records, baseline, {
          ruleId: 'happy-path',
          ruleName: '正常流',
          title: `${page.title || '表单'}-正常流`,
          fieldRef: target.ref,
          fieldLabel: target.label,
          kind: 'positive',
          expected: 'success',
          priority: 'normal',
          tags: ['happy-path'],
          source: 'standard:happy-path',
          requiresWrite: true,
          ...(baseReason ? { reason: baseReason } : {}),
          rows: [
            {
              label: '基线数据',
              partition: 'validTypical',
              kind: 'positive',
              expected: 'success',
              testLevel: 'ui',
              status: baseRowStatus,
              values: { [target.ref]: target.baseline ?? '' },
            },
          ],
        })
      }
    }
  }

  const scenarios: DesignScenario[] = drafts.map((draft, index) => {
    const { rows, dataRecordIds, ...rest } = draft
    return {
      ...rest,
      id: `ds-${String(index + 1).padStart(3, '0')}`,
      status: draft.status ?? scenarioStatusOf(rows),
      dataRecordIds: dataRecordIds ?? [],
    }
  })
  const scenarioByRecord = new Map<string, DesignScenario>()
  for (const scenario of scenarios) {
    for (const recordId of scenario.dataRecordIds) scenarioByRecord.set(recordId, scenario)
  }
  const activeRecords = records.filter((record) => {
    const scenario = scenarioByRecord.get(record.id)
    return (
      Boolean(scenario) &&
      scenario?.status !== 'rejected' &&
      scenario?.status !== 'excluded' &&
      record.status !== 'excluded'
    )
  })
  const readyRows = activeRecords.filter((record) => record.status === 'ready')
  const pendingRows = activeRecords.filter((record) => record.status === 'pending')
  const acceptedRecords = scenarios
    .filter((scenario) => scenario.status === 'accepted')
    .flatMap((scenario) => scenario.dataRecordIds)
    .map((id) => activeRecords.find((record) => record.id === id))
    .filter((record): record is DesignDataRecord => Boolean(record))
  const acceptedRows = acceptedRecords.filter((record) => record.status === 'ready')
  const savedRows = activeRecords.filter((record) => record.savedCaseId).length
  const executedRows = activeRecords.filter((record) => record.lastRun).length
  const passedRows = activeRecords.filter((record) => record.lastRun?.status === 'passed').length
  const applicableRows = readyRows.length + pendingRows.length
  const countScenarios = (status: DesignScenarioStatus): number =>
    scenarios.filter((scenario) => scenario.status === status).length

  const appliedRules = new Set(scenarios.map((scenario) => scenario.ruleId))
  const standards = Array.from(
    new Map(
      Array.from(appliedRules)
        .map((ruleId) => STANDARD_BY_RULE.get(ruleId))
        .filter((standard): standard is (typeof STANDARDS)[number] => Boolean(standard))
        .map((standard) => [standard.id, standard]),
    ).values(),
  )

  const uniqueSkipped = Array.from(
    new Map(
      skipped.map((item) => [`${item.ruleId}|${item.fieldLabel ?? ''}|${item.reason}`, item]),
    ).values(),
  )

  return {
    schemaVersion: 2,
    revision: 0,
    id: `dm-${Date.now().toString(36)}`,
    url: page.url,
    title: page.title,
    fields,
    ...(page.submit ? { submit: page.submit } : {}),
    ...(page.entry ? { entry: page.entry } : {}),
    ...(page.scopeLabel ? { scopeLabel: page.scopeLabel } : {}),
    scenarios,
    skipped: uniqueSkipped,
    stats: {
      fields: fields.length,
      rules: appliedRules.size,
      scenarios: scenarios.length,
      rows: activeRecords.length,
      ready: countScenarios('ready') + countScenarios('partial'),
      readyRows: readyRows.length,
      pending: countScenarios('pending'),
      pendingRows: pendingRows.length,
      accepted: countScenarios('accepted'),
      skipped: uniqueSkipped.length,
    },
    coverage: {
      designCoverage: applicableRows === 0 ? 0 : readyRows.length / applicableRows,
      acceptCoverage: applicableRows === 0 ? 0 : acceptedRows.length / applicableRows,
      executionCoverage: applicableRows === 0 ? 0 : executedRows / applicableRows,
      passRate: executedRows === 0 ? 0 : passedRows / executedRows,
      scenarios: scenarios.length,
      readyScenarios: countScenarios('ready'),
      partialScenarios: countScenarios('partial'),
      pendingScenarios: countScenarios('pending'),
      acceptedScenarios: countScenarios('accepted'),
      rejectedScenarios: countScenarios('rejected'),
      rows: activeRecords.length,
      readyRows: readyRows.length,
      pendingRows: pendingRows.length,
      acceptedRows: acceptedRows.length,
      savedRows,
      executedRows,
      passedRows,
      blocked: 0,
    },
    ...(standards.length > 0 ? { standards: standards.map((standard) => ({ ...standard })) } : {}),
    dataRecords: Object.fromEntries(records.map((record) => [record.id, record])),
    successText: page.successText ?? DEFAULT_SUCCESS_TEXT,
    createdAt: new Date().toISOString(),
  }
}

/** 把选中的可执行数据行转成待解析的用例蓝图；元素 ref 由 Agent 解析成持久定位器 */
export function buildCaseBlueprints(
  matrix: DesignMatrix,
  selections: DesignSelection[],
): CaseBlueprint[] {
  const records = matrix.dataRecords ?? {}
  const stamp = Date.now().toString(36).slice(-5)
  const path = currentPath(matrix.url)
  const seen = new Set<string>()
  const blueprints: CaseBlueprint[] = []

  for (const selection of selections) {
    const key = `${selection.scenarioId}::${selection.dataRecordId}`
    if (seen.has(key)) continue
    seen.add(key)
    const scenario = matrix.scenarios.find((item) => item.id === selection.scenarioId)
    if (!scenario || scenario.status === 'rejected' || scenario.status === 'excluded') continue
    if (!scenario.dataRecordIds.includes(selection.dataRecordId)) continue
    const record = records[selection.dataRecordId]
    if (!record || record.status !== 'ready') continue

    const steps: BlueprintStep[] = []
    if (matrix.entry && matrix.scopeLabel) {
      steps.push({ action: 'click', ref: matrix.entry.ref })
    }

    for (const field of matrix.fields) {
      if (field.disabled || field.readonly || field.controlType === 'unknown') continue
      const rawValue = record.values[field.ref]
      if (Array.isArray(rawValue)) continue
      const value = rawValue === undefined ? (field.baseline ?? '') : String(rawValue)
      if (field.controlType === 'checkbox' || field.controlType === 'radio') {
        if (value === 'true' || (value !== '' && value !== 'false')) {
          steps.push({ action: 'click', ref: field.ref })
        }
        continue
      }
      if (!field.fillable) continue
      if (field.controlType === 'select' || field.controlType === 'multiSelect') {
        if (value !== '') {
          steps.push({
            action: 'select',
            ref: field.ref,
            value,
            mode: 'native',
          })
        }
        continue
      }
      steps.push({ action: 'fill', ref: field.ref, value })
    }

    if (matrix.submit) {
      steps.push({ action: 'click', ref: matrix.submit.ref })
    }

    if (record.expectedValue !== undefined) {
      steps.push({
        action: 'assert',
        ref: scenario.fieldRef,
        assertion: { type: 'value', expected: record.expectedValue },
      })
    }
    if (record.expected === 'invalid') {
      steps.push({
        action: 'assert',
        ref: scenario.fieldRef,
        assertion: { type: 'fieldInvalid' },
      })
      steps.push({
        action: 'assert',
        ref: scenario.fieldRef,
        assertion: { type: 'fieldError' },
      })
      if (path) {
        steps.push({
          action: 'assert',
          assertion: { type: 'urlContains', expected: path },
        })
      }
    } else {
      steps.push({
        action: 'assert',
        assertion: {
          type: 'pageText',
          match: 'contains',
          expected: matrix.successText,
        },
      })
    }

    blueprints.push({
      scenarioId: scenario.id,
      dataRecordId: record.id,
      label: record.label,
      name: `测试规范_${scenario.title}_${record.label}_${stamp}`,
      intent: `${scenario.ruleName}：${scenario.fieldLabel} · ${record.label}`,
      startUrl: matrix.url,
      steps,
    })
  }

  return blueprints
}
