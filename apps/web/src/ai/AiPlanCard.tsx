import type { Step } from '@atp/model'
import { Button, toast } from '@heroui/react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ExternalLink,
  FileCheck2,
  Loader2,
  Pencil,
  Play,
  Save,
  Sparkles,
  Square,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { SaveCaseDialog } from '../recording/SaveCaseDialog'
import { type AiPlanProposal, useUiStore } from '../state/ui-store'
import { actionMeta, stepPreview } from '../steps/step-meta'

const VERB: Record<string, string> = {
  click: '点击',
  fill: '填写',
  select: '选择',
  press: '按键',
  scroll: '滚动',
  wait: '等待',
  assert: '断言',
}

function stepLabel(step: Step): string {
  const verb = step.display?.verb ?? VERB[step.action] ?? actionMeta(step.action).label
  const field = step.display?.field
  const value = step.display?.value ?? stepPreview(step)
  const head = field ? `${verb}「${field}」` : verb
  return value ? `${head} · ${value}` : head
}

function editableField(step: Step): 'value' | 'key' | 'expected' | null {
  if (step.action === 'fill' || step.action === 'select') return 'value'
  if (step.action === 'press') return 'key'
  if (
    step.action === 'assert' &&
    step.assertion &&
    'expected' in step.assertion &&
    typeof step.assertion.expected === 'string'
  ) {
    return 'expected'
  }
  return null
}

function readEditable(step: Step): string {
  if (step.action === 'fill' || step.action === 'select') {
    return typeof step.params?.value === 'string' ? step.params.value : ''
  }
  if (step.action === 'press') {
    return typeof step.params?.key === 'string' ? step.params.key : ''
  }
  if (step.action === 'assert' && step.assertion && 'expected' in step.assertion) {
    return step.assertion.expected === undefined ? '' : String(step.assertion.expected)
  }
  return ''
}

function withEditable(step: Step, value: string): Step {
  if (step.action === 'fill' || step.action === 'select') {
    return {
      ...step,
      params: { ...step.params, value },
      ...(step.display ? { display: { ...step.display, value } } : {}),
    }
  }
  if (step.action === 'press') {
    return {
      ...step,
      params: { ...step.params, key: value },
      ...(step.display ? { display: { ...step.display, value } } : {}),
    }
  }
  if (step.action === 'assert' && step.assertion && 'expected' in step.assertion) {
    return {
      ...step,
      assertion: { ...step.assertion, expected: value } as Step['assertion'],
      ...(step.display ? { display: { ...step.display, value } } : {}),
    }
  }
  return step
}

function statusIcon(plan: AiPlanProposal, step: Step) {
  const result = plan.stepResults[step.id]
  if (!result) {
    return <span className="size-3.5 rounded-full border border-border" />
  }
  if (result.status === 'failed') {
    return <XCircle size={13} className="text-red-600 dark:text-red-400" />
  }
  return <Check size={13} className="text-emerald-600 dark:text-emerald-400" />
}

function StatusChip({ plan }: { plan: AiPlanProposal }) {
  if (plan.status === 'running') {
    return (
      <span className="flex items-center gap-0.5 rounded bg-accent/10 px-1.5 py-px text-[10px] font-medium text-accent">
        <Loader2 size={9} className="animate-spin" />
        执行中
      </span>
    )
  }
  if (plan.status === 'passed') {
    return (
      <span className="flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <Check size={9} />
        已通过
      </span>
    )
  }
  if (plan.status === 'failed') {
    return (
      <span className="flex items-center gap-0.5 rounded bg-red-500/10 px-1.5 py-px text-[10px] font-medium text-red-600 dark:text-red-400">
        <XCircle size={9} />
        未通过
      </span>
    )
  }
  if (plan.status === 'saved') {
    return (
      <span className="flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <FileCheck2 size={9} />
        {plan.verified ? '已保存' : '已保存 · 未验证'}
      </span>
    )
  }
  return (
    <span className="rounded bg-surface-secondary px-1.5 py-px text-[10px] text-muted">待执行</span>
  )
}

export function AiPlanCard({ plan }: { plan: AiPlanProposal }) {
  const patchAiPlan = useUiStore((s) => s.patchAiPlan)
  const updateAiPlanFile = useUiStore((s) => s.updateAiPlanFile)
  const removeAiPlan = useUiStore((s) => s.removeAiPlan)
  const setSelected = useUiStore((s) => s.setSelected)
  const setNavTab = useUiStore((s) => s.setNavTab)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)

  const steps = plan.caseFile.case.steps
  const running = plan.status === 'running'
  const locked = running || plan.status === 'saved'
  const passedCount = steps.filter((step) => plan.stepResults[step.id]?.status === 'passed').length

  const saveDraft = useMemo(
    () => ({
      steps,
      elements: plan.caseFile.elements,
      startUrl: plan.startUrl,
      intent: plan.summary,
    }),
    [steps, plan.caseFile.elements, plan.startUrl, plan.summary],
  )

  const updateSteps = (next: Step[]): void => {
    updateAiPlanFile(plan.proposalId, {
      ...plan.caseFile,
      case: { ...plan.caseFile.case, steps: next },
    })
    // 改过步骤后，之前的执行结果不再代表当前草稿
    patchAiPlan(plan.proposalId, {
      status: 'pending',
      stepResults: {},
      verified: false,
      error: undefined,
    })
  }

  const move = (index: number, offset: number): void => {
    const next = [...steps]
    const target = index + offset
    if (target < 0 || target >= next.length) return
    const [step] = next.splice(index, 1)
    if (!step) return
    next.splice(target, 0, step)
    updateSteps(next)
  }

  const removeStep = (stepId: string): void => {
    if (steps.length <= 1) {
      toast.info('计划至少保留一个步骤')
      return
    }
    updateSteps(steps.filter((step) => step.id !== stepId))
  }

  const setStepValue = (stepId: string, value: string): void => {
    updateSteps(steps.map((step) => (step.id === stepId ? withEditable(step, value) : step)))
  }

  const execute = async (): Promise<void> => {
    if (running) {
      try {
        await window.atp.invoke('ai:plan-stop')
        toast.info('正在停止计划…')
      } catch (err) {
        toast.danger(err instanceof Error ? err.message : '停止计划失败')
      }
      return
    }
    patchAiPlan(plan.proposalId, {
      status: 'running',
      error: undefined,
      stepResults: {},
    })
    try {
      await window.atp.invoke('ai:plan-run', {
        proposalId: plan.proposalId,
        caseFile: plan.caseFile,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '执行计划失败'
      patchAiPlan(plan.proposalId, { status: 'failed', error: message })
      toast.danger(message)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded bg-accent/10 text-accent">
          <Sparkles size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[11.5px] font-semibold">AI 计划</span>
            <span className="truncate text-[10.5px] text-muted">{plan.name}</span>
            <span className="ml-auto shrink-0">
              <StatusChip plan={plan} />
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-foreground/85">{plan.summary}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted">
            <span>{steps.length} 步</span>
            {plan.status !== 'pending' && (
              <span>
                · {passedCount}/{steps.length} 通过
              </span>
            )}
            <span className="truncate" title={plan.startUrl}>
              · 起始页 {plan.startUrl}
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled={running}
          onClick={() => removeAiPlan(plan.proposalId)}
          className="grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-default hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          aria-label="关闭计划"
          title="关闭"
        >
          <X size={11} />
        </button>
      </div>

      <div className="mt-1.5 max-h-52 overflow-y-auto rounded-md border border-border bg-surface-secondary/60 p-1">
        {steps.map((step, index) => {
          const result = plan.stepResults[step.id]
          const editable = editableField(step)
          return (
            <div key={step.id} className="rounded px-1 py-0.5">
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-[1.7]">
                <span className="w-3 shrink-0 text-center font-mono text-[10px] text-muted">
                  {index + 1}
                </span>
                {statusIcon(plan, step)}
                <span
                  className="min-w-0 flex-1 truncate text-foreground/90"
                  title={stepLabel(step)}
                >
                  {stepLabel(step)}
                </span>
                {result?.skipped && <span className="shrink-0 text-[9px] text-muted">已跳过</span>}
                {result !== undefined && (
                  <span className="shrink-0 font-mono text-[9px] text-muted">
                    {result.durationMs}ms
                  </span>
                )}
                {!locked && (
                  <div className="flex shrink-0 items-center gap-0.5">
                    {editable && (
                      <button
                        type="button"
                        onClick={() => setEditingId(editingId === step.id ? null : step.id)}
                        className="grid size-4 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
                        aria-label={`编辑第 ${index + 1} 步`}
                        title="编辑值"
                      >
                        <Pencil size={9} />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      className="grid size-4 place-items-center rounded text-muted hover:bg-default hover:text-foreground disabled:opacity-30"
                      aria-label={`上移第 ${index + 1} 步`}
                      title="上移"
                    >
                      <ArrowUp size={9} />
                    </button>
                    <button
                      type="button"
                      disabled={index === steps.length - 1}
                      onClick={() => move(index, 1)}
                      className="grid size-4 place-items-center rounded text-muted hover:bg-default hover:text-foreground disabled:opacity-30"
                      aria-label={`下移第 ${index + 1} 步`}
                      title="下移"
                    >
                      <ArrowDown size={9} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStep(step.id)}
                      className="grid size-4 place-items-center rounded text-muted hover:bg-danger/10 hover:text-danger"
                      aria-label={`删除第 ${index + 1} 步`}
                      title="删除步骤"
                    >
                      <Trash2 size={9} />
                    </button>
                  </div>
                )}
              </div>
              {result?.error && (
                <p className="ml-9 mt-0.5 break-words rounded bg-red-500/[0.06] px-1.5 py-1 text-[10px] leading-4 text-red-700 dark:text-red-400">
                  {result.error}
                </p>
              )}
              {result?.screenshotUrl && (
                <a
                  href={result.screenshotUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-9 mt-1 block overflow-hidden rounded border border-border"
                  title={`第 ${index + 1} 步截图`}
                >
                  <img
                    src={result.screenshotUrl}
                    alt={`第 ${index + 1} 步截图`}
                    className="max-h-28 w-full object-cover object-top"
                  />
                </a>
              )}
              {editingId === step.id && editable && (
                <div className="ml-9 mt-1 flex items-center gap-1.5">
                  <input
                    // biome-ignore lint/a11y/noAutofocus: 编辑值由用户主动点开
                    autoFocus
                    value={readEditable(step)}
                    onChange={(event) => setStepValue(step.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === 'Escape') setEditingId(null)
                    }}
                    className="h-6 min-w-0 flex-1 rounded border border-border bg-field px-1.5 text-[11px] outline-none focus:border-accent/60"
                    aria-label={`编辑第 ${index + 1} 步的值`}
                  />
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="text-[10px] text-accent hover:underline"
                  >
                    完成
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {plan.error && (
        <p className="mt-1.5 break-words rounded bg-red-500/[0.06] px-2 py-1.5 text-[10.5px] leading-4 text-red-700 dark:text-red-400">
          {plan.error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {plan.status === 'saved' && plan.savedCaseId ? (
          <>
            <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400">
              已保存为用例「{plan.savedCaseName ?? plan.name}」
            </span>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                setSelected({ kind: 'case', id: plan.savedCaseId as string })
                setNavTab('cases')
              }}
            >
              <ExternalLink size={11} />
              打开用例
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant={running ? 'secondary' : 'primary'}
              onPress={() => void execute()}
            >
              {running ? <Square size={10} fill="currentColor" /> : <Play size={11} />}
              {running ? '停止' : '在中栏执行'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={running}
              onPress={() => setSaveOpen(true)}
            >
              <Save size={11} />
              保存为用例
            </Button>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={running}
              onPress={() => removeAiPlan(plan.proposalId)}
            >
              放弃
            </Button>
            {plan.status === 'passed' && (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400">已验证</span>
            )}
            {plan.status === 'failed' && (
              <span className="text-[10px] text-muted">保存时标记未验证</span>
            )}
          </>
        )}
      </div>

      {saveOpen && (
        <SaveCaseDialog
          draft={saveDraft}
          defaultName={plan.name}
          title="保存为用例"
          onClose={() => setSaveOpen(false)}
          onSaved={(saved) => {
            patchAiPlan(plan.proposalId, {
              status: 'saved',
              savedCaseId: saved.case.id,
              savedCaseName: saved.case.name,
              verified: plan.status === 'passed',
            })
            setSaveOpen(false)
          }}
        />
      )}
    </div>
  )
}

export function AiPlanList() {
  const plans = useUiStore((s) => s.aiPlans)
  if (plans.length === 0) return null
  return (
    <div className="max-h-[46vh] shrink-0 space-y-2 overflow-y-auto border-t border-border bg-surface px-2.5 py-2">
      {plans.map((plan) => (
        <AiPlanCard key={plan.proposalId} plan={plan} />
      ))}
    </div>
  )
}
