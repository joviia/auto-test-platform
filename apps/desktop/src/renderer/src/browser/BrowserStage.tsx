import { Button, Input } from '@heroui/react'
import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../state/ui-store'

export function BrowserStage() {
  const stageRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')
  const recording = useUiStore((s) => s.recording)
  const url = useUiStore((s) => s.url)
  const setUrl = useUiStore((s) => s.setUrl)
  const resetLiveSteps = useUiStore((s) => s.resetLiveSteps)
  const setDraftRecording = useUiStore((s) => s.setDraftRecording)

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
          {recording ? '■ 停止录制' : '● 开始录制'}
        </Button>
        {recording && (
          <Button
            variant="secondary"
            onPress={() => void window.atp.invoke('recording:assert-arm')}
          >
            ＋断言
          </Button>
        )}
        <Button isDisabled>▶ 回放</Button>
      </div>
      <div ref={stageRef} className="relative min-h-0 flex-1 bg-default-100">
        {!url && !recording && (
          <div className="absolute inset-0 grid place-items-center text-default-400">
            输入地址打开受控浏览器
          </div>
        )}
      </div>
    </div>
  )
}
