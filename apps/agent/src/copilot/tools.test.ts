import { describe, expect, it } from 'vitest'
import type { RecordedDraft } from '../browser.js'
import {
  COPILOT_TOOL_MAP,
  type CopilotCaseRun,
  type CopilotPlatform,
  type CopilotToolContext,
} from './tools.js'

function context(platform: Partial<CopilotPlatform>): CopilotToolContext {
  return {
    sessionId: 's-test',
    callId: 'c-test',
    dataDir: '/tmp/atp-tool-test',
    browser: () => null,
    platform: {
      isRecording: () => false,
      startRecording: () => undefined,
      stopRecording: async () => {
        throw new Error('stopRecording 不应被调用')
      },
      notifyRecordingDraft: () => undefined,
      runCase: async () => {
        throw new Error('runCase 不应被调用')
      },
      ...platform,
    },
    signal: new AbortController().signal,
  }
}

const passedRun: CopilotCaseRun = {
  runId: 'r-test',
  status: 'passed',
  durationMs: 1200,
  steps: [
    { index: 0, action: 'fill', status: 'passed', durationMs: 12 },
    { index: 1, action: 'drag', status: 'passed', durationMs: 430 },
  ],
}

describe('case_run', () => {
  it('执行用例并回传逐步结果', async () => {
    const tool = COPILOT_TOOL_MAP.get('case_run')
    expect(tool).toBeDefined()
    const outcome = await tool?.run(
      { caseId: 'c-test' },
      context({ runCase: async () => passedRun }),
    )
    expect(outcome?.label).toContain('通过')
    expect(outcome?.result).toMatchObject({
      ok: true,
      runId: 'r-test',
      status: 'passed',
      steps: [
        { index: 0, action: 'fill', status: 'passed' },
        { index: 1, action: 'drag', status: 'passed' },
      ],
    })
  })

  it('失败时返回 ok=false 与错误', async () => {
    const tool = COPILOT_TOOL_MAP.get('case_run')
    const outcome = await tool?.run(
      { caseId: 'c-test' },
      context({
        runCase: async () => ({
          runId: 'r-fail',
          status: 'failed',
          error: '拖拽失败',
          steps: [{ index: 0, action: 'drag', status: 'failed', durationMs: 500 }],
        }),
      }),
    )
    expect(outcome?.label).toContain('失败')
    expect(outcome?.result).toMatchObject({ ok: false, status: 'failed', error: '拖拽失败' })
  })
})

describe('recording tools', () => {
  it('recording_start 调用平台开始录制', async () => {
    let started = false
    const tool = COPILOT_TOOL_MAP.get('recording_start')
    const outcome = await tool?.run(
      {},
      context({
        isRecording: () => false,
        startRecording: () => {
          started = true
        },
      }),
    )
    expect(started).toBe(true)
    expect(outcome?.label).toBe('开始录制')
  })

  it('recording_stop 把草稿交给界面', async () => {
    const draft: RecordedDraft = {
      steps: [],
      elements: {},
      startUrl: 'http://example.com',
      intent: '',
      groups: [],
      rawEvents: 0,
      diagnostics: { rawEvents: 0, frames: [] },
    }
    let notified: RecordedDraft | null = null
    const tool = COPILOT_TOOL_MAP.get('recording_stop')
    const outcome = await tool?.run(
      {},
      context({
        isRecording: () => true,
        stopRecording: async () => draft,
        notifyRecordingDraft: (value) => {
          notified = value
        },
      }),
    )
    expect(notified).toBe(draft)
    expect(outcome?.result).toMatchObject({ ok: true, steps: 0, startUrl: 'http://example.com' })
  })

  it('没有在录制时拒绝停止', async () => {
    const tool = COPILOT_TOOL_MAP.get('recording_stop')
    await expect(tool?.run({}, context({ isRecording: () => false }))).rejects.toThrow('没有在录制')
  })
})
