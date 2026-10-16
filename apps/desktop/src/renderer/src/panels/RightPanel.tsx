import { Tab, TabList, TabPanel, TabsRoot } from '@heroui/react'
import { useUiStore } from '../state/ui-store'

export function RightPanel() {
  const recording = useUiStore((s) => s.recording)
  const liveSteps = useUiStore((s) => s.liveSteps)
  const selected = useUiStore((s) => s.selected)

  return (
    <TabsRoot className="flex h-full flex-col">
      <TabList className="border-b border-default-200 px-2">
        <Tab id="steps">步骤</Tab>
        <Tab id="elements">元素</Tab>
        <Tab id="report">报告</Tab>
      </TabList>
      <TabPanel id="steps" className="min-h-0 flex-1 overflow-auto p-3 text-sm">
        {recording ? (
          liveSteps.length === 0 ? (
            <p className="text-default-400">
              录制中：在中间的受控浏览器里操作，步骤会实时出现在这里
            </p>
          ) : (
            <ol className="space-y-1">
              {liveSteps.map((s, i) => (
                <li key={`${s.ts}-${i}`} className="rounded bg-default-100 px-2 py-1">
                  <span className="font-medium">
                    {i + 1}. {s.action}
                  </span>{' '}
                  <span className="text-default-500">
                    {s.target.name || s.target.text || s.target.tag}
                    {s.value !== undefined ? ` = ${s.value}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )
        ) : selected?.kind === 'case' ? (
          <p className="text-default-400">用例已选中：编辑器在 T9 接入</p>
        ) : (
          <p className="text-default-400">选中用例后可编辑步骤</p>
        )}
      </TabPanel>
      <TabPanel id="elements" className="min-h-0 flex-1 overflow-auto p-3 text-sm">
        <p className="text-default-400">元素库（T9 接入）</p>
      </TabPanel>
      <TabPanel id="report" className="min-h-0 flex-1 overflow-auto p-3 text-sm">
        <p className="text-default-400">执行记录与报告（T10 接入）</p>
      </TabPanel>
    </TabsRoot>
  )
}
