import type { RunStepRow } from '@atp/model'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronRight, FileVideo, History, XCircle } from 'lucide-react'
import { useState } from 'react'
import { EmptyHint } from '../components/EmptyHint'
import { useUiStore } from '../state/ui-store'

/** 文件绝对路径 → atp-evidence://<runId>/<file>（自定义协议读取证据） */
function toEvidenceUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  const idx = path.indexOf('runs/')
  if (idx < 0) return undefined
  return `atp-evidence://${path.slice(idx + 5)}`
}

const ACTION_LABEL: Record<string, string> = {
  click: '点击',
  fill: '输入',
  select: '选择',
  press: '按键',
  assert: '断言',
}

function formatTime(value: string | null | undefined): string {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function ReportPanel() {
  const selected = useUiStore((s) => s.selected)
  const caseId = selected?.kind === 'case' ? selected.id : undefined

  const { data: runs = [] } = useQuery({
    queryKey: ['runs', caseId ?? 'all'],
    queryFn: () => window.atp.invoke('run:list', caseId ? { caseId } : {}),
  })
  const [openRunId, setOpenRunId] = useState<string | null>(null)
  const { data: detail } = useQuery({
    queryKey: ['run', openRunId],
    queryFn: () => window.atp.invoke('run:get', { runId: openRunId as string }),
    enabled: Boolean(openRunId),
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-[13px] font-medium">执行记录</span>
        <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted">
          {runs.length}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
          {caseId ? '当前用例' : '全部用例'} · 步骤级证据
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {runs.length === 0 ? (
          <EmptyHint
            icon={History}
            title="还没有执行记录"
            description="选中用例后点击中间工具栏的「回放用例」，结果与证据会出现在这里"
            compact
          />
        ) : (
          <div className="space-y-1.5">
            {runs.map((run) => {
              const open = openRunId === run.id
              const passed = run.status === 'passed'
              return (
                <div
                  key={run.id}
                  className={`rounded-md border bg-surface transition-colors ${
                    open ? 'border-accent/40' : 'border-border'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setOpenRunId(open ? null : run.id)}
                    className="flex w-full items-center gap-2 px-2 py-2 text-left text-[13px]"
                  >
                    {passed ? (
                      <CheckCircle2
                        size={15}
                        className="shrink-0 text-green-600 dark:text-green-400"
                      />
                    ) : (
                      <XCircle size={15} className="shrink-0 text-red-600 dark:text-red-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {run.caseName ?? run.caseId}
                      <span className="ml-2 text-[11px] text-muted">
                        {formatTime(run.startedAt)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        passed
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : 'bg-red-500/10 text-red-600 dark:text-red-400'
                      }`}
                    >
                      {passed ? '通过' : '失败'}
                    </span>
                    {run.videoPath && (
                      <FileVideo size={13} className="shrink-0 text-muted" aria-label="含视频" />
                    )}
                    {open ? (
                      <ChevronDown size={13} className="shrink-0 text-muted" />
                    ) : (
                      <ChevronRight size={13} className="shrink-0 text-muted" />
                    )}
                  </button>

                  {open && detail && detail.run.id === run.id && (
                    <div className="atp-fade-in space-y-2 border-t border-border p-2">
                      <p className="text-[11px] text-muted">
                        {formatTime(detail.run.startedAt)} → {formatTime(detail.run.finishedAt)}
                        {detail.run.error ? ` · 运行错误：${detail.run.error}` : ''}
                      </p>

                      <div className="space-y-1.5">
                        {detail.steps.map((s: RunStepRow) => (
                          <div
                            key={s.stepId}
                            className={`rounded border p-2 ${
                              s.status === 'passed'
                                ? 'border-border'
                                : 'border-red-500/30 bg-red-500/[0.04]'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-xs">
                              {s.status === 'passed' ? (
                                <CheckCircle2
                                  size={12}
                                  className="text-green-600 dark:text-green-400"
                                />
                              ) : (
                                <XCircle size={12} className="text-red-600 dark:text-red-400" />
                              )}
                              <span className="font-mono text-[10px] text-muted">#{s.idx + 1}</span>
                              <span className="font-medium">
                                {ACTION_LABEL[s.action] ?? s.action}
                              </span>
                              <span className="text-[10px] text-muted">{s.durationMs}ms</span>
                              {s.locatorHit && (
                                <span className="rounded bg-surface-secondary px-1 font-mono text-[10px] text-muted">
                                  候选 #{s.locatorHit.tier} · {s.locatorHit.locator.type}
                                </span>
                              )}
                            </div>
                            {s.status === 'failed' && (
                              <div className="mt-1.5 space-y-0.5 text-[11px] text-red-700 dark:text-red-400">
                                {(s.triedCandidates ?? []).map((c, i) => (
                                  <p key={`${c.locator.type}-${c.locator.value}-${i}`}>
                                    候选 {c.locator.type}:{c.locator.value} → 未命中
                                    {c.error ? `（${c.error}）` : ''}
                                  </p>
                                ))}
                                {s.assertion && s.assertion.type !== 'visible' && (
                                  <p>
                                    断言 {s.assertion.type}：期望「{s.assertion.expected}
                                    」实际「{s.assertion.actual}」
                                  </p>
                                )}
                                {s.error && <p>{s.error}</p>}
                              </div>
                            )}
                            {s.screenshotPath && (
                              <img
                                src={toEvidenceUrl(s.screenshotPath)}
                                alt={`步骤${s.idx + 1}截图`}
                                className="mt-1.5 w-full rounded border border-border"
                              />
                            )}
                          </div>
                        ))}
                      </div>

                      {detail.run.videoPath && (
                        <div>
                          <p className="mb-1 text-[10px] text-muted">全程视频</p>
                          {/* biome-ignore lint/a11y/useMediaCaption: 回放证据视频无字幕源 */}
                          <video
                            controls
                            src={toEvidenceUrl(detail.run.videoPath)}
                            className="w-full rounded border border-border"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
