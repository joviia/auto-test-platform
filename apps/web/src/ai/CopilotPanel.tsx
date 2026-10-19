import type { AiEnvironment } from '@atp/model'
import { Button, toast } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUp,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  FileText,
  Globe,
  History,
  Info,
  Loader2,
  PanelRightClose,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCases, usePlans, useProjects } from '../api/client'
import { useUiStore } from '../state/ui-store'
import type { AiContext, AiMessage, AiToolCall } from './types'

function clip(text: string, max = 1400): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const MODE_LABEL: Record<AiEnvironment['mode'], string> = {
  launch: '启动台',
  editing: '编辑/浏览',
  recording: '录制中',
  replaying: '回放中',
  plan: '计划执行中',
}

function hostOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch {
    return url
  }
}

export function CopilotPanel() {
  const aiConfig = useUiStore((s) => s.aiConfig)
  const setAiConfig = useUiStore((s) => s.setAiConfig)
  const messages = useUiStore((s) => s.aiMessages)
  const running = useUiStore((s) => s.aiRunning)
  const seed = useUiStore((s) => s.aiSeed)
  const consumeAiSeed = useUiStore((s) => s.consumeAiSeed)
  const setAiOpen = useUiStore((s) => s.setAiOpen)
  const setAiSettingsOpen = useUiStore((s) => s.setAiSettingsOpen)
  const resetAi = useUiStore((s) => s.resetAi)
  const url = useUiStore((s) => s.url)
  const selected = useUiStore((s) => s.selected)
  const selectedRunId = useUiStore((s) => s.selectedRunId)
  const currentProjectId = useUiStore((s) => s.currentProjectId)
  const recording = useUiStore((s) => s.recording)
  const liveSteps = useUiStore((s) => s.liveSteps)
  const draftRecording = useUiStore((s) => s.draftRecording)
  const replaying = useUiStore((s) => s.replaying)
  const planProgress = useUiStore((s) => s.planProgress)
  const navTab = useUiStore((s) => s.navTab)
  const { data: cases = [] } = useCases(currentProjectId)
  const { data: projects = [] } = useProjects()
  const { data: plans = [] } = usePlans(currentProjectId)

  const [text, setText] = useState('')
  const [envOpen, setEnvOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const { data: config } = useQuery({
    queryKey: ['ai', 'config'],
    queryFn: () => window.atp.invoke('ai:config'),
    staleTime: 30_000,
  })
  useEffect(() => {
    if (config) setAiConfig(config)
  }, [config, setAiConfig])

  // 流式输出 / 工具卡展开会改变内容高度：只在用户停在底部时自动跟随
  useEffect(() => {
    const list = listRef.current
    const content = contentRef.current
    if (!list || !content) return
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) list.scrollTop = list.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const caseName =
    selected?.kind === 'case' ? cases.find((item) => item.id === selected.id)?.name : undefined

  const environment = useMemo<AiEnvironment>(() => {
    const mode: AiEnvironment['mode'] = recording
      ? 'recording'
      : replaying
        ? 'replaying'
        : planProgress
          ? 'plan'
          : url
            ? 'editing'
            : 'launch'
    const project = projects.find((item) => item.id === currentProjectId)
    const plan =
      selected?.kind === 'plan' ? plans.find((item) => item.id === selected.id) : undefined
    const value: AiEnvironment = { mode, navTab }
    if (url) value.url = url
    if (selected) value.selectedKind = selected.kind
    if (project) {
      value.projectId = project.id
      value.projectName = project.name
    }
    if (selected?.kind === 'case') {
      value.caseId = selected.id
      if (caseName) value.caseName = caseName
    }
    if (plan) {
      value.planId = plan.id
      value.planName = plan.name
    }
    if (selectedRunId) value.runId = selectedRunId
    if (recording) {
      value.recording = true
      value.recordedSteps = liveSteps.length
    }
    if (draftRecording) value.draftSteps = draftRecording.steps.length
    if (replaying) value.replaying = true
    if (planProgress) {
      value.planProgress = {
        caseName: planProgress.caseName,
        caseIndex: planProgress.caseIndex,
        caseTotal: planProgress.caseTotal,
        attempt: planProgress.attempt,
      }
    }
    return value
  }, [
    url,
    navTab,
    selected,
    caseName,
    selectedRunId,
    projects,
    currentProjectId,
    plans,
    recording,
    liveSteps.length,
    draftRecording,
    replaying,
    planProgress,
  ])

  const context = useMemo<AiContext>(() => {
    const value: AiContext = { environment }
    if (url) value.url = url
    if (selected?.kind === 'case') {
      value.caseId = selected.id
      if (caseName) value.caseName = caseName
    }
    if (selectedRunId) value.runId = selectedRunId
    return value
  }, [environment, url, selected, caseName, selectedRunId])

  const submit = useCallback(
    async (message: string, override?: AiContext): Promise<void> => {
      const trimmed = message.trim()
      if (!trimmed) return
      const store = useUiStore.getState()
      if (store.aiRunning) {
        toast.info('Copilot 正在执行，先停止当前任务再继续')
        return
      }
      const sessionId = store.aiSessionId
      store.addAiUserMessage(trimmed)
      store.setAiRunning(true)
      stickToBottom.current = true
      try {
        const payload = override ?? context
        await window.atp.invoke('ai:send', {
          message: trimmed,
          ...(sessionId ? { sessionId } : {}),
          ...(Object.keys(payload).length ? { context: payload } : {}),
        })
      } catch (err) {
        useUiStore.getState().addAiErrorMessage(err instanceof Error ? err.message : '发送失败')
      }
    },
    [context],
  )

  // 来自命令栏 / 报告 / 启动台的预置请求：消费一次后自动发送
  useEffect(() => {
    if (!seed) return
    consumeAiSeed(seed.id)
    void submit(seed.message, seed.context)
  }, [seed, consumeAiSeed, submit])

  const stop = async (): Promise<void> => {
    try {
      await window.atp.invoke('ai:cancel', {})
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '停止失败')
    }
  }

  const suggestions = useMemo(() => {
    const list: string[] = []
    if (selectedRunId) list.push('分析这次运行失败的原因，并给出修复建议')
    if (url) {
      list.push('描述当前页面，并给出 3 个值得测的场景')
      list.push('在当前页面上走一遍主流程，每一步都告诉我结果')
      list.push('从当前页面生成一条可执行的测试用例')
    } else {
      list.push('打开 https://demo.playwright.dev/todomvc/ 并添加一条待办')
      list.push('我该如何开始编写一条 Web 自动化用例？')
    }
    return list.slice(0, 3)
  }, [url, selectedRunId])

  const hasContext = Object.keys(context).length > 0
  const modelLabel = aiConfig?.stub ? '演示模式' : (aiConfig?.model ?? '未配置')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Sparkles size={13} className="shrink-0 text-accent" />
        <span className="text-[12px] font-semibold">Copilot</span>
        <button
          type="button"
          onClick={() => setAiSettingsOpen(true)}
          className={`max-w-[150px] truncate rounded px-1.5 py-px text-[9.5px] font-medium outline-none hover:ring-1 hover:ring-accent/30 ${
            aiConfig?.stub
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : 'bg-surface-secondary text-muted'
          }`}
          title={`${aiConfig?.reason ?? aiConfig?.provider ?? ''} · 点击配置模型`}
        >
          {modelLabel}
        </button>
        {aiConfig?.stub && aiConfig.reason && (
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted" title={aiConfig.reason}>
            · 未配置密钥
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              if (running) return
              resetAi()
            }}
            disabled={running || messages.length === 0}
            className="grid size-6 place-items-center rounded text-muted hover:bg-default hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="新会话"
            title="新会话"
          >
            <RotateCcw size={12} />
          </button>
          <button
            type="button"
            onClick={() => setAiOpen(false)}
            className="grid size-6 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
            aria-label="收起 Copilot"
            title="收起（⌘K 可再次唤起）"
          >
            <PanelRightClose size={12} />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-1.5">
        {url && (
          <span className="flex max-w-[60%] shrink-0 items-center gap-1 rounded border border-border bg-surface-secondary px-1.5 py-0.5 text-[10px] text-muted">
            <Globe size={9} className="shrink-0" />
            <span className="truncate">{hostOf(url)}</span>
          </span>
        )}
        {selected?.kind === 'case' && (
          <span className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-secondary px-1.5 py-0.5 text-[10px] text-muted">
            <FileText size={9} className="shrink-0" />
            <span className="max-w-[140px] truncate">{caseName ?? selected.id}</span>
          </span>
        )}
        {selectedRunId && (
          <span className="flex shrink-0 items-center gap-1 rounded border border-border bg-surface-secondary px-1.5 py-0.5 text-[10px] text-muted">
            <History size={9} className="shrink-0" />
            运行 {selectedRunId.slice(0, 8)}
          </span>
        )}
        {recording && (
          <span className="flex shrink-0 items-center gap-1 rounded border border-rose-500/30 bg-rose-500/[0.06] px-1.5 py-0.5 text-[10px] text-rose-600 dark:text-rose-400">
            <span className="size-1.5 animate-pulse rounded-full bg-rose-500" />
            录制 {liveSteps.length} 步
          </span>
        )}
        {draftRecording && (
          <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/[0.06] px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            待保存 {draftRecording.steps.length} 步
          </span>
        )}
        <button
          type="button"
          onClick={() => setEnvOpen((value) => !value)}
          aria-expanded={envOpen}
          aria-label="环境"
          className={`ml-auto flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] outline-none hover:bg-default ${
            envOpen ? 'text-foreground' : 'text-muted'
          }`}
          title="查看发送给模型的环境上下文"
        >
          <Info size={9} />
          环境
          {envOpen ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
        </button>
      </div>

      {envOpen && (
        <div className="shrink-0 border-b border-border bg-surface-secondary/40 px-3 py-2">
          <dl className="grid grid-cols-[52px_1fr] gap-x-2 gap-y-1 text-[10px] leading-4">
            <dt className="text-muted">模式</dt>
            <dd>{MODE_LABEL[environment.mode]}</dd>
            {environment.projectName && (
              <>
                <dt className="text-muted">项目</dt>
                <dd className="truncate">{environment.projectName}</dd>
              </>
            )}
            {environment.caseName && (
              <>
                <dt className="text-muted">用例</dt>
                <dd className="truncate">{environment.caseName}</dd>
              </>
            )}
            {environment.planName && (
              <>
                <dt className="text-muted">计划</dt>
                <dd className="truncate">{environment.planName}</dd>
              </>
            )}
            {environment.runId && (
              <>
                <dt className="text-muted">运行</dt>
                <dd className="truncate font-mono">{environment.runId.slice(0, 12)}</dd>
              </>
            )}
            {environment.url && (
              <>
                <dt className="text-muted">页面</dt>
                <dd className="truncate">{hostOf(environment.url)}</dd>
              </>
            )}
            {environment.recording && (
              <>
                <dt className="text-muted">录制</dt>
                <dd>进行中 · {environment.recordedSteps ?? 0} 步</dd>
              </>
            )}
            {environment.draftSteps !== undefined && (
              <>
                <dt className="text-muted">草稿</dt>
                <dd>{environment.draftSteps} 步待保存</dd>
              </>
            )}
            {environment.planProgress && (
              <>
                <dt className="text-muted">进度</dt>
                <dd className="truncate">
                  {environment.planProgress.caseName ?? '计划'} ·{' '}
                  {environment.planProgress.caseIndex + 1}/{environment.planProgress.caseTotal}
                </dd>
              </>
            )}
          </dl>
          <p className="mt-1.5 border-t border-border/60 pt-1.5 text-[9.5px] leading-4 text-muted">
            这些字段会随每条消息发送给模型。{hasContext ? '' : '当前没有页面或用例上下文。'}
          </p>
        </div>
      )}

      <div
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        <div ref={contentRef}>
          {messages.length === 0 ? (
            <div className="pt-6">
              <div className="mx-auto grid size-10 place-items-center rounded-xl border border-accent/25 bg-accent/[0.07] text-accent">
                <Sparkles size={19} />
              </div>
              <h3 className="mt-3 text-center text-[13px] font-semibold">让 Copilot 操作页面</h3>
              <p className="mx-auto mt-1 max-w-[280px] text-center text-[11.5px] leading-5 text-muted">
                Copilot 会先读取页面，再一步步点击、输入与验证；每一步都显示在中间舞台，可随时停止。
              </p>
              <div className="mt-4 space-y-1.5">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void submit(suggestion)}
                    className="flex w-full items-start gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-left text-[11.5px] leading-5 transition-colors hover:border-accent/40 hover:bg-accent/[0.04]"
                  >
                    <Sparkles size={11} className="mt-1 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1">{suggestion}</span>
                  </button>
                ))}
              </div>
              {aiConfig?.stub && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-2 text-[10.5px] leading-4 text-muted">
                  <Info size={11} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span>
                    {aiConfig.reason ?? '未配置模型密钥'}。当前用内置演示流程展示交互；
                    <button
                      type="button"
                      onClick={() => setAiSettingsOpen(true)}
                      className="font-medium text-accent outline-none hover:underline"
                    >
                      打开模型设置
                    </button>
                    填入 API Key 后自动切换为真实 Agent。
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <MessageItem key={message.id} message={message} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-2.5">
        <div className="rounded-lg border border-border bg-field p-2 transition-colors focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/10">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (!running && text.trim()) {
                  void submit(text)
                  setText('')
                }
              }
            }}
            rows={2}
            placeholder="描述要测什么，或让 Copilot 操作页面…"
            className="max-h-32 min-h-[42px] w-full resize-none bg-transparent text-[12.5px] leading-5 text-foreground outline-none placeholder:text-muted"
            spellCheck={false}
          />
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[9.5px] text-muted">Enter 发送 · Shift+Enter 换行</span>
            <span className="ml-auto" />
            {running ? (
              <Button size="sm" variant="secondary" onPress={() => void stop()}>
                <Square size={10} fill="currentColor" />
                停止
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                isDisabled={!text.trim()}
                onPress={() => {
                  void submit(text)
                  setText('')
                }}
              >
                <ArrowUp size={12} />
                发送
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageItem({ message }: { message: AiMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-accent px-2.5 py-1.5 text-[12.5px] leading-5 text-accent-foreground">
          {message.text}
        </div>
      </div>
    )
  }

  const streaming = message.pending
  const thinking = streaming && !message.text && message.tools.length === 0

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium text-muted">
        <Sparkles size={10} className="text-accent" />
        Copilot
        {streaming && <Loader2 size={10} className="animate-spin" />}
        {message.cancelled && (
          <span className="rounded bg-surface-secondary px-1 py-px text-[9.5px]">已停止</span>
        )}
      </div>

      {message.reasoning && (
        <details className="mb-1.5 rounded-md border border-border bg-surface-secondary/50 px-2 py-1.5">
          <summary className="cursor-pointer list-none text-[10.5px] text-muted hover:text-foreground">
            思考过程
          </summary>
          <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-[1.65] text-muted">
            {clip(message.reasoning, 2400)}
          </p>
        </details>
      )}

      {thinking && (
        <div className="flex items-center gap-1.5 py-1 text-[11.5px] text-muted">
          正在读取页面
          <span className="flex gap-1">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="size-1 animate-pulse rounded-full bg-muted"
                style={{ animationDelay: `${index * 150}ms` }}
              />
            ))}
          </span>
        </div>
      )}

      {message.text && (
        <p className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.7] text-foreground">
          {message.text}
          {streaming && (
            <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-accent align-text-bottom" />
          )}
        </p>
      )}

      <ToolGroup tools={message.tools} pending={streaming} />

      {message.error && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-red-500/30 bg-red-500/[0.05] px-2 py-1.5 text-[11px] leading-4 text-red-700 dark:text-red-400">
          <CircleAlert size={11} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{message.error}</span>
        </div>
      )}
    </div>
  )
}

/** 一次回复里的工具调用收成一组：执行中展开，完成后默认折叠成一行 */
function ToolGroup({ tools, pending }: { tools: AiToolCall[]; pending: boolean }) {
  const failed = tools.filter((tool) => tool.status === 'error').length
  const running = tools.some((tool) => tool.status === 'running')
  const [open, setOpen] = useState(pending || failed > 0)

  useEffect(() => {
    if (!pending) setOpen(failed > 0)
  }, [pending, failed])

  if (tools.length === 0) return null

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-md border bg-surface-secondary/40 px-2 py-1.5 text-left ${
          failed > 0 ? 'border-red-500/30' : 'border-border'
        }`}
      >
        {running || pending ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-accent" />
        ) : failed > 0 ? (
          <X size={11} className="shrink-0 text-red-600 dark:text-red-400" />
        ) : (
          <Check size={11} className="shrink-0 text-green-600 dark:text-green-400" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">
          {running
            ? `工具调用 · ${tools.length} 项执行中`
            : pending
              ? `工具调用 · ${tools.length} 次`
              : `工具调用 · ${tools.length} 次${failed > 0 ? ` · ${failed} 次失败` : ' · 全部成功'}`}
        </span>
        <ChevronDown
          size={11}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  )
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** 把高频工具的结果压成一行，原始 JSON 收进「原始结果」 */
function toolSummary(tool: AiToolCall): string | null {
  const output = objectOf(tool.output)
  if (!output) return null
  if (tool.name === 'browser_snapshot') {
    const title = typeof output.title === 'string' && output.title ? output.title : '无标题页面'
    const count = Array.isArray(output.elements) ? output.elements.length : 0
    return `${title} · ${count} 个可交互元素`
  }
  const element = objectOf(output.element)
  if (tool.name.startsWith('browser_') && element) {
    const role = typeof element.role === 'string' ? element.role : '元素'
    const name = typeof element.name === 'string' ? element.name : ''
    return `${role}${name ? ` · ${name}` : ''}`
  }
  if (tool.name === 'case_get') {
    const item = objectOf(output.case)
    if (item) {
      const steps = Array.isArray(item.steps) ? item.steps.length : 0
      return `用例「${String(item.name ?? '')}」· ${steps} 步`
    }
  }
  if (tool.name === 'run_get') {
    const run = objectOf(output.run)
    if (run) {
      const steps = Array.isArray(output.steps) ? output.steps.length : 0
      return `运行${run.status === 'passed' ? '通过' : '失败'} · ${steps} 步`
    }
  }
  return null
}

function ToolCard({ tool }: { tool: AiToolCall }) {
  const [open, setOpen] = useState(tool.status === 'error')

  useEffect(() => {
    if (tool.status === 'error') setOpen(true)
  }, [tool.status])

  const input = objectOf(tool.input)
  const inputEmpty = !input || Object.keys(input).length === 0
  const inputText = inputEmpty ? '' : clip(formatJson(tool.input))
  const outputText = clip(formatJson(tool.output))
  const summary = toolSummary(tool)
  const hasBody = Boolean(summary || inputText || outputText || tool.error || tool.evidenceUrl)

  return (
    <div
      className={`overflow-hidden rounded-md border bg-surface-secondary/40 ${
        tool.status === 'error' ? 'border-red-500/30' : 'border-border'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
        aria-expanded={open}
      >
        {tool.status === 'running' ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-accent" />
        ) : tool.status === 'ok' ? (
          <Check size={11} className="shrink-0 text-green-600 dark:text-green-400" />
        ) : (
          <X size={11} className="shrink-0 text-red-600 dark:text-red-400" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{tool.label}</span>
        {tool.evidenceUrl && <Camera size={10} className="shrink-0 text-muted" />}
        {tool.target && (
          <span className="shrink-0 rounded bg-accent/10 px-1 text-[9px] font-medium text-accent">
            已定位
          </span>
        )}
        {tool.durationMs !== undefined && (
          <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-muted">
            {tool.durationMs}ms
          </span>
        )}
        {hasBody && (
          <ChevronDown
            size={11}
            className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {open && hasBody && (
        <div className="space-y-2 border-t border-border px-2 py-1.5">
          {summary && <p className="break-words text-[10.5px] leading-4 text-muted">{summary}</p>}
          {inputText && (
            <div>
              <p className="mb-0.5 text-[9.5px] font-medium uppercase tracking-wide text-muted">
                参数
              </p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-surface px-1.5 py-1 font-mono text-[10px] leading-4 text-muted">
                {inputText}
              </pre>
            </div>
          )}
          {outputText && (
            <details>
              <summary className="cursor-pointer list-none text-[9.5px] font-medium uppercase tracking-wide text-muted hover:text-foreground">
                原始结果
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface px-1.5 py-1 font-mono text-[10px] leading-4 text-muted">
                {outputText}
              </pre>
            </details>
          )}
          {tool.error && (
            <p className="break-words rounded bg-red-500/[0.06] px-1.5 py-1 text-[10.5px] leading-4 text-red-700 dark:text-red-400">
              {tool.error}
            </p>
          )}
          {tool.target && (
            <p className="text-[10px] text-muted">
              高亮目标：{tool.target.role}
              {tool.target.name ? ` · ${tool.target.name}` : ''}
            </p>
          )}
          {tool.evidenceUrl && (
            <a
              href={tool.evidenceUrl}
              target="_blank"
              rel="noreferrer"
              className="block overflow-hidden rounded border border-border"
              title="打开操作后截图"
            >
              <img
                src={tool.evidenceUrl}
                alt={`${tool.label}操作后截图`}
                className="max-h-44 w-full object-cover"
              />
            </a>
          )}
        </div>
      )}
    </div>
  )
}
