import { randomUUID } from 'node:crypto'
import { type DesignMatrix, designMatrixSchema } from '@atp/model'
import type { EntityManager } from '@mikro-orm/sqlite'
import { DesignSession } from '../entities.js'

/** 设计会话持久化：矩阵 JSON 快照 + 会话元信息 */
export class DesignSessionRepository {
  constructor(private readonly em: EntityManager) {}

  async save(input: {
    projectId?: string | null
    matrix: DesignMatrix
    status?: string
    /** 前端/AI 读取时的版本；存在时做乐观并发校验 */
    baseRevision?: number
  }): Promise<DesignMatrix> {
    const parsed = designMatrixSchema.parse(input.matrix)
    const now = new Date().toISOString()
    const id = parsed.sessionId ?? parsed.id ?? `ds-${randomUUID().slice(0, 8)}`
    const existing = await this.em.findOne(DesignSession, { id })
    let currentRevision = 0
    if (existing) {
      const current = designMatrixSchema.safeParse(existing.matrix)
      currentRevision = current.success ? current.data.revision : 0
      if (input.baseRevision !== undefined && input.baseRevision !== currentRevision) {
        throw new Error('设计会话已更新，请刷新后重试')
      }
      const next = { ...parsed, revision: currentRevision + 1 }
      existing.matrix = next
      existing.status = input.status ?? existing.status
      existing.updatedAt = now
      existing.projectId = input.projectId ?? existing.projectId
      await this.em.flush()
      return { ...next, sessionId: id }
    }
    const next = { ...parsed, revision: 1 }
    this.em.create(DesignSession, {
      id,
      projectId: input.projectId ?? null,
      objectId: parsed.id ?? id,
      status: input.status ?? 'draft',
      matrix: next,
      createdAt: now,
      updatedAt: now,
    })
    await this.em.flush()
    return { ...next, sessionId: id }
  }

  async latest(projectId?: string): Promise<DesignMatrix | null> {
    const where = projectId ? { projectId } : {}
    const rows = await this.em.find(DesignSession, where, {
      orderBy: { updatedAt: 'desc' },
      limit: 1,
    })
    const row = rows[0]
    if (!row) return null
    const parsed = designMatrixSchema.safeParse(row.matrix)
    if (!parsed.success || parsed.data.schemaVersion !== 2) return null
    return { ...parsed.data, sessionId: row.id }
  }

  async get(id: string): Promise<DesignMatrix | null> {
    const row = await this.em.findOne(DesignSession, { id })
    if (!row) return null
    const parsed = designMatrixSchema.safeParse(row.matrix)
    if (!parsed.success || parsed.data.schemaVersion !== 2) return null
    return { ...parsed.data, sessionId: row.id }
  }
}
