import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '@atp/core'
import type { AiPlanProposal } from '@atp/model'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ChromeController, RefDescription } from '../browser.js'
import { AI_TOOL_MAP, type AiPlatform, type AiToolContext } from './tools.js'

const described: Record<string, RefDescription> = {
  'r-name': {
    role: 'textbox',
    name: '内容名称',
    tag: 'input',
    testId: 'content-name',
    css: '#content-name',
    xpath: '/html[1]/body[1]/input[1]',
  },
  'r-type': {
    role: 'combobox',
    name: '节目类型',
    tag: 'input',
    css: '#content-type',
    xpath: '/html[1]/body[1]/input[2]',
  },
  'r-save': {
    role: 'button',
    name: '保存',
    tag: 'button',
    text: '保存',
    css: '#save',
    xpath: '/html[1]/body[1]/button[1]',
  },
}

function context(proposals: AiPlanProposal[]): AiToolContext {
  const browser = {
    currentUrl: 'https://example.test/demo',
    describeRef: async (ref: string) => described[ref] ?? null,
  } as unknown as ChromeController
  const platform: AiPlatform = {
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
    proposePlan: (proposal) => proposals.push(proposal),
  }
  return {
    sessionId: 's-test',
    callId: 'c-test',
    dataDir: '/tmp/atp-plan-test',
    browser: () => browser,
    platform,
    signal: new AbortController().signal,
  }
}

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atp-plan-test-'))
  await initDb({ dataDir: dir })
  await getDb().uow().projects.create('默认项目')
})

afterAll(async () => {
  await closeDb()
  rmSync(dir, { recursive: true, force: true })
})

describe('case_plan', () => {
  const tool = AI_TOOL_MAP.get('case_plan')

  it('把 ref 解析成持久元素，并生成可执行步骤', async () => {
    expect(tool).toBeDefined()
    const proposals: AiPlanProposal[] = []
    const outcome = await tool?.run(
      {
        name: '新建内容',
        summary: '填写名称、选择类型、保存并断言提示',
        steps: [
          { action: 'fill', ref: 'r-name', value: '电影_1' },
          { action: 'select', ref: 'r-type', value: '电影' },
          { action: 'click', ref: 'r-save' },
          {
            action: 'assert',
            assertion: { type: 'pageText', match: 'contains', expected: '保存成功' },
          },
        ],
      },
      context(proposals),
    )

    expect(proposals).toHaveLength(1)
    const proposal = proposals[0]
    expect(proposal?.caseFile.case.steps).toHaveLength(4)
    expect(proposal?.caseFile.case.startUrl).toBe('https://example.test/demo')
    expect(proposal?.caseFile.case.intent).toBe('填写名称、选择类型、保存并断言提示')
    expect(Object.keys(proposal?.caseFile.elements ?? {})).toHaveLength(3)

    const nameElement = Object.values(proposal?.caseFile.elements ?? {}).find(
      (element) => element.name === '内容名称',
    )
    expect(nameElement?.locators.map((locator) => locator.type)).toEqual([
      'testId',
      'role',
      'css',
      'xpath',
    ])

    const selectStep = proposal?.caseFile.case.steps[1]
    expect(selectStep?.action).toBe('select')
    expect(selectStep?.params).toMatchObject({ value: '电影', mode: 'custom' })

    const assertStep = proposal?.caseFile.case.steps[3]
    expect(assertStep?.action).toBe('assert')
    expect(assertStep?.elementId).toBeUndefined()
    expect(assertStep?.assertion).toMatchObject({ type: 'pageText', expected: '保存成功' })

    expect(outcome?.result).toMatchObject({ ok: true, stepCount: 4, elementCount: 3 })
  })

  it('ref 失效时给出可行动的错误', async () => {
    const proposals: AiPlanProposal[] = []
    await expect(
      tool?.run(
        {
          name: '失效计划',
          summary: '引用旧 ref',
          steps: [{ action: 'click', ref: 'r-stale' }],
        },
        context(proposals),
      ),
    ).rejects.toThrow('已失效')
    expect(proposals).toHaveLength(0)
  })

  it('缺少 ref 或值时报错，不生成计划', async () => {
    const proposals: AiPlanProposal[] = []
    await expect(
      tool?.run(
        {
          name: '缺少 ref',
          summary: '点击但没有目标',
          steps: [{ action: 'click' }],
        },
        context(proposals),
      ),
    ).rejects.toThrow('缺少 ref')

    await expect(
      tool?.run(
        {
          name: '缺少值',
          summary: '填写但没有值',
          steps: [{ action: 'fill', ref: 'r-name' }],
        },
        context(proposals),
      ),
    ).rejects.toThrow('缺少 value')
    expect(proposals).toHaveLength(0)
  })
})
