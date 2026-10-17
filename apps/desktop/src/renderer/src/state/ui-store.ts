import type { Element, IpcEventPayload, LiveStep, Step } from '@atp/model'
import { create } from 'zustand'

export type SelectedNode = { kind: 'project' | 'module' | 'case'; id: string }

export type ThemePreference = 'system' | 'light' | 'dark'

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

interface UiState {
  selected: SelectedNode | null
  setSelected: (node: SelectedNode | null) => void

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
}

export const useUiStore = create<UiState>((set) => ({
  selected: null,
  setSelected: (selected) => set({ selected }),

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
}))
