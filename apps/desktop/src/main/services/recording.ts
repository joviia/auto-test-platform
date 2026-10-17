import type { Element, Step } from '@atp/model'
import { IpcEvent } from '@atp/model'
import {
  type RawRecorderEvent,
  buildElement,
  collectorSource,
  normalizeEvents,
} from '@atp/recorder'
import type { WebContentsView, WebFrameMain } from 'electron'
import { ipcMain } from 'electron'
import { getMainWindow } from '../app-window'
import { acquireDebugger, releaseDebugger } from '../browser/debugger'
import { isPlanRunning } from './run-lock'

/** 录制停止时回传的诊断信息：前端用于区分「没操作」与「注入失败/iframe」 */
export interface RecordingDiagnostics {
  rawEvents: number
  frames: Array<{ url: string; injected: boolean }>
}

interface RecordingState {
  recording: boolean
  buffer: RawRecorderEvent[]
  view: WebContentsView | null
  assertionArmed: boolean
  assertionSteps: Step[]
  assertionElements: Record<string, Element>
  startUrl: string
  /** 录制期挂在受控视图上的监听器，停止时按引用移除 */
  handlers: {
    onReady: () => void
    onFrameFinishLoad: () => void
    onNavigate: (event: unknown, url: string) => void
  } | null
}

const state: RecordingState = {
  recording: false,
  buffer: [],
  view: null,
  assertionArmed: false,
  assertionSteps: [],
  assertionElements: {},
  startUrl: '',
  handlers: null,
}

function isRealUrl(url: string | undefined): url is string {
  return typeof url === 'string' && url.length > 0 && !url.startsWith('about:')
}

/** 向受控视图的每个 frame（含 iframe）注入采集器；已注入的文档会被采集器自身去重 */
async function injectAllFrames(view: WebContentsView): Promise<void> {
  let frames: WebFrameMain[]
  try {
    frames = view.webContents.mainFrame.framesInSubtree
  } catch (err) {
    console.error('[atp] 枚举 frame 失败:', err)
    return
  }
  await Promise.all(
    frames.map(async (frame) => {
      try {
        await frame.executeJavaScript(collectorSource())
      } catch (err) {
        // 跨域 iframe / 正在导航的 frame 可能拒绝执行：记录但不中断
        console.error(`[atp] frame 注入失败 ${frame.url}:`, err)
      }
    }),
  )
}

/** 停止前探测每个 frame 的注入状态，供保存对话框展示 */
async function collectFrameDiagnostics(
  view: WebContentsView,
): Promise<RecordingDiagnostics['frames']> {
  let frames: WebFrameMain[]
  try {
    frames = view.webContents.mainFrame.framesInSubtree
  } catch {
    return []
  }
  return Promise.all(
    frames.map(async (frame) => {
      try {
        const injected = await frame.executeJavaScript(
          'Boolean(window.__atpRecorderInstalled && window.__atpBridge)',
        )
        return { url: frame.url, injected: injected === true }
      } catch {
        return { url: frame.url, injected: false }
      }
    }),
  )
}

/** 从发送 frame 计算到主文档的索引路径（iframe 回放用） */
function framePathOf(frame: WebFrameMain | null): number[] {
  const path: number[] = []
  let cur = frame
  while (cur?.parent) {
    const idx = cur.parent.frames.indexOf(cur)
    if (idx < 0) break
    path.unshift(idx)
    cur = cur.parent
  }
  return path
}

/** 订阅受控视图采集器的原始事件流（recorder-preload → ipcMain） */
export function initRecordingService(): void {
  ipcMain.on('atp:recorder-event', (event, payload: unknown) => {
    if (!state.recording) return
    const raw = payload as RawRecorderEvent
    if (!raw || typeof raw.kind !== 'string' || !Array.isArray(raw.candidates)) return
    const ev: RawRecorderEvent = { ...raw, framePath: framePathOf(event.senderFrame) }

    // 断言拾取态：下一个被捕获元素生成 visible 断言步骤，不记动作
    if (state.assertionArmed) {
      state.assertionArmed = false
      const el = buildElement(ev.target, ev.candidates, ev.framePath)
      // 断言步骤同样引用元素库，元素必须随用例一起落库
      state.assertionElements[el.id] = el
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
  if (isPlanRunning()) throw new Error('计划执行中，无法开始录制')
  state.buffer = []
  state.assertionSteps = []
  state.assertionElements = {}
  state.assertionArmed = false
  state.view = view
  state.recording = true
  const currentUrl = view.webContents.getURL()
  state.startUrl = isRealUrl(currentUrl) ? currentUrl : ''

  // 即时注入当前文档 + 所有已有 iframe
  void injectAllFrames(view)

  // 兜底：后续每个新文档（含 iframe）在加载完成时自动注入，
  // 覆盖跳转/重定向/动态插入 iframe 的时序
  void acquireDebugger(view, 'recording')
    .then(() =>
      view.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: collectorSource(),
      }),
    )
    .catch((err: unknown) => console.error('[atp] 自动注入注册失败:', err))

  const onReady = (): void => {
    void injectAllFrames(view)
  }
  const onFrameFinishLoad = (): void => {
    void injectAllFrames(view)
  }
  const onNavigate = (_event: unknown, url: string): void => {
    if (!state.startUrl && isRealUrl(url)) state.startUrl = url
  }
  state.handlers = { onReady, onFrameFinishLoad, onNavigate }

  view.webContents.on('dom-ready', onReady)
  view.webContents.on('did-finish-load', onReady)
  view.webContents.on('did-frame-finish-load', onFrameFinishLoad)
  view.webContents.on('did-navigate', onNavigate)

  getMainWindow()?.webContents.send(IpcEvent.recordingStatus, {
    recording: true,
    url: view.webContents.getURL(),
  })
  return { ok: true }
}

export async function stopRecording(): Promise<{
  steps: Step[]
  elements: Record<string, Element>
  startUrl: string
  diagnostics: RecordingDiagnostics
}> {
  const view = state.view
  state.recording = false

  if (view && state.handlers) {
    view.webContents.removeListener('dom-ready', state.handlers.onReady)
    view.webContents.removeListener('did-finish-load', state.handlers.onReady)
    view.webContents.removeListener('did-frame-finish-load', state.handlers.onFrameFinishLoad)
    view.webContents.removeListener('did-navigate', state.handlers.onNavigate)
    state.handlers = null
  }

  const events = state.buffer
  state.buffer = []

  // 诊断必须在分离 debugger / 清空 view 之前采集
  let frames: RecordingDiagnostics['frames'] = []
  if (view) {
    try {
      frames = await collectFrameDiagnostics(view)
    } catch (err) {
      console.error('[atp] 采集 frame 诊断失败:', err)
    }
  }

  if (view) {
    releaseDebugger(view, 'recording')
  }
  console.log(
    `[atp] 录制停止：捕获原始事件 ${events.length} 条；frame ${frames.length} 个（注入 ${frames.filter((f) => f.injected).length} 个）`,
  )

  const normalized = normalizeEvents(events)
  const elements: Record<string, Element> = { ...state.assertionElements }
  const steps: Step[] = normalized.map((s, i) => {
    if (s.action === 'scroll') {
      return {
        id: `s-${String(i + 1).padStart(3, '0')}`,
        action: 'scroll',
        params: { x: s.x ?? 0, y: s.y ?? 0 },
      }
    }
    const el = buildElement(s.target, s.candidates, s.framePath)
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
            : s.action === 'drag'
              ? {
                  dx: s.dx ?? 0,
                  dy: s.dy ?? 0,
                  startX: s.startX,
                  startY: s.startY,
                  durationMs: s.durationMs,
                }
              : undefined,
    }
  })
  // 起始地址取主 frame：先看录制期间首次真实导航，再退回事件里的顶层 frame URL
  const startUrl =
    state.startUrl ||
    events.find((e) => e.isTop === true)?.url ||
    events[0]?.url ||
    (view ? view.webContents.getURL() : '')

  const allSteps = [...steps, ...state.assertionSteps]
  state.startUrl = ''
  state.assertionSteps = []
  state.assertionElements = {}
  state.view = null

  getMainWindow()?.webContents.send(IpcEvent.recordingStatus, { recording: false })
  return {
    steps: allSteps,
    elements,
    startUrl,
    diagnostics: { rawEvents: events.length, frames },
  }
}

/** 录制中断言拾取：武装后下一个被捕获元素生成 visible 断言步骤 */
export function armAssertion(): { ok: true } {
  if (state.recording) state.assertionArmed = true
  return { ok: true }
}

export function isRecording(): boolean {
  return state.recording
}
