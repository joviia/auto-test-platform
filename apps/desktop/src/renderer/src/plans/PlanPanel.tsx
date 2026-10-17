import type { PlanRunRow, RunRow, RunStepRow } from '@atp/model'
import { Button, Tooltip, toast } from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ListChecks,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { qk, useCases, usePlan, usePlanRun, usePlanRuns } from '../api/client'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyHint } from '../components/EmptyHint'
import { useUiStore } from '../state/ui-store'
import { ACTION_META } from '../steps/step-meta'
import { PlanDialog } from './PlanDialogs'

const STATUS_META: Record<
  PlanRunRow['status'],
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  running: { label: '执行中', className: 'text-accent', icon: Loader2 },
  passed: { label: '通过', className: 'text-green-600 dark:text-green-400', icon: CheckCircle2 },
  failed: { label: '失败', className: 'text-red-600 dark:text-red-400', icon: XCircle },
  cancelled: { label: '已取消', className: 'text-muted', icon: Circle },
}

function toEvidenceUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  const idx = path.indexOf('runs/')
  if (idx < 0) return undefined
  return `atp-evidence://${path.slice(idx + 5)}`
}

function formatTime(value: string | null | undefined): string {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function RunStatus({ status, size = 12 }: { status: PlanRunRow['status']; size?: number }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <Icon
      size={size}
      className={`${meta.className} ${status === 'running' ? 'animate-spin' : ''}`}
    />
  )
}

function CaseRunSteps({ runId }: { runId: string }) {
  const { data } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => window.atp.invoke('run:get', { runId }),
  })
  if (!data) return <p className="mt-1 text-[11px] text-muted">加载步骤…</p>
  return (
    <div className="mt-1 space-y-1 border-t border-border pt-1.5">
      {data.steps.map((step: RunStepRow) => {
        const meta = ACTION_META[step.action]
        return (
          <div key={step.id} className="rounded bg-surface-secondary px-1.5 py-1 text-[11px]">
            <div className="flex items-center gap-1.5">
              {step.status === 'passed' ? (
                <CheckCircle2 size={10} className="text-green-600 dark:text-green-400" />
              ) : (
                <XCircle size={10} className="text-red-600 dark:text-red-400" />
              )}
              <span className="font-mono text-[10px] text-muted">#{step.idx + 1}</span>
              <span
                className={meta.className
                  .split(' ')
                  .filter((c) => c.startsWith('text-'))
                  .join(' ')}
              >
                {meta.label}
              </span>
              <span className="text-[10px] text-muted">{step.durationMs}ms</span>
            </div>
            {step.error && <p className="mt-0.5 text-red-600 dark:text-red-400">{step.error}</p>}
            {step.assertion && step.assertion.type !== 'visible' && (
              <p className="mt-0.5 text-muted">
                期望「{step.assertion.expected ?? ''}」实际「{step.assertion.actual ?? ''}」
              </p>
            )}
            {step.screenshotPath && (
              <img
                src={toEvidenceUrl(step.screenshotPath)}
                alt={`步骤${step.idx + 1}`}
                className="mt-1 max-h-28 w-full rounded object-cover object-top"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function PlanPanel({ planId }: { planId: string }) {
  const qc = useQueryClient()
  const setUrl = useUiStore((s) => s.setUrl)
  const setSelected = useUiStore((s) => s.setSelected)
  const planProgress = useUiStore((s) => s.planProgress)
  const setPlanProgress = useUiStore((s) => s.setPlanProgress)
  const recording = useUiStore((s) => s.recording)

  const { data: detail } = usePlan(planId)
  const { data: runs = [] } = usePlanRuns(planId)
  const casesProjectId = detail?.plan.projectId ?? null
  const { data: cases = [] } = useCases(casesProjectId)

  const [running, setRunning] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [expandedCase, setExpandedCase] = useState<string | null>(null)

  const { data: runDetail } = usePlanRun(selectedRunId)

  useEffect(() => {
    setSelectedRunId(runs[0]?.id ?? null)
    setExpandedCase(null)
  }, [runs])

  useEffect(() => {
    if (!planId) return
    setSelectedRunId(null)
    setExpandedCase(null)
    setRunning(false)
  }, [planId])

  const caseById = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases])

  const runsByCase = useMemo(() => {
    const map = new Map<string, { run: RunRow; attempts: number }>()
    if (!runDetail) return map
    const grouped = new Map<string, typeof runDetail.runs>()
    for (const item of runDetail.runs) {
      const list = grouped.get(item.run.caseId) ?? []
      list.push(item)
      grouped.set(item.run.caseId, list)
    }
    for (const [caseId, list] of grouped) {
      const sorted = [...list].sort((a, b) => (b.run.attempt ?? 1) - (a.run.attempt ?? 1))
      map.set(caseId, { run: sorted[0].run, attempts: list.length })
    }
    return map
  }, [runDetail])

  /** 当前选中执行里失败（或取消时未跑完）的用例，按计划顺序重跑 */
  const failedCaseIds = useMemo(() => {
    if (!detail) return []
    const failed = new Set<string>()
    for (const [caseId, result] of runsByCase) {
      if (result.run.status !== 'passed') failed.add(caseId)
    }
    return detail.caseIds.filter((id) => failed.has(id))
  }, [detail, runsByCase])

  const runPlan = async (onlyCaseIds?: string[]): Promise<void> => {
    if (!detail) return
    const targets = onlyCaseIds ?? detail.caseIds
    if (targets.length === 0) return
    if (recording) {
      toast.danger('录制进行中，请先停止录制')
      return
    }
    setRunning(true)
    setPlanProgress(null)
    try {
      const first = await window.atp.invoke('case:get', { id: targets[0] })
      // 先让中栏视图可见，主进程会等待 bounds 就绪
      setUrl(first.case.startUrl)
      await new Promise((resolve) => setTimeout(resolve, 200))
      await window.atp.invoke('plan:run-start', { planId, caseIds: onlyCaseIds })
      toast.success(
        onlyCaseIds
          ? `失败用例重跑完成（${targets.length} 条），结果已写入执行记录`
          : '计划执行完成，结果已写入执行记录',
      )
      if (detail) {
        void qc.invalidateQueries({ queryKey: qk.planRuns(planId) })
        void qc.invalidateQueries({ queryKey: qk.plan(planId) })
        void qc.invalidateQueries({ queryKey: qk.plans(detail.plan.projectId) })
      }
      void qc.invalidateQueries({ queryKey: ['runs'] })
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '计划执行失败')
    } finally {
      setRunning(false)
      setPlanProgress(null)
    }
  }

  const stopPlan = async (): Promise<void> => {
    try {
      await window.atp.invoke('plan:run-stop')
      toast.info('正在停止计划执行…')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '停止失败')
    }
  }

  const removePlan = async (): Promise<void> => {
    try {
      await window.atp.invoke('plan:delete', { id: planId })
      if (detail) {
        void qc.invalidateQueries({ queryKey: qk.plans(detail.plan.projectId) })
        void qc.invalidateQueries({ queryKey: qk.planRuns(planId) })
      }
      setSelected(null)
      toast.success('计划已删除')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '删除失败')
    }
  }

  if (!detail) {
    return <div className="p-3 text-xs text-muted">加载计划…</div>
  }

  const { plan, caseIds } = detail
  const progress = running && planProgress && planProgress.planRunId ? planProgress : null

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{plan.name}</span>
          <Tooltip.Root>
            <Tooltip.Trigger>
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={running}
                className="grid size-7 place-items-center rounded-md text-muted outline-none hover:bg-default hover:text-foreground disabled:opacity-40"
                aria-label="编辑计划"
              >
                <Pencil size={13} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content>编辑计划</Tooltip.Content>
          </Tooltip.Root>
          <Tooltip.Root>
            <Tooltip.Trigger>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={running}
                className="grid size-7 place-items-center rounded-md text-muted outline-none hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                aria-label="删除计划"
              >
                <Trash2 size={13} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content>删除计划</Tooltip.Content>
          </Tooltip.Root>
          <Button
            size="sm"
            variant={running ? 'danger' : 'primary'}
            isDisabled={caseIds.length === 0 || (recording && !running)}
            onPress={() => void (running ? stopPlan() : runPlan())}
          >
            {running ? <Square size={12} fill="currentColor" /> : <Play size={12} />}
            {running ? '停止' : '执行计划'}
          </Button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
          <span className="rounded bg-surface-secondary px-1.5 py-0.5">
            {caseIds.length} 条用例
          </span>
          <span className="rounded bg-surface-secondary px-1.5 py-0.5">重试 {plan.retries} 次</span>
          <span className="rounded bg-surface-secondary px-1.5 py-0.5">
            超时 {Math.round(plan.timeoutMs / 1000)}s
          </span>
          <span className="rounded bg-surface-secondary px-1.5 py-0.5">
            {plan.continueOnFailure ? '失败继续' : '失败即停'}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        {progress && (
          <div className="rounded-md border border-accent/30 bg-accent/[0.04] p-2">
            <div className="flex items-center gap-1.5 text-[11px]">
              <Loader2 size={12} className="animate-spin text-accent" />
              <span className="font-medium text-accent">
                {progress.phase === 'run-end' ? '计划执行完成' : '计划执行中'}
              </span>
              <span className="ml-auto font-mono text-muted">
                {Math.min(progress.caseIndex + 1, progress.caseTotal)}/{progress.caseTotal}
              </span>
            </div>
            <p className="mt-1 truncate text-[12px]">{progress.caseName || plan.name}</p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
              <span>第 {progress.attempt} 次</span>
              {progress.stepIndex !== undefined && progress.stepTotal !== undefined && (
                <span>
                  步骤 {progress.stepIndex}/{progress.stepTotal}
                </span>
              )}
              {progress.status === 'retrying' && (
                <span className="text-amber-600 dark:text-amber-400">重试中</span>
              )}
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-secondary">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{
                  width: `${Math.min(100, Math.round((progress.caseIndex / Math.max(1, progress.caseTotal)) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}

        <section>
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              执行记录
            </span>
            <span className="text-[10px] text-muted">{runs.length}</span>
          </div>
          {runs.length === 0 ? (
            <p className="px-1 py-1.5 text-[11px] text-muted">还没有执行记录</p>
          ) : (
            <div className="space-y-1">
              {runs.map((run) => {
                const active = selectedRunId === run.id
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => {
                      setSelectedRunId(run.id)
                      setExpandedCase(null)
                    }}
                    className={`flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[12px] ${
                      active
                        ? 'border-accent/40 bg-accent/5'
                        : 'border-border hover:bg-surface-secondary'
                    }`}
                  >
                    <RunStatus status={run.status} />
                    <span className="min-w-0 flex-1 truncate">{formatTime(run.startedAt)}</span>
                    <span className="shrink-0 text-[10px] text-muted">
                      {run.passed} 通过 / {run.failed} 失败
                    </span>
                    {active ? (
                      <ChevronDown size={12} className="shrink-0 text-muted" />
                    ) : (
                      <ChevronRight size={12} className="shrink-0 text-muted" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {!running && failedCaseIds.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-1.5 w-full"
              onPress={() => void runPlan(failedCaseIds)}
            >
              <RotateCcw size={12} />
              重跑本次失败用例（{failedCaseIds.length}）
            </Button>
          )}
        </section>

        <section>
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">用例</span>
            <span className="text-[10px] text-muted">{caseIds.length}</span>
          </div>
          {caseIds.length === 0 ? (
            <EmptyHint icon={ListChecks} title="计划里还没有用例" compact />
          ) : (
            <div className="space-y-1">
              {caseIds.map((caseId) => {
                const caseRow = caseById.get(caseId)
                const result = runsByCase.get(caseId)
                const expanded = expandedCase === caseId
                const isCurrent = progress?.caseId === caseId
                return (
                  <div
                    key={caseId}
                    className={`rounded-md border ${
                      isCurrent
                        ? 'border-accent/50 bg-accent/[0.04]'
                        : expanded
                          ? 'border-accent/30'
                          : 'border-border'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedCase(expanded ? null : caseId)}
                      disabled={!result}
                      className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[12px] disabled:cursor-default"
                    >
                      {result ? (
                        <RunStatus status={result.run.status} />
                      ) : (
                        <Circle size={12} className="text-muted" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{caseRow?.name ?? caseId}</span>
                      {result && result.attempts > 1 && (
                        <span className="shrink-0 rounded bg-warning/10 px-1 text-[10px] text-warning">
                          尝试 {result.attempts} 次
                        </span>
                      )}
                      {result?.run.error && (
                        <span className="max-w-[100px] shrink-0 truncate text-[10px] text-red-600 dark:text-red-400">
                          {result.run.error}
                        </span>
                      )}
                      {result &&
                        (expanded ? (
                          <ChevronDown size={12} className="shrink-0 text-muted" />
                        ) : (
                          <ChevronRight size={12} className="shrink-0 text-muted" />
                        ))}
                    </button>
                    {expanded && result && <CaseRunSteps runId={result.run.id} />}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {editing && (
        <PlanDialog
          open
          projectId={plan.projectId}
          planId={planId}
          onClose={() => setEditing(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          isOpen
          onOpenChange={setConfirmDelete}
          title={`删除计划「${plan.name}」？`}
          description="计划及其历史执行记录将被删除，用例本身不受影响。"
          confirmLabel="删除"
          onConfirm={removePlan}
        />
      )}
    </div>
  )
}
