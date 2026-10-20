import type { DesignDataRecord, DesignScenario, DesignScenarioStatus } from '@atp/model'
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Square, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useUiStore } from '../state/ui-store'
import { shortScenarioTitle } from './scenario-title'

const STATUS_LABEL: Record<DesignScenarioStatus, string> = {
  ready: '可执行',
  partial: '部分可执行',
  pending: '待确认',
  accepted: '已接受',
  rejected: '已拒绝',
  excluded: '不适用',
}

const STATUS_DOT: Record<DesignScenarioStatus, string> = {
  ready: 'bg-emerald-500',
  partial: 'bg-amber-500',
  pending: 'bg-zinc-400',
  accepted: 'bg-sky-500',
  rejected: 'bg-red-400',
  excluded: 'bg-zinc-300 dark:bg-zinc-600',
}

const STATUS_TEXT: Record<DesignScenarioStatus, string> = {
  ready: 'text-emerald-600 dark:text-emerald-400',
  partial: 'text-amber-600 dark:text-amber-400',
  pending: 'text-muted',
  accepted: 'text-sky-600 dark:text-sky-400',
  rejected: 'text-red-600 dark:text-red-400',
  excluded: 'text-muted',
}

function valueText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.join('、')
  return String(value)
}

function preview(value: unknown, max = 48): string {
  const text = valueText(value)
  if (text === '') return '（空）'
  if (/^\s+$/.test(text)) return `（纯空格，${text.length} 位）`
  return text.length > max ? `${text.slice(0, max)}…（${text.length} 字）` : text
}

function expectedOf(scenario: DesignScenario): string {
  return scenario.expected === 'invalid' ? '拒绝' : '通过'
}

function expectedSummary(scenario: DesignScenario, records: DesignDataRecord[]): string {
  const expected = expectedOf(scenario)
  if (records.length === 0) return `预期${expected}`
  const labels = records.map((record) =>
    record.expectedValue !== undefined
      ? `${record.expectedValue.length}截断`
      : record.label.replace(/\s*字$/, ''),
  )
  const head = labels.slice(0, 3).join('/')
  const more = labels.length > 3 ? '…' : ''
  return `${records.length} 行 · ${head}${more} → ${expected}`
}

function rowStateKey(scenarioId: string, recordId: string): string {
  return `${scenarioId}::${recordId}`
}

function ScenarioCheckbox({
  checked,
  indeterminate,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  indeterminate: boolean
  disabled: boolean
  onChange: () => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="size-3.5 shrink-0 accent-[var(--accent)]"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={label}
    />
  )
}

function RunBadge({
  status,
  error,
}: {
  status: 'running' | 'passed' | 'failed' | 'stopped' | undefined
  error?: string
}) {
  if (!status) return null
  if (status === 'running') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted">
        <Loader2 size={10} className="animate-spin" />
        执行中
      </span>
    )
  }
  if (status === 'passed') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={10} />
        通过
      </span>
    )
  }
  if (status === 'stopped') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-muted">
        <Square size={9} />
        停止
      </span>
    )
  }
  return (
    <span
      className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400"
      title={error}
    >
      <XCircle size={10} />
      未通过
    </span>
  )
}

function DataRow({
  scenario,
  record,
  onOpenDetail,
}: {
  scenario: DesignScenario
  record: DesignDataRecord
  onOpenDetail: () => void
}) {
  const running = useUiStore((s) => s.designRunning)
  const selected = useUiStore((s) =>
    s.designRowSelected.includes(rowStateKey(scenario.id, record.id)),
  )
  const run = useUiStore((s) => s.designRun[rowStateKey(scenario.id, record.id)])
  const toggleRow = useUiStore((s) => s.toggleDesignRow)
  const setValue = useUiStore((s) => s.setDesignDataValue)

  const value = record.values[scenario.fieldRef]
  const excluded = scenario.status === 'rejected' || scenario.status === 'excluded'
  const selectable = record.status === 'ready' && !excluded && !running
  const status = run?.status ?? record.lastRun?.status

  return (
    <tr
      data-design-row={record.id}
      data-design-scenario={scenario.id}
      data-design-run-status={status === 'running' ? 'running' : status}
      className="border-t border-border/60 align-top hover:bg-surface-secondary/40"
    >
      <td className="px-2 py-2">
        <input
          type="checkbox"
          className="size-3.5 accent-[var(--accent)]"
          checked={selected}
          disabled={!selectable}
          onChange={() => toggleRow(scenario.id, record.id)}
          aria-label={`选择数据行 ${record.label}`}
        />
      </td>
      <td className="px-2 py-2">
        <button
          type="button"
          onClick={onOpenDetail}
          className="block w-full truncate text-left text-[11px] font-medium text-foreground hover:text-accent"
          title={record.label}
        >
          {record.label}
        </button>
        <span className="flex items-center gap-1 text-[9.5px] text-muted">
          <span className="truncate">{record.partition}</span>
          {record.testLevel === 'api' && (
            <span className="shrink-0 rounded bg-sky-500/10 px-1 text-[8.5px] text-sky-600 dark:text-sky-400">
              API
            </span>
          )}
        </span>
      </td>
      <td className="px-2 py-2">
        {selectable ? (
          <input
            value={valueText(value)}
            onChange={(event) => setValue(scenario.id, record.id, event.target.value)}
            readOnly={Array.isArray(value)}
            className="w-full rounded-sm border-b border-border/60 bg-transparent px-1 py-0.5 text-[11px] text-foreground outline-none placeholder:text-muted/60 hover:border-border hover:bg-surface focus:border-accent"
            placeholder="（空）"
            aria-label={`数据 ${scenario.title} ${record.label}`}
          />
        ) : (
          <span className="block truncate text-[10.5px] text-muted" title={valueText(value)}>
            {preview(value)}
          </span>
        )}
        {record.expectedValue !== undefined && (
          <span className="block truncate px-1 text-[9.5px] text-muted">
            期望输入 {record.expectedValue.length} 字
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-[10.5px] text-muted">
        {record.expectedValue !== undefined
          ? `${record.expectedValue.length} 字`
          : expectedOf(scenario)}
      </td>
      <td className="px-2 py-2">
        {record.status === 'ready' ? (
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400">可执行</span>
        ) : record.status === 'pending' ? (
          <span
            className="block text-[10px] text-amber-600 dark:text-amber-400"
            title={record.reason}
          >
            待确认
          </span>
        ) : (
          <span className="text-[10px] text-muted">已排除</span>
        )}
      </td>
      <td className="px-2 py-2">
        <RunBadge status={status} error={run?.error} />
      </td>
    </tr>
  )
}

function ScenarioRow({
  scenario,
  expanded,
  onToggleExpand,
  onOpenDetail,
}: {
  scenario: DesignScenario
  expanded: boolean
  onToggleExpand: () => void
  onOpenDetail: (scenarioId: string, recordId?: string) => void
}) {
  const design = useUiStore((s) => s.design)
  const rowSelected = useUiStore((s) => s.designRowSelected)
  const designRun = useUiStore((s) => s.designRun)
  const running = useUiStore((s) => s.designRunning)
  const toggleScenario = useUiStore((s) => s.toggleDesignScenario)

  const records = (
    design?.dataRecords ? scenario.dataRecordIds.map((id) => design.dataRecords?.[id]) : []
  ).filter((record): record is DesignDataRecord => Boolean(record))
  const readyKeys = records
    .filter((record) => record.status === 'ready')
    .map((record) => rowStateKey(scenario.id, record.id))
  const selectedCount = readyKeys.filter((key) => rowSelected.includes(key)).length
  const allSelected = readyKeys.length > 0 && selectedCount === readyKeys.length
  const excluded = scenario.status === 'rejected' || scenario.status === 'excluded'
  const runState = records.reduce<'running' | 'passed' | 'failed' | 'stopped' | undefined>(
    (current, record) => {
      if (current === 'running') return current
      const status = designRun[rowStateKey(scenario.id, record.id)]?.status
      if (status === 'running') return 'running'
      if (status === 'failed') return 'failed'
      if (status === undefined) return current
      return current ?? status
    },
    undefined,
  )

  return (
    <div
      data-design-scenario={scenario.id}
      data-design-scenario-status={scenario.status}
      className="border-b border-border/60 last:border-b-0"
    >
      <div className="flex min-h-11 items-center gap-2 px-3 py-1.5 hover:bg-surface-secondary/50">
        <ScenarioCheckbox
          checked={allSelected}
          indeterminate={selectedCount > 0 && !allSelected}
          disabled={readyKeys.length === 0 || excluded || running}
          onChange={() => toggleScenario(scenario.id)}
          label={`选择场景 ${scenario.title}`}
        />
        <button
          type="button"
          onClick={onToggleExpand}
          className="grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
          aria-label={expanded ? '收起数据行' : '展开数据行'}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          type="button"
          onClick={() => onOpenDetail(scenario.id, records[0]?.id)}
          className="min-w-0 flex-1 py-0.5 text-left"
        >
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 truncate text-[12.5px] font-medium text-foreground">
              {shortScenarioTitle(scenario, design?.scopeLabel ?? design?.title)}
            </span>
            {scenario.requiresWrite && (
              <span className="shrink-0 rounded bg-purple-500/10 px-1 text-[9.5px] text-purple-600 dark:text-purple-400">
                写数据
              </span>
            )}
            {scenario.priority === 'blocker' && (
              <span className="shrink-0 rounded bg-red-500/10 px-1 text-[9.5px] text-red-600 dark:text-red-400">
                必测
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[10.5px] text-muted">
            {expectedSummary(scenario, records)}
          </span>
        </button>
        <span
          className={`flex shrink-0 items-center gap-1 text-[10.5px] ${STATUS_TEXT[scenario.status]}`}
        >
          <span className={`size-1.5 rounded-full ${STATUS_DOT[scenario.status]}`} />
          {STATUS_LABEL[scenario.status]}
        </span>
        <span className="w-14 shrink-0">
          <RunBadge status={runState} />
        </span>
      </div>

      {expanded && records.length > 0 && (
        <div className="mx-3 mb-2 overflow-hidden rounded-md border border-border bg-surface">
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col className="w-9" />
              <col className="w-40" />
              <col />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-20" />
            </colgroup>
            <thead>
              <tr className="bg-surface-secondary/70 text-[10px] text-muted">
                <th className="px-2 py-1.5 text-left font-medium">
                  <span className="sr-only">选择</span>
                </th>
                <th className="px-2 py-1.5 text-left font-medium">分区 / 数据</th>
                <th className="px-2 py-1.5 text-left font-medium">数据值</th>
                <th className="px-2 py-1.5 text-left font-medium">预期</th>
                <th className="px-2 py-1.5 text-left font-medium">状态</th>
                <th className="px-2 py-1.5 text-left font-medium">结果</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <DataRow
                  key={record.id}
                  scenario={scenario}
                  record={record}
                  onOpenDetail={() => onOpenDetail(scenario.id, record.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function DesignScenarioView({
  onOpenDetail,
}: {
  onOpenDetail: (scenarioId: string, recordId?: string) => void
}) {
  const design = useUiStore((s) => s.design)
  const filter = useUiStore((s) => s.designFilter)
  const setFilter = useUiStore((s) => s.setDesignFilter)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    if (!design) return []
    const ruleIds = filter.ruleIds ?? (filter.ruleId ? [filter.ruleId] : [])
    const visible = design.scenarios.filter(
      (scenario) =>
        (!filter.fieldRef || scenario.fieldRef === filter.fieldRef) &&
        (ruleIds.length === 0 || ruleIds.includes(scenario.ruleId)) &&
        (!filter.status || scenario.status === filter.status),
    )
    const order = new Map(design.fields.map((field, index) => [field.ref, index]))
    const byField = new Map<string, DesignScenario[]>()
    for (const scenario of visible) {
      const list = byField.get(scenario.fieldRef) ?? []
      list.push(scenario)
      byField.set(scenario.fieldRef, list)
    }
    return [...byField.entries()]
      .sort(([a], [b]) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
      .map(([fieldRef, scenarios]) => {
        const rows = scenarios.reduce((sum, scenario) => sum + scenario.dataRecordIds.length, 0)
        return {
          fieldRef,
          label: scenarios[0]?.fieldLabel || fieldRef,
          scenarios,
          rows,
        }
      })
  }, [design, filter])

  if (!design) return null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {groups.length === 0 ? (
        <div className="grid h-full place-items-center px-4">
          <div className="text-center">
            <p className="text-[12px] text-muted">当前筛选下没有场景</p>
            <button
              type="button"
              onClick={() => setFilter({})}
              className="mt-1.5 text-[11px] text-accent hover:underline"
            >
              清除筛选
            </button>
          </div>
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.fieldRef} data-design-group={group.fieldRef}>
            <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-border bg-surface-secondary/90 px-4 py-1.5 backdrop-blur">
              <span className="text-[11.5px] font-semibold">{group.label}</span>
              <span className="text-[10px] text-muted">· {group.rows} 行</span>
            </div>
            {group.scenarios.map((scenario) => (
              <ScenarioRow
                key={scenario.id}
                scenario={scenario}
                expanded={expanded.has(scenario.id)}
                onOpenDetail={onOpenDetail}
                onToggleExpand={() =>
                  setExpanded((current) => {
                    const next = new Set(current)
                    if (next.has(scenario.id)) next.delete(scenario.id)
                    else next.add(scenario.id)
                    return next
                  })
                }
              />
            ))}
          </section>
        ))
      )}
    </div>
  )
}
