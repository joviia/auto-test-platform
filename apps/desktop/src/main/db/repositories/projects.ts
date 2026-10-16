import { randomUUID } from 'node:crypto'
import type { ProjectRow } from '@atp/model'
import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { projects } from '../schema'

export const projectRepo = {
  list(): ProjectRow[] {
    return getDb()
      .select()
      .from(projects)
      .all()
      .map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt }))
  },

  create(name: string): ProjectRow {
    const row: ProjectRow = {
      id: `p-${randomUUID().slice(0, 8)}`,
      name,
      createdAt: new Date().toISOString(),
    }
    getDb().insert(projects).values({ id: row.id, name: row.name, createdAt: row.createdAt }).run()
    return row
  },

  remove(id: string): void {
    getDb().delete(projects).where(eq(projects.id, id)).run()
  },
}
