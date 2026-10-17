import { Toast } from '@heroui/react'
import { useEffect } from 'react'
import { useProjects } from './api/client'
import { BrowserStage } from './browser/BrowserStage'
import { AppBar } from './components/AppBar'
import { StatusBar } from './components/StatusBar'
import { RightPanel } from './panels/RightPanel'
import { SaveCaseDialog } from './recording/SaveCaseDialog'
import { useUiStore } from './state/ui-store'
import { CaseTree } from './tree/CaseTree'

export function App() {
  const setRecording = useUiStore((s) => s.setRecording)
  const pushLiveStep = useUiStore((s) => s.pushLiveStep)
  const setReplayProgress = useUiStore((s) => s.setReplayProgress)
  const theme = useUiStore((s) => s.theme)
  const currentProjectId = useUiStore((s) => s.currentProjectId)
  const setCurrentProjectId = useUiStore((s) => s.setCurrentProjectId)
  const { data: projects = [] } = useProjects()

  // 明暗：跟随系统；手动切换时以 html class 覆盖（Tailwind dark: 已改为 class 策略）
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      const root = document.documentElement
      root.classList.toggle('dark', dark)
      root.dataset.theme = dark ? 'dark' : 'light'
      root.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  // 当前项目：无效或未选择时回落到第一个项目
  useEffect(() => {
    if (projects.length === 0) {
      if (currentProjectId) setCurrentProjectId(null)
      return
    }
    if (!projects.some((p) => p.id === currentProjectId)) {
      setCurrentProjectId(projects[0].id)
    }
  }, [projects, currentProjectId, setCurrentProjectId])

  useEffect(() => {
    const offStatus = window.atp.on('event:recording-status', (p) => setRecording(p.recording))
    const offStep = window.atp.on('event:recording-step', (p) => pushLiveStep(p))
    const offReplay = window.atp.on('event:replay-progress', (p) =>
      setReplayProgress({ runId: p.runId, index: p.index, total: p.total }),
    )
    return () => {
      offStatus()
      offStep()
      offReplay()
    }
  }, [setRecording, pushLiveStep, setReplayProgress])

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
        <AppBar />
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[288px] shrink-0 flex-col border-r border-border bg-surface">
            <CaseTree />
          </aside>
          <main className="flex min-w-0 flex-1 flex-col">
            <BrowserStage />
          </main>
          <aside className="flex w-[404px] shrink-0 flex-col border-l border-border bg-surface">
            <RightPanel />
          </aside>
        </div>
        <StatusBar />
      </div>
      <SaveCaseDialog />
      <Toast.Provider placement="bottom end" />
    </>
  )
}
