import type { Step } from '@atp/model'
import { Button, toast } from '@heroui/react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, CircleAlert, FileDiff, Loader2, Undo2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { qk, useCases } from '../api/client'
import { type AiCaseProposal, useUiStore } from '../state/ui-store'
import { actionMeta, stepPreview } from '../steps/step-meta'

const MAX_VISIBLE_ITEMS = 6

interface DiffItem {
  kind: 'added' | 'removed' | 'changed'
  id: string
  before?: Step
  after?: Step
}

function diffSteps(before: AiCaseProposal['before'], after: AiCaseProposal['after']): DiffItem[] {
  const beforeById = new Map(before.case.steps.map((step) => [step.id, step]))
  const afterById = new Map(after.case.steps.map((step) => [step.id, step]))
  const items: DiffItem[] = []

  for (const step of after.case.steps) {
    const previous = beforeById.get(step.id)
    if (!previous) {
      items.push({ kind: 'added', id: step.id, after: step })
    } else if (JSON.stringify(previous) !== JSON.stringify(step)) {
      items.push({ kind: 'changed', id: step.id, before: previous, after: step })
    }
  }
  for (const step of before.case.steps) {
    if (!afterById.has(step.id)) items.push({ kind: 'removed', id: step.id, before: step })
  }
  return items
}

function isReordered(before: AiCaseProposal['before'], after: AiCaseProposal['after']): boolean {
  const afterIds = new Set(after.case.steps.map((step) => step.id))
  const beforeIds = new Set(before.case.steps.map((step) => step.id))
  const beforeCommon = before.case.steps.filter((step) => afterIds.has(step.id)).map((s) => s.id)
  const afterCommon = after.case.steps.filter((step) => beforeIds.has(step.id)).map((s) => s.id)
  return afterCommon.some((id, index) => id !== beforeCommon[index])
}

function isMetaChanged(before: AiCaseProposal['before'], after: AiCaseProposal['after']): boolean {
  return (
    before.case.name !== after.case.name ||
    before.case.startUrl !== after.case.startUrl ||
    JSON.stringify(before.case.intent) !== JSON.stringify(after.case.intent) ||
    JSON.stringify(before.case.groups) !== JSON.stringify(after.case.groups) ||
    JSON.stringify(before.case.variables) !== JSON.stringify(after.case.variables)
  )
}

function stepLabel(step: Step): string {
  const verb = step.display?.verb ?? actionMeta(step.action).label
  const field = step.display?.field
  const value = step.display?.value ?? stepPreview(step)
  const head = field ? `${verb}「${field}」` : verb
  return value ? `${head} · ${value}` : head
}

function DiffRow({ item }: { item: DiffItem }) {
  const tone =
    item.kind === 'added'
      ? { mark: '+', className: 'text-emerald-600 dark:text-emerald-400' }
      : item.kind === 'removed'
        ? { mark: '−', className: 'text-rose-600 dark:text-rose-400' }
        : { mark: '~', className: 'text-amber-600 dark:text-amber-400' }
  const beforeLabel = item.before ? stepLabel(item.before) : ''
  const afterLabel = item.after ? stepLabel(item.after) : ''

  return (
    <div className="flex min-w-0 items-start gap-1.5 px-1 py-0.5 text-[11px] leading-[1.55]">
      <span className={`w-2 shrink-0 text-center font-mono font-semibold ${tone.className}`}>
        {tone.mark}
      </span>
      {item.kind === 'changed' && beforeLabel !== afterLabel ? (
        <span className="min-w-0 flex-1">
          <span className="text-muted line-through">{beforeLabel}</span>
          <span className="mx-1 text-muted">→</span>
          <span className="text-foreground/90">{afterLabel}</span>
        </span>
      ) : item.kind === 'changed' ? (
        <span className="min-w-0 flex-1 text-foreground/90">「{afterLabel}」参数有调整</span>
      ) : (
        <span
          className={`min-w-0 flex-1 truncate ${
            item.kind === 'removed' ? 'text-muted line-through' : 'text-foreground/90'
          }`}
          title={stepLabel((item.after ?? item.before) as Step)}
        >
          {stepLabel((item.after ?? item.before) as Step)}
        </span>
      )}
    </div>
  )
}

function CountChip({ tone, label }: { tone: 'removed' | 'added' | 'changed'; label: string }) {
  const className =
    tone === 'removed'
      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
      : tone === 'added'
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
  return (
    <span className={`rounded px-1.5 py-px text-[10px] font-medium ${className}`}>{label}</span>
  )
}

export function CaseProposalCard({ proposal }: { proposal: AiCaseProposal }) {
  const qc = useQueryClient()
  const patchAiProposal = useUiStore((s) => s.patchAiProposal)
  const removeAiProposal = useUiStore((s) => s.removeAiProposal)
  const [busy, setBusy] = useState<'apply' | 'undo' | null>(null)
  const [serverConflict, setServerConflict] = useState(false)

  const items = useMemo(
    () => diffSteps(proposal.before, proposal.after),
    [proposal.before, proposal.after],
  )
  const removed = items.filter((item) => item.kind === 'removed').length
  const added = items.filter((item) => item.kind === 'added').length
  const changed = items.filter((item) => item.kind === 'changed').length
  const reordered = useMemo(
    () => isReordered(proposal.before, proposal.after),
    [proposal.before, proposal.after],
  )
  const metaChanged = useMemo(
    () => isMetaChanged(proposal.before, proposal.after),
    [proposal.before, proposal.after],
  )

  const { data: rows = [] } = useCases(proposal.after.case.projectId)
  const row = rows.find((item) => item.id === proposal.caseId)
  const stale =
    proposal.status === 'pending' &&
    (serverConflict || (row !== undefined && row.updatedAt !== proposal.baseUpdatedAt))
  const hasStepChange = items.length > 0

  const apply = async (): Promise<void> => {
    if (busy) return
    setBusy('apply')
    try {
      // 以服务端最新的 updatedAt 为准，避免覆盖用户在提议之后保存的改动
      const latestRows = await window.atp.invoke('case:list', {
        projectId: proposal.after.case.projectId,
      })
      const latest = latestRows.find((item) => item.id === proposal.caseId)
      if (!latest) {
        toast.danger('用例已不存在，无法应用修改')
        return
      }
      if (latest.updatedAt !== proposal.baseUpdatedAt) {
        setServerConflict(true)
        toast.danger('用例已保存过新改动，请让 AI 重新生成建议')
        return
      }
      const saved = await window.atp.invoke('case:update', proposal.after)
      qc.setQueryData(qk.caseFile(proposal.caseId), saved)
      void qc.invalidateQueries({ queryKey: qk.cases(proposal.after.case.projectId) })
      patchAiProposal(proposal.proposalId, { status: 'applied' })
      toast.success(`已应用对「${proposal.caseName}」的修改`)
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '应用修改失败')
    } finally {
      setBusy(null)
    }
  }

  const undo = async (): Promise<void> => {
    if (busy) return
    setBusy('undo')
    try {
      const saved = await window.atp.invoke('case:update', proposal.before)
      qc.setQueryData(qk.caseFile(proposal.caseId), saved)
      const latestRows = await window.atp.invoke('case:list', {
        projectId: proposal.after.case.projectId,
      })
      const latest = latestRows.find((item) => item.id === proposal.caseId)
      qc.setQueryData(qk.cases(proposal.after.case.projectId), latestRows)
      patchAiProposal(proposal.proposalId, {
        status: 'pending',
        baseUpdatedAt: latest?.updatedAt ?? proposal.baseUpdatedAt,
      })
      setServerConflict(false)
      toast.success('已撤销修改')
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '撤销失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded bg-accent/10 text-accent">
          <FileDiff size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 text-[11.5px] font-semibold">修改建议</span>
            <span className="truncate text-[10.5px] text-muted">用例「{proposal.caseName}」</span>
            {proposal.status === 'applied' && (
              <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                <Check size={9} />
                已应用
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-4 text-foreground/85">{proposal.summary}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {removed > 0 && <CountChip tone="removed" label={`−${removed}`} />}
            {added > 0 && <CountChip tone="added" label={`+${added}`} />}
            {changed > 0 && <CountChip tone="changed" label={`~${changed}`} />}
            {reordered && (
              <span className="rounded bg-sky-500/10 px-1.5 py-px text-[10px] font-medium text-sky-600 dark:text-sky-400">
                顺序调整
              </span>
            )}
            {metaChanged && (
              <span className="rounded bg-violet-500/10 px-1.5 py-px text-[10px] font-medium text-violet-600 dark:text-violet-400">
                用例信息
              </span>
            )}
            <span className="text-[10px] text-muted">
              {proposal.before.case.steps.length} 步 → {proposal.after.case.steps.length} 步
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => removeAiProposal(proposal.proposalId)}
          className="grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-default hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          aria-label="关闭修改建议"
          title="关闭"
        >
          <X size={11} />
        </button>
      </div>

      {hasStepChange && (
        <div className="mt-1.5 max-h-36 overflow-y-auto rounded-md border border-border bg-surface-secondary/60 p-1">
          {items.slice(0, MAX_VISIBLE_ITEMS).map((item) => (
            <DiffRow key={`${item.kind}-${item.id}`} item={item} />
          ))}
          {items.length > MAX_VISIBLE_ITEMS && (
            <div className="px-1 pt-0.5 text-[10px] text-muted">
              还有 {items.length - MAX_VISIBLE_ITEMS} 项…
            </div>
          )}
        </div>
      )}

      {stale && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/[0.06] px-2 py-1.5 text-[10.5px] leading-4 text-amber-700 dark:text-amber-300">
          <CircleAlert size={11} className="mt-0.5 shrink-0" />
          <span>
            用例在这条建议生成后又保存过。直接应用会覆盖新改动，请让 AI 重新读取并生成建议。
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        {proposal.status === 'applied' ? (
          <>
            <span className="flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400">
              <Check size={11} />
              已写入用例
            </span>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy !== null}
              onPress={() => void undo()}
            >
              {busy === 'undo' ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Undo2 size={11} />
              )}
              撤销
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="primary"
              isDisabled={busy !== null || stale}
              onPress={() => void apply()}
            >
              {busy === 'apply' && <Loader2 size={11} className="animate-spin" />}
              应用修改
            </Button>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={busy !== null}
              onPress={() => removeAiProposal(proposal.proposalId)}
            >
              忽略
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export function CaseProposalList() {
  const proposals = useUiStore((s) => s.aiProposals)
  if (proposals.length === 0) return null
  return (
    <div className="max-h-[46vh] shrink-0 space-y-2 overflow-y-auto border-t border-border bg-surface px-2.5 py-2">
      {proposals.map((proposal) => (
        <CaseProposalCard key={proposal.proposalId} proposal={proposal} />
      ))}
    </div>
  )
}
