import type { DesignDataRecord, DesignField, DesignMatrix, DesignPageField } from '@atp/model'
import { describe, expect, it } from 'vitest'
import {
  buildCaseBlueprints,
  buildDesignMatrix,
  type DesignPageInput,
  type DesignSelection,
} from './index.js'

function raw(
  overrides: Partial<DesignPageField> & Pick<DesignPageField, 'ref' | 'label'>,
): DesignPageField {
  return {
    role: 'textbox',
    tag: 'input',
    inputType: 'text',
    ...overrides,
  }
}

function page(
  fields: DesignPageField[],
  overrides: Partial<DesignPageInput> = {},
): DesignPageInput {
  return {
    url: 'https://example.com/contracts',
    title: '新建版权合同',
    fields,
    submit: { ref: 'df-submit', name: '保存' },
    ...overrides,
  }
}

function scenariosByRule(matrix: DesignMatrix, ruleId: string) {
  return matrix.scenarios.filter((scenario) => scenario.ruleId === ruleId)
}

function scenarioByTitle(matrix: DesignMatrix, title: string) {
  return matrix.scenarios.find((scenario) => scenario.title === title)
}

function rowsOf(matrix: DesignMatrix, scenarioId: string): DesignDataRecord[] {
  const scenario = matrix.scenarios.find((item) => item.id === scenarioId)
  return (scenario?.dataRecordIds ?? [])
    .map((id) => matrix.dataRecords?.[id])
    .filter((record): record is DesignDataRecord => Boolean(record))
}

function selectionOf(matrix: DesignMatrix, scenarioTitle: string, label?: string): DesignSelection {
  const scenario = scenarioByTitle(matrix, scenarioTitle)
  expect(scenario).toBeTruthy()
  const rows = rowsOf(matrix, scenario?.id ?? '')
  const row = label ? rows.find((item) => item.label === label) : rows[0]
  expect(row).toBeTruthy()
  return { scenarioId: scenario?.id ?? '', dataRecordId: row?.id ?? '' }
}

function fieldOf(matrix: DesignMatrix, ref: string): DesignField {
  const field = matrix.fields.find((item) => item.ref === ref)
  expect(field).toBeTruthy()
  return field as DesignField
}

describe('buildDesignMatrix', () => {
  it('短文本默认 256：场景按预期分组，255/256 可执行，257 待确认', () => {
    const matrix = buildDesignMatrix(
      page([raw({ ref: 'df-1', label: '合同名称', required: true })]),
    )
    const field = fieldOf(matrix, 'df-1')
    expect(field.constraints.find((constraint) => constraint.kind === 'maxLength')).toMatchObject({
      value: 256,
      source: 'standard',
      status: 'applied',
    })

    const valid = scenarioByTitle(matrix, '合同名称-长度-合法边界')
    expect(valid).toMatchObject({ expected: 'success', kind: 'positive', status: 'ready' })
    expect(valid?.requiresWrite).toBe(true)
    expect(rowsOf(matrix, valid?.id ?? '').map((row) => row.label)).toEqual(['255 字', '256 字'])

    const invalid = scenarioByTitle(matrix, '合同名称-长度-非法边界')
    expect(invalid).toMatchObject({ expected: 'invalid', kind: 'negative', status: 'pending' })
    expect(rowsOf(matrix, invalid?.id ?? '').map((row) => row.testLevel)).toEqual(['ui', 'api'])
    expect(rowsOf(matrix, invalid?.id ?? '').every((row) => row.status === 'pending')).toBe(true)

    const required = scenarioByTitle(matrix, '合同名称-必填')
    expect(required).toMatchObject({ expected: 'invalid', status: 'ready' })
    expect(rowsOf(matrix, required?.id ?? '')[0]).toMatchObject({
      label: '空值',
      expected: 'invalid',
      status: 'ready',
      partition: 'empty',
    })
    expect(matrix.scenarios.some((scenario) => scenario.ruleId === 'duplicate')).toBe(true)
  })

  it('长文本使用规范默认 1000，999/1000 可执行，1001 待确认', () => {
    const matrix = buildDesignMatrix(page([raw({ ref: 'df-2', label: '备注', tag: 'textarea' })]))
    expect(fieldOf(matrix, 'df-2').controlType).toBe('longText')
    expect(
      fieldOf(matrix, 'df-2').constraints.find((constraint) => constraint.kind === 'maxLength')
        ?.value,
    ).toBe(1000)

    const valid = scenarioByTitle(matrix, '备注-长度-合法边界')
    expect(rowsOf(matrix, valid?.id ?? '').map((row) => row.label)).toEqual(['999 字', '1000 字'])
    const invalid = scenarioByTitle(matrix, '备注-长度-非法边界')
    expect(rowsOf(matrix, invalid?.id ?? '').map((row) => row.label)).toEqual([
      '1001 字（UI 待确认）',
      '1001 字（API）',
    ])
  })

  it('页面 maxlength=50：49/50/51 截断可执行，非法场景只剩 API 待确认', () => {
    const matrix = buildDesignMatrix(
      page([raw({ ref: 'df-1', label: '合同名称', required: true, maxLength: 50 })]),
    )
    const max = fieldOf(matrix, 'df-1').constraints.find(
      (constraint) => constraint.kind === 'maxLength',
    )
    expect(max).toMatchObject({
      value: 50,
      source: 'page',
      status: 'applied',
      standardDefault: { kind: 'maxLength', value: 256 },
    })

    const valid = scenarioByTitle(matrix, '合同名称-长度-合法边界')
    const rows = rowsOf(matrix, valid?.id ?? '')
    expect(rows.map((row) => row.label)).toEqual(['49 字', '50 字', '51 字（截断）'])
    expect(rows.every((row) => row.status === 'ready')).toBe(true)
    const truncate = rows.find((row) => row.expectedValue !== undefined)
    expect(truncate?.values['df-1']).toHaveLength(51)
    expect(truncate?.expectedValue).toHaveLength(50)
    expect(truncate?.tags).toContain('truncate')

    const invalid = scenarioByTitle(matrix, '合同名称-长度-非法边界')
    expect(rowsOf(matrix, invalid?.id ?? '').map((row) => row.testLevel)).toEqual(['api'])
  })

  it('页面约束比规范更宽松时标记待确认，不生成可执行的长度行', () => {
    const matrix = buildDesignMatrix(
      page([raw({ ref: 'df-1', label: '合同名称', maxLength: 1000 })]),
    )
    const max = fieldOf(matrix, 'df-1').constraints.find(
      (constraint) => constraint.kind === 'maxLength',
    )
    expect(max).toMatchObject({ value: 1000, status: 'pending', source: 'page' })
    const pending = scenarioByTitle(matrix, '合同名称-长度-待确认')
    expect(pending?.status).toBe('pending')
    expect(rowsOf(matrix, pending?.id ?? '')).toHaveLength(1)
    expect(
      scenariosByRule(matrix, 'length').some((scenario) =>
        rowsOf(matrix, scenario.id).some((row) => row.status === 'ready'),
      ),
    ).toBe(false)
  })

  it('必填文本生成空值负向场景', () => {
    const matrix = buildDesignMatrix(
      page([raw({ ref: 'df-1', label: '合同名称', required: true })]),
    )
    const required = scenarioByTitle(matrix, '合同名称-必填')
    expect(required).toMatchObject({
      expected: 'invalid',
      status: 'ready',
    })
    expect(rowsOf(matrix, required?.id ?? '')[0]).toMatchObject({
      values: { 'df-1': '' },
      partition: 'empty',
    })
  })

  it('有默认值的下拉无法构造空值时标记待确认', () => {
    const matrix = buildDesignMatrix(
      page([
        raw({
          ref: 'df-1',
          label: '内容提供商',
          tag: 'div',
          role: 'combobox',
          options: ['自有内容', '外部内容'],
          value: '自有内容',
          required: true,
        }),
      ]),
    )
    const field = fieldOf(matrix, 'df-1')
    expect(field.controlType).toBe('select')
    expect(field.fillable).toBe(false)
    const required = scenarioByTitle(matrix, '内容提供商-必填')
    expect(required?.status).toBe('pending')
    expect(rowsOf(matrix, required?.id ?? '')[0]?.reason).toContain('默认值')
  })

  it('原生下拉必填且无默认值时可以直接测试空值', () => {
    const matrix = buildDesignMatrix(
      page([
        raw({
          ref: 'df-1',
          label: '授权平台',
          tag: 'select',
          role: 'combobox',
          options: ['平台A', '平台B'],
          required: true,
        }),
      ]),
    )
    expect(fieldOf(matrix, 'df-1').fillable).toBe(true)
    const required = scenarioByTitle(matrix, '授权平台-必填')
    expect(required).toMatchObject({ status: 'ready' })
    expect(rowsOf(matrix, required?.id ?? '')[0]?.values['df-1']).toBe('')
    expect(scenarioByTitle(matrix, '新建版权合同-正常流')).toMatchObject({
      status: 'ready',
      requiresWrite: true,
    })
  })

  it('自定义下拉必填留空可测，但正常流待确认', () => {
    const matrix = buildDesignMatrix(
      page([
        raw({
          ref: 'df-1',
          label: '授权平台',
          tag: 'div',
          role: 'combobox',
          options: ['平台A', '平台B'],
          required: true,
        }),
      ]),
    )
    expect(scenarioByTitle(matrix, '授权平台-必填')?.status).toBe('ready')
    expect(scenarioByTitle(matrix, '新建版权合同-正常流')?.status).toBe('pending')
  })

  it('邮箱格式生成非法值负向场景', () => {
    const matrix = buildDesignMatrix(
      page([raw({ ref: 'df-1', label: '联系邮箱', inputType: 'email' })]),
    )
    expect(fieldOf(matrix, 'df-1').semanticType).toBe('email')
    const format = scenarioByTitle(matrix, '联系邮箱-格式校验')
    expect(format).toMatchObject({ expected: 'invalid', status: 'ready' })
    expect(rowsOf(matrix, format?.id ?? '')[0]).toMatchObject({
      values: { 'df-1': 'not-an-email' },
      expected: 'invalid',
    })
  })

  it('邮箱长度边界值仍然满足邮箱格式', () => {
    const matrix = buildDesignMatrix(
      page([raw({ ref: 'df-1', label: '联系邮箱', inputType: 'email', maxLength: 50 })]),
    )
    const valid = scenarioByTitle(matrix, '联系邮箱-长度-合法边界')
    const rows = rowsOf(matrix, valid?.id ?? '')
    expect(rows.map((row) => String(row.values['df-1']).length)).toEqual([49, 50, 51])
    const submitted = rows.filter((row) => row.expectedValue === undefined)
    expect(submitted.every((row) => /^a+@b\.co$/.test(String(row.values['df-1'])))).toBe(true)
    const truncate = rows.find((row) => row.expectedValue !== undefined)
    expect(truncate?.expectedValue).toHaveLength(50)
    expect(truncate?.expectedValue).toMatch(/^a+@b\.co$/)
  })

  it('无法构造该长度且格式合法的数据时跳过，不生成非法正向数据', () => {
    const matrix = buildDesignMatrix(
      page([raw({ ref: 'df-1', label: '联系邮箱', inputType: 'email' })]),
    )
    const lengthRows = scenariosByRule(matrix, 'length').flatMap((scenario) =>
      rowsOf(matrix, scenario.id),
    )
    expect(lengthRows.some((row) => row.status === 'ready')).toBe(false)
    expect(matrix.skipped.some((item) => item.reason.includes('格式合法'))).toBe(true)
  })

  it('日期范围生成跨字段待确认场景，数据行包含两个字段', () => {
    const matrix = buildDesignMatrix(
      page([
        raw({ ref: 'df-a', label: '授权开始', inputType: 'date' }),
        raw({ ref: 'df-b', label: '授权结束', inputType: 'date' }),
      ]),
    )
    const scenario = scenarioByTitle(matrix, '授权开始-日期范围')
    expect(scenario?.status).toBe('pending')
    expect(scenario?.fieldRefs).toEqual(['df-a', 'df-b'])
    const row = rowsOf(matrix, scenario?.id ?? '')[0]
    expect(row?.values['df-a']).toBeTruthy()
    expect(row?.values['df-b']).toBeTruthy()
  })

  it('查询页不生成表单场景', () => {
    const matrix = buildDesignMatrix(
      page([raw({ ref: 'df-1', label: '关键字' })], {
        submit: { ref: 'df-submit', name: '查询' },
      }),
    )
    expect(matrix.scenarios).toHaveLength(0)
    expect(matrix.skipped.some((item) => item.ruleId === 'page-kind')).toBe(true)
  })

  it('禁用和只读字段不进入设计', () => {
    const matrix = buildDesignMatrix(
      page([
        raw({ ref: 'df-1', label: '合同名称', disabled: true }),
        raw({ ref: 'df-2', label: '备注', tag: 'textarea', readonly: true }),
      ]),
    )
    expect(matrix.fields).toHaveLength(0)
    expect(matrix.skipped.some((item) => item.ruleId === 'fields')).toBe(true)
  })

  it('统计与覆盖按行计算，并区分 ready / pending / accepted', () => {
    const matrix = buildDesignMatrix(
      page([
        raw({ ref: 'df-1', label: '合同名称', required: true }),
        raw({ ref: 'df-2', label: '备注', tag: 'textarea' }),
      ]),
    )
    const rows = Object.values(matrix.dataRecords ?? {})
    const readyRows = rows.filter((row) => row.status === 'ready').length
    const pendingRows = rows.filter((row) => row.status === 'pending').length
    expect(matrix.stats.rows).toBe(rows.length)
    expect(matrix.stats.readyRows).toBe(readyRows)
    expect(matrix.stats.pendingRows).toBe(pendingRows)
    expect(matrix.coverage.rows).toBe(readyRows + pendingRows)
    expect(matrix.coverage.readyRows).toBe(readyRows)
    expect(matrix.coverage.pendingRows).toBe(pendingRows)
    expect(matrix.coverage.designCoverage).toBeCloseTo(readyRows / (readyRows + pendingRows))
    expect(matrix.schemaVersion).toBe(2)
    expect(matrix.revision).toBe(0)
  })
})

describe('buildCaseBlueprints', () => {
  it('弹窗表单先点入口，选中的每一行生成一条蓝图', () => {
    const matrix = buildDesignMatrix(
      page(
        [
          raw({
            ref: 'df-1',
            label: '合同名称',
            required: true,
            maxLength: 50,
          }),
        ],
        {
          entry: { ref: 'df-entry', name: '新建版权合同' },
          scopeLabel: '新建版权合同',
        },
      ),
    )
    const valid = scenarioByTitle(matrix, '合同名称-长度-合法边界')
    const selections = (valid?.dataRecordIds ?? []).map((dataRecordId) => ({
      scenarioId: valid?.id ?? '',
      dataRecordId,
    }))
    const blueprints = buildCaseBlueprints(matrix, selections)
    expect(blueprints).toHaveLength(3)
    expect(new Set(blueprints.map((item) => item.dataRecordId)).size).toBe(3)
    expect(blueprints.every((item) => item.name.includes('合同名称-长度-合法边界'))).toBe(true)
    expect(blueprints[0]?.steps[0]).toMatchObject({ action: 'click', ref: 'df-entry' })
    const truncate = blueprints.find((item) => item.label.includes('截断'))
    expect(
      truncate?.steps.some(
        (step) =>
          step.action === 'assert' &&
          step.assertion?.type === 'value' &&
          step.assertion.expected?.length === 50,
      ),
    ).toBe(true)
  })

  it('待确认行不生成蓝图', () => {
    const matrix = buildDesignMatrix(
      page([raw({ ref: 'df-1', label: '合同名称', required: true })]),
    )
    const invalid = scenarioByTitle(matrix, '合同名称-长度-非法边界')
    const selection = selectionOf(matrix, '合同名称-长度-非法边界')
    expect(invalid?.status).toBe('pending')
    expect(buildCaseBlueprints(matrix, [selection])).toHaveLength(0)
  })

  it('蓝图从数据行读取全部字段值，跨字段数据不丢失', () => {
    const matrix = buildDesignMatrix(
      page([
        raw({ ref: 'df-a', label: '授权开始', inputType: 'date' }),
        raw({ ref: 'df-b', label: '授权结束', inputType: 'date' }),
      ]),
    )
    const scenario = scenarioByTitle(matrix, '授权开始-日期范围')
    const row = rowsOf(matrix, scenario?.id ?? '')[0]
    expect(row).toBeTruthy()
    if (scenario && row) row.status = 'ready'
    const blueprints = buildCaseBlueprints(matrix, [
      { scenarioId: scenario?.id ?? '', dataRecordId: row?.id ?? '' },
    ])
    expect(blueprints).toHaveLength(1)
    const fills = blueprints[0]?.steps.filter((step) => step.action === 'fill') ?? []
    expect(fills.find((step) => step.ref === 'df-a')?.value).toBe(row?.values['df-a'])
    expect(fills.find((step) => step.ref === 'df-b')?.value).toBe(row?.values['df-b'])
  })
})
