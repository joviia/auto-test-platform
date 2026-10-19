import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { AiConfig } from '@atp/model'
import { type LanguageModel, type ModelMessage, stepCountIs, streamText, type ToolSet } from 'ai'
import type { ResolvedAiProfile } from './config.js'

export interface ProviderContext {
  url?: string
  caseId?: string
  caseName?: string
  runId?: string
}

export interface ProviderRunInput {
  system: string
  messages: ModelMessage[]
  tools: ToolSet
  context: ProviderContext
  signal: AbortSignal
  onText: (text: string) => void
  onReasoning: (text: string) => void
  onError: (message: string) => void
  /** Stub 模式下直接调用工具（真实 provider 由 AI SDK 自己执行工具） */
  callTool: (name: string, input: unknown) => Promise<unknown>
}

export interface CopilotProvider {
  readonly provider: string
  readonly model: string
  readonly stub: boolean
  run(input: ProviderRunInput): Promise<ModelMessage[]>
}

class StubProvider implements CopilotProvider {
  readonly provider = 'stub'
  readonly model = 'stub'
  readonly stub = true

  constructor(private readonly reason?: string) {}

  async run(input: ProviderRunInput): Promise<ModelMessage[]> {
    const { context } = input
    const pause = (ms = 220): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
    input.onText('当前是演示模式：没有配置真实模型，我会展示 Agent 的观察与工具卡片。\n\n')
    if (this.reason) input.onText(`（${this.reason}）\n\n`)
    await pause()

    try {
      await input.callTool('browser_snapshot', {})
      await pause()
      input.onText('页面已经快照完成。\n\n')
    } catch (err) {
      input.onText(`页面暂时不可观察：${err instanceof Error ? err.message : String(err)}\n\n`)
    }

    if (context.runId) {
      try {
        await input.callTool('run_get', { runId: context.runId })
        await pause()
        input.onText('运行记录已读取，右侧卡片里能看到步骤结果。\n\n')
      } catch {
        input.onText('运行记录读取失败。\n\n')
      }
    }

    if (context.caseId) {
      try {
        await input.callTool('case_get', { id: context.caseId })
        await pause()
        input.onText('用例结构已读取。\n\n')
      } catch {
        input.onText('用例读取失败。\n\n')
      }
    }

    await pause()
    input.onText(
      '已验证：快照与记录读取链路正常。\n假设：真实模型接入后会在此基础上自主操作与验证。\n未完成：配置 ATP_AI_API_KEY（或 DEEPSEEK_API_KEY / ANTHROPIC_API_KEY）后即可使用真实 Agent。',
    )
    return []
  }
}

class AiSdkProvider implements CopilotProvider {
  constructor(
    readonly provider: string,
    readonly model: string,
    private readonly languageModel: LanguageModel,
  ) {}

  readonly stub = false

  async run(input: ProviderRunInput): Promise<ModelMessage[]> {
    const result = streamText({
      model: this.languageModel,
      instructions: input.system,
      messages: input.messages,
      tools: input.tools,
      stopWhen: stepCountIs(20),
      abortSignal: input.signal,
      onError: ({ error }) => {
        input.onError(error instanceof Error ? error.message : String(error))
      },
    })

    for await (const part of result.stream) {
      if (part.type === 'text-delta') input.onText(part.text)
      else if (part.type === 'reasoning-delta') input.onReasoning(part.text)
      else if (part.type === 'error') {
        input.onError(part.error instanceof Error ? part.error.message : String(part.error))
      }
    }
    return (await result.responseMessages) as ModelMessage[]
  }
}

export interface ProviderBundle {
  provider: CopilotProvider
  config: AiConfig
}

/** 按 profile 构建 provider；配置不可用时退回 Stub，保证界面可用 */
export function createCopilotProvider(resolved: ResolvedAiProfile): ProviderBundle {
  const { profile } = resolved
  if (!resolved.ready || profile.kind === 'stub') {
    return {
      provider: new StubProvider(resolved.reason),
      config: {
        ready: false,
        provider: 'stub',
        model: 'stub',
        stub: true,
        ...(resolved.reason ? { reason: resolved.reason } : {}),
        env: resolved.env,
      },
    }
  }

  const apiKey = resolved.apiKey ?? ''
  let model: LanguageModel
  if (profile.kind === 'deepseek') {
    const provider = createDeepSeek({
      apiKey,
      ...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
    })
    model = provider(profile.model)
  } else if (profile.kind === 'anthropic') {
    const provider = createAnthropic({
      apiKey,
      ...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
    })
    model = provider(profile.model)
  } else {
    if (!profile.baseURL) throw new Error('OpenAI 兼容 profile 缺少 baseURL')
    const provider = createOpenAICompatible({
      name: 'atp',
      baseURL: profile.baseURL,
      apiKey,
    })
    model = provider.chatModel(profile.model)
  }

  return {
    provider: new AiSdkProvider(resolved.name, profile.model, model),
    config: {
      ready: true,
      provider: resolved.name,
      model: profile.model,
      stub: false,
      env: resolved.env,
    },
  }
}
