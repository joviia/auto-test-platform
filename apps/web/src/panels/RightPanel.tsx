import { Tab, TabIndicator, TabList, TabListContainer, TabPanel, TabsRoot } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { ListChecks, Wrench } from 'lucide-react'
import { useEffect } from 'react'
import { AiPanel } from '../ai/AiPanel'
import { qk } from '../api/client'
import { EmptyHint } from '../components/EmptyHint'
import { ElementPanel } from '../elements/ElementPanel'
import { PlanPanel } from '../plans/PlanPanel'
import { SkillPanel } from '../skills/SkillPanel'
import { useUiStore } from '../state/ui-store'
import { DraftStepsPanel } from '../steps/DraftStepsPanel'
import { LiveStepsPanel } from '../steps/LiveStepsPanel'
import { StepPanel } from '../steps/StepPanel'
import { ReportPanel } from './ReportPanel'

function CountBadge({ value }: { value: number }) {
  return (
    <span className="ml-1 rounded-full bg-default px-1.5 py-px text-[10px] font-medium text-muted tabular-nums">
      {value}
    </span>
  )
}

export function RightPanel() {
  const selected = useUiStore((s) => s.selected)
  const navTab = useUiStore((s) => s.navTab)
  const aiOpen = useUiStore((s) => s.aiOpen)
  const rightTab = useUiStore((s) => s.rightTab)

  // AI 是全局的：即使当前停在计划上，AI 面板也能占住右侧
  if (aiOpen && rightTab === 'ai') return <CaseRightPanel />
  if (navTab === 'skills' && !aiOpen) {
    if (selected?.kind === 'skill') return <SkillPanel skillId={selected.id} />
    return (
      <EmptyHint
        icon={Wrench}
        title="选择一个操作"
        description="操作库把滑块、上传、悬浮菜单等复杂控件封装成可复用的确定性技能，AI 可以直接调用。"
      />
    )
  }
  if (selected?.kind === 'plan') return <PlanPanel planId={selected.id} />
  if (navTab === 'plans' && !aiOpen) {
    return (
      <EmptyHint
        icon={ListChecks}
        title="选择或新建测试计划"
        description="左侧选择计划查看执行记录，或点击「新建测试计划」把用例组织成批量回归。"
      />
    )
  }
  return <CaseRightPanel />
}

function CaseRightPanel() {
  const selected = useUiStore((s) => s.selected)
  const recording = useUiStore((s) => s.recording)
  const liveSteps = useUiStore((s) => s.liveSteps)
  const draftRecording = useUiStore((s) => s.draftRecording)
  const selectedRunId = useUiStore((s) => s.selectedRunId)
  const tab = useUiStore((s) => s.rightTab)
  const setTab = useUiStore((s) => s.setRightTab)
  const aiOpen = useUiStore((s) => s.aiOpen)
  const setAiOpen = useUiStore((s) => s.setAiOpen)
  const aiRunning = useUiStore((s) => s.aiRunning)
  const caseId = selected?.kind === 'case' ? selected.id : null

  // 开始录制 / 停止待保存时都回到「步骤」页
  useEffect(() => {
    if (recording || draftRecording) setTab('steps')
  }, [recording, draftRecording, setTab])

  // 在舞台中打开运行记录时，右侧直接切到报告（AI 正在执行时不抢焦点）
  useEffect(() => {
    if (selectedRunId) {
      const state = useUiStore.getState()
      if (!state.aiRunning) setTab('report')
    }
  }, [selectedRunId, setTab])

  // 记住的 AI 页签在启动台模式下也要让右侧面板出现
  useEffect(() => {
    if (tab === 'ai' && !aiOpen) setAiOpen(true)
  }, [tab, aiOpen, setAiOpen])

  // 与 StepPanel/ElementPanel 共用同一 query key，用于标签计数
  const { data: file } = useQuery({
    queryKey: caseId ? qk.caseFile(caseId) : ['case', 'none'],
    queryFn: () => window.atp.invoke('case:get', { id: caseId as string }),
    enabled: Boolean(caseId),
  })
  const { data: runs = [] } = useQuery({
    queryKey: ['runs', caseId ?? 'all'],
    queryFn: () => window.atp.invoke('run:list', caseId ? { caseId } : {}),
  })

  const stepCount = recording
    ? liveSteps.length
    : draftRecording
      ? draftRecording.steps.length
      : (file?.case.steps.length ?? 0)
  const elementCount = file ? Object.keys(file.elements).length : 0

  return (
    <TabsRoot
      variant="secondary"
      className="flex h-full flex-col"
      selectedKey={tab}
      onSelectionChange={(key) => {
        const next = String(key)
        setTab(next as typeof tab)
        if (next === 'ai') setAiOpen(true)
        // 从计划上下文临时打开 AI 后，切回其它页签应回到计划面板
        else if (selected?.kind === 'plan') setAiOpen(false)
      }}
    >
      <TabListContainer className="h-[52px] shrink-0 px-3">
        <TabList className="h-full gap-0">
          <Tab id="steps" className="h-full flex-1 justify-center text-[13px]">
            步骤
            <CountBadge value={stepCount} />
            <TabIndicator />
          </Tab>
          <Tab id="elements" className="h-full flex-1 justify-center text-[13px]">
            元素
            <CountBadge value={elementCount} />
            <TabIndicator />
          </Tab>
          <Tab id="report" className="h-full flex-1 justify-center text-[13px]">
            报告
            <CountBadge value={runs.length} />
            <TabIndicator />
          </Tab>
          <Tab id="ai" className="h-full flex-1 justify-center text-[13px]">
            AI
            {aiRunning && <span className="ml-1 size-1.5 animate-pulse rounded-full bg-accent" />}
            <TabIndicator />
          </Tab>
        </TabList>
      </TabListContainer>
      <TabPanel id="steps" className="min-h-0 flex-1 overflow-hidden">
        {recording ? <LiveStepsPanel /> : draftRecording ? <DraftStepsPanel /> : <StepPanel />}
      </TabPanel>
      <TabPanel id="elements" className="min-h-0 flex-1 overflow-hidden">
        <ElementPanel />
      </TabPanel>
      <TabPanel id="report" className="min-h-0 flex-1 overflow-hidden">
        <ReportPanel />
      </TabPanel>
      <TabPanel id="ai" className="min-h-0 flex-1 overflow-hidden">
        <AiPanel />
      </TabPanel>
    </TabsRoot>
  )
}
