import { z } from 'zod'
import type { ZodType } from 'zod'
import { caseFileSchema, elementSchema, stepSchema, stepStatusSchema } from '../domain'
import {
  caseRowSchema,
  elementRowSchema,
  moduleRowSchema,
  projectRowSchema,
  runRowSchema,
  runStepRowSchema,
} from '../dto/rows'
import { IpcChannel, IpcEvent } from './channels'

export interface IpcEndpoint<I = unknown, O = unknown> {
  input: ZodType<I>
  output: ZodType<O>
}

const okSchema = z.object({ ok: z.literal(true) })
const idInput = z.object({ id: z.string().min(1) })

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

  [IpcChannel.elementList]: {
    input: z.object({ projectId: z.string().min(1) }),
    output: z.array(elementRowSchema),
  },
  [IpcChannel.elementUpsert]: { input: elementRowSchema, output: elementRowSchema },
  [IpcChannel.elementDelete]: { input: idInput, output: okSchema },

  [IpcChannel.browserNavigate]: {
    input: z.object({ url: z.string().min(1) }),
    output: okSchema,
  },
  [IpcChannel.viewBoundsSet]: {
    input: z.object({
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative(),
    }),
    output: okSchema,
  },
  [IpcChannel.recordingStart]: { input: z.void(), output: okSchema },
  [IpcChannel.recordingStop]: {
    input: z.void(),
    output: z.object({
      steps: z.array(stepSchema),
      elements: z.record(z.string(), elementSchema),
      startUrl: z.string(),
    }),
  },

  [IpcChannel.replayStart]: {
    input: z.object({ caseId: z.string().min(1) }),
    output: z.object({ runId: z.string() }),
  },
  [IpcChannel.runList]: {
    input: z.object({ caseId: z.string().min(1).optional() }),
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
  [IpcEvent.recordingStep]: stepSchema,
  [IpcEvent.replayProgress]: z.object({
    runId: z.string(),
    index: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    status: stepStatusSchema,
  }),
}

export type RendererInvoke = <K extends keyof IpcContract>(
  channel: K,
  ...args: z.input<IpcContract[K]['input']> extends void ? [] : [z.input<IpcContract[K]['input']>]
) => Promise<z.output<IpcContract[K]['output']>>
