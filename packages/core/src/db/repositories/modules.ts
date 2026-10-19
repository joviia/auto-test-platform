import { randomUUID } from 'node:crypto'
import type { ModuleRow } from '@atp/model'
import type { EntityManager } from '@mikro-orm/sqlite'
import { Module, type ModuleEntity } from '../entities.js'

function toRow(row: ModuleEntity): ModuleRow {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId ?? null,
    name: row.name,
    createdAt: row.createdAt,
  }
}

export class ModuleRepository {
  constructor(private readonly em: EntityManager) {}

  async list(projectId: string): Promise<ModuleRow[]> {
    const rows = await this.em.find(Module, { projectId }, { orderBy: { createdAt: 'asc' } })
    return rows.map(toRow)
  }

  async create(
    projectId: string,
    parentId: string | null | undefined,
    name: string,
  ): Promise<ModuleRow> {
    const row = this.em.create(Module, {
      id: `m-${randomUUID().slice(0, 8)}`,
      projectId,
      parentId: parentId ?? null,
      name,
      createdAt: new Date().toISOString(),
    })
    await this.em.flush()
    return toRow(row)
  }

  async rename(id: string, name: string): Promise<ModuleRow | null> {
    const row = await this.em.findOne(Module, { id })
    if (!row) return null
    row.name = name
    await this.em.flush()
    return toRow(row)
  }

  async remove(id: string): Promise<void> {
    await this.em.nativeDelete(Module, { id })
  }

  async find(id: string): Promise<ModuleRow | null> {
    const row = await this.em.findOne(Module, { id })
    return row ? toRow(row) : null
  }
}
