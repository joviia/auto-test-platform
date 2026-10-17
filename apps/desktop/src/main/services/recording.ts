import type { Element, Step } from '@atp/model'
import { IpcEvent } from '@atp/model'
import {
  type RawRecorderEvent,
  buildElement,
  collectorSource,
  normalizeEvents,
} from '@atp/recorder'
import type { WebContentsView } from 'electron'
import { ipcMain } from 'electron'
import { getMainWindow } from '../app-window'

const state: {
  recording: boolean
  buffer: RawRecorderEvent[]
  view: WebContentsView | null
  domReadyHandler: (() => void) | null
  assertionArmed: boolean
  assertionSteps: Step[]
  debuggerAttached: boolean
} = {
  recording: false,
  buffer: [],
  view: null,
  domReadyHandler: null,
  assertionArmed: false,
  assertionSteps: [],
  debuggerAttached: false,
}

/** 订阅受控视图采集器的原始事件流（recorder-preload → ipcMain） */
export function initRecordingService(): void {
  ipcMain.on('atp:recorder-event', (_event, payload: unknown) => {
    if (!state.recording) return
    const ev = payload as RawRecorderEvent
    if (!ev || typeof ev.kind !== 'string' || !Array.isArray(ev.candidates)) return

    // 断言拾取态：下一个被捕获元素生成 visible 断言步骤，不记动作
    if (state.assertionArmed) {
      state.assertionArmed = false
      const el = buildElement(ev.target, ev.candidates)
      state.assertionSteps.push({
        id: `s-assert-${Date.now().toString(36)}`,
        action: 'assert',
        elementId: el.id,
        assertion: { type: 'visible' },
      })
      getMainWindow()?.webContents.send(IpcEvent.recordingStep, {
        action: 'assert',
        target: ev.target,
        candidates: ev.candidates,
        url: ev.url,
        ts: ev.ts,
      })
      return
    }

    state.buffer.push(ev)
    // 实时预览：全量归一化后把最后一步推给 renderer（T8 起进入右栏面板）
    const steps = normalizeEvents(state.buffer)
    const last = steps[steps.length - 1]
    if (last) getMainWindow()?.webContents.send(IpcEvent.recordingStep, last)
  })
}

export function startRecording(view: WebContentsView): { ok: true } {
  state.buffer = []
  state.assertionSteps = []
  state.assertionArmed = false
  state.view = view
  state.recording = true

  // 即时注入当前文档
  const inject = (): void => {
    view.webContents
      .executeJavaScript(collectorSource())
      .then(() => console.log('[atp] recorder 注入成功:', view.webContents.getURL()))
      .catch((err: unknown) =>
        console.error('[atp] recorder 注入失败（将收不到任何录制事件）:', err),
      )
  }
  inject()
  // 兜底：后续每个新文档自动注入（早于页面脚本，覆盖跳转/重定向时序）
  try {
    view.webContents.debugger.attach('1.3')
    view.webContents.debugger
      .sendCommand('Page.enable')
      .then(() =>
        view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
          source: collectorSource(),
        }),
      )
      .catch((err: unknown) => console.error('[atp] 自动注入注册失败:', err))
    state.debuggerAttached = true
  } catch (err) {
    console.error('[atp] debugger attach 失败:', err)
  }
  state.domReadyHandler = inject
  view.webContents.on('dom-ready', state.domReadyHandler)
  view.webContents.on('did-finish-load', inject)

  getMainWindow()?.webContents.send(IpcEvent.recordingStatus, {
    recording: true,
    url: view.webContents.getURL(),
  })
  return { ok: true }
}

export function stopRecording(): {
  steps: Step[]
  elements: Record<string, Element>
  startUrl: string
} {
  state.recording = false
  if (state.view && state.domReadyHandler) {
    state.view.webContents.removeListener('dom-ready', state.domReadyHandler)
    state.view.webContents.removeListener('did-finish-load', state.domReadyHandler)
  }
  if (state.view && state.debuggerAttached) {
    try {
      void state.view.webContents.debugger.sendCommand('Page.disable')
      state.view.webContents.debugger.detach()
    } catch {
      // 已分离时忽略
    }
    state.debuggerAttached = false
  }
  const events = state.buffer
  state.buffer = []
  console.log(`[atp] 录制停止：捕获原始事件 ${events.length} 条`)
  state.view = null

  const normalized = normalizeEvents(events)
  const elements: Record<string, Element> = {}
  const steps: Step[] = normalized.map((s, i) => {
    const el = buildElement(s.target, s.candidates)
    elements[el.id] = el
    return {
      id: `s-${String(i + 1).padStart(3, '0')}`,
      action: s.action,
      elementId: el.id,
      params:
        s.action === 'fill' || s.action === 'select'
          ? { value: s.value ?? '' }
          : s.action === 'press'
            ? { key: s.key ?? 'Enter' }
            : undefined,
    }
  })
  const startUrl = events[0]?.url ?? ''

  getMainWindow()?.webContents.send(IpcEvent.recordingStatus, { recording: false })
  return { steps: [...steps, ...state.assertionSteps], elements, startUrl }
}

/** 录制中断言拾取：武装后下一个被捕获元素生成 visible 断言步骤 */
export function armAssertion(): { ok: true } {
  if (state.recording) state.assertionArmed = true
  return { ok: true }
}
