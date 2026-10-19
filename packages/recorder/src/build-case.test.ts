import { describe, expect, it } from 'vitest'
import { buildRecordedCase } from './build-case.js'
import type { RawActionEvent } from './collector.js'

function ev(partial: Partial<RawActionEvent> & { kind: RawActionEvent['kind'] }): RawActionEvent {
  return {
    url: 'http://127.0.0.1/demo',
    ts: 1000,
    isTop: true,
    target: { tag: 'input', name: '内容名称' },
    candidates: [{ type: 'testId', value: 'content-name', count: 1 }],
    ...partial,
  }
}

describe('buildRecordedCase', () => {
  it('把普通动作映射为步骤与元素', () => {
    const draft = buildRecordedCase([
      ev({
        kind: 'click',
        target: { tag: 'button', text: '新建内容' },
        candidates: [{ type: 'text', value: '新建内容', count: 1 }],
      }),
      ev({
        kind: 'fill',
        ts: 1100,
        value: '节目一',
        candidates: [{ type: 'testId', value: 'content-name', count: 1 }],
      }),
      ev({
        kind: 'select',
        ts: 1200,
        value: 'movie',
        target: { tag: 'select', name: '节目类型' },
        candidates: [{ type: 'role', value: 'combobox', name: '节目类型', count: 1 }],
      }),
    ])

    expect(draft.steps.map((s) => s.action)).toEqual(['click', 'fill', 'select'])
    expect(draft.steps[1].params).toEqual({ value: '节目一' })
    expect(draft.steps[2].params).toEqual({ value: 'movie' })
    expect(draft.startUrl).toBe('http://127.0.0.1/demo')
    expect(Object.keys(draft.elements)).toHaveLength(3)
    for (const step of draft.steps) expect(draft.elements[step.elementId ?? '']).toBeTruthy()
  })

  it('滚动不绑定元素，并保留最终坐标', () => {
    const draft = buildRecordedCase([
      ev({ kind: 'scroll', target: { tag: 'window' }, candidates: [], x: 0, y: 640 }),
    ])
    expect(draft.steps).toHaveLength(1)
    expect(draft.steps[0]).toMatchObject({ action: 'scroll', params: { x: 0, y: 640 } })
    expect(draft.elements).toEqual({})
  })

  it('显式起始地址优先，断言步骤追加在末尾', () => {
    const draft = buildRecordedCase(
      [ev({ kind: 'click', target: { tag: 'button', text: '保存' } })],
      {
        startUrl: 'http://127.0.0.1/start',
        assertionSteps: [{ id: 's-assert-1', action: 'assert', assertion: { type: 'visible' } }],
      },
    )
    expect(draft.startUrl).toBe('http://127.0.0.1/start')
    expect(draft.steps.at(-1)?.id).toBe('s-assert-1')
  })

  it('空事件回退到 about:blank', () => {
    const draft = buildRecordedCase([])
    expect(draft.startUrl).toBe('about:blank')
    expect(draft.steps).toEqual([])
  })
})
