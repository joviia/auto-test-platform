import type { Element, IpcEventPayload, LiveStep, Step } from '@atp/model'
import { create } from 'zustand'

export type SelectedNode = { kind: 'project' | 'module' | 'case' | 'plan'; id: string }

export type NavTab = 'cases' | 'plans'

export type ThemePreference = 'system' | 'light' | 'dark'

export type DevicePresetId =
  | 'responsive'
  | 'desktop-1440'
  | 'laptop-1280'
  | 'tablet-1024'
  | 'iphone-14'
  | 'android-412'

export type DeviceOrientation = 'portrait' | 'landscape'
export type DeviceZoom = 'fit' | 0.5 | 0.75 | 1 | 1.25
export type ReplayMode = 'embedded' | 'standalone'

export interface RecordingDraft {
  steps: Step[]
  elements: Record<string, Element>
  startUrl: string
  diagnostics?: {
    rawEvents: number
    frames: Array<{ url: string; injected: boolean }>
  }
}

const THEME_KEY = 'atp.theme'
const DEVICE_KEY = 'atp.device'
const REPLAY_MODE_KEY = 'atp.replayMode'

function readStoredTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // 私密窗口/被禁用时忽略
  }
  return 'system'
}

function storeTheme(theme: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // 忽略写入失败
  }
}

interface StoredDevice {
  presetId: DevicePresetId
  orientation: DeviceOrientation
  zoom: DeviceZoom
}

function readStoredDevice(): StoredDevice {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredDevice>
      if (parsed.presetId) {
        return {
          presetId: parsed.presetId,
          orientation: parsed.orientation === 'landscape' ? 'landscape' : 'portrait',
          zoom: parsed.zoom === 'fit' || typeof parsed.zoom === 'number' ? parsed.zoom : 'fit',
        }
      }
    }
  } catch {
    // 忽略
  }
  return { presetId: 'responsive', orientation: 'portrait', zoom: 'fit' }
}

function storeDevice(device: StoredDevice): void {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(device))
  } catch {
    // 忽略
  }
}

function readReplayMode(): ReplayMode {
  try {
    return localStorage.getItem(REPLAY_MODE_KEY) === 'standalone' ? 'standalone' : 'embedded'
  } catch {
    return 'embedded'
  }
}

function storeReplayMode(mode: ReplayMode): void {
  try {
    localStorage.setItem(REPLAY_MODE_KEY, mode)
  } catch {
    // 忽略
  }
}

interface UiState {
  selected: SelectedNode | null
  setSelected: (node: SelectedNode | null) => void

  /** 左栏导航：用例库 / 测试计划 */
  navTab: NavTab
  setNavTab: (tab: NavTab) => void

  /** 当前项目：左树、新建用例、保存对话框共用 */
  currentProjectId: string | null
  setCurrentProjectId: (projectId: string | null) => void

  recording: boolean
  recordingStartedAt: number | null
  setRecording: (recording: boolean) => void

  liveSteps: LiveStep[]
  pushLiveStep: (step: IpcEventPayload<'event:recording-step'>) => void
  resetLiveSteps: () => void

  draftRecording: RecordingDraft | null
  setDraftRecording: (draft: RecordingDraft | null) => void

  url: string
  setUrl: (url: string) => void

  /** 打开的弹层层数：原生受控浏览器视图必须让位，否则会盖住弹窗 */
  overlayDepth: number
  pushOverlay: () => void
  popOverlay: () => void

  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void

  devicePresetId: DevicePresetId
  deviceOrientation: DeviceOrientation
  deviceZoom: DeviceZoom
  setDevice: (patch: Partial<StoredDevice>) => void

  replayMode: ReplayMode
  setReplayMode: (mode: ReplayMode) => void

  replayProgress: { runId: string | null; index: number; total: number } | null
  setReplayProgress: (
    progress: { runId: string | null; index: number; total: number } | null,
  ) => void

  planProgress: IpcEventPayload<'event:plan-progress'> | null
  setPlanProgress: (progress: IpcEventPayload<'event:plan-progress'> | null) => void
}

const initialDevice = readStoredDevice()

export const useUiStore = create<UiState>((set, get) => ({
  selected: null,
  setSelected: (selected) => set({ selected }),

  navTab: 'cases',
  setNavTab: (navTab) => set({ navTab }),

  currentProjectId: null,
  setCurrentProjectId: (currentProjectId) => set({ currentProjectId }),

  recording: false,
  recordingStartedAt: null,
  setRecording: (recording) =>
    set((s) => ({
      recording,
      // 只在本轮录制开始时打点，重复的 true 事件不重置计时
      recordingStartedAt: recording ? (s.recordingStartedAt ?? Date.now()) : null,
    })),

  liveSteps: [],
  pushLiveStep: (step) => set((s) => ({ liveSteps: [...s.liveSteps, step] })),
  resetLiveSteps: () => set({ liveSteps: [] }),

  draftRecording: null,
  setDraftRecording: (draftRecording) => set({ draftRecording }),

  url: '',
  setUrl: (url) => set({ url }),

  overlayDepth: 0,
  pushOverlay: () => set((s) => ({ overlayDepth: s.overlayDepth + 1 })),
  popOverlay: () => set((s) => ({ overlayDepth: Math.max(0, s.overlayDepth - 1) })),

  theme: readStoredTheme(),
  setTheme: (theme) => {
    storeTheme(theme)
    set({ theme })
  },

  devicePresetId: initialDevice.presetId,
  deviceOrientation: initialDevice.orientation,
  deviceZoom: initialDevice.zoom,
  setDevice: (patch) => {
    const current = get()
    const next: StoredDevice = {
      presetId: patch.presetId ?? current.devicePresetId,
      orientation: patch.orientation ?? current.deviceOrientation,
      zoom: patch.zoom ?? current.deviceZoom,
    }
    storeDevice(next)
    set({
      devicePresetId: next.presetId,
      deviceOrientation: next.orientation,
      deviceZoom: next.zoom,
    })
  },

  replayMode: readReplayMode(),
  setReplayMode: (mode) => {
    storeReplayMode(mode)
    set({ replayMode: mode })
  },

  replayProgress: null,
  setReplayProgress: (replayProgress) => set({ replayProgress }),

  planProgress: null,
  setPlanProgress: (planProgress) => set({ planProgress }),
}))
