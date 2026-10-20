import type { DesignDataRecord, DesignScenario } from '@atp/model'
import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Database,
  History,
  Info,
  Loader2,
  Sparkles,
  Square,
  X,
  XCircle,
} from 'lucide-react'
import { useMemo } from 'react'
import { AiPanel } from '../ai/AiPanel'
import { useUiStore } from '../state/ui-store'
import { shortScenarioTitle } from './scenario-title'

export type DesignInspectorTab = 'detail' | 'ai'

function valueText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.join('、')
  return String(value)
}

function statusBadge(record: DesignDataRecord) {
  if (record.status === 'ready') {
    return (
      <span className="rounded bg-emerald-500/10 px-1 py-px text-[9.5px] text-emerald-600 dark:text-emerald-400">
        可执行
      </span>
    )
  }
  if (record.status === 'pending') {
    return (
      <span className="rounded bg-amber-500/10 px-1 py-px text-[9.5px] text-amber-600 dark:text-amber-400">
        待确认
      </span>
    )
  }
  return <span className="rounded bg-zinc-500/10 px-1 py-px text-[9.5px] text-muted">已排除</span>
}

function runBadge(record: DesignDataRecord) {
  const run = record.lastRun
  if (!run) return null
  if (run.status === 'passed') {
    return (
      <span className="flex items-center gap-0.5 text-[9.5px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={9} />
        通过
      </span>
    )
  }
  if (run.status === 'stopped') {
    return (
      <span className="flex items-center gap-0.5 text-[9.5px] text-muted">
        <Square size={8} />
        停止
      </span>
    )
  }
  return (
    <span className="flex items-center gap-0.5 text-[9.5px] text-red-600 dark:text-red-400">
      <XCircle size={9} />
      未通过
    </span>
  )
}

function DataEditor({ scenario, record }: { scenario: DesignScenario; record: DesignDataRecord }) {
  const design = useUiStore((s) => s.design)
  const running = useUiStore((s) => s.designRunning)
  const run = useUiStore((s) => s.designRun[`${scenario.id}::${record.id}`])
  const setValue = useUiStore((s) => s.setDesignDataValue)
  const setExpectedValue = useUiStore((s) => s.setDesignDataExpectedValue)
  const value = record.values[scenario.fieldRef]
  const editable = !running && record.status === 'ready'
  const extraValues = Object.entries(record.values).filter(
    ([ref, extra]) =>
      ref !== scenario.fieldRef && extra !== undefined && valueText(extra).trim() !== '',
  )
  const labelOf = (ref: string): string =>
    design?.fields.find((field) => field.ref === ref)?.label || ref

  return (
    <div className="space-y-2.5">
      <div>
        <label
          className="mb-1 block text-[9.5px] font-medium text-muted"
          htmlFor={`design-value-${record.id}`}
        >
          数据值 · {scenario.fieldLabel}
        </label>
        <textarea
          id={`design-value-${record.id}`}
          value={valueText(value)}
          onChange={(event) => setValue(scenario.id, record.id, event.target.value)}
          readOnly={!editable || Array.isArray(value)}
          rows={Math.min(6, Math.max(2, Math.ceil(valueText(value).length / 48)))}
          className="w-full resize-y rounded-md border border-border bg-field px-2 py-1.5 font-mono text-[11.5px] leading-5 text-foreground outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/10 read-only:opacity-70"
          placeholder="（空）"
          spellCheck={false}
        />
        <p className="mt-0.5 text-[9px] text-muted">
          {valueText(value).length} 字{Array.isArray(value) ? ' · 多选值由平台自动处理' : ''}
        </p>
      </div>

      {record.expectedValue !== undefined && (
        <div>
          <label
            className="mb-1 block text-[9.5px] font-medium text-muted"
            htmlFor={`design-expected-${record.id}`}
          >
            期望输入值（截断后）
          </label>
          <textarea
            id={`design-expected-${record.id}`}
            value={record.expectedValue}
            onChange={(event) => setExpectedValue(scenario.id, record.id, event.target.value)}
            readOnly={!editable}
            rows={2}
            className="w-full resize-y rounded-md border border-border bg-field px-2 py-1.5 font-mono text-[11.5px] leading-5 text-foreground outline-none focus:border-accent/60 read-only:opacity-70"
            spellCheck={false}
          />
          <p className="mt-0.5 text-[9px] text-muted">
            用于验证输入框 maxlength 截断；执行后应等于该值。
          </p>
        </div>
      )}

      {extraValues.length > 0 && (
        <div className="rounded-md border border-border bg-surface-secondary/50 px-2 py-1.5">
          <p className="text-[10px] text-muted">关联字段</p>
          <ul className="mt-1 space-y-1">
            {extraValues.map(([ref, extra]) => (
              <li key={ref} className="flex items-center gap-1.5 text-[10.5px]">
                <span className="shrink-0 text-muted">{labelOf(ref)}</span>
                <ChevronRight size={9} className="shrink-0 text-muted" />
                <span className="min-w-0 truncate font-mono">{valueText(extra)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {record.reason && (
        <p className="rounded border border-amber-500/25 bg-amber-500/[0.06] px-2 py-1.5 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
          {record.reason}
        </p>
      )}

      {record.lastRun && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted">
          <History size={10} />
          <span>最近执行 {new Date(record.lastRun.at).toLocaleString('zh-CN')}</span>
          {runBadge(record)}
        </div>
      )}
      {run?.status === 'running' && (
        <p className="flex items-center gap-1 text-[10px] text-muted">
          <Loader2 size={10} className="animate-spin" />
          正在执行…
        </p>
      )}
      {run?.error && (
        <p className="rounded border border-red-500/25 bg-red-500/[0.05] px-2 py-1.5 text-[10px] leading-4 text-red-600 dark:text-red-400">
          {run.error}
        </p>
      )}
      {record.savedCaseId && (
        <p className="flex items-center gap-1 text-[10px] text-sky-600 dark:text-sky-400">
          <Database size={10} />
          已入库：{record.savedCaseId}
        </p>
      )}
    </div>
  )
}

export function DesignInspector({
  tab,
  onTabChange,
  onClose,
}: {
  tab: DesignInspectorTab
  onTabChange: (tab: DesignInspectorTab) => void
  onClose: () => void
}) {
  const design = useUiStore((s) => s.design)
  const activeScenarioId = useUiStore((s) => s.designActiveScenarioId)
  const activeDataRecordId = useUiStore((s) => s.designActiveDataRecordId)
  const setActive = useUiStore((s) => s.setDesignActive)

  const scenario = design?.scenarios.find((item) => item.id === activeScenarioId) ?? null
  const records = useMemo(() => {
    if (!design || !scenario) return []
    return scenario.dataRecordIds
      .map((id) => design.dataRecords?.[id])
      .filter((record): record is DesignDataRecord => Boolean(record))
  }, [design, scenario])
  const record = records.find((item) => item.id === activeDataRecordId) ?? records[0] ?? null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex items-center rounded-md border border-border bg-surface-secondary p-0.5">
          <button
            type="button"
            onClick={() => onTabChange('detail')}
            className={`rounded px-2.5 py-0.5 text-[11px] ${
              tab === 'detail' ? 'bg-surface font-medium text-accent shadow-sm' : 'text-muted'
            }`}
          >
            详情
          </button>
          <button
            type="button"
            onClick={() => onTabChange('ai')}
            className={`flex items-center gap-1 rounded px-2.5 py-0.5 text-[11px] ${
              tab === 'ai' ? 'bg-surface font-medium text-accent shadow-sm' : 'text-muted'
            }`}
          >
            <Sparkles size={10} />
            AI
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto grid size-6 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
          aria-label="关闭详情抽屉"
          title="关闭（Esc）"
        >
          <X size={13} />
        </button>
      </div>

      {tab === 'ai' ? (
        <div className="min-h-0 flex-1">
          <AiPanel embedded />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {!scenario || !record ? (
            <div className="grid h-full place-items-center px-3 text-center">
              <div>
                <Info size={20} className="mx-auto text-muted/60" />
                <p className="mt-2 text-[11px] text-muted">
                  在工作台中选择一个场景或数据行，查看预期、数据与断言。
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-[10px] text-muted">
                  {scenario.ruleName} · {scenario.fieldLabel}
                </p>
                <h3 className="mt-0.5 text-[13px] font-semibold leading-5">
                  {shortScenarioTitle(scenario, design?.scopeLabel ?? design?.title)}
                </h3>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                  <span>{scenario.expected === 'invalid' ? '预期拒绝' : '预期通过'}</span>
                  {scenario.requiresWrite && (
                    <span className="rounded bg-purple-500/10 px-1 text-[9px] text-purple-600 dark:text-purple-400">
                      写业务数据
                    </span>
                  )}
                </p>
              </div>

              <div className="rounded-md border border-border">
                <div className="flex items-center gap-1.5 border-b border-border bg-surface-secondary px-2.5 py-1.5">
                  <span className="text-[10px] font-medium">数据行 {records.length}</span>
                  <span className="ml-auto text-[9px] text-muted">点击切换下方详情</span>
                </div>
                <div className="max-h-44 overflow-y-auto">
                  {records.map((item) => {
                    const active = item.id === record.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActive(scenario.id, item.id)}
                        className={`flex w-full items-center gap-1.5 border-b border-border/50 px-2 py-1 text-left last:border-b-0 ${
                          active ? 'bg-accent/[0.07]' : 'hover:bg-surface-secondary/60'
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[10.5px] font-medium">
                            {item.label}
                          </span>
                          <span className="block truncate text-[9px] text-muted">
                            {item.partition}
                            {item.testLevel === 'api' ? ' · API' : ''}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-0.5">
                          {statusBadge(item)}
                          {runBadge(item)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <DataEditor scenario={scenario} record={record} />

              <div className="rounded-md border border-border bg-surface-secondary/40 px-2 py-1.5">
                <p className="flex items-center gap-1 text-[10px] font-medium">
                  <CircleDashed size={10} className="text-accent" />
                  预期与断言预览
                </p>
                <ul className="mt-1.5 space-y-1 text-[10px] leading-4 text-muted">
                  <li>
                    · 输入：{scenario.fieldLabel} ={' '}
                    <span className="font-mono text-foreground">
                      {valueText(record.values[scenario.fieldRef]) || '（空）'}
                    </span>
                  </li>
                  {record.expectedValue !== undefined && (
                    <li>
                      · 输入框应截断为{' '}
                      <span className="font-mono text-foreground">
                        {record.expectedValue.length}
                      </span>{' '}
                      字
                    </li>
                  )}
                  <li>
                    · 预期：
                    {scenario.expected === 'invalid'
                      ? '出现字段校验错误，且不创建数据'
                      : `提交成功${design?.successText ? `（${design.successText}）` : ''}`}
                  </li>
                  {record.preconditions?.map((item) => (
                    <li key={item}>· 前置：{item}</li>
                  ))}
                  {record.cleanup?.map((item) => (
                    <li key={item}>· 清理：{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
