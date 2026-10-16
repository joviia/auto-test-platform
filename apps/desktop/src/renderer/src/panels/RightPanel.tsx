import { Tab, TabList, TabPanel, TabsRoot } from '@heroui/react'
import { ElementPanel } from '../elements/ElementPanel'
import { useUiStore } from '../state/ui-store'
import { StepPanel } from '../steps/StepPanel'

export function RightPanel() {
  const recording = useUiStore((s) => s.recording)
  const liveSteps = useUiStore((s) => s.liveSteps)

  return (
    <TabsRoot className="flex h-full flex-col">
      <TabList className="border-b border-default-200 px-2">
        <Tab id="steps">步骤</Tab>
        <Tab id="elements">元素</Tab>
        <Tab id="report">报告</Tab>
      </TabList>
      <TabPanel id="steps" className="min-h-0 flex-1 overflow-auto">
        {recording ? (
          <div className="p-3 text-sm">
            <p className="mb-2 text-default-400">
              录制中：操作中间的受控浏览器，步骤实时出现（「＋断言」后点选目标即插断言）
            </p>
            <ol className="space-y-1">
              {liveSteps.map((s, i) => (
                <li key={`${s.ts}-${i}`} className="rounded bg-default-100 px-2 py-1">
                  <span className="font-medium">
                    {i + 1}. {s.action === 'assert' ? '断言(可见)' : s.action}
                  </span>{' '}
                  <span className="text-default-500">
                    {s.target.name || s.target.text || s.target.tag}
                    {s.value !== undefined ? ` = ${s.value}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <StepPanel />
        )}
      </TabPanel>
      <TabPanel id="elements" className="min-h-0 flex-1 overflow-auto">
        <ElementPanel />
      </TabPanel>
      <TabPanel id="report" className="min-h-0 flex-1 overflow-auto p-3 text-sm">
        <p className="text-default-400">执行记录与报告（T10 接入）</p>
      </TabPanel>
    </TabsRoot>
  )
}
