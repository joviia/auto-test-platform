import { getDb } from '@atp/core'
import type {
  AiConfig,
  AiEnvironment,
  AiModelsInput,
  AiModelsResult,
  AiSaveConfigInput,
  AiSendInput,
  AiSessionMessage,
  AiSessionRow,
  AiStoredTool,
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
import {
  COPILOT_TOOL_MAP,
  type CopilotPlatform,
  type CopilotTool,
  type CopilotToolContext,
} from './tools.js'

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
  /** 已从 SQLite 恢复过上下文，避免重复读取 */
  loaded: boolean
}

/** 单轮运行的产出，用于取消/错误时也能完整落库 */
interface RunState {
  text: string
  reasoning: string
  tools: AiStoredTool[]
}

export interface CopilotServiceOptions {
  dataDir: string
  getBrowser: () => ChromeController | null
  platform: CopilotPlatform
  onEvent: (event: CopilotEvent) => void
}

const SYSTEM_PROMPT = `你是 ATP（本地 Web UI 自动化测试平台）的测试 Copilot。

平台模型：
- 项目 > 模块 > 用例。用例由步骤和元素库组成，可以回放并产生执行记录。
- 测试计划把多条用例组织起来批量执行。
- 平台有录制模式。用户说「录制」「录一条用例」时，调用 recording_start，完成操作后调用 recording_stop；平台会弹出保存对话框，由用户确认保存。
- 操作库里有确定性技能（滑块、文件上传、悬停菜单）。遇到这些控件先 skill_list，再 skill_run，不要自己猜坐标。
- 不确定平台里有什么项目、用例、计划或运行记录时，调用 workspace_state。
- 受控浏览器只用于被测系统。ATP 平台自身的界面不在这里，不要导航到平台 UI 去找用例页。
- 用例、计划、运行记录都用平台工具读取；用户要求执行或回放用例时直接调用 case_run，不要让用户手动去点回放。
- 修改已有用例：先用 case_get 读取，再用 case_propose 提交操作列表。平台会显示 diff 卡，用户确认后才写入；不要声称已经修改。
- 新建用例：用户要求从当前页面生成用例 / 把流程沉淀为用例时，先 browser_snapshot，再调用 case_plan，用快照里的 ref 指定目标。平台会显示计划卡，由用户决定执行和保存；不要声称已经保存或已经执行。
- case_plan 只支持 click / fill / select / press / scroll / wait / assert；需要悬停、上传、多标签等动作时，说明当前计划卡不支持。
- 单轮最多 50 次工具调用。不要因为需要用户点击而停下；如果达到上限，明确说明已完成和未完成。

工作方式：
1. 操作前先调用 browser_snapshot 观察页面；不要猜 CSS/XPath。
2. 需要确认视觉状态时调用 browser_screenshot。
3. 每次操作后用 browser_snapshot、browser_assert_visible 或 browser_wait_for 验证结果；失败时说明原因，必要时重试一次。
4. 超过 3 步的任务先给出简短计划，再逐步执行。
5. 只操作被测页面；不要访问与任务无关的站点。
6. 不要声称已经保存用例；只有用户确认保存对话框，或后续查询确实返回了用例，才算保存成功。
7. 结束时用三行总结：已验证 / 假设 / 未完成。
8. 用中文回答，简洁，不展示内部推理过程。`

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function sessionTitle(message: string): string {
  const text = message
    .replace(/[#>*`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 40) || '新会话'
}

/** 快照结果体积大，历史里只保留摘要；其余工具输出原样保存 */
function compactToolOutput(name: string, output: unknown): unknown {
  if (name === 'browser_snapshot' && output && typeof output === 'object') {
    const snapshot = output as { url?: unknown; title?: unknown; elements?: unknown[] }
    return {
      url: snapshot.url,
      title: snapshot.title,
      elements: Array.isArray(snapshot.elements) ? snapshot.elements.length : 0,
    }
  }
  if (name === 'browser_screenshot') return { ok: true }
  return output
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
    case 'browser_hover':
      return `悬停「${target}」`
    case 'browser_drag':
      return `拖拽「${target}」(${String(input.dx ?? 0)}, ${String(input.dy ?? 0)})`
    case 'browser_wait_for':
      return input.kind === 'networkIdle' ? '等待网络空闲' : `等待 ${String(input.kind ?? '')}`
    case 'skill_list':
      return '查看操作库'
    case 'skill_run':
      return `使用技能 ${String(input.id ?? '')}`
    case 'workspace_state':
      return '读取平台状态'
    case 'case_run':
      return `执行用例 ${String(input.caseId ?? '')}`
    case 'recording_start':
      return '开始录制'
    case 'recording_stop':
      return '停止录制'
    case 'browser_assert_visible':
      return `断言「${target}」可见`
    case 'case_list':
      return '查看用例库'
    case 'case_get':
      return '读取用例'
    case 'case_propose':
      return '提议修改用例'
    case 'case_plan':
      return '生成用例计划'
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

/** 日志兜底脱敏：不把常见的密钥形态写进本地日志 */
function redactForLog(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
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

  /** 供 SSE 建连时下发，修复客户端错过的 ai-start / ai-done */
  state(): { running: boolean; sessionId?: string; messageId?: string } {
    return {
      running: this.activeAbort !== null,
      ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}),
      ...(this.activeMessageId ? { messageId: this.activeMessageId } : {}),
    }
  }

  async listSessions(limit?: number): Promise<AiSessionRow[]> {
    return getDb()
      .uow()
      .aiSessions.list(limit ?? 30)
  }

  async getSession(id: string): Promise<{ session: AiSessionRow; messages: AiSessionMessage[] }> {
    const uow = getDb().uow()
    const session = await uow.aiSessions.get(id)
    if (!session) throw new Error(`会话不存在：${id}`)
    return { session, messages: await uow.aiSessions.messages(id) }
  }

  async deleteSession(id: string): Promise<void> {
    if (this.activeSessionId === id) throw new Error('会话正在执行，请先停止')
    this.sessions.delete(id)
    await getDb().uow().aiSessions.remove(id)
  }

  private async createSession(firstMessage: string): Promise<Session> {
    const row = await getDb().uow().aiSessions.create(sessionTitle(firstMessage))
    const session: Session = { id: row.id, messages: [], loaded: true }
    this.sessions.set(row.id, session)
    return session
  }

  /** 重启后首次发送时从 SQLite 重建模型上下文（只含文本） */
  private async loadSession(id: string): Promise<Session> {
    const existing = this.sessions.get(id)
    if (existing?.loaded) return existing
    const uow = getDb().uow()
    const row = await uow.aiSessions.get(id)
    if (!row) throw new Error('会话不存在或已被删除，请新开一个会话')
    const stored = await uow.aiSessions.messages(id)
    const messages = stored
      .filter((message) => message.text.trim())
      .map((message) => ({ role: message.role, content: message.text }) as ModelMessage)
      .slice(-40)
    const session: Session = { id, messages, loaded: true }
    this.sessions.set(id, session)
    return session
  }

  async send(input: AiSendInput): Promise<{ sessionId: string; messageId: string }> {
    if (this.activeAbort) throw new Error('Copilot 正在执行，请先停止')
    await this.init()
    const session = input.sessionId
      ? await this.loadSession(input.sessionId)
      : await this.createSession(input.message)
    await getDb().uow().aiSessions.append(session.id, 'user', { text: input.message })
    const messageId = newId('m')
    const abort = new AbortController()
    this.activeAbort = abort
    this.activeSessionId = session.id
    this.activeMessageId = messageId
    console.log(`[ai] start session=${session.id} message=${messageId}`)
    const context: ProviderContext = {
      url: input.context?.url || this.options.getBrowser()?.currentUrl || undefined,
      caseId: input.context?.caseId,
      caseName: input.context?.caseName,
      runId: input.context?.runId,
      environment: input.context?.environment,
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
    if (!this.activeAbort) {
      console.log('[ai] cancel ignored: no active run')
      return { ok: true }
    }
    console.log(`[ai] cancel session=${this.activeSessionId ?? ''}`)
    this.activeAbort.abort()
    return { ok: true }
  }

  private activeSessionId: string | null = null
  private activeMessageId: string | null = null

  private async run(
    session: Session,
    messageId: string,
    userText: string,
    context: ProviderContext,
    abort: AbortController,
  ): Promise<void> {
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
    const runState: RunState = { text: '', reasoning: '', tools: [] }
    const tools = this.buildTools(session, messageId, abort.signal, runState)
    let cancelled = false
    let errorText: string | undefined
    try {
      const responseMessages = await provider.run({
        system,
        messages: history,
        tools,
        context,
        signal: abort.signal,
        onText: (text) => {
          runState.text += text
          this.options.onEvent({
            type: 'ai-delta',
            sessionId: session.id,
            messageId,
            kind: 'text',
            text,
          })
        },
        onReasoning: (text) => {
          runState.reasoning += text
          this.options.onEvent({
            type: 'ai-delta',
            sessionId: session.id,
            messageId,
            kind: 'reasoning',
            text,
          })
        },
        onError: (error) => {
          errorText = errorText ?? error
          this.options.onEvent({ type: 'ai-error', sessionId: session.id, messageId, error })
        },
        callTool: (name, input) =>
          this.callToolByName(session, messageId, name, input, abort.signal, runState),
      })
      session.messages = [...history, ...responseMessages].slice(-40)
    } catch (err) {
      if (abort.signal.aborted) {
        cancelled = true
      } else {
        const text = err instanceof Error ? err.message : String(err)
        errorText = errorText ?? text
        console.log(`[ai] error session=${session.id} message=${messageId}: ${redactForLog(text)}`)
        this.options.onEvent({
          type: 'ai-error',
          sessionId: session.id,
          messageId,
          error: text,
        })
      }
    } finally {
      try {
        await getDb()
          .uow()
          .aiSessions.append(session.id, 'assistant', {
            text: runState.text,
            reasoning: runState.reasoning,
            tools: runState.tools,
            ...(cancelled ? { cancelled: true } : {}),
            ...(errorText ? { error: errorText } : {}),
          })
      } catch (err) {
        console.log(
          `[ai] persist error session=${session.id}: ${redactForLog(
            err instanceof Error ? err.message : String(err),
          )}`,
        )
      }
      this.activeAbort = null
      this.activeSessionId = null
      this.activeMessageId = null
      console.log(
        `[ai] done session=${session.id} message=${messageId}${cancelled ? ' cancelled' : ''}`,
      )
      this.options.onEvent({
        type: 'ai-done',
        sessionId: session.id,
        messageId,
        ...(cancelled ? { cancelled: true } : {}),
      })
    }
  }

  private buildTools(
    session: Session,
    messageId: string,
    signal: AbortSignal,
    runState: RunState,
  ): ToolSet {
    const tools: ToolSet = {}
    for (const def of COPILOT_TOOL_MAP.values()) {
      tools[def.name] = tool({
        description: def.description,
        inputSchema: def.schema,
        execute: async (input) =>
          this.executeTool(session, messageId, def, input, signal, runState),
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
    runState: RunState,
  ): Promise<unknown> {
    const def = COPILOT_TOOL_MAP.get(name)
    if (!def) throw new Error(`未知工具：${name}`)
    return this.executeTool(session, messageId, def, input, signal, runState)
  }

  private async executeTool(
    session: Session,
    messageId: string,
    def: CopilotTool,
    rawInput: unknown,
    signal: AbortSignal,
    runState: RunState,
  ): Promise<unknown> {
    const input = (rawInput ?? {}) as Record<string, unknown>
    const callId = newId('tc')
    const label = toolLabel(def.name, input)
    const stored: AiStoredTool = {
      id: callId,
      name: def.name,
      label,
      input,
      status: 'running',
    }
    runState.tools.push(stored)
    this.options.onEvent({
      type: 'ai-tool-start',
      sessionId: session.id,
      messageId,
      callId,
      name: def.name,
      label,
      input,
    })
    console.log(`[ai] tool start ${def.name}`)
    const startedAt = Date.now()
    const ctx: CopilotToolContext = {
      sessionId: session.id,
      callId,
      dataDir: this.options.dataDir,
      browser: this.options.getBrowser,
      platform: this.options.platform,
      signal,
    }
    try {
      const outcome = await def.run(input, ctx)
      const toolMs = Date.now() - startedAt
      console.log(`[ai] tool ok ${def.name} ${toolMs}ms`)
      stored.status = 'ok'
      stored.durationMs = toolMs
      stored.output = compactToolOutput(def.name, outcome.result)
      if (outcome.evidenceUrl) stored.evidenceUrl = outcome.evidenceUrl
      if (outcome.target) stored.target = outcome.target as AiTarget
      this.options.onEvent({
        type: 'ai-tool-end',
        sessionId: session.id,
        messageId,
        callId,
        name: def.name,
        status: 'ok',
        output: outcome.result,
        ...(outcome.evidenceUrl ? { evidenceUrl: outcome.evidenceUrl } : {}),
        ...(outcome.target ? { target: outcome.target as AiTarget } : {}),
        durationMs: toolMs,
      })
      return outcome.result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const toolMs = Date.now() - startedAt
      console.log(`[ai] tool error ${def.name} ${toolMs}ms: ${redactForLog(message)}`)
      stored.status = 'error'
      stored.durationMs = toolMs
      stored.error = message
      this.options.onEvent({
        type: 'ai-tool-end',
        sessionId: session.id,
        messageId,
        callId,
        name: def.name,
        status: 'error',
        error: message,
        durationMs: toolMs,
      })
      // 工具失败回给模型，让它决定重试或换一种方式
      return { error: message }
    }
  }
}

const MODE_LABEL: Record<AiEnvironment['mode'], string> = {
  launch: '启动台（还没有打开页面）',
  editing: '编辑/浏览',
  recording: '录制中',
  replaying: '回放中',
  plan: '计划执行中',
}

function buildSystemPrompt(context: ProviderContext): string {
  const lines = [SYSTEM_PROMPT, '', '当前环境：']
  const env = context.environment
  lines.push(`- 页面：${context.url ?? '（尚未打开页面）'}`)
  if (env) {
    lines.push(`- 模式：${MODE_LABEL[env.mode]}`)
    if (env.projectName || env.projectId) {
      lines.push(`- 项目：${env.projectName ?? env.projectId}`)
    }
    if (env.caseName || context.caseId) {
      lines.push(`- 用例：${env.caseName ?? context.caseName ?? context.caseId}`)
    }
    if (env.planName) lines.push(`- 测试计划：${env.planName}`)
    if (env.runId || context.runId) {
      lines.push(`- 运行记录：${env.runId ?? context.runId}`)
    }
    if (env.recording) lines.push(`- 录制：进行中，已捕获 ${env.recordedSteps ?? 0} 步`)
    if (env.draftSteps) lines.push(`- 待保存草稿：${env.draftSteps} 步`)
    if (env.replaying) lines.push('- 回放：进行中')
    if (env.planProgress) {
      const progress = env.planProgress
      lines.push(
        `- 计划进度：${progress.caseName ?? ''}（${progress.caseIndex + 1}/${progress.caseTotal}）`,
      )
    }
    if (env.navTab) lines.push(`- 左侧页签：${env.navTab}`)
    if (env.selectedKind) lines.push(`- 当前选中：${env.selectedKind}`)
  } else {
    if (context.caseId) {
      lines.push(`- 用例：${context.caseName ?? context.caseId}（id=${context.caseId}）`)
    } else {
      lines.push('- 用例：未选择')
    }
    if (context.runId) lines.push(`- 运行记录：${context.runId}（可调用 run_get 查看步骤）`)
    else lines.push('- 运行记录：未选择')
  }
  return lines.join('\n')
}
