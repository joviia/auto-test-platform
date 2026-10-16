import type { Element, IpcEventPayload, LiveStep, Step } from '@atp/model'
import { create } from 'zustand'

export type SelectedNode = { kind: 'project' | 'module' | 'case'; id: string }

export interface RecordingDraft {
  steps: Step[]
  elements: Record<string, Element>
  startUrl: string
}

interface UiState {
  selected: SelectedNode | null
  setSelected: (node: SelectedNode | null) => void

  recording: boolean
  setRecording: (recording: boolean) => void

  liveSteps: LiveStep[]
  pushLiveStep: (step: IpcEventPayload<'event:recording-step'>) => void
  resetLiveSteps: () => void

  draftRecording: RecordingDraft | null
  setDraftRecording: (draft: RecordingDraft | null) => void

  url: string
  setUrl: (url: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  selected: null,
  setSelected: (selected) => set({ selected }),

  recording: false,
  setRecording: (recording) => set({ recording }),

  liveSteps: [],
  pushLiveStep: (step) => set((s) => ({ liveSteps: [...s.liveSteps, step] })),
  resetLiveSteps: () => set({ liveSteps: [] }),

  draftRecording: null,
  setDraftRecording: (draftRecording) => set({ draftRecording }),

  url: '',
  setUrl: (url) => set({ url }),
}))
