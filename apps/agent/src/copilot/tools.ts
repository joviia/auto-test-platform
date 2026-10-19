import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb } from '@atp/core'
import type { AiTarget } from '@atp/model'
import { z } from 'zod'
import type { ChromeController } from '../browser.js'

export interface CopilotToolContext {
  sessionId: string
  callId: string
  dataDir: string
  browser: () => ChromeController | null
  signal: AbortSignal
}

export interface ToolOutcome {
  /** 回给模型的紧凑结果 */
  result: unknown
  /** UI 工具卡展示 */
  label: string
  evidenceUrl?: string
  target?: AiTarget
}

export interface CopilotTool {
  name: string
  description: string
  schema: z.ZodType
  run: (input: Record<string, unknown>, ctx: CopilotToolContext) => Promise<ToolOutcome>
}

function requireBrowser(ctx: CopilotToolContext): ChromeController {
  const browser = ctx.browser()
  if (!browser) throw new Error('浏览器尚未就绪')
  return browser
}

function checkAbort(ctx: CopilotToolContext): void {
  if (ctx.signal.aborted) throw new Error('已停止')
}

async function saveEvidence(ctx: CopilotToolContext): Promise<string | undefined> {
  try {
    const browser = requireBrowser(ctx)
    const jpeg = await browser.screenshotJpeg(55)
    const dir = join(ctx.dataDir, 'ai-evidence', ctx.sessionId)
    await mkdir(dir, { recursive: true })
    const file = `${ctx.callId}.jpg`
    await writeFile(join(dir, file), jpeg)
    return `/ai-evidence/${ctx.sessionId}/${file}`
  } catch {
    return undefined
  }
}

function clippedName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : undefined
}

const refInput = z.object({
  ref: z.string().min(1).describe('browser_snapshot 返回的元素 ref；导航后需要重新快照'),
  name: z.string().optional().describe('元素的可读名称，仅用于界面展示'),
})

async function act(
  ctx: CopilotToolContext,
  input: Record<string, unknown>,
  verb: string,
  perform: (
    resolved: NonNullable<Awaited<ReturnType<ChromeController['resolveRef']>>>,
  ) => Promise<unknown>,
): Promise<ToolOutcome> {
  checkAbort(ctx)
  const ref = String(input.ref ?? '')
  const browser = requireBrowser(ctx)
  const resolved = await browser.resolveRef(ref)
  if (!resolved) {
    throw new Error('ref 已失效：请先调用 browser_snapshot 获取最新元素')
  }
  await perform(resolved)
  await (await browser.runnerPage()).waitForTimeout(120).catch(() => undefined)
  const name = resolved.target.name || clippedName(input.name) || ref
  return {
    result: { ok: true, element: { role: resolved.target.role, name } },
    label: `${verb}「${name}」`,
    evidenceUrl: await saveEvidence(ctx),
    target: resolved.target,
  }
}

export const COPILOT_TOOLS: CopilotTool[] = [
  {
    name: 'browser_snapshot',
    description:
      '观察当前页面：返回 URL、标题、可见文本和所有可交互元素（带 ref、角色、名称、值、状态）。执行操作前先调用它；每次调用都会让旧 ref 失效。',
    schema: z.object({}),
    async run(_input, ctx) {
      checkAbort(ctx)
      const snapshot = await requireBrowser(ctx).snapshot()
      return {
        result: {
          url: snapshot.url,
          title: snapshot.title,
          viewport: snapshot.viewport,
          scroll: snapshot.scroll,
          text: snapshot.text,
          elements: snapshot.elements,
          truncated: snapshot.truncated,
        },
        label: `观察页面 · ${snapshot.elements.length} 个可交互元素`,
      }
    },
  },
  {
    name: 'browser_screenshot',
    description:
      '截取当前页面画面并返回证据地址。需要确认视觉状态、布局或遮挡时使用；默认先看 browser_snapshot。',
    schema: z.object({}),
    async run(_input, ctx) {
      checkAbort(ctx)
      const browser = requireBrowser(ctx)
      const jpeg = await browser.screenshotJpeg(60)
      const dir = join(ctx.dataDir, 'ai-evidence', ctx.sessionId)
      await mkdir(dir, { recursive: true })
      const file = `${ctx.callId}.jpg`
      await writeFile(join(dir, file), jpeg)
      const evidenceUrl = `/ai-evidence/${ctx.sessionId}/${file}`
      return {
        result: { ok: true, evidenceUrl, bytes: jpeg.length },
        label: '截取当前页面',
        evidenceUrl,
      }
    },
  },
  {
    name: 'browser_navigate',
    description:
      '打开一个 URL（http/https 或本地文件路径）。导航后元素 ref 全部失效，需要重新快照。',
    schema: z.object({ url: z.string().min(1) }),
    async run(input, ctx) {
      checkAbort(ctx)
      const url = await requireBrowser(ctx).navigate(String(input.url))
      return { result: { ok: true, url }, label: `打开 ${url}` }
    },
  },
  {
    name: 'browser_click',
    description: '点击快照里的某个元素。',
    schema: refInput,
    run: (input, ctx) => act(ctx, input, '点击', ({ locator }) => locator.click({ timeout: 6000 })),
  },
  {
    name: 'browser_fill',
    description: '清空并填写输入框。',
    schema: z.object({
      ref: z.string().min(1),
      value: z.string().describe('要填入的文本'),
      name: z.string().optional(),
    }),
    run: (input, ctx) =>
      act(ctx, input, '填写', ({ locator }) =>
        locator.fill(String(input.value ?? ''), { timeout: 6000 }),
      ),
  },
  {
    name: 'browser_select',
    description: '在下拉框里选择一个选项（按 value 或可见文本匹配）。',
    schema: z.object({
      ref: z.string().min(1),
      value: z.string().min(1),
      name: z.string().optional(),
    }),
    run: (input, ctx) =>
      act(ctx, input, '选择', async ({ locator }) => {
        const value = String(input.value)
        try {
          await locator.selectOption(value, { timeout: 6000 })
        } catch {
          await locator.selectOption({ label: value }, { timeout: 6000 })
        }
      }),
  },
  {
    name: 'browser_check',
    description: '勾选复选框或单选框。',
    schema: refInput,
    run: (input, ctx) => act(ctx, input, '勾选', ({ locator }) => locator.check({ timeout: 6000 })),
  },
  {
    name: 'browser_uncheck',
    description: '取消勾选复选框。',
    schema: refInput,
    run: (input, ctx) =>
      act(ctx, input, '取消勾选', ({ locator }) => locator.uncheck({ timeout: 6000 })),
  },
  {
    name: 'browser_press',
    description: '向页面发送一次按键，例如 Enter、Escape、Tab。',
    schema: z.object({ key: z.string().min(1) }),
    async run(input, ctx) {
      checkAbort(ctx)
      const browser = requireBrowser(ctx)
      await (await browser.runnerPage()).keyboard.press(String(input.key))
      return {
        result: { ok: true },
        label: `按键 ${String(input.key)}`,
        evidenceUrl: await saveEvidence(ctx),
      }
    },
  },
  {
    name: 'browser_scroll',
    description: '滚动页面，用于加载更多内容或查看下方区域。',
    schema: z.object({
      direction: z.enum(['up', 'down']).default('down'),
      amount: z.number().int().positive().max(3000).default(600),
    }),
    async run(input, ctx) {
      checkAbort(ctx)
      const browser = requireBrowser(ctx)
      const amount = Number(input.amount ?? 600)
      const delta = input.direction === 'up' ? -amount : amount
      await (await browser.runnerPage()).mouse.wheel(0, delta)
      await (await browser.runnerPage()).waitForTimeout(200)
      return {
        result: { ok: true },
        label: `滚动 ${input.direction === 'up' ? '向上' : '向下'} ${amount}px`,
        evidenceUrl: await saveEvidence(ctx),
      }
    },
  },
  {
    name: 'browser_wait',
    description: '等待一段时间（最多 5 秒），用于等待加载或动画。',
    schema: z.object({ ms: z.number().int().min(0).max(5000) }),
    async run(input, ctx) {
      checkAbort(ctx)
      const ms = Number(input.ms ?? 0)
      await (await requireBrowser(ctx).runnerPage()).waitForTimeout(ms)
      return { result: { ok: true }, label: `等待 ${ms}ms` }
    },
  },
  {
    name: 'browser_assert_visible',
    description: '断言元素可见，返回 ok=true/false；失败时结合快照判断原因。',
    schema: refInput,
    async run(input, ctx) {
      checkAbort(ctx)
      const browser = requireBrowser(ctx)
      const ref = String(input.ref ?? '')
      const resolved = await browser.resolveRef(ref)
      if (!resolved) {
        return {
          result: { ok: false, error: 'ref 已失效，请重新快照' },
          label: `断言「${clippedName(input.name) ?? ref}」可见`,
        }
      }
      const visible = await resolved.locator.isVisible()
      return {
        result: { ok: visible, visible },
        label: `断言「${resolved.target.name || clippedName(input.name) || ref}」${visible ? '可见' : '不可见'}`,
        target: resolved.target,
        evidenceUrl: await saveEvidence(ctx),
      }
    },
  },
  {
    name: 'case_list',
    description: '列出用例库里的用例（id、名称、起始地址、更新时间）。',
    schema: z.object({}),
    async run() {
      const uow = getDb().uow()
      const projects = await uow.projects.list()
      const rows = await Promise.all(projects.map((project) => uow.cases.list(project.id)))
      const cases = rows
        .flat()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((row) => ({
          id: row.id,
          name: row.name,
          startUrl: row.startUrl,
          updatedAt: row.updatedAt,
        }))
      return { result: { cases }, label: `查看用例库 · ${cases.length} 条` }
    },
  },
  {
    name: 'case_get',
    description: '读取一条用例的完整结构（步骤、元素、意图、分组）。',
    schema: z.object({ id: z.string().min(1) }),
    async run(input) {
      const file = await getDb().uow().cases.get(String(input.id))
      if (!file) throw new Error(`用例不存在：${String(input.id)}`)
      return { result: file, label: `读取用例「${file.case.name}」` }
    },
  },
  {
    name: 'run_list',
    description: '列出执行记录，可按用例过滤。',
    schema: z.object({ caseId: z.string().optional() }),
    async run(input) {
      const runs = await getDb()
        .uow()
        .runs.list(typeof input.caseId === 'string' && input.caseId ? { caseId: input.caseId } : {})
      return {
        result: {
          runs: runs.map((run) => ({
            id: run.id,
            caseId: run.caseId,
            caseName: run.caseName,
            status: run.status,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
          })),
        },
        label: `查看执行记录 · ${runs.length} 条`,
      }
    },
  },
  {
    name: 'run_get',
    description: '读取一次运行的详细结果与步骤证据。',
    schema: z.object({ runId: z.string().min(1) }),
    async run(input) {
      const found = await getDb().uow().runs.get(String(input.runId))
      if (!found) throw new Error(`执行记录不存在：${String(input.runId)}`)
      return {
        result: {
          run: {
            id: found.run.id,
            caseId: found.run.caseId,
            caseName: found.run.caseName,
            status: found.run.status,
            error: found.run.error,
            startedAt: found.run.startedAt,
            finishedAt: found.run.finishedAt,
          },
          steps: found.steps.map((step) => ({
            idx: step.idx,
            action: step.action,
            status: step.status,
            durationMs: step.durationMs,
            error: step.error,
            skipped: step.skipped,
          })),
        },
        label: '读取运行记录',
      }
    },
  },
]

export const COPILOT_TOOL_MAP = new Map(COPILOT_TOOLS.map((tool) => [tool.name, tool]))
