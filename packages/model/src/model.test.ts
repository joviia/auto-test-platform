import { describe, expect, it } from 'vitest'
import { caseFileSchema, runResultSchema, stepSchema } from './index'

const docExample = {
  case: {
    id: 'c-001',
    name: '登录成功',
    projectId: 'p-001',
    startUrl: 'file:///fixtures/login-form/index.html',
    steps: [
      {
        id: 's-001',
        action: 'fill',
        elementId: 'el-001',
        params: { value: '{{username}}' },
      },
      { id: 's-002', action: 'click', elementId: 'el-003' },
      {
        id: 's-003',
        action: 'assert',
        elementId: 'el-004',
        assertion: { type: 'text', expected: '登录成功' },
      },
    ],
  },
  elements: {
    'el-003': {
      id: 'el-003',
      name: '登录按钮',
      locators: [
        { type: 'testId', value: 'login-submit' },
        { type: 'role', value: 'button', name: '登录' },
        { type: 'css', value: '#login-form button[type=submit]' },
      ],
    },
  },
}

describe('caseFileSchema（方案 §4.3 示例）', () => {
  it('示例 JSON 可解析', () => {
    const parsed = caseFileSchema.parse(docExample)
    expect(parsed.case.name).toBe('登录成功')
    expect(parsed.case.steps).toHaveLength(3)
  })

  it('非法定位器类型被拒绝', () => {
    const bad = structuredClone(docExample)
    bad.elements['el-003'].locators[0] = { type: 'xpath', value: '//button' } as never
    expect(caseFileSchema.safeParse(bad).success).toBe(false)
  })

  it('assert 步骤缺 assertion 被拒绝', () => {
    const bad = structuredClone(docExample)
    bad.case.steps[2].assertion = undefined
    expect(stepSchema.safeParse(bad.case.steps[2]).success).toBe(false)
  })

  it('click 步骤缺 elementId 被拒绝', () => {
    expect(stepSchema.safeParse({ id: 's-x', action: 'click' }).success).toBe(false)
  })
})

describe('runResultSchema', () => {
  it('执行记录可解析，含命中候选与断言对比', () => {
    const run = {
      runId: 'r-001',
      caseId: 'c-001',
      caseName: '登录成功',
      startUrl: 'file:///fixtures/login-form/index.html',
      startedAt: '2026-10-16T12:00:00.000Z',
      finishedAt: '2026-10-16T12:00:05.000Z',
      status: 'failed',
      videoPath: '/runs/r-001/video.webm',
      steps: [
        {
          stepId: 's-002',
          index: 1,
          action: 'click',
          status: 'failed',
          durationMs: 812,
          error: '所有候选定位器均未命中',
          locatorHit: undefined,
          triedCandidates: [
            { locator: { type: 'testId', value: 'login-submit' }, ok: false, error: 'not found' },
            { locator: { type: 'css', value: '#login-form button[type=submit]' }, ok: false },
          ],
          screenshotPath: '/runs/r-001/step-1.png',
        },
      ],
    }
    const parsed = runResultSchema.parse(run)
    expect(parsed.steps[0].triedCandidates).toHaveLength(2)
    expect(parsed.status).toBe('failed')
  })
})
