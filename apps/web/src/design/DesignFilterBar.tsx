import type { DesignScenario } from '@atp/model'
import { ChevronDown, CircleSlash, FilterX } from 'lucide-react'
import { useMemo } from 'react'
import { useUiStore } from '../state/ui-store'

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'ready', label: '可执行' },
  { value: 'partial', label: '部分可执行' },
  { value: 'pending', label: '待确认' },
  { value: 'accepted', label: '已接受' },
  { value: 'rejected', label: '已拒绝' },
]

function scenarioRuleIds(filter: { ruleId?: string; ruleIds?: string[] }): string[] {
  return filter.ruleIds ?? (filter.ruleId ? [filter.ruleId] : [])
}

function rowsOf(scenario: DesignScenario, records: Record<string, { status: string }>): number {
  return scenario.dataRecordIds.filter((id) => records[id]?.status !== 'excluded').length
}

function readyRowsOf(
  scenario: DesignScenario,
  records: Record<string, { status: string }>,
): number {
  return scenario.dataRecordIds.filter((id) => records[id]?.status === 'ready').length
}

export function DesignFilterBar() {
  const design = useUiStore((s) => s.design)
  const filter = useUiStore((s) => s.designFilter)
  const setFilter = useUiStore((s) => s.setDesignFilter)
  const setSelection = useUiStore((s) => s.setDesignSelection)

  const ruleIds = scenarioRuleIds(filter)
  const records = design?.dataRecords ?? {}

  const fields = useMemo(() => {
    if (!design) return []
    const byField = new Map<string, DesignScenario[]>()
    for (const scenario of design.scenarios) {
      const list = byField.get(scenario.fieldRef) ?? []
      list.push(scenario)
      byField.set(scenario.fieldRef, list)
    }
    return design.fields
      .map((field) => {
        const scenarios = byField.get(field.ref) ?? []
        return {
          field,
          scenarios,
          rows: scenarios.reduce((sum, scenario) => sum + rowsOf(scenario, records), 0),
        }
      })
      .filter((item) => item.scenarios.length > 0)
  }, [design, records])

  const rules = useMemo(() => {
    if (!design) return []
    const pool = filter.fieldRef
      ? design.scenarios.filter((scenario) => scenario.fieldRef === filter.fieldRef)
      : design.scenarios
    const map = new Map<string, { ruleId: string; label: string; rows: number }>()
    for (const scenario of pool) {
      const current = map.get(scenario.ruleId)
      map.set(scenario.ruleId, {
        ruleId: scenario.ruleId,
        label: scenario.ruleName || scenario.ruleId,
        rows: (current?.rows ?? 0) + rowsOf(scenario, records),
      })
    }
    return [...map.values()]
  }, [design, filter.fieldRef, records])

  const visible = useMemo(() => {
    if (!design) return []
    return design.scenarios.filter(
      (scenario) =>
        (!filter.fieldRef || scenario.fieldRef === filter.fieldRef) &&
        (ruleIds.length === 0 || ruleIds.includes(scenario.ruleId)) &&
        (!filter.status || scenario.status === filter.status),
    )
  }, [design, filter.fieldRef, filter.status, ruleIds])

  if (!design) return null

  const visibleReady = visible.reduce((sum, scenario) => sum + readyRowsOf(scenario, records), 0)
  const ruleSummary =
    ruleIds.length === 0
      ? '全部规范'
      : ruleIds
          .map((id) => design.scenarios.find((scenario) => scenario.ruleId === id)?.ruleName ?? id)
          .join('、')
  const hasFilter = Boolean(filter.fieldRef) || ruleIds.length > 0 || Boolean(filter.status)

  const update = (patch: Partial<typeof filter>): void => {
    const next = { ...filter, ...patch }
    if (next.fieldRef === '') delete next.fieldRef
    if (!next.status) delete next.status
    if (!next.ruleIds || next.ruleIds.length === 0) {
      delete next.ruleIds
      delete next.ruleId
    }
    setFilter(next)
  }

  const changeField = (fieldRef: string): void => {
    const nextRules = ruleIds.filter((id) =>
      design.scenarios.some((scenario) => scenario.fieldRef === fieldRef && scenario.ruleId === id),
    )
    const next = { ...filter }
    if (fieldRef) next.fieldRef = fieldRef
    else delete next.fieldRef
    if (nextRules.length > 0) next.ruleIds = nextRules
    else {
      delete next.ruleIds
      delete next.ruleId
    }
    setFilter(next)
  }

  const toggleRule = (ruleId: string): void => {
    const next = ruleIds.includes(ruleId)
      ? ruleIds.filter((id) => id !== ruleId)
      : [...ruleIds, ruleId]
    update({ ruleIds: next })
  }

  return (
    <div
      data-design-filter-bar
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-4"
    >
      <select
        aria-label="筛选字段"
        value={filter.fieldRef ?? ''}
        onChange={(event) => changeField(event.target.value)}
        className="h-7 min-w-0 max-w-[180px] shrink rounded-md border border-border bg-field px-2 text-[11px] text-foreground outline-none focus:border-accent/60"
      >
        <option value="">全部字段</option>
        {fields.map(({ field, rows }) => (
          <option key={field.ref} value={field.ref}>
            {field.label || field.ref}（{rows} 行）
          </option>
        ))}
      </select>

      <details className="group relative min-w-0 shrink" data-design-rule-filter>
        <summary className="flex h-7 max-w-[240px] min-w-0 cursor-pointer list-none items-center gap-1 rounded-md border border-border bg-field px-2 text-[11px] text-foreground outline-none hover:border-accent/40 [&::-webkit-details-marker]:hidden">
          <span className="truncate">
            {ruleIds.length === 0 ? '全部规范' : `规范：${ruleSummary}`}
          </span>
          <ChevronDown size={11} className="shrink-0 text-muted" />
        </summary>
        <div className="absolute left-0 top-8 z-30 max-h-64 w-52 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-xl">
          <button
            type="button"
            onClick={() => update({ ruleIds: [] })}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] ${
              ruleIds.length === 0 ? 'text-accent' : 'text-muted hover:bg-default'
            }`}
          >
            全部规范
          </button>
          {rules.map((rule) => (
            <label
              key={rule.ruleId}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[11px] hover:bg-default"
            >
              <input
                type="checkbox"
                checked={ruleIds.includes(rule.ruleId)}
                onChange={() => toggleRule(rule.ruleId)}
              />
              <span className="min-w-0 flex-1 truncate">{rule.label}</span>
              <span className="shrink-0 text-[9.5px] text-muted">{rule.rows} 行</span>
            </label>
          ))}
        </div>
      </details>

      <select
        aria-label="筛选状态"
        value={filter.status ?? ''}
        onChange={(event) => update({ status: event.target.value })}
        className="h-7 shrink-0 rounded-md border border-border bg-field px-2 text-[11px] text-foreground outline-none focus:border-accent/60"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <span className="ml-auto shrink-0 whitespace-nowrap text-[10.5px] text-muted">
        {visibleReady > 0 ? (
          <span className="text-emerald-600 dark:text-emerald-400">{visibleReady} 行可执行</span>
        ) : (
          '没有可执行行'
        )}
      </span>
      <span className="h-3 w-px shrink-0 bg-border" />
      <button
        type="button"
        onClick={() => setSelection(true)}
        className="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] text-muted hover:bg-default hover:text-foreground"
      >
        全选可执行
      </button>
      <button
        type="button"
        onClick={() => setSelection(false)}
        className="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] text-muted hover:bg-default hover:text-foreground"
      >
        清空
      </button>

      {design.skipped.length > 0 && (
        <details className="relative">
          <summary className="flex h-7 shrink-0 cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[10.5px] text-muted hover:bg-default hover:text-foreground [&::-webkit-details-marker]:hidden">
            <CircleSlash size={10} />
            跳过 {design.skipped.length} 项
          </summary>
          <div className="absolute right-0 top-8 z-30 max-h-64 w-80 overflow-y-auto rounded-md border border-border bg-surface p-2 shadow-xl">
            <p className="mb-1 text-[9.5px] text-muted">未生成场景的原因</p>
            <ul className="space-y-1.5">
              {design.skipped.map((item) => (
                <li
                  key={`${item.ruleId}-${item.fieldLabel ?? ''}-${item.reason}`}
                  className="text-[10px] leading-4 text-muted"
                >
                  <span className="text-foreground">
                    {item.fieldLabel ? `${item.fieldLabel} · ` : ''}
                    {item.ruleName}
                  </span>
                  ：{item.reason}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {hasFilter && (
        <button
          type="button"
          onClick={() => setFilter({})}
          className="flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] text-muted hover:bg-default hover:text-foreground"
        >
          <FilterX size={10} />
          清除
        </button>
      )}
    </div>
  )
}
