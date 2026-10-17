import { Tab, TabIndicator, TabList, TabListContainer, TabPanel, TabsRoot } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { qk } from '../api/client'
import { ElementPanel } from '../elements/ElementPanel'
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
  const recording = useUiStore((s) => s.recording)
  const liveSteps = useUiStore((s) => s.liveSteps)
  const draftRecording = useUiStore((s) => s.draftRecording)
  const caseId = selected?.kind === 'case' ? selected.id : null
  const [tab, setTab] = useState('steps')

  // 开始录制 / 停止待保存时都回到「步骤」页
  useEffect(() => {
    if (recording || draftRecording) setTab('steps')
  }, [recording, draftRecording])

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
      onSelectionChange={(key) => setTab(String(key))}
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
    </TabsRoot>
  )
}
