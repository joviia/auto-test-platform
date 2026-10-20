import type { DesignScenario } from '@atp/model'
import { useMemo } from 'react'
import { useUiStore } from '../state/ui-store'

const RULE_ORDER = [
  'required',
  'length',
  'format',
  'duplicate',
  'date-range',
  'happy-path',
  'other',
]

type CellTone = 'ok' | 'partial' | 'pending' | 'accepted' | 'excluded' | 'empty'

const TONE_CELL: Record<CellTone, string> = {
  ok: 'border-l-emerald-500 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300',
  partial: 'border-l-amber-500 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300',
  pending: 'border-l-zinc-400 bg-surface-secondary/60 text-muted',
  accepted: 'border-l-sky-500 bg-sky-500/[0.06] text-sky-700 dark:text-sky-300',
  excluded: 'border-l-zinc-300 bg-transparent text-muted/70 dark:border-l-zinc-600',
  empty: 'border-l-transparent text-muted/30',
}

const TONE_LABEL: Record<CellTone, string> = {
  ok: '可执行',
  partial: '部分',
  pending: '待确认',
  accepted: '已接受',
  excluded: '不适用',
  empty: '—',
}

function cellTone(scenarios: DesignScenario[], readyRows: number, totalRows: number): CellTone {
  if (scenarios.length === 0) return 'empty'
  if (
    scenarios.every((scenario) => scenario.status === 'rejected' || scenario.status === 'excluded')
  ) {
    return 'excluded'
  }
  if (readyRows > 0 && readyRows === totalRows) return 'ok'
  if (readyRows > 0) return 'partial'
  if (scenarios.some((scenario) => scenario.status === 'accepted')) return 'accepted'
  return 'pending'
}

function Metric({ label, value }: { label: string; value: number }) {
  const percent = value > 0 ? Math.round(value * 100) : 0
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted">{label}</span>
      <span className="w-8 font-medium tabular-nums">{value > 0 ? `${percent}%` : '—'}</span>
      <span className="h-1 w-12 overflow-hidden rounded-full bg-default">
        <span className="block h-full rounded-full bg-accent/70" style={{ width: `${percent}%` }} />
      </span>
    </span>
  )
}

export function DesignMatrixView() {
  const design = useUiStore((s) => s.design)
  const setFilter = useUiStore((s) => s.setDesignFilter)
  const setView = useUiStore((s) => s.setDesignView)

  const rules = useMemo(() => {
    if (!design) return []
    const map = new Map<string, string>()
    for (const scenario of design.scenarios) {
      if (!map.has(scenario.ruleId)) map.set(scenario.ruleId, scenario.ruleName)
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        const ai = RULE_ORDER.indexOf(a)
        const bi = RULE_ORDER.indexOf(b)
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
      })
      .map(([ruleId, label]) => ({ ruleId, label }))
  }, [design])

  const rows = useMemo(() => {
    if (!design) return []
    const byField = new Map<string, DesignScenario[]>()
    for (const scenario of design.scenarios) {
      const list = byField.get(scenario.fieldRef) ?? []
      list.push(scenario)
      byField.set(scenario.fieldRef, list)
    }
    return design.fields
      .filter((field) => byField.has(field.ref))
      .map((field) => ({ field, scenarios: byField.get(field.ref) ?? [] }))
  }, [design])

  if (!design) return null

  const open = (fieldRef: string, ruleId: string): void => {
    setFilter({ fieldRef, ruleIds: [ruleId] })
    setView('scenarios')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border bg-surface px-4 py-2.5 text-[10.5px]">
        <Metric label="设计覆盖" value={design.coverage.designCoverage} />
        <Metric label="接受覆盖" value={design.coverage.acceptCoverage} />
        <Metric label="执行覆盖" value={design.coverage.executionCoverage} />
        <Metric label="通过率" value={design.coverage.passRate} />
        <span className="ml-auto flex items-center gap-3 text-[9.5px] text-muted">
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-500" /> 可执行
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-amber-500" /> 部分
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-zinc-400" /> 待确认
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-sky-500" /> 已接受
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {rows.length === 0 ? (
          <div className="grid h-full place-items-center text-[12px] text-muted">
            当前设计没有可展示的字段
          </div>
        ) : (
          <table className="w-full table-fixed border-collapse">
            <colgroup>
              <col className="w-48" />
              {rules.map((rule) => (
                <col key={rule.ruleId} />
              ))}
            </colgroup>
            <thead>
              <tr className="text-[10px] text-muted">
                <th className="pb-2 text-left font-medium">字段</th>
                {rules.map((rule) => (
                  <th key={rule.ruleId} className="px-1 pb-2 text-center font-medium">
                    <span className="line-clamp-2">{rule.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ field, scenarios }) => (
                <tr key={field.id}>
                  <td className="border-t border-border/60 py-1.5 pr-2 align-middle">
                    <span className="block truncate text-[11.5px] font-medium">{field.label}</span>
                    <span className="block truncate text-[9.5px] text-muted">
                      {scenarios.length} 场景 ·{' '}
                      {scenarios.reduce((sum, scenario) => sum + scenario.dataRecordIds.length, 0)}{' '}
                      行
                    </span>
                  </td>
                  {rules.map((rule) => {
                    const cellScenarios = scenarios.filter(
                      (scenario) => scenario.ruleId === rule.ruleId,
                    )
                    let totalRows = 0
                    let readyRows = 0
                    for (const scenario of cellScenarios) {
                      for (const id of scenario.dataRecordIds) {
                        totalRows += 1
                        if (design.dataRecords?.[id]?.status === 'ready') readyRows += 1
                      }
                    }
                    const tone = cellTone(cellScenarios, readyRows, totalRows)
                    if (tone === 'empty') {
                      return (
                        <td
                          key={rule.ruleId}
                          className="border-t border-border/60 px-1 py-1.5 text-center text-[11px] text-muted/30"
                        >
                          —
                        </td>
                      )
                    }
                    return (
                      <td key={rule.ruleId} className="border-t border-border/60 px-1 py-1.5">
                        <button
                          type="button"
                          data-design-cell={`${field.ref}:${rule.ruleId}`}
                          data-design-cell-tone={tone}
                          onClick={() => open(field.ref, rule.ruleId)}
                          title={`${field.label} · ${rule.label}：${TONE_LABEL[tone]}，${readyRows}/${totalRows} 行可执行`}
                          className={`flex min-h-14 w-full flex-col items-center justify-center rounded-sm border-l-2 px-1 py-1 transition-colors hover:brightness-95 ${TONE_CELL[tone]}`}
                        >
                          <span className="text-[11px] font-medium">{TONE_LABEL[tone]}</span>
                          <span className="text-[9.5px] opacity-75">
                            {readyRows}/{totalRows} 行
                          </span>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
