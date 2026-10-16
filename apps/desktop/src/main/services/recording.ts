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
} = { recording: false, buffer: [], view: null, domReadyHandler: null }

/** 订阅受控视图采集器的原始事件流（recorder-preload → ipcMain） */
export function initRecordingService(): void {
  ipcMain.on('atp:recorder-event', (_event, payload: unknown) => {
    if (!state.recording) return
    const ev = payload as RawRecorderEvent
    if (!ev || typeof ev.kind !== 'string' || !Array.isArray(ev.candidates)) return
    state.buffer.push(ev)
    // 实时预览：全量归一化后把最后一步推给 renderer（T8 起进入右栏面板）
    const steps = normalizeEvents(state.buffer)
    const last = steps[steps.length - 1]
    if (last) getMainWindow()?.webContents.send(IpcEvent.recordingStep, last)
  })
}

export function startRecording(view: WebContentsView): { ok: true } {
  state.buffer = []
  state.view = view
  state.recording = true

  const inject = (): void => {
    void view.webContents.executeJavaScript(collectorSource()).catch(() => {})
  }
  inject()
  // 页面跳转后重新注入（SPA 路由变化不需要，dom-ready 覆盖传统导航）
  state.domReadyHandler = inject
  view.webContents.on('dom-ready', state.domReadyHandler)

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
  }
  const events = state.buffer
  state.buffer = []
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
  return { steps, elements, startUrl }
}
