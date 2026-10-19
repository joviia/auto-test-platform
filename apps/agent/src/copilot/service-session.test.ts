import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '@atp/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CopilotService } from './service.js'
import type { CopilotPlatform } from './tools.js'

const platform: CopilotPlatform = {
  isRecording: () => false,
  startRecording: () => undefined,
  stopRecording: async () => {
    throw new Error('stopRecording 不应被调用')
  },
  notifyRecordingDraft: () => undefined,
  runCase: async () => {
    throw new Error('runCase 不应被调用')
  },
  proposeCase: () => undefined,
  proposePlan: () => undefined,
}

let dir: string
let previousStub: string | undefined

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atp-copilot-session-'))
  previousStub = process.env.ATP_AI_STUB
  process.env.ATP_AI_STUB = '1'
  await initDb({ dataDir: dir })
})

afterAll(async () => {
  if (previousStub === undefined) delete process.env.ATP_AI_STUB
  else process.env.ATP_AI_STUB = previousStub
  await closeDb()
  rmSync(dir, { recursive: true, force: true })
})

function createService(): { service: CopilotService; waitDone: () => Promise<void> } {
  let resolveDone: (() => void) | null = null
  const service = new CopilotService({
    dataDir: dir,
    getBrowser: () => null,
    platform,
    onEvent: (event) => {
      if (event.type === 'ai-done') resolveDone?.()
    },
  })
  return {
    service,
    waitDone: () =>
      new Promise((resolve) => {
        resolveDone = resolve
      }),
  }
}

describe('CopilotService 会话持久化', () => {
  it('重启后能读取历史并继续同一会话', async () => {
    const first = createService()
    await first.service.init()
    // ai-done 可能在 send 返回前就到达，先挂好等待器再发送
    let done = first.waitDone()
    const created = await first.service.send({ message: '帮我观察一下当前页面' })
    await done

    const list = await first.service.listSessions()
    expect(list[0]?.id).toBe(created.sessionId)
    expect(list[0]?.title).toBe('帮我观察一下当前页面')
    expect(list[0]?.messageCount).toBe(2)

    // 模拟 Agent 重启：新实例没有内存会话，必须从 SQLite 恢复
    const restarted = createService()
    await restarted.service.init()
    const restored = await restarted.service.getSession(created.sessionId)
    expect(restored.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(restored.messages[1]?.tools?.length).toBeGreaterThan(0)

    done = restarted.waitDone()
    await restarted.service.send({ message: '继续', sessionId: created.sessionId })
    await done
    const continued = await restarted.service.getSession(created.sessionId)
    expect(continued.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
  })
})
