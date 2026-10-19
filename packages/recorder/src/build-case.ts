import type { CaseGroup, Element, Step } from '@atp/model'
import type { RawRecorderEvent } from './collector.js'
import { buildElement } from './locator.js'
import { normalizeEvents } from './normalize.js'
import { buildSemanticDraft } from './semantic.js'

export interface RecordedCaseDraft {
  steps: Step[]
  elements: Record<string, Element>
  startUrl: string
  /** 意图层：一句话摘要 */
  intent: string
  /** 意图层：步骤分组 */
  groups: CaseGroup[]
}

export interface BuildRecordedCaseOptions {
  /** 调用方已知的起始地址优先；否则从事件推断 */
  startUrl?: string
  assertionSteps?: Step[]
  assertionElements?: Record<string, Element>
}

/**
 * 原始录制事件 → 用例草稿（步骤 + 元素库 + 起始地址）。
 * 与执行壳无关：Electron 录制服务和 Agent 共用同一套转换。
 */
export function buildRecordedCase(
  events: RawRecorderEvent[],
  opts: BuildRecordedCaseOptions = {},
): RecordedCaseDraft {
  const normalized = normalizeEvents(events)
  const semantic = buildSemanticDraft(normalized)
  const elements: Record<string, Element> = { ...(opts.assertionElements ?? {}) }
  const steps: Step[] = semantic.entries.map((entry, i) => {
    const first = entry.steps[0]
    const id = `s-${String(i + 1).padStart(3, '0')}`
    const display = {
      ...entry.display,
      ...(entry.confidence === 'confirm' ? { confidence: 'confirm' as const } : {}),
    }
    if (first.action === 'scroll') {
      return {
        id,
        action: 'scroll',
        params: { x: first.x ?? 0, y: first.y ?? 0 },
        display,
        ...(entry.groupId ? { groupId: entry.groupId } : {}),
      }
    }
    const el = buildElement(first.target, first.candidates, first.framePath)
    elements[el.id] = el
    const params =
      entry.action === 'select' && entry.steps.length > 1
        ? { value: entry.value ?? '', mode: 'custom' }
        : first.action === 'fill' || first.action === 'select'
          ? { value: first.value ?? '' }
          : first.action === 'press'
            ? { key: first.key ?? 'Enter' }
            : first.action === 'drag'
              ? {
                  dx: first.dx ?? 0,
                  dy: first.dy ?? 0,
                  startX: first.startX,
                  startY: first.startY,
                  durationMs: first.durationMs,
                }
              : undefined
    return {
      id,
      action: entry.action,
      elementId: el.id,
      ...(params ? { params } : {}),
      display,
      ...(entry.groupId ? { groupId: entry.groupId } : {}),
    }
  })

  const startUrl =
    opts.startUrl || events.find((e) => e.isTop === true)?.url || events[0]?.url || 'about:blank'

  return {
    steps: [...steps, ...(opts.assertionSteps ?? [])],
    elements,
    startUrl,
    intent: semantic.intent,
    groups: semantic.groups,
  }
}
