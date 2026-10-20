import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { AiConfig, AiEnvironment, CaseFile } from '@atp/model'
import { type LanguageModel, type ModelMessage, stepCountIs, streamText, type ToolSet } from 'ai'
import type { AiThinking, ResolvedAiProfile } from './config.js'

export interface ProviderContext {
  url?: string
  caseId?: string
  caseName?: string
  runId?: string
  environment?: AiEnvironment
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

export interface AiProvider {
  readonly provider: string
  readonly model: string
  readonly stub: boolean
  run(input: ProviderRunInput): Promise<ModelMessage[]>
}

function lastUserText(messages: ModelMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .filter(Boolean)
        .join(' ')
    }
    return ''
  }
  return ''
}

const DESIGN_RULE_WORDS: Array<[RegExp, string]> = [
  [/必填/, 'required'],
  [/长度/, 'length'],
  [/格式/, 'format'],
  [/重复|唯一/, 'duplicate'],
  [/日期范围|日期/, 'date-range'],
  [/正常流|主流程|正向/, 'happy-path'],
]

const DESIGN_RULE_LABEL: Record<string, string> = {
  required: '必填',
  length: '长度',
  format: '格式',
  duplicate: '重复',
  'date-range': '日期范围',
  'happy-path': '正常流',
}

function designRuleIds(text: string): string[] {
  return DESIGN_RULE_WORDS.filter(([pattern]) => pattern.test(text)).map(([, id]) => id)
}

interface StubDesignRow {
  id: string
  label: string
  status: string
}

interface StubDesignScenario {
  id: string
  title: string
  ruleId: string
  rows: StubDesignRow[]
}

interface StubDesignQuery {
  revision?: number
  stats?: { scenarios?: number; rows?: number; readyRows?: number; pendingRows?: number }
  scenarios?: StubDesignScenario[]
}

function asCaseFile(value: unknown): CaseFile | null {
  if (!value || typeof value !== 'object') return null
  const file = value as { case?: { id?: unknown; steps?: unknown } }
  if (typeof file.case?.id !== 'string' || !Array.isArray(file.case.steps)) return null
  return value as CaseFile
}

class StubProvider implements AiProvider {
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

    // 设计工作台：脚本化覆盖筛选、改数据、接受/拒绝与执行，便于演示与 E2E
    if (context.environment?.design) {
      const text = lastUserText(input.messages)
      const ruleIds = designRuleIds(text)
      const ruleText =
        ruleIds.length > 0
          ? ruleIds.map((id) => DESIGN_RULE_LABEL[id] ?? id).join('、')
          : '当前范围'
      try {
        if (/执行|跑一下|跑一遍/.test(text)) {
          const result = (await input.callTool('design_run', {
            ...(ruleIds.length > 0 ? { ruleIds } : { allReady: true }),
          })) as { needsConfirmation?: boolean; message?: string; cases?: number }
          input.onText(
            result?.needsConfirmation
              ? `${result.message}\n\n`
              : `已开始执行 ${result?.cases ?? 0} 行数据，结果会按行回写。\n\n`,
          )
        } else if (/清空|全部|重置/.test(text)) {
          await input.callTool('design_select', { clear: true, filter: null })
          input.onText('已清空工作台的筛选与选择。\n\n')
        } else if (/只保留|筛选|只看|选中|保留/.test(text)) {
          await input.callTool('design_select', {
            ...(ruleIds.length > 0 ? { ruleIds } : {}),
            filter: ruleIds.length > 0 ? { ruleIds } : {},
          })
          input.onText(`已按 ${ruleText} 筛选，并选中对应的可执行行。\n\n`)
        } else if (/拒绝|接受/.test(text)) {
          const query = (await input.callTool('design_query', {})) as StubDesignQuery
          const targets =
            query.scenarios?.filter(
              (scenario) => ruleIds.length === 0 || ruleIds.includes(scenario.ruleId),
            ) ?? []
          const decision = text.includes('拒绝') ? 'rejected' : 'accepted'
          await input.callTool('design_decide', {
            decision,
            ...(targets.length > 0 ? { scenarioIds: targets.map((item) => item.id) } : {}),
          })
          input.onText(
            `已${decision === 'rejected' ? '拒绝' : '接受'} ${targets.length} 个场景（未入库）。\n\n`,
          )
        } else if (/改成|改为|修改|更新|设为/.test(text)) {
          const query = (await input.callTool('design_query', {})) as StubDesignQuery
          const scenarios =
            query.scenarios?.filter(
              (scenario) => ruleIds.length === 0 || ruleIds.includes(scenario.ruleId),
            ) ?? []
          const target =
            scenarios.find((scenario) => scenario.rows?.some((row) => row.status === 'ready')) ??
            scenarios[0]
          const row = target?.rows?.find((item) => item.status === 'ready') ?? target?.rows?.[0]
          const match = text.match(/(?:改成|改为|修改为|设为)\s*["“]?([^\s"”，。]+)/)
          const value = (match?.[1] ?? '').replace(/字$/, '')
          if (target && row && value) {
            await input.callTool('design_update_data', {
              updates: [{ scenarioId: target.id, dataRecordId: row.id, value }],
            })
            input.onText(`已把「${target.title}」的数据改为 ${value}，工作台底部可以撤销。\n\n`)
          } else {
            input.onText('没有找到可修改的可执行数据行；可以先打开设计工作台重新分析。\n\n')
          }
        } else {
          const query = (await input.callTool('design_query', {})) as StubDesignQuery
          input.onText(
            `当前设计 rev ${query.revision ?? '—'}：${query.stats?.scenarios ?? 0} 个场景 / ${query.stats?.rows ?? 0} 行数据，可执行 ${query.stats?.readyRows ?? 0} 行，待确认 ${query.stats?.pendingRows ?? 0} 行。\n\n`,
          )
        }
      } catch (err) {
        input.onText(`设计操作失败：${err instanceof Error ? err.message : String(err)}\n\n`)
      }
      await pause()
      return []
    }

    type StubSnapshot = {
      elements?: Array<{ ref: string; role: string; name: string; disabled?: boolean }>
    }
    let snapshot: StubSnapshot | null = null
    try {
      snapshot = (await input.callTool('browser_snapshot', {})) as StubSnapshot
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

    let caseFile: CaseFile | null = null
    if (context.caseId) {
      try {
        caseFile = asCaseFile(await input.callTool('case_get', { id: context.caseId }))
        await pause()
        input.onText('用例结构已读取。\n\n')
      } catch {
        input.onText('用例读取失败。\n\n')
      }
    }

    // 演示模式也覆盖「提议 → diff → 应用」：识别修改意图后移除最后一步
    const wantsEdit = /修改用例|精简|清理冗余|删.*步骤|改一下/.test(lastUserText(input.messages))
    if (wantsEdit && caseFile && caseFile.case.steps.length > 1) {
      const lastStep = caseFile.case.steps[caseFile.case.steps.length - 1]
      try {
        await input.callTool('case_propose', {
          caseId: caseFile.case.id,
          summary: '演示：移除最后一步，展示修改建议与确认流程',
          operations: [{ op: 'remove_step', stepId: lastStep.id }],
        })
        await pause()
        input.onText('已生成修改建议，请在输入框上方确认是否应用。\n\n')
      } catch (err) {
        input.onText(`修改建议生成失败：${err instanceof Error ? err.message : String(err)}\n\n`)
      }
    }

    // 演示模式覆盖「从页面生成计划卡」：用快照里的 ref 拼一条可执行计划
    const wantsPlan = /生成.*用例|用例.*生成|沉淀|计划卡/.test(lastUserText(input.messages))
    if (wantsPlan && snapshot?.elements?.length) {
      const textbox =
        snapshot.elements.find((el) => el.role === 'textbox' && /内容/.test(el.name)) ??
        snapshot.elements.find((el) => el.role === 'textbox' && !el.disabled)
      const saveButton =
        snapshot.elements.find((el) => el.role === 'button' && /保存/.test(el.name)) ??
        snapshot.elements.find((el) => el.role === 'button' && !el.disabled)
      if (textbox) {
        const stamp = Date.now().toString(36).slice(-4)
        try {
          await input.callTool('case_plan', {
            name: `AI 计划新建内容 ${stamp}`,
            summary: '填写内容名称、保存，并验证页面出现保存成功提示。',
            steps: [
              {
                action: 'fill',
                ref: textbox.ref,
                name: textbox.name || '内容名称',
                value: `AI计划_${stamp}`,
              },
              ...(saveButton
                ? [
                    {
                      action: 'click',
                      ref: saveButton.ref,
                      name: saveButton.name || '保存',
                    },
                  ]
                : []),
              {
                action: 'assert',
                assertion: { type: 'pageText', match: 'contains', expected: '保存成功' },
              },
            ],
          })
          await pause()
          input.onText('已生成可执行的计划卡，请在输入框上方执行或保存。\n\n')
        } catch (err) {
          input.onText(`计划卡生成失败：${err instanceof Error ? err.message : String(err)}\n\n`)
        }
      }
    }

    await pause()
    input.onText(
      '已验证：快照与记录读取链路正常。\n假设：真实模型接入后会在此基础上自主操作与验证。\n未完成：在「模型设置」中配置 API Key 后即可使用真实 Agent。',
    )
    return []
  }
}

/** DeepSeek 思考模式参数；off 时显式关闭，其他值开启并指定强度 */
export function deepseekProviderOptions(thinking?: AiThinking) {
  if (!thinking) return undefined
  if (thinking === 'off') return { deepseek: { thinking: { type: 'disabled' } } }
  return { deepseek: { thinking: { type: 'enabled' }, reasoningEffort: thinking } }
}

class AiSdkProvider implements AiProvider {
  readonly stub = false

  constructor(
    readonly provider: string,
    readonly model: string,
    private readonly languageModel: LanguageModel,
    private readonly thinking?: AiThinking,
  ) {}

  async run(input: ProviderRunInput): Promise<ModelMessage[]> {
    const options = deepseekProviderOptions(this.thinking)
    const result = streamText({
      model: this.languageModel,
      instructions: input.system,
      messages: input.messages,
      tools: input.tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
      abortSignal: input.signal,
      ...(options ? { providerOptions: options } : {}),
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
    const steps = await result.steps
    if (steps.length >= MAX_TOOL_STEPS) {
      input.onText(
        `\n\n（已达到本轮 ${MAX_TOOL_STEPS} 次工具调用上限，任务可能还没完成。回复「继续」可以从当前进度接着做。）`,
      )
    }
    return (await result.responseMessages) as ModelMessage[]
  }
}

/** 单轮工具循环上限；复杂任务（录制、回放、多步诊断）需要比 20 更宽 */
export const MAX_TOOL_STEPS = 50

export interface ProviderBundle {
  provider: AiProvider
  config: AiConfig
}

/** 按 profile 构建实际的 LanguageModel；测试连接与模型列表也复用它 */
export function createLanguageModel(profile: ResolvedAiProfile['profile'], apiKey: string) {
  if (profile.kind === 'deepseek') {
    const provider = createDeepSeek({
      apiKey,
      ...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
    })
    return provider(profile.model)
  }
  if (profile.kind === 'anthropic') {
    const provider = createAnthropic({
      apiKey,
      ...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
    })
    return provider(profile.model)
  }
  if (profile.kind === 'openai-compatible') {
    if (!profile.baseURL) throw new Error('OpenAI 兼容 profile 缺少 baseURL')
    const provider = createOpenAICompatible({
      name: 'atp',
      baseURL: profile.baseURL,
      apiKey,
    })
    return provider.chatModel(profile.model)
  }
  throw new Error('Stub profile 没有可用的模型')
}

function configOf(
  resolved: ResolvedAiProfile,
  overrides: { ready: boolean; stub: boolean },
): AiConfig {
  const { profile } = resolved
  return {
    ready: overrides.ready,
    provider: resolved.name === 'stub' ? 'stub' : resolved.name,
    model: profile.model,
    stub: overrides.stub,
    kind: profile.kind,
    ...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
    hasKey: Boolean(resolved.apiKey),
    keySource: resolved.keySource,
    ...(resolved.keyHint ? { keyHint: resolved.keyHint } : {}),
    ...(resolved.keyEnv ? { keyEnv: resolved.keyEnv } : {}),
    ...(profile.thinking ? { thinking: profile.thinking } : {}),
    ...(resolved.reason ? { reason: resolved.reason } : {}),
    env: resolved.env,
  }
}

/** 按 profile 构建 provider；配置不可用时退回 Stub，保证界面可用 */
export function createAiProvider(resolved: ResolvedAiProfile): ProviderBundle {
  const { profile } = resolved
  if (!resolved.ready || profile.kind === 'stub' || !resolved.apiKey) {
    return {
      provider: new StubProvider(resolved.reason),
      config: configOf(resolved, { ready: false, stub: true }),
    }
  }

  const model = createLanguageModel(profile, resolved.apiKey)
  return {
    provider: new AiSdkProvider(
      resolved.name,
      profile.model,
      model,
      profile.kind === 'deepseek' ? profile.thinking : undefined,
    ),
    config: configOf(resolved, { ready: true, stub: false }),
  }
}
