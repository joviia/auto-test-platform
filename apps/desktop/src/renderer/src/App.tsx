import { useEffect } from 'react'
import { BrowserStage } from './browser/BrowserStage'
import { ThreeColumn } from './layout/ThreeColumn'
import { RightPanel } from './panels/RightPanel'
import { useUiStore } from './state/ui-store'
import { CaseTree } from './tree/CaseTree'

export function App() {
  const setRecording = useUiStore((s) => s.setRecording)
  const pushLiveStep = useUiStore((s) => s.pushLiveStep)

  useEffect(() => {
    const offStatus = window.atp.on('event:recording-status', (p) => setRecording(p.recording))
    const offStep = window.atp.on('event:recording-step', (p) => pushLiveStep(p))
    return () => {
      offStatus()
      offStep()
    }
  }, [setRecording, pushLiveStep])

  return <ThreeColumn left={<CaseTree />} center={<BrowserStage />} right={<RightPanel />} />
}
