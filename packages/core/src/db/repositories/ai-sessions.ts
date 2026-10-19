import { randomUUID } from 'node:crypto'
import type { AiSessionMessage, AiSessionRow, AiStoredTool } from '@atp/model'
import type { EntityManager } from '@mikro-orm/sqlite'
import { AiMessage, AiSession, type AiSessionEntity } from '../entities.js'

type MessagePayload = {
  text?: string
  reasoning?: string
  tools?: AiStoredTool[]
  cancelled?: boolean
  error?: string
}

function toSessionRow(row: AiSessionEntity, messageCount: number): AiSessionRow {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messageCount,
  }
}

/** Copilot 会话与消息。消息只追加，不改写；会话按 updatedAt 倒序。 */
export class AiSessionRepository {
  constructor(private readonly em: EntityManager) {}

  async create(title: string): Promise<AiSessionRow> {
    const now = new Date().toISOString()
    const row = this.em.create(AiSession, {
      id: `s-${randomUUID().slice(0, 8)}`,
      title,
      createdAt: now,
      updatedAt: now,
    })
    await this.em.flush()
    return toSessionRow(row, 0)
  }

  async get(id: string): Promise<AiSessionRow | null> {
    const row = await this.em.findOne(AiSession, { id })
    if (!row) return null
    return toSessionRow(row, await this.em.count(AiMessage, { sessionId: id }))
  }

  async list(limit = 30): Promise<AiSessionRow[]> {
    const rows = await this.em.find(
      AiSession,
      {},
      { orderBy: { updatedAt: 'desc' }, limit: Math.max(1, limit) },
    )
    return Promise.all(
      rows.map(async (row) =>
        toSessionRow(row, await this.em.count(AiMessage, { sessionId: row.id })),
      ),
    )
  }

  async append(
    sessionId: string,
    role: 'user' | 'assistant',
    payload: MessagePayload,
  ): Promise<AiSessionMessage> {
    const session = await this.em.findOne(AiSession, { id: sessionId })
    if (!session) throw new Error(`会话不存在：${sessionId}`)
    const last = await this.em.findOne(AiMessage, { sessionId }, { orderBy: { seq: 'desc' } })
    const now = new Date().toISOString()
    const row = this.em.create(AiMessage, {
      id: `m-${randomUUID().slice(0, 8)}`,
      sessionId,
      seq: (last?.seq ?? 0) + 1,
      role,
      payload,
      createdAt: now,
    })
    session.updatedAt = now
    await this.em.flush()
    return {
      id: row.id,
      role,
      text: typeof payload.text === 'string' ? payload.text : '',
      ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
      ...(payload.tools ? { tools: payload.tools } : {}),
      ...(payload.cancelled ? { cancelled: true } : {}),
      ...(payload.error ? { error: payload.error } : {}),
      createdAt: row.createdAt,
    }
  }

  async messages(sessionId: string): Promise<AiSessionMessage[]> {
    const rows = await this.em.find(AiMessage, { sessionId }, { orderBy: { seq: 'asc' } })
    return rows.map((row) => {
      const payload = (row.payload ?? {}) as MessagePayload
      return {
        id: row.id,
        role: row.role === 'assistant' ? 'assistant' : 'user',
        text: typeof payload.text === 'string' ? payload.text : '',
        ...(payload.reasoning ? { reasoning: payload.reasoning } : {}),
        ...(payload.tools ? { tools: payload.tools } : {}),
        ...(payload.cancelled ? { cancelled: true } : {}),
        ...(payload.error ? { error: payload.error } : {}),
        createdAt: row.createdAt,
      }
    })
  }

  async remove(id: string): Promise<void> {
    await this.em.transactional(async (em) => {
      await em.nativeDelete(AiMessage, { sessionId: id })
      await em.nativeDelete(AiSession, { id })
    })
  }
}
