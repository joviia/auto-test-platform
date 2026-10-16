import type { RawLocatorCandidate, RawRecorderEvent, RawTargetInfo } from './collector'

/** 归一化后的语义步骤（尚未绑定元素库） */
export interface RecorderStep {
  action: 'click' | 'fill' | 'select' | 'press'
  target: RawTargetInfo
  candidates: RawLocatorCandidate[]
  url: string
  ts: number
  value?: string
  key?: string
}

function cssOf(candidates: RawLocatorCandidate[]): string {
  return candidates.find((c) => c.type === 'css')?.value ?? JSON.stringify(candidates)
}

/**
 * 原始事件 → 语义步骤：
 * - 连续同元素的 fill 合并为一条（保留最后值）
 * - 300ms 内同元素的重复 click 去重（label→input 双发、合成 click）
 * - keydown → press
 */
export function normalizeEvents(events: RawRecorderEvent[]): RecorderStep[] {
  const steps: RecorderStep[] = []
  for (const ev of events) {
    const last = steps[steps.length - 1]
    if (ev.kind === 'fill' && last && last.action === 'fill') {
      if (cssOf(last.candidates) === cssOf(ev.candidates)) {
        last.value = ev.value
        last.ts = ev.ts
        continue
      }
    }
    if (
      ev.kind === 'click' &&
      last &&
      last.action === 'click' &&
      cssOf(last.candidates) === cssOf(ev.candidates) &&
      ev.ts - last.ts < 300
    ) {
      continue
    }
    steps.push({
      action: ev.kind === 'keydown' ? 'press' : ev.kind,
      target: ev.target,
      candidates: ev.candidates,
      url: ev.url,
      ts: ev.ts,
      value: ev.value,
      key: ev.key,
    })
  }
  return steps
}
