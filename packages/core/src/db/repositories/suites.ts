import { randomUUID } from 'node:crypto'
import type { SuiteRow } from '@atp/model'
import type { EntityManager } from '@mikro-orm/sqlite'
import { Plan, Suite, type SuiteEntity, SuiteItem } from '../entities.js'

function toRow(row: SuiteEntity, caseCount: number): SuiteRow {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description ?? null,
    caseCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class SuiteRepository {
  constructor(private readonly em: EntityManager) {}

  async list(projectId: string): Promise<SuiteRow[]> {
    const rows = await this.em.find(Suite, { projectId }, { orderBy: { updatedAt: 'desc' } })
    return Promise.all(
      rows.map(async (row) => toRow(row, await this.em.count(SuiteItem, { suiteId: row.id }))),
    )
  }

  async get(id: string): Promise<{ suite: SuiteRow; caseIds: string[] } | null> {
    const row = await this.em.findOne(Suite, { id })
    if (!row) return null
    const items = await this.em.find(SuiteItem, { suiteId: id }, { orderBy: { idx: 'asc' } })
    return { suite: toRow(row, items.length), caseIds: items.map((item) => item.caseId) }
  }

  async create(input: {
    projectId: string
    name: string
    description?: string
    caseIds: string[]
  }): Promise<SuiteRow> {
    const id = `st-${randomUUID().slice(0, 8)}`
    const now = new Date().toISOString()
    await this.em.transactional(async (em) => {
      em.create(Suite, {
        id,
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        createdAt: now,
        updatedAt: now,
      })
      input.caseIds.forEach((caseId, index) => {
        em.create(SuiteItem, { id: `${id}-${index}`, suiteId: id, caseId, idx: index })
      })
      await em.flush()
    })
    return (await this.get(id))?.suite as SuiteRow
  }

  async update(input: {
    id: string
    name: string
    description?: string
    caseIds: string[]
  }): Promise<SuiteRow> {
    await this.em.transactional(async (em) => {
      const row = await em.findOneOrFail(Suite, { id: input.id })
      row.name = input.name
      row.description = input.description ?? null
      row.updatedAt = new Date().toISOString()
      await em.nativeDelete(SuiteItem, { suiteId: input.id })
      input.caseIds.forEach((caseId, index) => {
        em.create(SuiteItem, {
          id: `${input.id}-${index}`,
          suiteId: input.id,
          caseId,
          idx: index,
        })
      })
      await em.flush()
    })
    return (await this.get(input.id))?.suite as SuiteRow
  }

  async remove(id: string): Promise<void> {
    await this.em.transactional(async (em) => {
      // 计划是成员快照，删除套件不影响计划，只清掉来源引用
      await em.nativeUpdate(Plan, { suiteId: id }, { suiteId: null })
      await em.nativeDelete(SuiteItem, { suiteId: id })
      await em.nativeDelete(Suite, { id })
    })
  }
}
