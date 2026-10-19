import type {
  AiConfig,
  AiModelsInput,
  AiModelsResult,
  AiSaveConfigInput,
  AiSendInput,
  AiTarget,
  AiTestInput,
  AiTestResult,
  AiToolEndPayload,
  AiToolStartPayload,
} from '@atp/model'
import { generateText, type ModelMessage, stepCountIs, type ToolSet, tool } from 'ai'
import { z } from 'zod'
import type { ChromeController } from '../browser.js'
import { loadAiProfile, resolveConnectionProfile, saveAiProfile } from './config.js'
import {
  createCopilotProvider,
  createLanguageModel,
  deepseekProviderOptions,
  type ProviderBundle,
  type ProviderContext,
} from './provider.js'
import { COPILOT_TOOL_MAP, type CopilotTool, type CopilotToolContext } from './tools.js'

export type CopilotEvent =
  | { type: 'ai-start'; sessionId: string; messageId: string }
  | {
      type: 'ai-delta'
      sessionId: string
      messageId: string
      kind: 'text' | 'reasoning'
      text: string
    }
  | ({ type: 'ai-tool-start' } & AiToolStartPayload)
  | ({ type: 'ai-tool-end' } & AiToolEndPayload)
  | { type: 'ai-done'; sessionId: string; messageId: string; cancelled?: boolean }
  | { type: 'ai-error'; sessionId?: string; messageId?: string; error: string }

interface Session {
  id: string
  messages: ModelMessage[]
}

export interface CopilotServiceOptions {
  dataDir: string
  getBrowser: () => ChromeController | null
  onEvent: (event: CopilotEvent) => void
}

const SYSTEM_PROMPT = `你是 ATP（本地 Web UI 自动化测试平台）的测试 Copilot。

你能直接操作受控的真实 Chrome，也能读取用例库与执行记录。

工作方式：
1. 操作前先调用 browser_snapshot 观察页面；不要猜 CSS/XPath。
2. 需要确认视觉状态时调用 browser_screenshot。
3. 每次操作后用 browser_snapshot 或 browser_assert_visible 验证结果；失败时说明原因，必要时重试一次。
4. 超过 3 步的任务先给出简短计划，再逐步执行。
5. 只操作被测页面；不要访问与任务无关的站点。
6. 结束时用三行总结：已验证 / 假设 / 未完成。
7. 用中文回答，简洁，不展示内部推理过程。`

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function toolLabel(name: string, input: Record<string, unknown>): string {
  const element =
    typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined
  const ref = typeof input.ref === 'string' ? input.ref : ''
  const target = element ?? ref
  switch (name) {
    case 'browser_snapshot':
      return '观察页面'
    case 'browser_screenshot':
      return '截取当前页面'
    case 'browser_navigate':
      return `打开 ${String(input.url ?? '')}`
    case 'browser_click':
      return `点击「${target}」`
    case 'browser_fill':
      return `填写「${target}」`
    case 'browser_select':
      return `选择「${target}」`
    case 'browser_check':
      return `勾选「${target}」`
    case 'browser_uncheck':
      return `取消勾选「${target}」`
    case 'browser_press':
      return `按键 ${String(input.key ?? '')}`
    case 'browser_scroll':
      return `滚动页面`
    case 'browser_wait':
      return `等待 ${String(input.ms ?? 0)}ms`
    case 'browser_assert_visible':
      return `断言「${target}」可见`
    case 'case_list':
      return '查看用例库'
    case 'case_get':
      return '读取用例'
    case 'run_list':
      return '查看执行记录'
    case 'run_get':
      return '读取运行记录'
    default:
      return name
  }
}

function scrubSecret(text: string, key?: string): string {
  return key ? text.split(key).join('***') : text
}

/**
 * Copilot 会话与工具循环。
 * 真实模型走 Vercel AI SDK；没有配置 key 时走 Stub，保证界面与 E2E 可运行。
 */
export class CopilotService {
  private sessions = new Map<string, Session>()
  private activeAbort: AbortController | null = null
  private bundle: ProviderBundle | null = null
  private config: AiConfig | null = null

  constructor(private readonly options: CopilotServiceOptions) {}

  async init(): Promise<void> {
    if (this.bundle) return
    await this.reload()
  }

  /** 重新读取配置并替换 provider；正在执行的任务持有旧 provider，不会被打断 */
  async reload(): Promise<AiConfig> {
    const resolved = await loadAiProfile(this.options.dataDir)
    this.bundle = createCopilotProvider(resolved)
    this.config = this.bundle.config
    return this.config
  }

  async saveConfig(input: AiSaveConfigInput): Promise<AiConfig> {
    await saveAiProfile(this.options.dataDir, input)
    return this.reload()
  }

  /** 用设置弹窗里尚未保存的值做一次最小调用，验证鉴权与工具调用 */
  async test(input: AiTestInput): Promise<AiTestResult> {
    const resolved = await resolveConnectionProfile(this.options.dataDir, input)
    if (!resolved.ready || !resolved.apiKey) {
      return {
        ok: false,
        latencyMs: 0,
        model: input.model,
        toolCall: false,
        error: resolved.reason ?? '请先填写 API Key',
      }
    }

    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    const thinking =
      resolved.profile.kind === 'deepseek'
        ? deepseekProviderOptions(resolved.profile.thinking)
        : undefined
    try {
      const model = createLanguageModel(resolved.profile, resolved.apiKey)
      const result = await generateText({
        model,
        messages: [
          {
            role: 'user',
            content: '请调用 ping 工具，把 value 设为 ok，然后只回复 OK。',
          },
        ],
        tools: {
          ping: tool({
            description: '连通性测试工具：原样返回传入的 value',
            inputSchema: z.object({ value: z.string() }),
            execute: async ({ value }) => ({ echoed: value }),
          }),
        },
        stopWhen: stepCountIs(3),
        abortSignal: controller.signal,
        ...(thinking ? { providerOptions: thinking } : {}),
      })
      const toolCall = result.steps.some((step) => step.toolCalls.length > 0)
      return {
        ok: true,
        latencyMs: Date.now() - started,
        model: input.model,
        toolCall,
        ...(result.text ? { detail: result.text.slice(0, 300) } : {}),
      }
    } catch (err) {
      const detail = scrubSecret(err instanceof Error ? err.message : String(err), resolved.apiKey)
      const status = (err as { statusCode?: number }).statusCode
      let error = detail.slice(0, 300)
      if (status === 401) error = '401 认证失败：API Key 无效或已过期'
      else if (status === 403) error = '403 无权限：请确认 Key 的权限或网关策略'
      else if (status === 404) error = '404 模型或接口不存在：请检查模型名与 Base URL'
      else if (status === 429) error = '429 请求过多：稍后再试或检查额度'
      else if (
        err instanceof Error &&
        (err.name === 'AbortError' || /aborted/i.test(err.message))
      ) {
        error = '请求超时（20s）：请检查 Base URL 与网络'
      }
      return {
        ok: false,
        latencyMs: Date.now() - started,
        model: input.model,
        toolCall: false,
        error,
        ...(detail ? { detail } : {}),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 读取服务商模型列表；失败时由设置弹窗回落到本地建议值 */
  async models(input: AiModelsInput): Promise<AiModelsResult> {
    const resolved = await resolveConnectionProfile(this.options.dataDir, {
      provider: input.provider,
      model: input.model ?? 'deepseek-flash',
      ...(input.baseURL ? { baseURL: input.baseURL } : {}),
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    })
    if (!resolved.apiKey) {
      return { models: [], error: resolved.reason ?? '请先填写 API Key' }
    }
    const profile = resolved.profile
    const base = (
      profile.baseURL ??
      (profile.kind === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com')
    ).replace(/\/$/, '')
    const url = profile.kind === 'anthropic' ? `${base}/v1/models?limit=100` : `${base}/models`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(url, {
        headers:
          profile.kind === 'anthropic'
            ? { 'x-api-key': resolved.apiKey, 'anthropic-version': '2023-06-01' }
            : { Authorization: `Bearer ${resolved.apiKey}` },
        signal: controller.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        return {
          models: [],
          error: `获取模型列表失败（${response.status}）：${scrubSecret(text.slice(0, 200), resolved.apiKey)}`,
        }
      }
      const json = JSON.parse(text) as unknown[] | { data?: unknown; models?: unknown }
      const list = Array.isArray(json)
        ? json
        : Array.isArray(json.data)
          ? json.data
          : Array.isArray(json.models)
            ? json.models
            : []
      const models = list.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const row = item as Record<string, unknown>
        const id = typeof row.id === 'string' ? row.id : undefined
        if (!id) return []
        return [
          {
            id,
            ...(typeof row.name === 'string'
              ? { name: row.name }
              : typeof row.display_name === 'string'
                ? { name: row.display_name }
                : {}),
            ...(typeof row.context_window === 'number'
              ? { contextWindow: row.context_window }
              : typeof row.max_input_tokens === 'number'
                ? { contextWindow: row.max_input_tokens }
                : {}),
            ...(typeof row.max_output_tokens === 'number'
              ? { maxOutputTokens: row.max_output_tokens }
              : {}),
            ...(Array.isArray(row.input_modalities)
              ? {
                  inputModalities: row.input_modalities.filter(
                    (value): value is string => typeof value === 'string',
                  ),
                }
              : {}),
          },
        ]
      })
      return { models }
    } catch (err) {
      return {
        models: [],
        error: scrubSecret(err instanceof Error ? err.message : String(err), resolved.apiKey),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  get aiConfig(): AiConfig {
    if (!this.config) {
      return {
        ready: false,
        provider: 'stub',
        model: 'stub',
        stub: true,
        kind: 'stub',
        hasKey: false,
        keySource: 'none',
        reason: 'Copilot 尚未初始化',
        env: [],
      }
    }
    return this.config
  }

  async send(input: AiSendInput): Promise<{ sessionId: string; messageId: string }> {
    if (this.activeAbort) throw new Error('Copilot 正在执行，请先停止')
    await this.init()
    const session = input.sessionId
      ? (this.sessions.get(input.sessionId) ?? { id: input.sessionId, messages: [] })
      : { id: newId('s'), messages: [] }
    this.sessions.set(session.id, session)
    const messageId = newId('m')
    const abort = new AbortController()
    this.activeAbort = abort
    const context: ProviderContext = {
      url: input.context?.url || this.options.getBrowser()?.currentUrl || undefined,
      caseId: input.context?.caseId,
      caseName: input.context?.caseName,
      runId: input.context?.runId,
    }
    this.options.onEvent({ type: 'ai-start', sessionId: session.id, messageId })
    void this.run(session, messageId, input.message, context, abort).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      this.options.onEvent({ type: 'ai-error', sessionId: session.id, messageId, error: message })
      this.options.onEvent({ type: 'ai-done', sessionId: session.id, messageId })
    })
    return { sessionId: session.id, messageId }
  }

  cancel(sessionId?: string): { ok: true } {
    if (sessionId && this.activeSessionId !== sessionId) return { ok: true }
    this.activeAbort?.abort()
    return { ok: true }
  }

  private activeSessionId: string | null = null

  private async run(
    session: Session,
    messageId: string,
    userText: string,
    context: ProviderContext,
    abort: AbortController,
  ): Promise<void> {
    this.activeSessionId = session.id
    const provider = this.bundle?.provider
    if (!provider) {
      this.options.onEvent({
        type: 'ai-error',
        sessionId: session.id,
        messageId,
        error: 'Copilot 未初始化',
      })
      this.options.onEvent({ type: 'ai-done', sessionId: session.id, messageId })
      return
    }
    const system = buildSystemPrompt(context)
    const history: ModelMessage[] = [...session.messages, { role: 'user', content: userText }]
    const tools = this.buildTools(session, messageId, abort.signal)
    let cancelled = false
    try {
      const responseMessages = await provider.run({
        system,
        messages: history,
        tools,
        context,
        signal: abort.signal,
        onText: (text) =>
          this.options.onEvent({
            type: 'ai-delta',
            sessionId: session.id,
            messageId,
            kind: 'text',
            text,
          }),
        onReasoning: (text) =>
          this.options.onEvent({
            type: 'ai-delta',
            sessionId: session.id,
            messageId,
            kind: 'reasoning',
            text,
          }),
        onError: (error) =>
          this.options.onEvent({ type: 'ai-error', sessionId: session.id, messageId, error }),
        callTool: (name, input) =>
          this.callToolByName(session, messageId, name, input, abort.signal),
      })
      session.messages = [...history, ...responseMessages].slice(-24)
    } catch (err) {
      if (abort.signal.aborted) {
        cancelled = true
      } else {
        this.options.onEvent({
          type: 'ai-error',
          sessionId: session.id,
          messageId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    } finally {
      this.activeAbort = null
      this.activeSessionId = null
      this.options.onEvent({
        type: 'ai-done',
        sessionId: session.id,
        messageId,
        ...(cancelled ? { cancelled: true } : {}),
      })
    }
  }

  private buildTools(session: Session, messageId: string, signal: AbortSignal): ToolSet {
    const tools: ToolSet = {}
    for (const def of COPILOT_TOOL_MAP.values()) {
      tools[def.name] = tool({
        description: def.description,
        inputSchema: def.schema,
        execute: async (input) => this.executeTool(session, messageId, def, input, signal),
      })
    }
    return tools
  }

  private async callToolByName(
    session: Session,
    messageId: string,
    name: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const def = COPILOT_TOOL_MAP.get(name)
    if (!def) throw new Error(`未知工具：${name}`)
    return this.executeTool(session, messageId, def, input, signal)
  }

  private async executeTool(
    session: Session,
    messageId: string,
    def: CopilotTool,
    rawInput: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const input = (rawInput ?? {}) as Record<string, unknown>
    const callId = newId('tc')
    this.options.onEvent({
      type: 'ai-tool-start',
      sessionId: session.id,
      messageId,
      callId,
      name: def.name,
      label: toolLabel(def.name, input),
      input,
    })
    const startedAt = Date.now()
    const ctx: CopilotToolContext = {
      sessionId: session.id,
      callId,
      dataDir: this.options.dataDir,
      browser: this.options.getBrowser,
      signal,
    }
    try {
      const outcome = await def.run(input, ctx)
      this.options.onEvent({
        type: 'ai-tool-end',
        sessionId: session.id,
        messageId,
        callId,
        status: 'ok',
        output: outcome.result,
        ...(outcome.evidenceUrl ? { evidenceUrl: outcome.evidenceUrl } : {}),
        ...(outcome.target ? { target: outcome.target as AiTarget } : {}),
        durationMs: Date.now() - startedAt,
      })
      return outcome.result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.options.onEvent({
        type: 'ai-tool-end',
        sessionId: session.id,
        messageId,
        callId,
        status: 'error',
        error: message,
        durationMs: Date.now() - startedAt,
      })
      // 工具失败回给模型，让它决定重试或换一种方式
      return { error: message }
    }
  }
}

function buildSystemPrompt(context: ProviderContext): string {
  const lines = [SYSTEM_PROMPT, '', '当前上下文：']
  lines.push(`- 页面：${context.url ?? '（尚未打开页面）'}`)
  if (context.caseId) {
    lines.push(`- 用例：${context.caseName ?? context.caseId}（id=${context.caseId}）`)
  } else {
    lines.push('- 用例：未选择')
  }
  if (context.runId) lines.push(`- 运行记录：${context.runId}（可调用 run_get 查看步骤）`)
  else lines.push('- 运行记录：未选择')
  return lines.join('\n')
}
