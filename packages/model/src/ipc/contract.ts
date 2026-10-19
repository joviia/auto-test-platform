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
    output: z.object({
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
    }),
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
}

export type IpcEventPayload<K extends keyof typeof ipcEventContract> = z.output<
  (typeof ipcEventContract)[K]
>

export type RendererInvoke = <K extends keyof IpcContract>(
  channel: K,
  ...args: z.input<IpcContract[K]['input']> extends void ? [] : [z.input<IpcContract[K]['input']>]
) => Promise<z.output<IpcContract[K]['output']>>
