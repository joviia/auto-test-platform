import { Toast, toast } from '@heroui/react'
import { useQueryClient } from '@tanstack/react-query'
import { type PointerEvent as ReactPointerEvent, useEffect } from 'react'
import { AiSettingsDialog } from './ai/AiSettingsDialog'
import { CommandPalette } from './ai/CommandPalette'
import { useProjects } from './api/client'
import { BrowserStage } from './browser/BrowserStage'
import { AppBar } from './components/AppBar'
import { LeftSidebar } from './components/LeftSidebar'
import { StatusBar } from './components/StatusBar'
import { RightPanel } from './panels/RightPanel'
import { SaveCaseDialog } from './recording/SaveCaseDialog'
import { useUiStore } from './state/ui-store'

export function App() {
  const setRecording = useUiStore((s) => s.setRecording)
  const pushLiveStep = useUiStore((s) => s.pushLiveStep)
  const setReplayProgress = useUiStore((s) => s.setReplayProgress)
  const setPlanProgress = useUiStore((s) => s.setPlanProgress)
  const theme = useUiStore((s) => s.theme)
  const currentProjectId = useUiStore((s) => s.currentProjectId)
  const setCurrentProjectId = useUiStore((s) => s.setCurrentProjectId)
  const url = useUiStore((s) => s.url)
  const recording = useUiStore((s) => s.recording)
  const draftRecording = useUiStore((s) => s.draftRecording)
  const selectedRunId = useUiStore((s) => s.selectedRunId)
  const navTab = useUiStore((s) => s.navTab)
  const selected = useUiStore((s) => s.selected)
  const aiOpen = useUiStore((s) => s.aiOpen)
  const rightWidth = useUiStore((s) => s.rightWidth)
  const setRightWidth = useUiStore((s) => s.setRightWidth)
  const startAiMessage = useUiStore((s) => s.startAiMessage)
  const appendAiDelta = useUiStore((s) => s.appendAiDelta)
  const startAiTool = useUiStore((s) => s.startAiTool)
  const endAiTool = useUiStore((s) => s.endAiTool)
  const finishAiMessage = useUiStore((s) => s.finishAiMessage)
  const failAiMessage = useUiStore((s) => s.failAiMessage)
  const setReplaying = useUiStore((s) => s.setReplaying)
  const qc = useQueryClient()
  // 项目/模块只是树上的定位，不算「打开了东西」；启动台仍应保持干净的整幅舞台
  const openedNode = selected?.kind === 'case' || selected?.kind === 'plan'
  const launchMode =
    navTab === 'cases' &&
    !url &&
    !recording &&
    !draftRecording &&
    !selectedRunId &&
    !openedNode &&
    !aiOpen
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
    const offPlan = window.atp.on('event:plan-progress', (p) => setPlanProgress(p))
    const offAiStart = window.atp.on('event:ai-start', (p) =>
      startAiMessage(p.sessionId, p.messageId),
    )
    const offAiDelta = window.atp.on('event:ai-delta', (p) =>
      appendAiDelta(p.messageId, p.kind, p.text),
    )
    const offAiToolStart = window.atp.on('event:ai-tool-start', (p) => {
      startAiTool(p.messageId, p)
      // AI 自己执行用例时，中栏回放状态条与进度条跟随
      if (p.name === 'case_run') setReplaying(true)
    })
    const offAiToolEnd = window.atp.on('event:ai-tool-end', (p) => {
      endAiTool(p.messageId, p)
      if (p.name === 'case_run') {
        setReplaying(false)
        void qc.invalidateQueries({ queryKey: ['runs'] })
        void qc.invalidateQueries({ queryKey: ['planRuns'] })
      }
    })
    const offAiDone = window.atp.on('event:ai-done', (p) =>
      finishAiMessage(p.messageId, p.cancelled),
    )
    const offAiError = window.atp.on('event:ai-error', (p) => {
      if (p.messageId) failAiMessage(p.messageId, p.error)
      else toast.danger(p.error)
    })
    // AI 停止录制：把完整草稿交给现有的保存对话框
    const offAiDraft = window.atp.on('event:ai-recording-draft', (p) => {
      if (!Array.isArray(p.steps)) return
      useUiStore.getState().setDraftRecording(p)
      useUiStore.getState().setRightTab('steps')
    })
    // AI 修改用例：只收起建议，等用户在 diff 卡里确认
    const offAiProposal = window.atp.on('event:ai-case-proposal', (p) => {
      useUiStore.getState().addAiProposal(p)
      useUiStore.getState().setAiOpen(true)
      useUiStore.getState().setRightTab('copilot')
    })
    // SSE 建连 / 重连时的运行快照：清掉错过的 ai-done 留下的转圈状态
    const offAiState = window.atp.on('event:ai-state', (p) => {
      // 只处理「服务端已结束」：running=true 不重建消息，避免停止过程中的竞态
      if (p.running) return
      const store = useUiStore.getState()
      const pending = store.aiMessages.find((message) => message.pending)
      if (pending) store.finishAiMessage(pending.id)
      else if (store.aiRunning) store.setAiRunning(false)
    })
    return () => {
      offStatus()
      offStep()
      offReplay()
      offPlan()
      offAiStart()
      offAiDelta()
      offAiToolStart()
      offAiToolEnd()
      offAiDone()
      offAiError()
      offAiDraft()
      offAiProposal()
      offAiState()
    }
  }, [
    setRecording,
    pushLiveStep,
    setReplayProgress,
    setPlanProgress,
    startAiMessage,
    appendAiDelta,
    startAiTool,
    endAiTool,
    finishAiMessage,
    failAiMessage,
    setReplaying,
    qc,
  ])

  // 拖拽右侧面板：向左拖动变宽，宽度持久化到本地
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = rightWidth
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (moveEvent: PointerEvent): void => {
      setRightWidth(startWidth + (startX - moveEvent.clientX))
    }
    const onUp = (): void => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
        <AppBar />
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[288px] shrink-0 flex-col border-r border-border bg-surface">
            <LeftSidebar />
          </aside>
          <main className="flex min-w-0 flex-1 flex-col">
            <BrowserStage />
          </main>
          {!launchMode && (
            <>
              <hr
                aria-orientation="vertical"
                aria-label="调整右侧面板宽度"
                onPointerDown={beginResize}
                className="m-0 w-1 shrink-0 cursor-col-resize border-0 transition-colors hover:bg-accent/30"
              />
              <aside
                className="flex shrink-0 flex-col border-l border-border bg-surface"
                style={{ width: rightWidth }}
              >
                <RightPanel />
              </aside>
            </>
          )}
        </div>
        <StatusBar />
      </div>
      <SaveCaseDialog />
      <AiSettingsDialog />
      <CommandPalette />
      <Toast.Provider placement="bottom end" />
    </>
  )
}
