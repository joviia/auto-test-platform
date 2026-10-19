import type {
  RawActionEvent,
  RawLocatorCandidate,
  RawProbeEvent,
  RawRecorderEvent,
  RawSemanticMeta,
  RawTargetInfo,
} from './collector.js'

/** 归一化后的语义步骤（尚未绑定元素库） */
export interface RecorderStep {
  action: 'click' | 'fill' | 'select' | 'press' | 'scroll' | 'drag'
  target: RawTargetInfo
  candidates: RawLocatorCandidate[]
  url: string
  ts: number
  isTop?: boolean
  framePath?: number[]
  value?: string
  key?: string
  x?: number
  y?: number
  dx?: number
  dy?: number
  startX?: number
  startY?: number
  durationMs?: number
  /** click 时的意图线索 */
  semantic?: RawSemanticMeta
  /** click 后 180ms 的观察结果（弹层/弹窗/状态） */
  probe?: RawProbeEvent
}

function cssOf(candidates: RawLocatorCandidate[]): string {
  return candidates.find((c) => c.type === 'css')?.value ?? JSON.stringify(candidates)
}

/** 同一 frame 内的同一目标：iframe 之间可能存在相同的 CSS 链，必须带上 url 区分 */
function sameTarget(step: RecorderStep, ev: RawActionEvent): boolean {
  return step.url === ev.url && cssOf(step.candidates) === cssOf(ev.candidates)
}

/**
 * 原始事件 → 语义步骤：
 * - 连续同元素的 fill 合并为一条（保留最后值）
 * - 300ms 内同元素的重复 click 去重（label→input 双发、合成 click）
 * - click 后紧接同元素的 fill/select：丢弃 click（fill/select 自带聚焦）
 * - keydown → press
 */
export function normalizeEvents(events: RawRecorderEvent[]): RecorderStep[] {
  const steps: RecorderStep[] = []
  // probe 是 click 的补充观察，不单独成步；按 refTs 挂回对应 click
  const probes = new Map<number, RawProbeEvent>()
  for (const ev of events) {
    if (ev.kind !== 'probe' || typeof ev.refTs !== 'number') continue
    const prev = probes.get(ev.refTs)
    probes.set(ev.refTs, {
      ...prev,
      ...ev,
      // 早拍看到的弹层不应被晚拍（弹层已关闭）覆盖
      popup: ev.popup ?? prev?.popup,
      dialogOpened: ev.dialogOpened ?? prev?.dialogOpened,
      dialogClosed: ev.dialogClosed ?? prev?.dialogClosed,
      checked: ev.checked ?? prev?.checked,
      expanded: ev.expanded ?? prev?.expanded,
    })
  }
  for (const ev of events) {
    if (ev.kind === 'probe') continue
    let last = steps[steps.length - 1]
    if (
      (ev.kind === 'fill' || ev.kind === 'select') &&
      last?.action === 'click' &&
      sameTarget(last, ev)
    ) {
      steps.pop()
      last = steps[steps.length - 1]
    }
    if (ev.kind === 'scroll' && last && last.action === 'scroll') {
      last.x = ev.x
      last.y = ev.y
      last.ts = ev.ts
      continue
    }
    if (ev.kind === 'fill' && last && last.action === 'fill') {
      if (sameTarget(last, ev)) {
        last.value = ev.value
        last.ts = ev.ts
        continue
      }
    }
    if (
      ev.kind === 'click' &&
      last &&
      last.action === 'click' &&
      sameTarget(last, ev) &&
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
      isTop: ev.isTop,
      framePath: ev.framePath,
      value: ev.value,
      key: ev.key,
      x: ev.x,
      y: ev.y,
      dx: ev.dx,
      dy: ev.dy,
      startX: ev.startX,
      startY: ev.startY,
      durationMs: ev.durationMs,
      semantic: ev.semantic,
      probe: ev.kind === 'click' ? probes.get(ev.ts) : undefined,
    })
  }
  return steps
}
