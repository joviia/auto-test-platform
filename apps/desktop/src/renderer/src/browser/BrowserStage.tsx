import { Button, Input } from '@heroui/react'
import { useQueryClient } from '@tanstack/react-query'
import { Circle, Play, Plus, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../state/ui-store'

export function BrowserStage() {
  const stageRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')
  const [replaying, setReplaying] = useState(false)
  const recording = useUiStore((s) => s.recording)
  const url = useUiStore((s) => s.url)
  const setUrl = useUiStore((s) => s.setUrl)
  const resetLiveSteps = useUiStore((s) => s.resetLiveSteps)
  const setDraftRecording = useUiStore((s) => s.setDraftRecording)
  const selected = useUiStore((s) => s.selected)
  const qc = useQueryClient()

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const report = () => {
      const r = el.getBoundingClientRect()
      void window.atp.invoke('view:bounds-set', {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const open = async (): Promise<void> => {
    if (!input.trim()) return
    await window.atp.invoke('browser:navigate', { url: input.trim() })
    setUrl(input.trim())
  }

  const toggleRecording = async (): Promise<void> => {
    if (!recording) {
      resetLiveSteps()
      await window.atp.invoke('recording:start')
    } else {
      const result = await window.atp.invoke('recording:stop')
      setDraftRecording(result)
    }
  }

  const replay = async (): Promise<void> => {
    if (selected?.kind !== 'case') return
    setReplaying(true)
    try {
      await window.atp.invoke('replay:start', { caseId: selected.id })
      void qc.invalidateQueries({ queryKey: ['runs'] })
    } finally {
      setReplaying(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-default-200 p-2">
        <Input
          className="flex-1"
          placeholder="输入被测页面地址（https://… 或本地文件路径）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button onPress={() => void open()}>打开</Button>
        <Button variant={recording ? 'danger' : 'primary'} onPress={() => void toggleRecording()}>
          {recording ? <Square size={14} /> : <Circle size={14} fill="currentColor" />}
          {recording ? '停止录制' : '开始录制'}
        </Button>
        {recording && (
          <Button
            variant="secondary"
            onPress={() => void window.atp.invoke('recording:assert-arm')}
          >
            <Plus size={14} />
            断言
          </Button>
        )}
        <Button
          variant="primary"
          isDisabled={selected?.kind !== 'case' || replaying}
          onPress={() => void replay()}
        >
          <Play size={14} fill="currentColor" />
          {replaying ? '回放中…' : '回放选中用例'}
        </Button>
      </div>
      <div ref={stageRef} className="relative min-h-0 flex-1 bg-default-100">
        {replaying && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black/60 text-lg text-white">
            回放中：Playwright 独立 Chromium 窗口执行中，完成后见右栏「报告」
          </div>
        )}
        {!url && !recording && (
          <div className="absolute inset-0 grid place-items-center text-default-400">
            输入地址打开受控浏览器
          </div>
        )}
      </div>
    </div>
  )
}
