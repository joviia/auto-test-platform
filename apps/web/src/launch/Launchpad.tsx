import type { RunRow } from '@atp/model'
import { Button, toast } from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChartNoAxesColumn, Circle, Clock, Globe, Play, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { qk, useCases } from '../api/client'
import { useUiStore } from '../state/ui-store'

function relativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return new Date(value).toLocaleDateString('zh-CN')
}

function timeOf(value: string): string {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

function durationOf(run: RunRow | undefined): string {
  if (!run?.finishedAt) return ''
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
  return `${(ms / 1000).toFixed(1)}s`
}

const CARD = 'rounded-lg border border-border bg-surface shadow-surface'

export function Launchpad() {
  const currentProjectId = useUiStore((s) => s.currentProjectId)
  const setSelected = useUiStore((s) => s.setSelected)
  const setUrl = useUiStore((s) => s.setUrl)
  const setRecording = useUiStore((s) => s.setRecording)
  const resetLiveSteps = useUiStore((s) => s.resetLiveSteps)
  const setReplaying = useUiStore((s) => s.setReplaying)
  const setReplayProgress = useUiStore((s) => s.setReplayProgress)
  const setSelectedRunId = useUiStore((s) => s.setSelectedRunId)
  const replayMode = useUiStore((s) => s.replayMode)
  const { data: cases = [] } = useCases(currentProjectId)
  const qc = useQueryClient()

  const { data: runs = [] } = useQuery({
    queryKey: ['runs', 'launchpad'],
    queryFn: () => window.atp.invoke('run:list', {}),
  })

  const sortedCases = useMemo(
    () => [...cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [cases],
  )
  const recentRuns = useMemo(
    () => [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
    [runs],
  )
  const latestRunByCase = useMemo(() => {
    const map = new Map<string, RunRow>()
    for (const run of runs) {
      const previous = map.get(run.caseId)
      if (!previous || run.startedAt > previous.startedAt) map.set(run.caseId, run)
    }
    return map
  }, [runs])

  const continueCase = useMemo(() => {
    const fromRun = recentRuns[0]
      ? cases.find((item) => item.id === recentRuns[0].caseId)
      : undefined
    return fromRun ?? sortedCases[0]
  }, [recentRuns, cases, sortedCases])

  const continueRun = continueCase ? latestRunByCase.get(continueCase.id) : undefined
  const { data: continueFile } = useQuery({
    queryKey: continueCase ? qk.caseFile(continueCase.id) : ['case', 'launchpad', 'none'],
    queryFn: () => window.atp.invoke('case:get', { id: continueCase?.id as string }),
    enabled: Boolean(continueCase),
  })

  const [urlInput, setUrlInput] = useState('')
  useEffect(() => {
    if (!urlInput && continueCase?.startUrl) setUrlInput(continueCase.startUrl)
  }, [continueCase?.startUrl, urlInput])

  const stats = useMemo(() => {
    const total = runs.length
    const passed = runs.filter((run) => run.status === 'passed').length
    return {
      total,
      passed,
      failed: total - passed,
      rate: total > 0 ? Math.round((passed / total) * 100) : 0,
    }
  }, [runs])

  const days = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start)
      day.setDate(day.getDate() - (6 - index))
      const next = new Date(day)
      next.setDate(next.getDate() + 1)
      const count = runs.filter((run) => {
        const at = new Date(run.startedAt)
        return at >= day && at < next
      }).length
      return { label: '日一二三四五六'[day.getDay()], count }
    })
  }, [runs])
  const maxRuns = Math.max(1, ...days.map((day) => day.count))

  const navigate = async (target: string): Promise<void> => {
    await window.atp.invoke('browser:navigate', { url: target })
    setUrl(target)
    setSelectedRunId(null)
  }

  const openCase = async (id: string, startUrl: string): Promise<void> => {
    try {
      setSelected({ kind: 'case', id })
      await navigate(startUrl)
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '打开页面失败')
    }
  }

  const openUrl = async (): Promise<void> => {
    const target = urlInput.trim()
    if (!target) {
      toast.info('先输入被测页面地址')
      return
    }
    try {
      await navigate(target)
      toast.success('已打开被测页面')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '打开页面失败')
    }
  }

  const startRecording = async (): Promise<void> => {
    const target = urlInput.trim() || continueCase?.startUrl
    if (!target) {
      toast.info('先输入被测页面地址')
      return
    }
    try {
      await navigate(target)
      resetLiveSteps()
      await window.atp.invoke('recording:start')
      setRecording(true)
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '开始录制失败')
    }
  }

  const replayCase = async (id: string, startUrl: string): Promise<void> => {
    try {
      const file = await window.atp.invoke('case:get', { id })
      setSelected({ kind: 'case', id })
      await navigate(file.case.startUrl || startUrl)
      setReplaying(true)
      setReplayProgress({ runId: null, index: 0, total: file.case.steps.length })
      await window.atp.invoke('replay:start', { caseId: id, mode: replayMode })
      toast.success('回放完成，结果见右侧「报告」')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '回放失败')
    } finally {
      setReplaying(false)
      setReplayProgress(null)
      void qc.invalidateQueries({ queryKey: ['runs'] })
    }
  }

  const openDemo = async (): Promise<void> => {
    try {
      await navigate(`${window.location.origin}/demo`)
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '打开演示页失败')
    }
  }

  return (
    <div className="atp-stage min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1040px] px-6 py-6">
        <div className="mb-4">
          <h1 className="text-[21px] font-semibold tracking-tight">继续上次的工作</h1>
          <p className="mt-0.5 text-xs text-muted">录制、回放，或从一句话开始。</p>
        </div>

        <div className="grid gap-3.5 lg:grid-cols-[1.45fr_1fr]">
          <div className="space-y-3.5">
            <section className={`${CARD} border-accent/30 p-4`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                <Clock size={12} />
                继续上次
              </div>
              {continueCase ? (
                <>
                  <h2 className="mt-1.5 text-lg font-semibold tracking-tight">
                    {continueCase.name}
                  </h2>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    {continueFile ? `${continueFile.case.steps.length} 步` : '—'} ·{' '}
                    {relativeTime(continueCase.updatedAt)}更新
                  </p>
                  {continueRun && (
                    <p className="mt-2 flex items-center gap-1.5 text-[11px]">
                      <span
                        className={`size-1.5 rounded-full ${
                          continueRun.status === 'passed' ? 'bg-green-500' : 'bg-red-500'
                        }`}
                      />
                      <span className="text-muted">
                        上次运行 {continueRun.status === 'passed' ? '通过' : '失败'}
                        {durationOf(continueRun) ? ` · ${durationOf(continueRun)}` : ''} ·{' '}
                        {timeOf(continueRun.startedAt)}
                      </span>
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onPress={() => void openCase(continueCase.id, continueCase.startUrl)}
                    >
                      继续编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => void replayCase(continueCase.id, continueCase.startUrl)}
                    >
                      <Play size={12} />
                      回放
                    </Button>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  还没有用例。先在左侧新建一个，录一次就会出现在这里。
                </p>
              )}
            </section>

            <section className={CARD}>
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <h2 className="text-[12.5px] font-semibold">最近用例</h2>
                <span className="text-[10px] text-muted">{cases.length} 个</span>
              </div>
              <div className="p-1.5">
                {sortedCases.slice(0, 4).map((item) => {
                  const run = latestRunByCase.get(item.id)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void openCase(item.id, item.startUrl)}
                      className="grid w-full grid-cols-[14px_1fr_auto_auto] items-center gap-2 rounded-md px-2 py-2 text-left text-[11.5px] hover:bg-default"
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          run?.status === 'passed'
                            ? 'bg-green-500'
                            : run?.status === 'failed'
                              ? 'bg-red-500'
                              : 'bg-separator'
                        }`}
                      />
                      <span className="truncate font-medium">{item.name}</span>
                      <span className="font-mono text-[10px] text-muted">{durationOf(run)}</span>
                      <span className="font-mono text-[10px] text-muted">
                        {run ? timeOf(run.startedAt) : relativeTime(item.updatedAt)}
                      </span>
                    </button>
                  )
                })}
                {cases.length === 0 && (
                  <p className="px-2 py-3 text-[11px] text-muted">还没有用例。</p>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-3.5">
            <section className={`${CARD} p-4`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                <Play size={12} />
                快速开始
              </div>
              <input
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void openUrl()
                }}
                placeholder="输入被测页面地址"
                aria-label="被测页面地址"
                className="mt-2.5 h-8 w-full rounded-md border border-border bg-field px-2.5 font-mono text-[11px] text-foreground outline-none placeholder:text-muted focus:border-accent/60"
                spellCheck={false}
              />
              <Button
                size="sm"
                variant="secondary"
                className="mt-2 w-full"
                onPress={() => void openUrl()}
              >
                打开并连接 Chrome
              </Button>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  className="flex h-14 flex-col items-start justify-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11.5px] font-medium hover:border-accent hover:bg-accent/5"
                >
                  <Circle size={15} className="text-red-500" fill="currentColor" />
                  开始录制
                </button>
                <button
                  type="button"
                  onClick={() => void openDemo()}
                  className="flex h-14 flex-col items-start justify-center gap-1 rounded-md border border-border bg-surface px-2.5 text-[11.5px] font-medium hover:border-accent hover:bg-accent/5"
                >
                  <Globe size={15} className="text-accent" />
                  打开演示页
                </button>
              </div>
            </section>

            <section className={`${CARD} p-4`}>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                <ChartNoAxesColumn size={12} />
                本周
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                {[
                  { value: stats.total, label: '运行' },
                  { value: `${stats.rate}%`, label: '通过' },
                  {
                    value: stats.failed,
                    label: '失败',
                    danger: stats.failed > 0,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-md border border-border bg-surface-secondary p-2"
                  >
                    <div
                      className={`text-[17px] font-semibold tracking-tight ${
                        item.danger ? 'text-red-500' : ''
                      }`}
                    >
                      {item.value}
                    </div>
                    <div className="text-[9.5px] text-muted">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex h-16 items-end gap-1.5 border-b border-border px-1">
                {days.map((day, index) => (
                  <div
                    key={`${day.label}-${index}`}
                    className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                  >
                    <div
                      className={`w-full max-w-5 rounded-t ${
                        day.count === 0 ? 'bg-default' : 'bg-accent/45'
                      }`}
                      style={{ height: `${Math.max(8, (day.count / maxRuns) * 100)}%` }}
                    />
                    <span className="text-[8.5px] text-muted">{day.label}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <div className="mt-3.5 flex items-center gap-3 rounded-lg border border-accent/30 bg-surface p-3 shadow-surface">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/10 text-accent">
            <Sparkles size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold">用一句话开始测试</span>
            <span className="block truncate text-[11px] text-muted">
              描述要测什么，例如：新建一条电影内容，并验证列表中出现
            </span>
          </span>
          <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-600 dark:text-amber-400">
            AI 即将支持
          </span>
        </div>
      </div>
    </div>
  )
}
