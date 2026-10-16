import { randomUUID } from 'node:crypto'
import type { ModuleRow } from '@atp/model'
import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { modules } from '../schema'

export const moduleRepo = {
  list(projectId: string): ModuleRow[] {
    return getDb()
      .select()
      .from(modules)
      .where(eq(modules.projectId, projectId))
      .all()
      .map((r) => ({
        id: r.id,
        projectId: r.projectId,
        parentId: r.parentId,
        name: r.name,
        createdAt: r.createdAt,
      }))
  },

  create(projectId: string, parentId: string | null | undefined, name: string): ModuleRow {
    const row: ModuleRow = {
      id: `m-${randomUUID().slice(0, 8)}`,
      projectId,
      parentId: parentId ?? null,
      name,
      createdAt: new Date().toISOString(),
    }
    getDb()
      .insert(modules)
      .values({
        id: row.id,
        projectId: row.projectId,
        parentId: row.parentId,
        name: row.name,
        createdAt: row.createdAt,
      })
      .run()
    return row
  },

  rename(id: string, name: string): ModuleRow | null {
    getDb().update(modules).set({ name }).where(eq(modules.id, id)).run()
    return this.find(id)
  },

  remove(id: string): void {
    getDb().delete(modules).where(eq(modules.id, id)).run()
  },

  find(id: string): ModuleRow | null {
    const r = getDb().select().from(modules).where(eq(modules.id, id)).get()
    return r
      ? {
          id: r.id,
          projectId: r.projectId,
          parentId: r.parentId,
          name: r.name,
          createdAt: r.createdAt,
        }
      : null
  },
}
