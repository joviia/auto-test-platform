import type { CaseFile } from '@atp/model'
import { describe, expect, it } from 'vitest'
import { applyCaseProposal, buildCaseProposal, type CaseProposalOp, diffCase } from './proposals.js'

function baseCase(): CaseFile {
  return {
    case: {
      id: 'c-1',
      name: '登陆',
      projectId: 'p-1',
      startUrl: 'http://localhost:8080/',
      variables: {},
      steps: [
        {
          id: 's-1',
          action: 'fill',
          elementId: 'e-user',
          params: { value: 'admin' },
          display: { verb: '填写', field: '用户名' },
        },
        {
          id: 's-2',
          action: 'fill',
          elementId: 'e-password',
          params: { value: '123456' },
          display: { verb: '填写', field: '密码' },
        },
        {
          id: 's-3',
          action: 'click',
          elementId: 'e-submit',
          display: { verb: '点击', field: '登录' },
        },
        {
          id: 's-4',
          action: 'fill',
          elementId: 'e-password',
          params: { value: '123456' },
          display: { verb: '填写', field: '密码' },
        },
      ],
    },
    elements: {
      'e-user': {
        id: 'e-user',
        name: '用户名',
        locators: [{ type: 'css', value: '#user' }],
      },
      'e-password': {
        id: 'e-password',
        name: '密码',
        locators: [{ type: 'css', value: '#password' }],
      },
      'e-submit': {
        id: 'e-submit',
        name: '登录按钮',
        locators: [{ type: 'role', value: 'button', name: '登录' }],
      },
    },
  }
}

function apply(ops: CaseProposalOp[]): CaseFile {
  return applyCaseProposal(baseCase(), ops)
}

describe('applyCaseProposal', () => {
  it('删除冗余步骤并保留用例元信息', () => {
    const next = apply([{ op: 'remove_step', stepId: 's-4' }])
    expect(next.case.steps.map((step) => step.id)).toEqual(['s-1', 's-2', 's-3'])
    expect(next.case.name).toBe('登陆')
    expect(next.case.startUrl).toBe('http://localhost:8080/')
    expect(next.elements['e-user']?.name).toBe('用户名')
  })

  it('修改步骤参数时保留未改字段', () => {
    const next = apply([
      {
        op: 'update_step',
        step: {
          id: 's-1',
          action: 'fill',
          elementId: 'e-user',
          params: { value: 'root' },
          display: { verb: '填写', field: '用户名' },
        },
      },
    ])
    expect(next.case.steps[0]).toMatchObject({
      id: 's-1',
      elementId: 'e-user',
      params: { value: 'root' },
      display: { verb: '填写', field: '用户名' },
    })
  })

  it('新增步骤插入到指定步骤之后', () => {
    const next = apply([
      {
        op: 'add_step',
        afterStepId: 's-2',
        step: {
          id: 's-new',
          action: 'press',
          params: { key: 'Enter' },
          display: { verb: '按键', field: '回车' },
        },
      },
    ])
    expect(next.case.steps.map((step) => step.id)).toEqual(['s-1', 's-2', 's-new', 's-3', 's-4'])
  })

  it('移动步骤并标记顺序变化', () => {
    const next = apply([{ op: 'move_step', stepId: 's-3', afterStepId: 's-4' }])
    expect(next.case.steps.map((step) => step.id)).toEqual(['s-1', 's-2', 's-4', 's-3'])
    expect(diffCase(baseCase(), next).reordered).toBe(true)
  })

  it('更新用例名称与意图', () => {
    const next = apply([
      { op: 'update_case', name: '登录（管理员）', intent: '管理员登录后进入工作台' },
    ])
    expect(next.case.name).toBe('登录（管理员）')
    expect(next.case.intent).toBe('管理员登录后进入工作台')
  })

  it('新增元素后步骤可以引用它', () => {
    const next = apply([
      {
        op: 'upsert_element',
        element: {
          id: 'e-code',
          name: '验证码',
          locators: [{ type: 'css', value: '#code' }],
        },
      },
      {
        op: 'add_step',
        step: {
          id: 's-code',
          action: 'fill',
          elementId: 'e-code',
          params: { value: '8888' },
        },
      },
    ])
    expect(next.elements['e-code']?.name).toBe('验证码')
    expect(next.case.steps.at(-1)?.elementId).toBe('e-code')
  })

  it('拒绝删除仍被步骤引用的元素', () => {
    expect(() => apply([{ op: 'remove_element', elementId: 'e-user' }])).toThrow('仍被步骤')
  })

  it('拒绝引用不存在元素的步骤', () => {
    expect(() =>
      apply([
        {
          op: 'add_step',
          step: { id: 's-x', action: 'click', elementId: 'e-missing' },
        },
      ]),
    ).toThrow('不存在的元素')
  })

  it('拒绝重复步骤 id 与不存在的步骤', () => {
    expect(() =>
      apply([
        {
          op: 'add_step',
          step: { id: 's-1', action: 'click', elementId: 'e-submit' },
        },
      ]),
    ).toThrow('已存在')
    expect(() => apply([{ op: 'remove_step', stepId: 's-404' }])).toThrow('不存在')
  })

  it('不允许清空所有步骤', () => {
    expect(() =>
      apply([
        { op: 'remove_step', stepId: 's-1' },
        { op: 'remove_step', stepId: 's-2' },
        { op: 'remove_step', stepId: 's-3' },
        { op: 'remove_step', stepId: 's-4' },
      ]),
    ).toThrow('至少需要保留一个步骤')
  })
})

describe('diffCase', () => {
  it('统计新增、删除、修改与步数变化', () => {
    const next = apply([
      { op: 'remove_step', stepId: 's-4' },
      {
        op: 'update_step',
        step: {
          id: 's-1',
          action: 'fill',
          elementId: 'e-user',
          params: { value: 'root' },
        },
      },
    ])
    expect(diffCase(baseCase(), next)).toMatchObject({
      removed: 1,
      added: 0,
      changed: 1,
      totalBefore: 4,
      totalAfter: 3,
      metaChanged: false,
    })
  })
})

describe('buildCaseProposal', () => {
  it('生成包含前后快照与基准时间的提案', () => {
    const { proposal, diff } = buildCaseProposal(
      baseCase(),
      { summary: '删除重复的密码输入', operations: [{ op: 'remove_step', stepId: 's-4' }] },
      {
        proposalId: 'p-1',
        baseUpdatedAt: '2026-10-19T00:00:00.000Z',
        createdAt: '2026-10-19T00:01:00.000Z',
      },
    )
    expect(proposal).toMatchObject({
      proposalId: 'p-1',
      caseId: 'c-1',
      caseName: '登陆',
      summary: '删除重复的密码输入',
      baseUpdatedAt: '2026-10-19T00:00:00.000Z',
      createdAt: '2026-10-19T00:01:00.000Z',
    })
    expect(proposal.before.case.steps).toHaveLength(4)
    expect(proposal.after.case.steps).toHaveLength(3)
    expect(diff.removed).toBe(1)
  })

  it('没有变化时拒绝生成空提案', () => {
    expect(() =>
      buildCaseProposal(
        baseCase(),
        {
          summary: '什么都没改',
          operations: [
            {
              op: 'update_step',
              step: {
                id: 's-3',
                action: 'click',
                elementId: 'e-submit',
                display: { verb: '点击', field: '登录' },
              },
            },
          ],
        },
        {
          proposalId: 'p-2',
          baseUpdatedAt: '2026-10-19T00:00:00.000Z',
          createdAt: '2026-10-19T00:01:00.000Z',
        },
      ),
    ).toThrow('没有产生任何变化')
  })
})
