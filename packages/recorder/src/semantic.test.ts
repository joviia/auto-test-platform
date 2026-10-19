import { describe, expect, it } from 'vitest'
import type { RawProbeEvent } from './collector.js'
import type { RecorderStep } from './normalize.js'
import { buildSemanticDraft } from './semantic.js'

const URL = 'https://example.test/content'

function step(
  overrides: Partial<RecorderStep> & Pick<RecorderStep, 'action' | 'ts'>,
): RecorderStep {
  return {
    target: { tag: 'button' },
    candidates: [],
    url: URL,
    ...overrides,
  }
}

function probe(refTs: number, overrides: Partial<RawProbeEvent> = {}): RawProbeEvent {
  return {
    kind: 'probe',
    refTs,
    ts: refTs + 180,
    url: URL,
    ...overrides,
  }
}

describe('buildSemanticDraft', () => {
  it('弹层内 1.5s 的选项点击合并为复合 select', () => {
    const trigger = step({
      action: 'click',
      ts: 1000,
      semantic: {
        label: '节目类型',
        role: 'combobox',
        tag: 'button',
        hasPopup: 'listbox',
      },
      probe: probe(1000, { popup: { role: 'listbox', options: ['电影', '剧集'] } }),
    })
    const option = step({
      action: 'click',
      ts: 1400,
      target: { tag: 'li', text: '电影' },
      semantic: { label: '电影', role: 'option', optionText: '电影' },
      probe: probe(1400),
    })

    const draft = buildSemanticDraft([trigger, option])
    expect(draft.entries).toHaveLength(1)
    expect(draft.entries[0]).toMatchObject({
      action: 'select',
      value: '电影',
      display: { verb: '选择', field: '节目类型', value: '电影', confidence: 'auto' },
    })
    expect(draft.entries[0]?.steps).toHaveLength(2)
  })

  it('勾选框按点击后的状态生成开启/关闭', () => {
    const click = step({
      action: 'click',
      ts: 2000,
      semantic: {
        label: '显示标题',
        tag: 'input',
        inputType: 'checkbox',
        checked: false,
      },
      probe: probe(2000, { checked: true }),
    })
    const draft = buildSemanticDraft([click])
    expect(draft.entries[0]?.display).toMatchObject({ verb: '开启', field: '显示标题' })
  })

  it('弹窗从打开到关闭归入同一组，并生成意图摘要', () => {
    const open = step({
      action: 'click',
      ts: 3000,
      semantic: { label: '新建内容', role: 'button', tag: 'button' },
      probe: probe(3000, { dialogOpened: '新建内容' }),
    })
    const fill = step({
      action: 'fill',
      ts: 3500,
      target: { tag: 'input' },
      value: '电影_1',
      semantic: { label: '内容名称', tag: 'input', inputType: 'text' },
    })
    const save = step({
      action: 'click',
      ts: 4000,
      semantic: { label: '保存', role: 'button', tag: 'button', inDialog: true },
      probe: probe(4000, { dialogClosed: true }),
    })

    const draft = buildSemanticDraft([open, fill, save])
    expect(draft.groups).toEqual([{ id: 'g-1', label: '新建内容', kind: 'dialog' }])
    expect(draft.entries.every((entry) => entry.groupId === 'g-1')).toBe(true)
    expect(draft.intent).toContain('在「新建内容」中')
    expect(draft.intent).toContain('填写 内容名称 = 电影_1')
  })

  it('不确定的下拉不静默合并，标为待确认', () => {
    const trigger = step({
      action: 'click',
      ts: 5000,
      semantic: { label: '节目类型', role: 'combobox', tag: 'button', hasPopup: 'listbox' },
    })
    const option = step({
      action: 'click',
      ts: 5400,
      target: { tag: 'li' },
      semantic: { role: 'option', optionText: '电影' },
    })
    const draft = buildSemanticDraft([trigger, option])
    expect(draft.entries).toHaveLength(2)
    expect(draft.entries[0]?.confidence).toBe('confirm')
    expect(draft.entries[0]?.display.confidence).toBe('confirm')
  })

  it('导航变化生成导航分组', () => {
    const click = step({
      action: 'click',
      ts: 6000,
      semantic: { label: '内容管理', role: 'link', tag: 'a' },
      probe: probe(6000, { url: 'https://example.test/content/list' }),
    })
    const draft = buildSemanticDraft([click])
    expect(draft.groups[0]).toMatchObject({ kind: 'navigation', label: '打开 /content/list' })
  })
})
