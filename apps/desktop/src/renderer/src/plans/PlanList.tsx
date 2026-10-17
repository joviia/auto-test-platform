import type { PlanRow, SuiteRow } from '@atp/model'
import { Button, Dropdown, toast } from '@heroui/react'
import { useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Circle,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { qk, usePlans, useSuites } from '../api/client'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyHint } from '../components/EmptyHint'
import { useUiStore } from '../state/ui-store'
import { PlanDialog, SuiteDialog } from './PlanDialogs'

const STATUS_META: Record<
  NonNullable<PlanRow['lastRunStatus']>,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  running: { label: '执行中', className: 'text-accent', icon: Loader2 },
  passed: { label: '通过', className: 'text-green-600 dark:text-green-400', icon: CheckCircle2 },
  failed: { label: '失败', className: 'text-red-600 dark:text-red-400', icon: XCircle },
  cancelled: { label: '已取消', className: 'text-muted', icon: Circle },
}

function StatusChip({ status }: { status: PlanRow['lastRunStatus'] }) {
  if (!status) return null
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <span className={`flex shrink-0 items-center gap-1 text-[10px] ${meta.className}`}>
      <Icon size={11} className={status === 'running' ? 'animate-spin' : ''} />
      {meta.label}
    </span>
  )
}

export function PlanList() {
  const selected = useUiStore((s) => s.selected)
  const setSelected = useUiStore((s) => s.setSelected)
  const currentProjectId = useUiStore((s) => s.currentProjectId)
  const qc = useQueryClient()

  const { data: suites = [] } = useSuites(currentProjectId)
  const { data: plans = [] } = usePlans(currentProjectId)

  const [suiteDialog, setSuiteDialog] = useState<{ id?: string } | null>(null)
  const [planDialog, setPlanDialog] = useState<{ id?: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: 'suite' | 'plan'
    id: string
    name: string
  } | null>(null)

  const remove = async (): Promise<void> => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.kind === 'suite') {
        await window.atp.invoke('suite:delete', { id: deleteTarget.id })
        void qc.invalidateQueries({ queryKey: currentProjectId ? qk.suites(currentProjectId) : [] })
        toast.success('套件已删除')
      } else {
        await window.atp.invoke('plan:delete', { id: deleteTarget.id })
        if (selected?.kind === 'plan' && selected.id === deleteTarget.id) setSelected(null)
        if (currentProjectId) {
          void qc.invalidateQueries({ queryKey: qk.plans(currentProjectId) })
          void qc.invalidateQueries({ queryKey: qk.planRuns(deleteTarget.id) })
        }
        toast.success('计划已删除')
      }
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '删除失败')
    }
  }

  const projectReady = Boolean(currentProjectId)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold tracking-tight">测试资产</h2>
          <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted">
            {suites.length + plans.length}
          </span>
        </div>
        <Dropdown.Root>
          <Dropdown.Trigger
            aria-label="新建测试资产"
            className="grid size-7 place-items-center rounded-md text-muted outline-none hover:bg-default hover:text-foreground"
          >
            <Plus size={15} />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu
              onAction={(key) => {
                if (key === 'suite') setSuiteDialog({})
                else setPlanDialog({})
              }}
            >
              <Dropdown.Item id="suite" textValue="新建套件" isDisabled={!projectReady}>
                新建套件
              </Dropdown.Item>
              <Dropdown.Item id="plan" textValue="新建计划" isDisabled={!projectReady}>
                新建测试计划
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown.Root>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!projectReady ? (
          <EmptyHint icon={ListChecks} title="先创建一个项目" compact />
        ) : suites.length === 0 && plans.length === 0 ? (
          <EmptyHint
            icon={ListChecks}
            title="还没有测试计划"
            description="先把用例组织成套件，再创建计划批量执行。"
            action={
              <Button size="sm" variant="primary" onPress={() => setPlanDialog({})}>
                <Plus size={14} />
                新建测试计划
              </Button>
            }
            compact
          />
        ) : (
          <div className="space-y-4">
            <section>
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  套件
                </span>
                <span className="text-[10px] text-muted">{suites.length}</span>
              </div>
              {suites.length === 0 ? (
                <p className="px-1 py-1.5 text-[11px] text-muted">还没有套件</p>
              ) : (
                <div className="space-y-1">
                  {suites.map((suite: SuiteRow) => (
                    <div
                      key={suite.id}
                      className="group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-secondary"
                    >
                      <ListChecks size={13} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate">{suite.name}</span>
                      <span className="shrink-0 text-[10px] text-muted">{suite.caseCount} 条</span>
                      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => setSuiteDialog({ id: suite.id })}
                          className="grid size-6 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
                          aria-label="编辑套件"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({ kind: 'suite', id: suite.id, name: suite.name })
                          }
                          className="grid size-6 place-items-center rounded text-muted hover:bg-danger/10 hover:text-danger"
                          aria-label="删除套件"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  计划
                </span>
                <span className="text-[10px] text-muted">{plans.length}</span>
              </div>
              {plans.length === 0 ? (
                <p className="px-1 py-1.5 text-[11px] text-muted">还没有测试计划</p>
              ) : (
                <div className="space-y-1">
                  {plans.map((plan: PlanRow) => {
                    const active = selected?.kind === 'plan' && selected.id === plan.id
                    return (
                      <div
                        key={plan.id}
                        className={`group flex items-center rounded-md pr-1 text-[13px] ${
                          active
                            ? 'bg-accent/10 font-medium text-accent'
                            : 'hover:bg-surface-secondary'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelected({ kind: 'plan', id: plan.id })}
                          className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left outline-none"
                        >
                          <StatusChip status={plan.lastRunStatus} />
                          <span className="min-w-0 flex-1 truncate">{plan.name}</span>
                          <span className="shrink-0 text-[10px] text-muted">
                            {plan.caseCount} 条
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => setPlanDialog({ id: plan.id })}
                            className="grid size-6 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
                            aria-label="编辑计划"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteTarget({ kind: 'plan', id: plan.id, name: plan.name })
                            }
                            className="grid size-6 place-items-center rounded text-muted hover:bg-danger/10 hover:text-danger"
                            aria-label="删除计划"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted">
        <span>
          {suites.length} 个套件 · {plans.length} 个计划
        </span>
        <span>本地执行</span>
      </div>

      {suiteDialog && currentProjectId && (
        <SuiteDialog
          open
          projectId={currentProjectId}
          suiteId={suiteDialog.id}
          onClose={() => setSuiteDialog(null)}
        />
      )}
      {planDialog && currentProjectId && (
        <PlanDialog
          open
          projectId={currentProjectId}
          planId={planDialog.id}
          onClose={() => setPlanDialog(null)}
          onSaved={(id) => setSelected({ kind: 'plan', id })}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          isOpen
          onOpenChange={() => setDeleteTarget(null)}
          title={`删除${deleteTarget.kind === 'suite' ? '套件' : '计划'}「${deleteTarget.name}」？`}
          description={
            deleteTarget.kind === 'suite'
              ? '删除套件不会删除用例；已创建的计划保留自己的用例快照。'
              : '计划及其历史执行记录将被删除，用例本身不受影响。'
          }
          confirmLabel="删除"
          onConfirm={remove}
        />
      )}
    </div>
  )
}
