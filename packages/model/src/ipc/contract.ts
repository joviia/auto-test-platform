import type { ZodType } from 'zod'
import { z } from 'zod'
import {
  caseFileSchema,
  caseGroupSchema,
  elementSchema,
  stepSchema,
  stepStatusSchema,
} from '../domain/index.js'
import {
  caseRowSchema,
  elementRowSchema,
  moduleRowSchema,
  planRowSchema,
  planRunRowSchema,
  projectRowSchema,
  runRowSchema,
  runStepRowSchema,
  suiteRowSchema,
} from '../dto/rows.js'
import { IpcChannel, IpcEvent } from './channels.js'

export interface IpcEndpoint<I = unknown, O = unknown> {
  input: ZodType<I>
  output: ZodType<O>
}

const okSchema = z.object({ ok: z.literal(true) })
const idInput = z.object({ id: z.string().min(1) })
const aiProviderSchema = z.enum(['deepseek', 'anthropic', 'gateway'])
const aiThinkingSchema = z.enum(['off', 'low', 'high', 'max'])
const aiConnectionInputSchema = z.object({
  provider: aiProviderSchema,
  model: z.string().min(1),
  baseURL: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  thinking: aiThinkingSchema.optional(),
})
const aiConfigSchema = z.object({
  ready: z.boolean(),
  provider: z.string(),
  model: z.string(),
  stub: z.boolean(),
  reason: z.string().optional(),
  /** 读取的环境变量名，配置卡里展示 */
  env: z.array(z.string()),
  kind: z.enum(['deepseek', 'anthropic', 'openai-compatible', 'stub']),
  baseURL: z.string().optional(),
  hasKey: z.boolean(),
  keyHint: z.string().optional(),
  keySource: z.enum(['env', 'file', 'none']),
  keyEnv: z.string().optional(),
  thinking: aiThinkingSchema.optional(),
})
const aiModelSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  inputModalities: z.array(z.string()).optional(),
})

/** Copilot 每次请求携带的工作环境；前端从 ui-store 组装 */
const aiEnvironmentSchema = z.object({
  mode: z.enum(['launch', 'editing', 'recording', 'replaying', 'plan']),
  url: z.string().optional(),
  navTab: z.enum(['cases', 'plans', 'skills']).optional(),
  selectedKind: z.enum(['project', 'module', 'case', 'plan', 'skill']).optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  caseId: z.string().optional(),
  caseName: z.string().optional(),
  planId: z.string().optional(),
  planName: z.string().optional(),
  runId: z.string().optional(),
  recording: z.boolean().optional(),
  recordedSteps: z.number().int().nonnegative().optional(),
  draftSteps: z.number().int().nonnegative().optional(),
  replaying: z.boolean().optional(),
  planProgress: z
    .object({
      caseName: z.string().optional(),
      caseIndex: z.number().int().nonnegative(),
      caseTotal: z.number().int().nonnegative(),
      attempt: z.number().int().positive().optional(),
    })
    .optional(),
})

/** 操作库技能对外的参数说明 */
const skillParamSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number']),
  required: z.boolean(),
  description: z.string(),
  default: z.union([z.string(), z.number()]).optional(),
})

const skillManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(['input', 'pointer', 'file']),
  params: z.array(skillParamSchema),
  example: z.string().optional(),
})

/** AI 对用例的修改建议。只提议，不写入；由用户在前端确认后调用 case:update */
const aiCaseProposalSchema = z.object({
  proposalId: z.string().min(1),
  caseId: z.string().min(1),
  caseName: z.string().min(1),
  /** 一句话说明改了什么、为什么 */
  summary: z.string().min(1),
  /** 生成建议时用例的 updatedAt；应用前用于检测用例是否已被改动 */
  baseUpdatedAt: z.string(),
  /** 生成建议时的用例快照：用于稳定展示 diff 和撤销 */
  before: caseFileSchema,
  /** 修改后的完整用例文件 */
  after: caseFileSchema,
  createdAt: z.string(),
})

/** AI 生成的新用例计划卡。执行与保存都由用户触发，不直接写库 */
const aiPlanProposalSchema = z.object({
  proposalId: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().min(1),
  startUrl: z.string().min(1),
  caseFile: caseFileSchema,
  createdAt: z.string(),
})

const aiPlanStepResultSchema = z.object({
  /** 1-based，和界面上的步骤序号一致 */
  index: z.number().int().positive(),
  stepId: z.string(),
  action: z.string(),
  status: stepStatusSchema,
  durationMs: z.number().nonnegative(),
  error: z.string().optional(),
  skipped: z.boolean().optional(),
  screenshotUrl: z.string().optional(),
})

const aiTargetSchema = z.object({
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  viewport: z.object({ width: z.number(), height: z.number() }),
  role: z.string().optional(),
  name: z.string().optional(),
})

/** 持久化的工具卡：历史会话恢复后仍能看到工具、结果与证据 */
const aiStoredToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  input: z.unknown().optional(),
  status: z.enum(['running', 'ok', 'error']),
  durationMs: z.number().nonnegative().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  evidenceUrl: z.string().optional(),
  target: aiTargetSchema.optional(),
})

const aiSessionMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  reasoning: z.string().optional(),
  tools: z.array(aiStoredToolSchema).optional(),
  cancelled: z.boolean().optional(),
  error: z.string().optional(),
  createdAt: z.string(),
})

const aiSessionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number().int().nonnegative(),
})

/** 单步调试：暂停时下发的当前步骤、变量与已完成结果 */
const debugResultSchema = z.object({
  status: stepStatusSchema,
  durationMs: z.number().nonnegative(),
  error: z.string().optional(),
  skipped: z.boolean().optional(),
  screenshotUrl: z.string().optional(),
})

export const debugStateSchema = z.object({
  caseId: z.string(),
  runId: z.string(),
  /** 调试页面的起始地址；刷新 / 新开窗口后用于恢复舞台 */
  startUrl: z.string(),
  status: z.enum(['paused', 'running', 'passed', 'failed', 'stopped']),
  /** 当前/下一步的 0-based 下标；结束时等于 total */
  index: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  stepId: z.string().optional(),
  /** 已做变量替换的当前步骤，用于展示实际参数 */
  step: stepSchema.optional(),
  variables: z.record(z.string(), z.string()).optional(),
  breakpoints: z.array(z.string()).optional(),
  results: z.record(z.string(), debugResultSchema),
  error: z.string().optional(),
})

/** 录制草稿：recording:stop 与 AI 停止录制事件共用 */
const recordedDraftSchema = z.object({
  steps: z.array(stepSchema),
  elements: z.record(z.string(), elementSchema),
  startUrl: z.string(),
  intent: z.string().optional(),
  groups: z.array(caseGroupSchema).optional(),
  /** 采集诊断：原始事件数 + 每个 frame 的注入状态 */
  diagnostics: z.object({
    rawEvents: z.number().int().nonnegative(),
    frames: z.array(
      z.object({
        url: z.string(),
        injected: z.boolean(),
      }),
    ),
  }),
})
const planPolicySchema = z.object({
  retries: z.number().int().min(0).max(10),
  timeoutMs: z.number().int().positive(),
  continueOnFailure: z.boolean(),
})

/** 录制实时预览步骤（未绑定元素库的语义动作），RecorderStep 的契约形态；
 * 断言拾取的预览也走此结构（action='assert'） */
export interface LiveCandidate {
  type: 'testId' | 'role' | 'text' | 'css' | 'xpath'
  value: string
  name?: string
  count?: number | null
  /** 语义作用域链（从外到内） */
  scope?: LiveCandidate[]
  topmost?: boolean
}

const liveCandidateSchema: z.ZodType<LiveCandidate> = z.lazy(() =>
  z.object({
    type: z.enum(['testId', 'role', 'text', 'css', 'xpath']),
    value: z.string(),
    name: z.string().optional(),
    count: z.number().nullable().optional(),
    scope: z.array(liveCandidateSchema).optional(),
    topmost: z.boolean().optional(),
  }),
)

export const liveStepSchema = z.object({
  action: z.enum(['click', 'fill', 'select', 'press', 'assert', 'scroll', 'wait', 'drag']),
  target: z.object({
    tag: z.string(),
    inputType: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    value: z.string().optional(),
    placeholder: z.string().optional(),
  }),
  candidates: z.array(liveCandidateSchema),
  url: z.string(),
  ts: z.number(),
  value: z.string().optional(),
  key: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  dx: z.number().optional(),
  dy: z.number().optional(),
  startX: z.number().optional(),
  startY: z.number().optional(),
  durationMs: z.number().optional(),
})

export type LiveStep = z.infer<typeof liveStepSchema>

/** 每个 channel 的输入/输出 zod 契约 —— main 侧强制校验，renderer 侧获得类型 */
export const ipcContract = {
  [IpcChannel.projectList]: { input: z.void(), output: z.array(projectRowSchema) },
  [IpcChannel.projectCreate]: {
    input: z.object({ name: z.string().min(1) }),
    output: projectRowSchema,
  },
  [IpcChannel.projectDelete]: { input: idInput, output: okSchema },

  [IpcChannel.moduleList]: {
    input: z.object({ projectId: z.string().min(1) }),
    output: z.array(moduleRowSchema),
  },
  [IpcChannel.moduleCreate]: {
    input: z.object({
      projectId: z.string().min(1),
      parentId: z.string().nullable().optional(),
      name: z.string().min(1),
    }),
    output: moduleRowSchema,
  },
  [IpcChannel.moduleRename]: {
    input: z.object({ id: z.string().min(1), name: z.string().min(1) }),
    output: moduleRowSchema,
  },
  [IpcChannel.moduleDelete]: { input: idInput, output: okSchema },

  [IpcChannel.caseList]: {
    input: z.object({ projectId: z.string().min(1) }),
    output: z.array(caseRowSchema),
  },
  [IpcChannel.caseGet]: { input: idInput, output: caseFileSchema },
  [IpcChannel.caseCreate]: {
    input: z.object({
      projectId: z.string().min(1),
      moduleId: z.string().nullable().optional(),
      name: z.string().min(1),
      startUrl: z.string().min(1),
    }),
    output: caseFileSchema,
  },
  [IpcChannel.caseUpdate]: { input: caseFileSchema, output: caseFileSchema },
  [IpcChannel.caseDelete]: { input: idInput, output: okSchema },
  [IpcChannel.caseExportTs]: {
    input: idInput,
    output: z.object({ code: z.string() }),
  },
  [IpcChannel.caseExportTsFile]: {
    input: idInput,
    output: z.object({ saved: z.boolean(), path: z.string().optional() }),
  },

  [IpcChannel.elementList]: {
    input: z.object({ projectId: z.string().min(1) }),
    output: z.array(elementRowSchema),
  },
  [IpcChannel.elementUpsert]: { input: elementRowSchema, output: elementRowSchema },
  [IpcChannel.elementDelete]: { input: idInput, output: okSchema },

  [IpcChannel.suiteList]: {
    input: z.object({ projectId: z.string().min(1) }),
    output: z.array(suiteRowSchema),
  },
  [IpcChannel.suiteGet]: {
    input: idInput,
    output: z.object({
      suite: suiteRowSchema,
      caseIds: z.array(z.string()),
    }),
  },
  [IpcChannel.suiteCreate]: {
    input: z.object({
      projectId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      caseIds: z.array(z.string()),
    }),
    output: suiteRowSchema,
  },
  [IpcChannel.suiteUpdate]: {
    input: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().optional(),
      caseIds: z.array(z.string()),
    }),
    output: suiteRowSchema,
  },
  [IpcChannel.suiteDelete]: { input: idInput, output: okSchema },

  [IpcChannel.planList]: {
    input: z.object({ projectId: z.string().min(1) }),
    output: z.array(planRowSchema),
  },
  [IpcChannel.planGet]: {
    input: idInput,
    output: z.object({
      plan: planRowSchema,
      caseIds: z.array(z.string()),
    }),
  },
  [IpcChannel.planCreate]: {
    input: z.object({
      projectId: z.string().min(1),
      name: z.string().min(1),
      suiteId: z.string().nullable().optional(),
      caseIds: z.array(z.string()),
      ...planPolicySchema.shape,
    }),
    output: planRowSchema,
  },
  [IpcChannel.planUpdate]: {
    input: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      caseIds: z.array(z.string()),
      ...planPolicySchema.shape,
    }),
    output: planRowSchema,
  },
  [IpcChannel.planDelete]: { input: idInput, output: okSchema },
  [IpcChannel.planRunStart]: {
    input: z.object({
      planId: z.string().min(1),
      /** 只执行计划内的指定用例（按计划顺序）；缺省执行全部 */
      caseIds: z.array(z.string().min(1)).min(1).optional(),
    }),
    output: z.object({ planRunId: z.string() }),
  },
  [IpcChannel.planRunStop]: { input: z.void(), output: okSchema },
  [IpcChannel.planRunList]: {
    input: z.object({
      planId: z.string().min(1).optional(),
      limit: z.number().int().positive().optional(),
    }),
    output: z.array(planRunRowSchema),
  },
  [IpcChannel.planRunGet]: {
    input: z.object({ planRunId: z.string().min(1) }),
    output: z.object({
      planRun: planRunRowSchema,
      runs: z.array(
        z.object({
          run: runRowSchema,
          caseName: z.string(),
        }),
      ),
    }),
  },

  [IpcChannel.browserNavigate]: {
    input: z.object({ url: z.string().min(1) }),
    output: okSchema,
  },
  [IpcChannel.browserFocus]: { input: z.void(), output: okSchema },
  [IpcChannel.viewBoundsSet]: {
    input: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative(),
    }),
    output: okSchema,
  },
  [IpcChannel.viewEmulate]: {
    input: z.union([
      z.object({ clear: z.literal(true) }),
      z.object({
        clear: z.literal(false).optional(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        deviceScaleFactor: z.number().positive(),
        mobile: z.boolean(),
      }),
    ]),
    output: okSchema,
  },
  [IpcChannel.recordingStart]: { input: z.void(), output: okSchema },
  [IpcChannel.recordingStop]: {
    input: z.void(),
    output: recordedDraftSchema,
  },

  [IpcChannel.recordingAssertArm]: { input: z.void(), output: okSchema },

  [IpcChannel.replayStart]: {
    input: z.object({
      caseId: z.string().min(1),
      mode: z.enum(['embedded', 'standalone']).default('embedded'),
    }),
    output: z.object({ runId: z.string() }),
  },
  [IpcChannel.replayStop]: { input: z.void(), output: okSchema },
  [IpcChannel.runList]: {
    input: z.object({
      caseId: z.string().min(1).optional(),
      /** 只看某个计划产生的执行记录（含重试） */
      planId: z.string().min(1).optional(),
    }),
    output: z.array(runRowSchema),
  },
  [IpcChannel.runGet]: {
    input: z.object({ runId: z.string().min(1) }),
    output: z.object({ run: runRowSchema, steps: z.array(runStepRowSchema) }),
  },

  [IpcChannel.aiSend]: {
    input: z.object({
      message: z.string().min(1),
      sessionId: z.string().min(1).optional(),
      context: z
        .object({
          url: z.string().optional(),
          caseId: z.string().optional(),
          caseName: z.string().optional(),
          runId: z.string().optional(),
          environment: aiEnvironmentSchema.optional(),
        })
        .optional(),
    }),
    output: z.object({ sessionId: z.string(), messageId: z.string() }),
  },
  [IpcChannel.aiCancel]: {
    input: z.object({ sessionId: z.string().min(1).optional() }),
    output: okSchema,
  },
  [IpcChannel.aiConfig]: {
    input: z.void(),
    output: aiConfigSchema,
  },
  [IpcChannel.aiSaveConfig]: {
    input: aiConnectionInputSchema.extend({
      clearKey: z.boolean().optional(),
    }),
    output: aiConfigSchema,
  },
  [IpcChannel.aiTest]: {
    input: aiConnectionInputSchema,
    output: z.object({
      ok: z.boolean(),
      latencyMs: z.number().nonnegative(),
      model: z.string(),
      /** 模型是否真的发起了一次工具调用 */
      toolCall: z.boolean(),
      error: z.string().optional(),
      detail: z.string().optional(),
    }),
  },
  [IpcChannel.aiModels]: {
    input: z.object({
      provider: aiProviderSchema,
      model: z.string().min(1).optional(),
      baseURL: z.string().min(1).optional(),
      apiKey: z.string().min(1).optional(),
    }),
    output: z.object({
      models: z.array(aiModelSchema),
      error: z.string().optional(),
    }),
  },

  [IpcChannel.aiPlanRun]: {
    input: z.object({
      proposalId: z.string().min(1),
      /** 卡片当前草稿（用户可能已删改步骤） */
      caseFile: caseFileSchema,
    }),
    output: z.object({ runId: z.string() }),
  },
  [IpcChannel.aiPlanStop]: { input: z.void(), output: okSchema },
  [IpcChannel.aiSessionList]: {
    input: z.object({ limit: z.number().int().positive().max(100).optional() }),
    output: z.array(aiSessionRowSchema),
  },
  [IpcChannel.aiSessionGet]: {
    input: idInput,
    output: z.object({
      session: aiSessionRowSchema,
      messages: z.array(aiSessionMessageSchema),
    }),
  },
  [IpcChannel.aiSessionDelete]: { input: idInput, output: okSchema },

  [IpcChannel.debugStart]: {
    input: z.object({
      caseId: z.string().min(1),
      breakpoints: z.array(z.string().min(1)).optional(),
    }),
    output: z.object({ runId: z.string() }),
  },
  [IpcChannel.debugCommand]: {
    input: z.object({
      action: z.enum(['next', 'continue', 'pause', 'stop', 'set-breakpoints']),
      breakpoints: z.array(z.string().min(1)).optional(),
    }),
    output: okSchema,
  },
  [IpcChannel.debugState]: {
    input: z.void(),
    output: debugStateSchema.nullable(),
  },

  [IpcChannel.skillList]: {
    input: z.void(),
    output: z.array(skillManifestSchema),
  },
} satisfies Record<string, IpcEndpoint>

export type IpcContract = typeof ipcContract

export type IpcInput<K extends keyof IpcContract> = z.output<IpcContract[K]['input']>
export type IpcOutput<K extends keyof IpcContract> = z.output<IpcContract[K]['output']>

/** main 侧统一入参校验入口（payload 缺省按 undefined 处理，兼容 z.void()） */
export function parseIpcInput<K extends keyof IpcContract>(channel: K, raw: unknown): IpcInput<K> {
  return ipcContract[channel].input.parse(raw) as IpcInput<K>
}

/** main → renderer 推送事件的载荷契约 */
export const ipcEventContract = {
  [IpcEvent.recordingStatus]: z.object({
    recording: z.boolean(),
    url: z.string().optional(),
  }),
  [IpcEvent.recordingStep]: liveStepSchema,
  [IpcEvent.replayProgress]: z.object({
    runId: z.string(),
    index: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    status: stepStatusSchema,
  }),
  [IpcEvent.planProgress]: z.object({
    planRunId: z.string(),
    planName: z.string(),
    phase: z.enum(['run-start', 'case-start', 'step', 'case-end', 'run-end']),
    caseIndex: z.number().int().nonnegative(),
    caseTotal: z.number().int().nonnegative(),
    caseId: z.string().optional(),
    caseName: z.string(),
    attempt: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    stepIndex: z.number().int().nonnegative().optional(),
    stepTotal: z.number().int().nonnegative().optional(),
    status: z.enum(['running', 'passed', 'failed', 'retrying', 'cancelled']).optional(),
    error: z.string().optional(),
  }),

  [IpcEvent.aiStart]: z.object({
    sessionId: z.string(),
    messageId: z.string(),
  }),
  [IpcEvent.aiDelta]: z.object({
    sessionId: z.string(),
    messageId: z.string(),
    kind: z.enum(['text', 'reasoning']),
    text: z.string(),
  }),
  [IpcEvent.aiToolStart]: z.object({
    sessionId: z.string(),
    messageId: z.string(),
    callId: z.string(),
    name: z.string(),
    label: z.string(),
    input: z.unknown(),
  }),
  [IpcEvent.aiToolEnd]: z.object({
    sessionId: z.string(),
    messageId: z.string(),
    callId: z.string(),
    name: z.string(),
    status: z.enum(['ok', 'error']),
    output: z.unknown().optional(),
    error: z.string().optional(),
    evidenceUrl: z.string().optional(),
    target: aiTargetSchema.optional(),
    durationMs: z.number().nonnegative(),
  }),
  [IpcEvent.aiDone]: z.object({
    sessionId: z.string(),
    messageId: z.string(),
    cancelled: z.boolean().optional(),
  }),
  [IpcEvent.aiError]: z.object({
    sessionId: z.string().optional(),
    messageId: z.string().optional(),
    error: z.string(),
  }),
  /** AI 停止录制后把完整草稿交给界面，复用保存用例对话框 */
  [IpcEvent.aiRecordingDraft]: recordedDraftSchema,
  /** AI 提出用例修改建议；前端展示 diff，由用户确认后写入 */
  [IpcEvent.aiCaseProposal]: aiCaseProposalSchema,
  /** SSE 建连时下发的 Copilot 运行快照；用于修复错过的 ai-start / ai-done */
  [IpcEvent.aiState]: z.object({
    running: z.boolean(),
    sessionId: z.string().optional(),
    messageId: z.string().optional(),
  }),
  /** AI 生成的新用例计划卡 */
  [IpcEvent.aiPlanProposal]: aiPlanProposalSchema,
  [IpcEvent.aiPlanProgress]: z.object({
    proposalId: z.string(),
    runId: z.string(),
    index: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    stepId: z.string(),
    status: stepStatusSchema,
  }),
  [IpcEvent.aiPlanResult]: z.object({
    proposalId: z.string(),
    runId: z.string(),
    status: stepStatusSchema,
    error: z.string().optional(),
    steps: z.array(aiPlanStepResultSchema),
  }),
  /** 单步调试状态变化 */
  [IpcEvent.debugState]: debugStateSchema,
}

/** Copilot 事件与上下文类型（agent / web 共用） */
export type AiToolStartPayload = z.output<(typeof ipcEventContract)[typeof IpcEvent.aiToolStart]>
export type AiToolEndPayload = z.output<(typeof ipcEventContract)[typeof IpcEvent.aiToolEnd]>
export type AiTarget = NonNullable<AiToolEndPayload['target']>
export type AiSendInput = z.output<(typeof ipcContract)[typeof IpcChannel.aiSend]['input']>
export type AiConfig = z.output<(typeof ipcContract)[typeof IpcChannel.aiConfig]['output']>
export type AiProvider = z.output<typeof aiProviderSchema>
export type AiThinking = z.output<typeof aiThinkingSchema>
export type AiSaveConfigInput = z.output<
  (typeof ipcContract)[typeof IpcChannel.aiSaveConfig]['input']
>
export type AiTestInput = z.output<(typeof ipcContract)[typeof IpcChannel.aiTest]['input']>
export type AiTestResult = z.output<(typeof ipcContract)[typeof IpcChannel.aiTest]['output']>
export type AiModelInfo = z.output<typeof aiModelSchema>
export type AiModelsInput = z.output<(typeof ipcContract)[typeof IpcChannel.aiModels]['input']>
export type AiModelsResult = z.output<(typeof ipcContract)[typeof IpcChannel.aiModels]['output']>
export type AiEnvironment = z.output<typeof aiEnvironmentSchema>
export type SkillParam = z.output<typeof skillParamSchema>
export type SkillManifest = z.output<typeof skillManifestSchema>
export type RecordedDraft = z.output<typeof recordedDraftSchema>
export type AiCaseProposal = z.output<typeof aiCaseProposalSchema>
export type AiPlanProposal = z.output<typeof aiPlanProposalSchema>
export type AiPlanProgress = z.output<(typeof ipcEventContract)[typeof IpcEvent.aiPlanProgress]>
export type AiPlanResult = z.output<(typeof ipcEventContract)[typeof IpcEvent.aiPlanResult]>
export type AiSessionRow = z.output<typeof aiSessionRowSchema>
export type AiSessionMessage = z.output<typeof aiSessionMessageSchema>
export type AiStoredTool = z.output<typeof aiStoredToolSchema>
export type DebugState = z.output<typeof debugStateSchema>

export type IpcEventPayload<K extends keyof typeof ipcEventContract> = z.output<
  (typeof ipcEventContract)[K]
>

export type RendererInvoke = <K extends keyof IpcContract>(
  channel: K,
  ...args: z.input<IpcContract[K]['input']> extends void ? [] : [z.input<IpcContract[K]['input']>]
) => Promise<z.output<IpcContract[K]['output']>>
