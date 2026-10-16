import type { RunStepRow } from '@atp/model'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, FileVideo, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useUiStore } from '../state/ui-store'

/** 文件绝对路径 → atp-evidence://<runId>/<file>（自定义协议读取证据） */
function toEvidenceUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  const idx = path.indexOf('runs/')
  if (idx < 0) return undefined
  return `atp-evidence://${path.slice(idx + 5)}`
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
    <div className="flex h-full flex-col p-2 text-sm">
      <p className="mb-2 text-xs text-default-400">
        {caseId ? '当前用例的执行记录' : '全部执行记录（选中用例可过滤）'}
      </p>
      <div className="space-y-1">
        {runs.length === 0 && (
          <p className="text-default-400">还没有执行记录：选中用例点「回放」</p>
        )}
        {runs.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setOpenRunId(openRunId === r.id ? null : r.id)}
            className="flex w-full items-center gap-2 rounded-lg border border-default-200 px-2 py-1.5 text-left hover:bg-default-100"
          >
            {r.status === 'passed' ? (
              <CheckCircle2 size={16} className="shrink-0 text-green-600" />
            ) : (
              <XCircle size={16} className="shrink-0 text-red-600" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {r.caseName ?? r.caseId}
              <span className="ml-2 text-xs text-default-400">
                {new Date(r.startedAt).toLocaleString('zh-CN', { hour12: false })}
              </span>
            </span>
            {r.videoPath && <FileVideo size={14} className="shrink-0 text-default-400" />}
          </button>
        ))}
      </div>

      {detail && (
        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-default-200 p-2">
          <p className="mb-2 text-xs text-default-500">
            {detail.run.status === 'passed' ? '✅ 通过' : '❌ 失败'} ·{' '}
            {new Date(detail.run.startedAt).toLocaleTimeString('zh-CN', { hour12: false })} →{' '}
            {detail.run.finishedAt
              ? new Date(detail.run.finishedAt).toLocaleTimeString('zh-CN', { hour12: false })
              : ''}
            {detail.run.error ? ` · 运行错误：${detail.run.error}` : ''}
          </p>
          <div className="space-y-2">
            {detail.steps.map((s: RunStepRow) => (
              <div
                key={s.stepId}
                className={`rounded-lg border p-2 ${
                  s.status === 'passed' ? 'border-default-200' : 'border-red-300 bg-red-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  {s.status === 'passed' ? (
                    <CheckCircle2 size={14} className="text-green-600" />
                  ) : (
                    <XCircle size={14} className="text-red-600" />
                  )}
                  <span className="font-mono text-xs text-default-400">#{s.idx + 1}</span>
                  <span className="font-medium">{s.action}</span>
                  <span className="text-xs text-default-400">{s.durationMs}ms</span>
                  {s.locatorHit && (
                    <span className="rounded bg-default-100 px-1 text-xs">
                      命中候选#{s.locatorHit.tier} {s.locatorHit.locator.type}
                    </span>
                  )}
                </div>
                {s.status === 'failed' && (
                  <div className="mt-1 space-y-0.5 text-xs text-red-700">
                    {(s.triedCandidates ?? []).map((c, i) => (
                      <p key={`${c.locator.type}-${c.locator.value}-${i}`}>
                        候选 {c.locator.type}:{c.locator.value} → 未命中
                        {c.error ? `（${c.error}）` : ''}
                      </p>
                    ))}
                    {s.assertion && s.assertion.type !== 'visible' && (
                      <p>
                        断言 {s.assertion.type}：期望「{s.assertion.expected}」实际「
                        {s.assertion.actual}」
                      </p>
                    )}
                    {s.error && <p>{s.error}</p>}
                  </div>
                )}
                {s.screenshotPath && (
                  <img
                    src={toEvidenceUrl(s.screenshotPath)}
                    alt={`步骤${s.idx + 1}截图`}
                    className="mt-1 w-full rounded border border-default-200"
                  />
                )}
              </div>
            ))}
          </div>
          {detail.run.videoPath && (
            <div className="mt-2">
              <p className="mb-1 text-xs text-default-400">全程视频</p>
              {/* biome-ignore lint/a11y/useMediaCaption: 回放证据视频无字幕源 */}
              <video
                controls
                src={toEvidenceUrl(detail.run.videoPath)}
                className="w-full rounded border border-default-200"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
