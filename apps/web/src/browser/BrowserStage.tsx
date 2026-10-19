import { Button, Tooltip, toast } from '@heroui/react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Circle,
  Globe,
  House,
  ListChecks,
  Loader2,
  MonitorPlay,
  MonitorSmartphone,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Square,
  Video,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyHint } from '../components/EmptyHint'
import { useElapsed } from '../hooks/use-elapsed'
import { Launchpad } from '../launch/Launchpad'
import { RunReview } from '../review/RunReview'
import {
  type DeviceOrientation,
  type DevicePresetId,
  type DeviceZoom,
  type ReplayMode,
  useUiStore,
} from '../state/ui-store'
import { DEVICE_PRESETS, deviceSize, getDevicePreset } from './devices'
import { LiveMirror } from './LiveMirror'

const ZOOM_OPTIONS: Array<{ value: DeviceZoom; label: string }> = [
  { value: 'fit', label: '适应舞台' },
  { value: 0.5, label: '50%' },
  { value: 0.75, label: '75%' },
  { value: 1, label: '100%' },
  { value: 1.25, label: '125%' },
]

interface FrameRect {
  left: number
  top: number
  width: number
  height: number
  scale: number
}

const selectClass =
  'h-7 rounded-md border border-border bg-field px-1.5 text-[11px] text-foreground outline-none focus:border-accent/60 disabled:opacity-50'

export function BrowserStage() {
  const stageRef = useRef<HTMLDivElement>(null)
  const webMode = window.atp.mode === 'web'
  const [input, setInput] = useState('')
  const [frame, setFrame] = useState<FrameRect | null>(null)
  const [domOverlay, setDomOverlay] = useState(false)

  const recording = useUiStore((s) => s.recording)
  const recordingStartedAt = useUiStore((s) => s.recordingStartedAt)
  const url = useUiStore((s) => s.url)
  const setUrl = useUiStore((s) => s.setUrl)
  const resetLiveSteps = useUiStore((s) => s.resetLiveSteps)
  const setDraftRecording = useUiStore((s) => s.setDraftRecording)
  const selected = useUiStore((s) => s.selected)
  const setSelected = useUiStore((s) => s.setSelected)
  const overlayDepth = useUiStore((s) => s.overlayDepth)
  const devicePresetId = useUiStore((s) => s.devicePresetId)
  const deviceOrientation = useUiStore((s) => s.deviceOrientation)
  const deviceZoom = useUiStore((s) => s.deviceZoom)
  const setDevice = useUiStore((s) => s.setDevice)
  const replayMode = useUiStore((s) => s.replayMode)
  const setReplayMode = useUiStore((s) => s.setReplayMode)
  const replaying = useUiStore((s) => s.replaying)
  const setReplaying = useUiStore((s) => s.setReplaying)
  const draftRecording = useUiStore((s) => s.draftRecording)
  const selectedRunId = useUiStore((s) => s.selectedRunId)
  const replayProgress = useUiStore((s) => s.replayProgress)
  const setReplayProgress = useUiStore((s) => s.setReplayProgress)
  const planProgress = useUiStore((s) => s.planProgress)
  const navTab = useUiStore((s) => s.navTab)
  const aiRunning = useUiStore((s) => s.aiRunning)
  const aiStartedAt = useUiStore((s) => s.aiStartedAt)
  const aiActiveTool = useUiStore((s) => s.aiActiveTool)
  const aiTarget = useUiStore((s) => s.aiTarget)
  const setAiOpen = useUiStore((s) => s.setAiOpen)
  const setRightTab = useUiStore((s) => s.setRightTab)
  const qc = useQueryClient()
  const elapsed = useElapsed(recordingStartedAt)
  const aiElapsed = useElapsed(aiStartedAt)

  const preset = getDevicePreset(devicePresetId)
  const size = deviceSize(preset, deviceOrientation)
  const planRunning = Boolean(planProgress && planProgress.phase !== 'run-end')
  const busy = recording || replaying || planRunning

  // 外部（回放/计划执行）设置 url 时同步地址栏
  useEffect(() => {
    if (url) setInput(url)
  }, [url])

  // 原生视图层级高于 renderer：任何与舞台相交的浮层（弹窗 / 下拉菜单）
  // 出现时都要暂时收起视图，否则浮层会被原生页面盖住。
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const intersectsStage = (): boolean => {
      const s = stage.getBoundingClientRect()
      const selector = [
        '[data-slot="dropdown-popover"]:not([data-exiting="true"])',
        '[data-slot="modal-backdrop"]:not([data-exiting="true"])',
        '[data-slot="alert-dialog-backdrop"]:not([data-exiting="true"])',
      ].join(',')
      return Array.from(document.querySelectorAll(selector)).some((el) => {
        const r = el.getBoundingClientRect()
        return r.bottom > s.top && r.top < s.bottom && r.right > s.left && r.left < s.right
      })
    }
    const check = (): void => setDomOverlay(intersectsStage())
    // 浮层刚插入时还没有布局（rect 全 0），等一帧再量
    let raf = 0
    const schedule = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(check)
      })
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-slot', 'data-exiting', 'data-entering'],
    })
    window.addEventListener('resize', check)
    schedule()
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [])

  const hideForOverlay = overlayDepth > 0 || domOverlay

  // 计算设备显示区域（保持比例、居中）；visible=false 时收起视图
  const computeLayout = useCallback(
    (
      visible: boolean,
    ): {
      bounds: { x: number; y: number; width: number; height: number }
      frame: FrameRect | null
    } | null => {
      const el = stageRef.current
      if (!el) return null
      const r = el.getBoundingClientRect()
      if (!visible) {
        return { bounds: { x: 0, y: 0, width: 0, height: 0 }, frame: null }
      }
      if (preset.width === 0) {
        return {
          bounds: {
            x: Math.round(r.left),
            y: Math.round(r.top),
            width: Math.round(r.width),
            height: Math.round(r.height),
          },
          frame: null,
        }
      }

      const padding = 24
      // 顶部留出设备标签的高度，避免竖屏设备贴顶时标签被隐藏
      const topReserve = 24
      const availW = Math.max(120, r.width - padding * 2)
      const availH = Math.max(120, r.height - padding * 2 - topReserve)
      const fit = Math.min(availW / size.width, availH / size.height)
      const scale = deviceZoom === 'fit' ? fit : Math.min(deviceZoom, fit)
      const w = Math.max(1, Math.round(size.width * scale))
      const h = Math.max(1, Math.round(size.height * scale))
      const left = Math.round((r.width - w) / 2)
      const top = Math.round(padding + topReserve + (availH - h) / 2)
      return {
        bounds: {
          x: Math.round(r.left + left),
          y: Math.round(r.top + top),
          width: w,
          height: h,
        },
        frame: { left, top, width: w, height: h, scale },
      }
    },
    [preset.width, size.width, size.height, deviceZoom],
  )

  // 同步原生视图 bounds（web 模式下页面在真实 Chrome 窗口里，无需同步）
  useEffect(() => {
    if (webMode) {
      setFrame(null)
      return
    }
    const el = stageRef.current
    if (!el) return
    const report = (): void => {
      const layout = computeLayout(Boolean(url) && !hideForOverlay)
      if (!layout) return
      setFrame(layout.frame)
      void window.atp.invoke('view:bounds-set', layout.bounds)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [webMode, url, hideForOverlay, computeLayout])

  // 设备模拟：自适应 = 清除 override；预设 = 固定 CSS 视口
  useEffect(() => {
    if (preset.width === 0) {
      void window.atp.invoke('view:emulate', { clear: true })
      return
    }
    void window.atp
      .invoke('view:emulate', {
        width: size.width,
        height: size.height,
        deviceScaleFactor: preset.deviceScaleFactor,
        mobile: preset.mobile,
      })
      .catch((err: unknown) => {
        toast.danger(err instanceof Error ? err.message : '设备模拟失败')
      })
  }, [preset.width, preset.deviceScaleFactor, preset.mobile, size.width, size.height])

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

  const focusChrome = async (): Promise<void> => {
    try {
      await window.atp.invoke('browser:focus')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '唤起 Chrome 窗口失败')
    }
  }

  const toggleRecording = async (): Promise<void> => {
    try {
      if (!recording) {
        resetLiveSteps()
        await window.atp.invoke('recording:start')
        toast.success(webMode ? '开始录制：操作真实 Chrome 窗口即可' : '开始录制：操作中间页面即可')
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
      const file = await window.atp.invoke('case:get', { id: selected.id })
      setInput(file.case.startUrl)
      setUrl(file.case.startUrl)
      // 先确保原生视图可见并拿到非零 viewport，再启动回放（否则点击会落在 0×0 视口外）
      const layout = computeLayout(true)
      if (layout) {
        setFrame(layout.frame)
        await window.atp.invoke('view:bounds-set', layout.bounds)
      }
      setReplayProgress({ runId: null, index: 0, total: file.case.steps.length })
      await window.atp.invoke('replay:start', { caseId: selected.id, mode: replayMode })
      void qc.invalidateQueries({ queryKey: ['runs'] })
      toast.success(replayMode === 'embedded' ? '回放完成，结果见右侧「报告」' : '独立窗口回放完成')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '回放失败')
    } finally {
      setReplaying(false)
      setReplayProgress(null)
    }
  }

  const stopAi = async (): Promise<void> => {
    try {
      await window.atp.invoke('ai:cancel', {})
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '停止 Copilot 失败')
    }
  }

  const takeoverAi = async (): Promise<void> => {
    await stopAi()
    await focusChrome()
  }

  const showAiPanel = (): void => {
    setAiOpen(true)
    setRightTab('copilot')
  }

  const stopReplay = async (): Promise<void> => {
    try {
      await window.atp.invoke('replay:stop')
      toast.info('正在停止回放…')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '停止回放失败')
    }
  }

  const toggleOrientation = (): void => {
    const next: DeviceOrientation = deviceOrientation === 'portrait' ? 'landscape' : 'portrait'
    setDevice({ orientation: next })
  }

  // 回到启动台：只收起舞台，不关闭 Chrome 里的页面
  const goHome = (): void => {
    setUrl('')
    setInput('')
    setSelected(null)
  }

  if (selectedRunId) return <RunReview runId={selectedRunId} />
  if (!url && !recording && !draftRecording && !replaying && !planRunning) {
    return <Launchpad />
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <Tooltip.Root>
          <Tooltip.Trigger>
            <button
              type="button"
              onClick={goHome}
              disabled={recording || draftRecording !== null || busy}
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-default hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              aria-label="返回启动台"
            >
              <House size={15} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>返回启动台（不关闭 Chrome）</Tooltip.Content>
        </Tooltip.Root>
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
          isDisabled={!input.trim() || busy}
          onPress={() => void open()}
        >
          打开
        </Button>

        <Button
          size="sm"
          variant={recording ? 'danger' : 'primary'}
          isDisabled={replaying || planRunning}
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
          isDisabled={selected?.kind !== 'case' || busy}
          onPress={() => void replay()}
        >
          {replaying ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {replaying ? '回放中…' : '回放用例'}
        </Button>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 text-[11px]">
        <MonitorSmartphone size={13} className="shrink-0 text-muted" />
        <select
          className={selectClass}
          value={devicePresetId}
          disabled={busy}
          onChange={(e) => setDevice({ presetId: e.target.value as DevicePresetId })}
          aria-label="设备预设"
        >
          {DEVICE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.width ? ` ${p.width}×${p.height}` : ''}
            </option>
          ))}
        </select>
        {preset.rotatable && (
          <button
            type="button"
            onClick={toggleOrientation}
            disabled={busy}
            className="grid size-6 place-items-center rounded text-muted hover:bg-default hover:text-foreground disabled:opacity-40"
            aria-label="切换横竖屏"
          >
            <RotateCcw size={12} />
          </button>
        )}
        <select
          className={selectClass}
          value={String(deviceZoom)}
          disabled={busy || preset.width === 0}
          onChange={(e) =>
            setDevice({
              zoom: e.target.value === 'fit' ? 'fit' : (Number(e.target.value) as DeviceZoom),
            })
          }
          aria-label="缩放"
        >
          {ZOOM_OPTIONS.map((z) => (
            <option key={String(z.value)} value={String(z.value)}>
              {z.label}
            </option>
          ))}
        </select>
        <span className="truncate text-muted">
          {preset.width === 0
            ? '跟随舞台'
            : `${size.width} × ${size.height} · ${Math.round((frame?.scale ?? 1) * 100)}%`}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-muted">回放方式</span>
          <select
            className={selectClass}
            value={replayMode}
            disabled={replaying}
            onChange={(e) => setReplayMode(e.target.value as ReplayMode)}
            aria-label="回放方式"
          >
            <option value="embedded">{webMode ? '当前 Chrome 窗口' : '中栏嵌入'}</option>
            <option value="standalone">独立窗口（录视频）</option>
          </select>
        </div>
      </div>

      {recording && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-red-500/20 bg-red-500/[0.06] px-3 text-xs">
          <span className="atp-rec-dot size-2 rounded-full bg-red-500" />
          <span className="font-medium text-red-600 dark:text-red-400">录制中</span>
          <span className="font-mono tabular-nums text-red-600/80 dark:text-red-400/80">
            {elapsed}
          </span>
          <span className="ml-1 truncate text-muted">
            {webMode ? '操作真实 Chrome 窗口' : '操作中间的页面'}
            ，步骤实时出现在右侧；点击「断言」后点选目标即可插入断言
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

      {planRunning && !recording && !replaying && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-accent/25 bg-accent/[0.06] px-3 text-xs">
          <Loader2 size={13} className="animate-spin text-accent" />
          <span className="font-medium text-accent">计划执行中</span>
          <span className="min-w-0 flex-1 truncate text-muted">
            {planProgress?.caseName || '准备执行'} · 第 {planProgress?.attempt ?? 1} 次
          </span>
          <span className="shrink-0 font-mono text-muted">
            {Math.min((planProgress?.caseIndex ?? 0) + 1, planProgress?.caseTotal ?? 0)}/
            {planProgress?.caseTotal ?? 0}
          </span>
        </div>
      )}

      {aiRunning && (
        <div
          role="status"
          aria-live="polite"
          className="flex h-9 shrink-0 items-center gap-2 border-b border-accent/30 bg-accent/[0.07] px-3 text-xs"
        >
          <Loader2 size={13} className="animate-spin text-accent" />
          <span className="shrink-0 font-medium text-accent">Copilot</span>
          <span className="min-w-0 flex-1 truncate text-muted">
            {aiActiveTool ? `正在${aiActiveTool.label}…` : '正在读取页面并规划下一步…'}
          </span>
          <span className="shrink-0 font-mono tabular-nums text-muted">{aiElapsed}</span>
          <button
            type="button"
            onClick={showAiPanel}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/10"
          >
            查看步骤
          </button>
          <Button size="sm" variant="secondary" onPress={() => void takeoverAi()}>
            <MonitorPlay size={11} />
            接管
          </Button>
          <Button size="sm" variant="secondary" onPress={() => void stopAi()}>
            <Square size={10} fill="currentColor" />
            停止
          </Button>
        </div>
      )}

      {replaying && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-accent/25 bg-accent/[0.06] px-3 text-xs">
          <Loader2 size={13} className="animate-spin text-accent" />
          <span className="font-medium text-accent">
            {replayMode === 'embedded'
              ? webMode
                ? '真实 Chrome 回放中'
                : '中栏回放中'
              : '独立窗口回放中'}
          </span>
          {replayProgress && replayProgress.total > 0 && (
            <span className="font-mono tabular-nums text-muted">
              {replayProgress.index}/{replayProgress.total}
            </span>
          )}
          <span className="ml-1 truncate text-muted">
            {replayMode === 'embedded'
              ? webMode
                ? '页面会在真实 Chrome 窗口中可见地执行；完成后结果写入右侧「报告」'
                : '页面会在中栏可见地执行；完成后结果写入右侧「报告」'
              : 'Playwright 独立 Chromium 窗口执行中，完成后结果写入右侧「报告」'}
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto"
            onPress={() => void stopReplay()}
          >
            停止回放
          </Button>
        </div>
      )}

      <div ref={stageRef} className="atp-stage relative min-h-0 flex-1 overflow-hidden">
        {webMode ? (
          <LiveMirror
            highlight={aiTarget}
            paused={hideForOverlay}
            onTakeover={() => void focusChrome()}
          />
        ) : (
          !url &&
          !recording && (
            <div className="absolute inset-0 grid place-items-center">
              {navTab === 'plans' ? (
                <EmptyHint
                  icon={ListChecks}
                  title="执行计划后，页面会在这里运行"
                  description="在右侧选择测试计划并点击「执行计划」；用例会按顺序在中栏可见地执行。"
                />
              ) : (
                <EmptyHint
                  icon={Globe}
                  title="打开被测页面，开始录制"
                  description="在上方输入网址（或本地 HTML 文件路径）后回车。录制期间在页面上的点击、输入、选择与按键都会自动沉淀为步骤。"
                />
              )}
            </div>
          )
        )}

        {frame && (
          <div
            className="pointer-events-none absolute rounded-sm outline outline-1 outline-border/80"
            style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
          >
            <span className="absolute -top-5 left-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted shadow-surface">
              {preset.name} · {size.width}×{size.height} · {Math.round(frame.scale * 100)}%
            </span>
          </div>
        )}

        {recording && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-red-500/70" />
        )}
        {replaying && replayMode === 'embedded' && (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-accent/70" />
        )}

        {replaying && replayMode === 'standalone' && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/70 backdrop-blur-[2px]">
            <div className="atp-fade-in flex items-center gap-3 rounded-lg border border-border bg-surface px-5 py-4 shadow-overlay">
              <Loader2 size={18} className="animate-spin text-accent" />
              <div>
                <p className="text-sm font-medium">独立窗口回放中</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                  <Video size={11} />
                  Chromium 独立窗口执行并录制视频，完成后在右侧「报告」查看
                </p>
                {replayProgress && replayProgress.total > 0 && (
                  <p className="mt-1 font-mono text-xs text-muted">
                    {replayProgress.index}/{replayProgress.total}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
