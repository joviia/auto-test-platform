import { Button, Tooltip, toast } from '@heroui/react'
import { useQueryClient } from '@tanstack/react-query'
import { Circle, Globe, Loader2, Play, Plus, RotateCw, Square, Video } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { EmptyHint } from '../components/EmptyHint'
import { useElapsed } from '../hooks/use-elapsed'
import { useUiStore } from '../state/ui-store'

export function BrowserStage() {
  const stageRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState('')
  const [replaying, setReplaying] = useState(false)

  const recording = useUiStore((s) => s.recording)
  const recordingStartedAt = useUiStore((s) => s.recordingStartedAt)
  const url = useUiStore((s) => s.url)
  const setUrl = useUiStore((s) => s.setUrl)
  const resetLiveSteps = useUiStore((s) => s.resetLiveSteps)
  const setDraftRecording = useUiStore((s) => s.setDraftRecording)
  const selected = useUiStore((s) => s.selected)
  const qc = useQueryClient()
  const elapsed = useElapsed(recordingStartedAt)

  // 原生 WebContentsView 覆盖在舞台区域；未打开页面时收起，避免遮住空状态
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const report = (): void => {
      const r = el.getBoundingClientRect()
      const visible = Boolean(url)
      void window.atp.invoke('view:bounds-set', {
        x: visible ? Math.round(r.left) : 0,
        y: visible ? Math.round(r.top) : 0,
        width: visible ? Math.round(r.width) : 0,
        height: visible ? Math.round(r.height) : 0,
      })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [url])

  const open = async (target = input): Promise<void> => {
    const value = target.trim()
    if (!value) return
    try {
      await window.atp.invoke('browser:navigate', { url: value })
      setUrl(value)
      setInput(value)
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '打开页面失败')
    }
  }

  const toggleRecording = async (): Promise<void> => {
    try {
      if (!recording) {
        resetLiveSteps()
        await window.atp.invoke('recording:start')
        toast.success('开始录制：操作中间页面即可')
      } else {
        const result = await window.atp.invoke('recording:stop')
        setDraftRecording(result)
      }
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '录制状态切换失败')
    }
  }

  const armAssertion = async (): Promise<void> => {
    try {
      await window.atp.invoke('recording:assert-arm')
      toast.info('断言已就绪：点击页面上的目标元素即可插入「可见」断言')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '断言拾取失败')
    }
  }

  const replay = async (): Promise<void> => {
    if (selected?.kind !== 'case') return
    setReplaying(true)
    try {
      await window.atp.invoke('replay:start', { caseId: selected.id })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      toast.success('回放完成，结果见右侧「报告」')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '回放失败')
    } finally {
      setReplaying(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface-secondary px-2.5 transition-colors focus-within:border-accent/60 focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent/15">
          <Globe size={14} className="shrink-0 text-muted" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void open()
            }}
            placeholder="输入被测页面地址，回车打开（https://… 或本地文件路径）"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted"
            spellCheck={false}
          />
          {url && (
            <Tooltip.Root>
              <Tooltip.Trigger>
                <button
                  type="button"
                  onClick={() => void open(url)}
                  className="grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
                  aria-label="刷新页面"
                >
                  <RotateCw size={12} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content>重新加载</Tooltip.Content>
            </Tooltip.Root>
          )}
        </div>

        <Button
          size="sm"
          variant="secondary"
          isDisabled={!input.trim() || recording}
          onPress={() => void open()}
        >
          打开
        </Button>

        <Button
          size="sm"
          variant={recording ? 'danger' : 'primary'}
          onPress={() => void toggleRecording()}
        >
          {recording ? (
            <Square size={12} fill="currentColor" />
          ) : (
            <Circle size={12} fill="currentColor" />
          )}
          {recording ? '停止录制' : '开始录制'}
        </Button>

        <div className="mx-0.5 h-5 w-px bg-separator" />

        <Button
          size="sm"
          variant="secondary"
          isDisabled={selected?.kind !== 'case' || replaying || recording}
          onPress={() => void replay()}
        >
          {replaying ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {replaying ? '回放中…' : '回放用例'}
        </Button>
      </div>

      {recording && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-red-500/20 bg-red-500/[0.06] px-3 text-xs">
          <span className="atp-rec-dot size-2 rounded-full bg-red-500" />
          <span className="font-medium text-red-600 dark:text-red-400">录制中</span>
          <span className="font-mono tabular-nums text-red-600/80 dark:text-red-400/80">
            {elapsed}
          </span>
          <span className="ml-1 truncate text-muted">
            操作中间的页面，步骤实时出现在右侧；点击「断言」后点选目标即可插入断言
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onPress={() => void armAssertion()}
          >
            <Plus size={12} />
            断言
          </Button>
        </div>
      )}

      <div ref={stageRef} className="atp-stage relative min-h-0 flex-1 overflow-hidden">
        {!url && !recording && (
          <div className="absolute inset-0 grid place-items-center">
            <EmptyHint
              icon={Globe}
              title="打开被测页面，开始录制"
              description="在上方输入网址（或本地 HTML 文件路径）后回车。录制期间在页面上的点击、输入、选择与按键都会自动沉淀为步骤。"
            />
          </div>
        )}

        {recording && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-red-500/70" />
        )}

        {replaying && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/70 backdrop-blur-[2px]">
            <div className="atp-fade-in flex items-center gap-3 rounded-lg border border-border bg-surface px-5 py-4 shadow-overlay">
              <Loader2 size={18} className="animate-spin text-accent" />
              <div>
                <p className="text-sm font-medium">Playwright 回放中</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  <Video size={11} />
                  独立 Chromium 窗口执行，完成后在右侧「报告」查看证据
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
