import type { RunStepRow } from '@atp/model'
import { Button, Tooltip } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, ExternalLink, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyHint } from '../components/EmptyHint'
import { toEvidenceUrl } from '../lib/evidence'
import { useUiStore } from '../state/ui-store'

const ACTION_LABEL: Record<string, string> = {
  click: '点击',
  fill: '填写',
  select: '选择',
  press: '按键',
  assert: '断言',
  scroll: '滚动',
  wait: '等待',
  drag: '拖拽',
}

function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return '—'
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime()
  return `${(ms / 1000).toFixed(1)}s`
}

function StepThumb({ step }: { step: RunStepRow }) {
  const src = toEvidenceUrl(step.screenshotPath)
  return (
    <span className="relative block h-7 w-10 shrink-0 overflow-hidden rounded border border-border bg-surface-secondary">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="grid h-full w-full place-items-center text-[8px] text-muted">
          {ACTION_LABEL[step.action] ?? step.action}
        </span>
      )}
      <span
        className={`absolute bottom-0 right-0 size-1.5 rounded-tl ${
          step.status === 'passed' ? 'bg-green-500' : 'bg-red-500'
        }`}
      />
    </span>
  )
}

export function RunReview({ runId }: { runId: string }) {
  const setSelectedRunId = useUiStore((s) => s.setSelectedRunId)
  const { data, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => window.atp.invoke('run:get', { runId }),
  })
  const [stepIdx, setStepIdx] = useState(0)

  const run = data?.run
  const steps = data?.steps ?? []

  // 打开运行记录时直接停在失败步骤，减少一次点击
  useEffect(() => {
    if (!data) return
    const failed = data.steps.findIndex((step) => step.status === 'failed')
    setStepIdx(failed >= 0 ? failed : 0)
  }, [data])

  const step = steps[stepIdx]
  const screenshot = toEvidenceUrl(step?.screenshotPath)
  const passed = steps.filter((item) => item.status === 'passed').length
  const failed = steps.length - passed

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <button
          type="button"
          onClick={() => setSelectedRunId(null)}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-default hover:text-foreground"
          aria-label="返回工作台"
        >
          <ArrowLeft size={15} />
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 text-[13px] font-semibold">运行 #{runId.slice(0, 8)}</h2>
          {run && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                run.status === 'passed'
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
              }`}
            >
              {run.status === 'passed' ? '通过' : '失败'}
            </span>
          )}
          {run && (
            <span className="truncate text-[11px] text-muted">
              {run.caseName ?? run.caseId}
              {steps.length > 0 ? ` · ${passed}/${steps.length} 步通过` : ''} ·{' '}
              {formatDuration(run.startedAt, run.finishedAt)}
            </span>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Tooltip.Root>
            <Tooltip.Trigger>
              <Button
                size="sm"
                variant="secondary"
                isDisabled={!run}
                onPress={() => void window.atp.invoke('browser:focus')}
              >
                <ExternalLink size={12} />
                聚焦 Chrome
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>回到真实 Chrome 窗口继续操作</Tooltip.Content>
          </Tooltip.Root>
        </div>
      </div>

      <div className="atp-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
        {screenshot ? (
          <div className="relative flex h-full w-full items-center justify-center">
            <div className="absolute left-2 top-2 z-10 rounded bg-black/75 px-2 py-1 text-[10px] font-medium text-white backdrop-blur">
              运行快照 · 第 {step ? step.idx + 1 : 1} 步
            </div>
            <img
              src={screenshot}
              alt={`第 ${step ? step.idx + 1 : 1} 步截图`}
              className="max-h-full max-w-full rounded-md border border-border object-contain shadow-[0_18px_50px_rgba(10,16,28,0.22)]"
            />
            {step && (
              <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5 rounded bg-black/75 px-2 py-1 text-[10px] text-white backdrop-blur">
                <span className="font-mono text-sky-300">
                  {String(step.idx + 1).padStart(2, '0')}
                </span>
                <span>
                  {ACTION_LABEL[step.action] ?? step.action}
                  {step.durationMs > 0 ? ` · ${step.durationMs}ms` : ''}
                </span>
                {step.status === 'failed' && <span className="text-red-300">失败</span>}
              </div>
            )}
          </div>
        ) : (
          <EmptyHint
            icon={failed > 0 ? XCircle : CheckCircle2}
            title={isLoading ? '正在读取运行记录…' : '这一步没有截图'}
            description={
              isLoading ? '运行证据加载完成后会显示在这里。' : '回放时开启了步骤截图才会有画面。'
            }
          />
        )}
      </div>

      <div className="flex h-16 shrink-0 items-center gap-2 overflow-x-auto border-t border-border bg-surface px-3">
        <span className="shrink-0 pr-1 font-mono text-[9.5px] text-muted">{steps.length} 步</span>
        {steps.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setStepIdx(index)}
            className={`flex w-[148px] shrink-0 items-center gap-2 rounded-md border px-1.5 py-1 text-left ${
              index === stepIdx
                ? item.status === 'failed'
                  ? 'border-red-500/60 bg-red-500/[0.06]'
                  : 'border-accent bg-accent/5'
                : 'border-transparent hover:bg-default'
            }`}
          >
            <StepThumb step={item} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10.5px] font-medium">
                {ACTION_LABEL[item.action] ?? item.action}
              </span>
              <span className="block font-mono text-[9px] text-muted">
                #{item.idx + 1} · {item.durationMs}ms
              </span>
            </span>
            <span
              className={`size-1.5 shrink-0 rounded-full ${
                item.status === 'passed' ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  )
}
