import type { ElementRow } from '@atp/model'
import { elementSchema } from '@atp/model'
import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { elements } from '../schema'

export const elementRepo = {
  list(projectId: string): ElementRow[] {
    return getDb()
      .select()
      .from(elements)
      .where(eq(elements.projectId, projectId))
      .all()
      .map((e) => ({
        id: e.id,
        projectId: e.projectId,
        name: e.name,
        locators: JSON.parse(e.locators),
      }))
  },

  /** 元素库 upsert：修改候选定位器即修复所有引用该元素的用例 */
  upsert(row: ElementRow): ElementRow {
    const parsed = elementSchema.parse(row)
    const locators = JSON.stringify(parsed.locators)
    const exists = getDb().select().from(elements).where(eq(elements.id, parsed.id)).get()
    if (exists) {
      getDb()
        .update(elements)
        .set({ name: parsed.name, locators })
        .where(eq(elements.id, parsed.id))
        .run()
    } else {
      getDb()
        .insert(elements)
        .values({ id: parsed.id, projectId: row.projectId, name: parsed.name, locators })
        .run()
    }
    return parsed as ElementRow
  },

  remove(id: string): void {
    getDb().delete(elements).where(eq(elements.id, id)).run()
  },
}
