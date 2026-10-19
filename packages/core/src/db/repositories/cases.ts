import { randomUUID } from 'node:crypto'
import type { CaseFile, CaseRow } from '@atp/model'
import { caseFileSchema, elementSchema } from '@atp/model'
import type { EntityManager } from '@mikro-orm/sqlite'
import { CaseStep, Element, TestCase, type TestCaseEntity } from '../entities.js'

function toRow(row: TestCaseEntity): CaseRow {
  return {
    id: row.id,
    projectId: row.projectId,
    moduleId: row.moduleId ?? null,
    name: row.name,
    startUrl: row.startUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class CaseRepository {
  constructor(private readonly em: EntityManager) {}

  async list(projectId: string): Promise<CaseRow[]> {
    const rows = await this.em.find(TestCase, { projectId }, { orderBy: { updatedAt: 'desc' } })
    return rows.map(toRow)
  }

  async get(id: string): Promise<CaseFile | null> {
    const row = await this.em.findOne(TestCase, { id })
    if (!row) return null

    const stepRows = await this.em.find(CaseStep, { caseId: id }, { orderBy: { idx: 'asc' } })
    const elementIds = [
      ...new Set(
        stepRows.map((step) => step.elementId).filter((value): value is string => !!value),
      ),
    ]
    // 元素按 id 全局共享：同一元素可能被多个项目的用例引用，
    // 不能仅按当前项目过滤（否则跨项目复用时会丢失元素）。
    const elementRows = elementIds.length
      ? await this.em.find(Element, { id: { $in: elementIds } })
      : []

    return caseFileSchema.parse({
      case: {
        id: row.id,
        name: row.name,
        projectId: row.projectId,
        moduleId: row.moduleId ?? undefined,
        startUrl: row.startUrl,
        variables: row.variables ?? {},
        intent: row.intent ?? undefined,
        groups: row.groups ?? undefined,
        steps: stepRows.map((step) => ({
          id: step.id.startsWith(`${id}-`) ? step.id.slice(id.length + 1) : step.id,
          action: step.action,
          elementId: step.elementId ?? undefined,
          params: step.params ?? undefined,
          assertion: step.assertion ?? undefined,
          condition: step.condition ?? undefined,
          groupId: step.groupId ?? undefined,
          display: step.display ?? undefined,
        })),
      },
      elements: Object.fromEntries(
        elementRows.map((element) => [
          element.id,
          elementSchema.parse({
            id: element.id,
            name: element.name,
            locators: element.locators,
            framePath: element.framePath ?? undefined,
          }),
        ]),
      ),
    })
  }

  async create(input: {
    projectId: string
    moduleId?: string | null
    name: string
    startUrl: string
  }): Promise<CaseFile> {
    const now = new Date().toISOString()
    const row = this.em.create(TestCase, {
      id: `c-${randomUUID().slice(0, 8)}`,
      projectId: input.projectId,
      moduleId: input.moduleId ?? null,
      name: input.name,
      startUrl: input.startUrl,
      variables: {},
      intent: null,
      groups: null,
      createdAt: now,
      updatedAt: now,
    })
    await this.em.flush()
    return (await this.get(row.id)) as CaseFile
  }

  /** 全量保存：更新用例行 + 事务内重建步骤 + upsert 引用的元素（元素库集中登记） */
  async save(file: CaseFile): Promise<CaseFile> {
    const parsed = caseFileSchema.parse(file)
    await this.em.transactional(async (em) => {
      const row = await em.findOneOrFail(TestCase, { id: parsed.case.id })
      row.name = parsed.case.name
      row.moduleId = parsed.case.moduleId ?? null
      row.startUrl = parsed.case.startUrl
      row.variables = parsed.case.variables ?? {}
      row.intent = parsed.case.intent ?? null
      row.groups = parsed.case.groups ?? null
      row.updatedAt = new Date().toISOString()

      await em.nativeDelete(CaseStep, { caseId: row.id })
      for (const [idx, step] of parsed.case.steps.entries()) {
        em.create(CaseStep, {
          // 主键带用例前缀：不同用例的 s-001 互不冲突
          id: `${row.id}-${step.id}`,
          caseId: row.id,
          idx,
          action: step.action,
          elementId: step.elementId ?? null,
          params: step.params ?? null,
          assertion: step.assertion ?? null,
          condition: step.condition ?? null,
          groupId: step.groupId ?? null,
          display: step.display ?? null,
        })
      }

      for (const element of Object.values(parsed.elements)) {
        const existing = await em.findOne(Element, { id: element.id })
        if (existing) {
          existing.name = element.name
          existing.locators = element.locators
          existing.framePath = element.framePath ?? null
        } else {
          em.create(Element, {
            id: element.id,
            projectId: parsed.case.projectId,
            name: element.name,
            locators: element.locators,
            framePath: element.framePath ?? null,
          })
        }
      }

      await em.flush()
    })
    return (await this.get(parsed.case.id)) as CaseFile
  }

  async remove(id: string): Promise<void> {
    await this.em.transactional(async (em) => {
      await em.nativeDelete(CaseStep, { caseId: id })
      await em.nativeDelete(TestCase, { id })
    })
  }
}
