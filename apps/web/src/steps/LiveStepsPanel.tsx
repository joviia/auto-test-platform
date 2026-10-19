import { MousePointerClick, Radio } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { EmptyHint } from '../components/EmptyHint'
import { useElapsed } from '../hooks/use-elapsed'
import { useUiStore } from '../state/ui-store'
import { actionMeta } from './step-meta'

/** 录制中的实时步骤流：事件到达即追加，停止后交给 StepPanel 编辑 */
export function LiveStepsPanel() {
  const liveSteps = useUiStore((s) => s.liveSteps)
  const recordingStartedAt = useUiStore((s) => s.recordingStartedAt)
  const elapsed = useElapsed(recordingStartedAt)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (liveSteps.length === 0) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [liveSteps.length])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Radio size={13} className="text-red-500" />
        <span className="text-[13px] font-medium text-red-600 dark:text-red-400">录制中</span>
        <span className="font-mono text-[11px] tabular-nums text-red-600/80 dark:text-red-400/80">
          {elapsed}
        </span>
        <span className="ml-auto text-[11px] text-muted">{liveSteps.length} 步</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {liveSteps.length === 0 ? (
          <EmptyHint
            icon={MousePointerClick}
            title="等待你的第一次操作…"
            description="在中间页面点击、输入或选择，步骤会实时出现在这里。点击工具栏「断言」后点选元素可插入断言。"
            compact
          />
        ) : (
          <div className="space-y-1.5">
            {liveSteps.map((step, idx) => {
              const meta = actionMeta(step.action)
              const label =
                step.action === 'scroll'
                  ? '页面'
                  : step.target.name ||
                    step.target.text ||
                    step.target.placeholder ||
                    step.target.tag
              const value =
                step.action === 'scroll'
                  ? `(${step.x ?? 0}, ${step.y ?? 0})`
                  : step.action === 'drag'
                    ? `Δ${step.dx ?? 0}, ${step.dy ?? 0}`
                    : (step.value ?? step.key)
              return (
                <div
                  key={`${step.ts}-${idx}`}
                  className="atp-fade-in flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px]"
                >
                  <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted">
                    {idx + 1}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {value !== undefined && value !== '' && (
                    <span className="max-w-[140px] shrink-0 truncate font-mono text-[11px] text-muted">
                      = {value}
                    </span>
                  )}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted">
        停止录制后可编辑、拖拽排序并保存为用例
      </div>
    </div>
  )
}
