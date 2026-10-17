import { describe, expect, it } from 'vitest'
import type { RawRecorderEvent } from './collector'
import { normalizeEvents } from './normalize'

function ev(
  partial: Partial<RawRecorderEvent> & { kind: RawRecorderEvent['kind'] },
): RawRecorderEvent {
  return {
    url: 'file:///fixture',
    ts: 1000,
    target: { tag: 'input' },
    candidates: [{ type: 'css', value: '#username', count: 1 }],
    ...partial,
  }
}

describe('normalizeEvents', () => {
  it('连续同元素 fill 合并为一条，保留最后值', () => {
    const steps = normalizeEvents([
      ev({ kind: 'fill', value: 'a', candidates: [{ type: 'css', value: '#username', count: 1 }] }),
      ev({
        kind: 'fill',
        value: 'ad',
        ts: 1100,
        candidates: [{ type: 'css', value: '#username', count: 1 }],
      }),
      ev({
        kind: 'fill',
        value: 'admin',
        ts: 1200,
        candidates: [{ type: 'css', value: '#username', count: 1 }],
      }),
    ])
    expect(steps).toHaveLength(1)
    expect(steps[0].value).toBe('admin')
  })

  it('不同元素的 fill 不合并', () => {
    const steps = normalizeEvents([
      ev({
        kind: 'fill',
        value: 'admin',
        candidates: [{ type: 'css', value: '#username', count: 1 }],
      }),
      ev({
        kind: 'fill',
        value: 'secret',
        ts: 1100,
        candidates: [{ type: 'css', value: '#password', count: 1 }],
      }),
    ])
    expect(steps).toHaveLength(2)
  })

  it('不同 frame 的同名 CSS 链不合并', () => {
    const steps = normalizeEvents([
      ev({ kind: 'fill', value: 'a', url: 'https://a.test/frame.html' }),
      ev({ kind: 'fill', value: 'b', ts: 1100, url: 'https://b.test/frame.html' }),
    ])
    expect(steps).toHaveLength(2)
  })

  it('300ms 内同元素重复 click 去重', () => {
    const steps = normalizeEvents([
      ev({
        kind: 'click',
        ts: 1000,
        candidates: [{ type: 'css', value: '#login > button', count: 1 }],
      }),
      ev({
        kind: 'click',
        ts: 1200,
        candidates: [{ type: 'css', value: '#login > button', count: 1 }],
      }),
    ])
    expect(steps).toHaveLength(1)
  })

  it('keydown 映射为 press 并保留按键', () => {
    const steps = normalizeEvents([ev({ kind: 'keydown', key: 'Enter', ts: 900 })])
    expect(steps[0].action).toBe('press')
    expect(steps[0].key).toBe('Enter')
  })
})
