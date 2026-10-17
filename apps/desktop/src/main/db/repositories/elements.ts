import type { ElementRow } from '@atp/model'
import { elementSchema } from '@atp/model'
import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { caseSteps, cases, elements } from '../schema'

export const elementRepo = {
  list(projectId: string): ElementRow[] {
    const owned = getDb().select().from(elements).where(eq(elements.projectId, projectId)).all()
    // 被本项目用例引用的元素（可能最初由其他项目登记）也要出现在元素库里
    const referenced = new Set(
      getDb()
        .select({ elementId: caseSteps.elementId })
        .from(caseSteps)
        .innerJoin(cases, eq(caseSteps.caseId, cases.id))
        .where(eq(cases.projectId, projectId))
        .all()
        .map((r) => r.elementId)
        .filter((id): id is string => Boolean(id)),
    )
    const byId = new Map(owned.map((e) => [e.id, e]))
    if (referenced.size > 0) {
      for (const e of getDb()
        .select()
        .from(elements)
        .all()
        .filter((row) => referenced.has(row.id))) {
        if (!byId.has(e.id)) byId.set(e.id, e)
      }
    }
    return [...byId.values()].map((e) => ({
      id: e.id,
      projectId: e.projectId,
      name: e.name,
      locators: JSON.parse(e.locators),
      framePath: e.framePath ? JSON.parse(e.framePath) : undefined,
    }))
  },

  /** 元素库 upsert：修改候选定位器即修复所有引用该元素的用例 */
  upsert(row: ElementRow): ElementRow {
    const parsed = elementSchema.parse(row)
    const locators = JSON.stringify(parsed.locators)
    const framePath = parsed.framePath ? JSON.stringify(parsed.framePath) : null
    const exists = getDb().select().from(elements).where(eq(elements.id, parsed.id)).get()
    if (exists) {
      getDb()
        .update(elements)
        .set({ name: parsed.name, locators, framePath })
        .where(eq(elements.id, parsed.id))
        .run()
    } else {
      getDb()
        .insert(elements)
        .values({
          id: parsed.id,
          projectId: row.projectId,
          name: parsed.name,
          locators,
          framePath,
        })
        .run()
    }
    return parsed as ElementRow
  },

  remove(id: string): void {
    getDb().delete(elements).where(eq(elements.id, id)).run()
  },
}
