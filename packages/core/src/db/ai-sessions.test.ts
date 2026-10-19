import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AtpDatabase } from './database.js'

const dirs: string[] = []
const databases: AtpDatabase[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'atp-ai-test-'))
  dirs.push(dir)
  return dir
}

async function open(): Promise<AtpDatabase> {
  const db = await AtpDatabase.open({ dataDir: tempDir() })
  databases.push(db)
  return db
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close().catch(() => {})))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('AiSessionRepository', () => {
  it('会话与消息可持久化、按顺序恢复并统计消息数', async () => {
    const db = await open()
    const session = await db.uow().aiSessions.create('帮我生成一条用例')
    expect(session.messageCount).toBe(0)

    await db.uow().aiSessions.append(session.id, 'user', { text: '帮我生成一条用例' })
    const assistant = await db.uow().aiSessions.append(session.id, 'assistant', {
      text: '已生成计划，请确认。',
      reasoning: '先观察页面',
      tools: [
        {
          id: 'tc-1',
          name: 'browser_snapshot',
          label: '观察页面',
          input: {},
          status: 'ok',
          durationMs: 32,
          output: { url: 'https://example.test', title: '示例', elements: 3 },
        },
      ],
    })
    expect(assistant.role).toBe('assistant')
    expect(assistant.tools?.[0]?.label).toBe('观察页面')

    const messages = await db.uow().aiSessions.messages(session.id)
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(messages[1]?.reasoning).toBe('先观察页面')
    expect(messages[1]?.tools?.[0]?.status).toBe('ok')

    const listed = await db.uow().aiSessions.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.title).toBe('帮我生成一条用例')
    expect(listed[0]?.messageCount).toBe(2)

    await db.uow().aiSessions.remove(session.id)
    expect(await db.uow().aiSessions.list()).toHaveLength(0)
    expect(await db.uow().aiSessions.messages(session.id)).toHaveLength(0)
  })

  it('第二个迁移能在已存在的库上补出 AI 表', async () => {
    const dir = tempDir()
    const first = await AtpDatabase.open({ dataDir: dir })
    await first.uow().projects.create('默认项目')
    await first.close()

    const reopened = await AtpDatabase.open({ dataDir: dir })
    databases.push(reopened)
    const session = await reopened.uow().aiSessions.create('重启后仍在')
    expect((await reopened.uow().aiSessions.list())[0]?.id).toBe(session.id)
  })
})
