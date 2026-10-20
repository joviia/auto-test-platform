import { getDb } from '@atp/core'
import {
  type CaseFile,
  caseFileSchema,
  type DesignCase,
  type DesignMatrix,
  type DesignSelection,
  type Element,
  type Step,
} from '@atp/model'
import { buildCaseBlueprints, buildDesignMatrix } from '@atp/test-design'
import { planLocators } from './ai/tools.js'
import type { ChromeController } from './browser.js'

/** 测试设计：分析当前页面，生成场景矩阵 */
export async function analyzeDesign(
  browser: ChromeController,
  options: { openEntry?: boolean } = {},
): Promise<DesignMatrix> {
  let page = await browser.designPage()
  if (!page.url || page.url === 'about:blank') {
    throw new Error('当前没有打开被测页面：请先打开或导航到一个页面')
  }
  let matrix = buildDesignMatrix(page)

  // 列表/查询页：如果页面上有「新建/新增」入口，先打开表单再分析
  const looksLikeList = matrix.skipped.some((item) => item.ruleId === 'page-kind')
  if (options.openEntry && page.entry && (looksLikeList || matrix.scenarios.length === 0)) {
    const entryName = page.entry.name
    const opened = await browser.openDesignEntry(page.entry.ref)
    if (opened) {
      page = await browser.designPage()
      const next = buildDesignMatrix(page)
      if (next.fields.length > 0 || next.scopeLabel) {
        matrix = {
          ...next,
          note: `已打开「${entryName}」表单进行分析`,
        }
      }
    }
  }
  const project = (await getDb().uow().projects.list())[0]
  if (!project) return matrix
  return getDb().uow().designSessions.save({ projectId: project.id, matrix })
}

/** 测试设计：把选中的数据行解析成可执行用例（不写库） */
export async function generateDesignCases(
  browser: ChromeController,
  matrix: DesignMatrix,
  selections: DesignSelection[],
): Promise<{ cases: DesignCase[] }> {
  const blueprints = buildCaseBlueprints(matrix, selections)
  if (blueprints.length === 0) throw new Error('没有选中可生成的场景')

  const project = (await getDb().uow().projects.list())[0]
  if (!project) throw new Error('还没有项目，请先在平台创建项目')

  const labels = new Map<string, string>()
  for (const field of matrix.fields) labels.set(field.ref, field.label || field.ref)
  if (matrix.submit) labels.set(matrix.submit.ref, matrix.submit.name)
  if (matrix.entry) labels.set(matrix.entry.ref, matrix.entry.name)

  const refs = new Set<string>()
  for (const blueprint of blueprints) {
    for (const step of blueprint.steps) {
      if (step.ref) refs.add(step.ref)
    }
  }

  const elements: Record<string, Element> = {}
  const elementIdByRef = new Map<string, string>()
  for (const ref of refs) {
    const info = await browser.describeRef(ref)
    if (!info) {
      throw new Error('页面元素已经变化：请重新分析当前页面后再生成用例')
    }
    const elementId = `el-design-${String(elementIdByRef.size + 1).padStart(3, '0')}`
    const name = (labels.get(ref) || info.name || info.tag).slice(0, 60)
    elements[elementId] = {
      id: elementId,
      name,
      locators: planLocators(info),
    }
    elementIdByRef.set(ref, elementId)
  }

  const cases: DesignCase[] = blueprints.map((blueprint, caseIndex) => {
    const steps: Step[] = blueprint.steps.map((step, index) => {
      const id = `s-${String(index + 1).padStart(3, '0')}`
      const elementId = step.ref ? elementIdByRef.get(step.ref) : undefined
      const element = elementId ? elements[elementId] : undefined
      const field = element?.name
      if (step.action === 'fill') {
        return {
          id,
          action: 'fill',
          ...(elementId ? { elementId } : {}),
          params: { value: step.value ?? '' },
          display: {
            verb: '填写',
            ...(field ? { field } : {}),
            ...(step.value !== undefined ? { value: step.value } : {}),
          },
        }
      }
      if (step.action === 'select') {
        return {
          id,
          action: 'select',
          ...(elementId ? { elementId } : {}),
          params: { value: step.value ?? '', mode: step.mode ?? 'native' },
          display: {
            verb: '选择',
            ...(field ? { field } : {}),
            ...(step.value !== undefined ? { value: step.value } : {}),
          },
        }
      }
      if (step.action === 'click') {
        const isEntry = Boolean(step.ref && matrix.entry?.ref === step.ref)
        return {
          id,
          action: 'click',
          ...(elementId ? { elementId } : {}),
          display: { verb: isEntry ? '打开' : '点击', ...(field ? { field } : {}) },
        }
      }
      const assertion = step.assertion
      if (!assertion) throw new Error('生成断言步骤缺少 assertion')
      const expected =
        'expected' in assertion && assertion.expected !== undefined
          ? String(assertion.expected)
          : assertion.type
      return {
        id,
        action: 'assert',
        ...(elementId ? { elementId } : {}),
        assertion,
        display: {
          verb: '断言',
          ...(field ? { field } : {}),
          value: expected,
        },
      }
    })

    const caseFile = {
      case: {
        id: `design-${Date.now().toString(36)}-${caseIndex + 1}`,
        name: blueprint.name,
        projectId: project.id,
        startUrl: blueprint.startUrl,
        variables: {},
        intent: blueprint.intent,
        steps,
      },
      elements,
    } satisfies CaseFile
    return {
      scenarioId: blueprint.scenarioId,
      dataRecordId: blueprint.dataRecordId,
      caseFile: caseFileSchema.parse(caseFile),
    }
  })

  return { cases }
}
