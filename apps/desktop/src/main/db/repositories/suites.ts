import { randomUUID } from 'node:crypto'
import type { SuiteRow } from '@atp/model'
import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { plans, suiteItems, suites } from '../schema'

function toRow(r: typeof suites.$inferSelect, caseCount: number): SuiteRow {
  return {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    description: r.description,
    caseCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function countItems(suiteId: string): number {
  return getDb().select().from(suiteItems).where(eq(suiteItems.suiteId, suiteId)).all().length
}

export const suiteRepo = {
  list(projectId: string): SuiteRow[] {
    return getDb()
      .select()
      .from(suites)
      .where(eq(suites.projectId, projectId))
      .all()
      .map((r) => toRow(r, countItems(r.id)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },

  get(id: string): { suite: SuiteRow; caseIds: string[] } | null {
    const r = getDb().select().from(suites).where(eq(suites.id, id)).get()
    if (!r) return null
    const items = getDb()
      .select()
      .from(suiteItems)
      .where(eq(suiteItems.suiteId, id))
      .all()
      .sort((a, b) => a.idx - b.idx)
    return { suite: toRow(r, items.length), caseIds: items.map((i) => i.caseId) }
  },

  create(input: {
    projectId: string
    name: string
    description?: string
    caseIds: string[]
  }): SuiteRow {
    const db = getDb()
    const now = new Date().toISOString()
    const id = `st-${randomUUID().slice(0, 8)}`
    db.transaction((tx) => {
      tx.insert(suites)
        .values({
          id,
          projectId: input.projectId,
          name: input.name,
          description: input.description ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      input.caseIds.forEach((caseId, idx) => {
        tx.insert(suiteItems)
          .values({
            id: `${id}-${idx}`,
            suiteId: id,
            caseId,
            idx,
          })
          .run()
      })
    })
    return this.get(id)?.suite as SuiteRow
  },

  update(input: {
    id: string
    name: string
    description?: string
    caseIds: string[]
  }): SuiteRow {
    const db = getDb()
    const now = new Date().toISOString()
    db.transaction((tx) => {
      tx.update(suites)
        .set({
          name: input.name,
          description: input.description ?? null,
          updatedAt: now,
        })
        .where(eq(suites.id, input.id))
        .run()
      tx.delete(suiteItems).where(eq(suiteItems.suiteId, input.id)).run()
      input.caseIds.forEach((caseId, idx) => {
        tx.insert(suiteItems)
          .values({
            id: `${input.id}-${idx}`,
            suiteId: input.id,
            caseId,
            idx,
          })
          .run()
      })
    })
    return this.get(input.id)?.suite as SuiteRow
  },

  remove(id: string): void {
    const db = getDb()
    db.transaction((tx) => {
      // 计划是成员快照，删除套件不影响计划，只清掉来源引用
      tx.update(plans).set({ suiteId: null }).where(eq(plans.suiteId, id)).run()
      tx.delete(suiteItems).where(eq(suiteItems.suiteId, id)).run()
      tx.delete(suites).where(eq(suites.id, id)).run()
    })
  },
}
