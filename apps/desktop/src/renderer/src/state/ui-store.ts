import type { IpcEventPayload, LiveStep } from '@atp/model'
import { create } from 'zustand'

export type SelectedNode = { kind: 'project' | 'module' | 'case'; id: string }

interface UiState {
  selected: SelectedNode | null
  setSelected: (node: SelectedNode | null) => void

  recording: boolean
  setRecording: (recording: boolean) => void

  liveSteps: LiveStep[]
  pushLiveStep: (step: IpcEventPayload<'event:recording-step'>) => void
  resetLiveSteps: () => void

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

  url: '',
  setUrl: (url) => set({ url }),
}))
