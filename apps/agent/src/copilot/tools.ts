import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb } from '@atp/core'
import type { AiTarget } from '@atp/model'
import { z } from 'zod'
import type { ChromeController, RecordedDraft } from '../browser.js'
import { SKILL_MANIFESTS, SKILL_MAP } from './skills.js'

export interface CopilotPlatform {
  isRecording: () => boolean
  startRecording: () => void
  stopRecording: () => Promise<RecordedDraft>
  notifyRecordingDraft: (draft: RecordedDraft) => void
}

export interface CopilotToolContext {
  sessionId: string
  callId: string
  dataDir: string
  browser: () => ChromeController | null
  platform: CopilotPlatform
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
    name: 'browser_hover',
    description:
      '把鼠标悬停到元素上，用于展开 hover 菜单或提示框。菜单类控件优先用 skill_run(hover_menu)。',
    schema: refInput,
    run: (input, ctx) => act(ctx, input, '悬停', ({ locator }) => locator.hover({ timeout: 6000 })),
  },
  {
    name: 'browser_drag',
    description:
      '从元素中心拖拽 (dx, dy) 像素。适合画布、排序、滑块等场景；滑块优先用 skill_run(slider_set)。',
    schema: z.object({
      ref: z.string().min(1),
      dx: z.number(),
      dy: z.number().default(0),
      durationMs: z.number().int().min(50).max(3000).default(320),
      name: z.string().optional(),
    }),
    async run(input, ctx) {
      checkAbort(ctx)
      const browser = requireBrowser(ctx)
      const ref = String(input.ref)
      const resolved = await browser.resolveRef(ref)
      if (!resolved) throw new Error('ref 已失效：请先调用 browser_snapshot 获取最新元素')
      const box = await resolved.locator.boundingBox()
      if (!box) throw new Error('无法获取元素位置')
      const dx = Number(input.dx ?? 0)
      const dy = Number(input.dy ?? 0)
      const total = 16
      const delay = Math.max(4, Math.round(Number(input.durationMs ?? 320) / total))
      const startX = box.x + box.width / 2
      const startY = box.y + box.height / 2
      const page = await browser.runnerPage()
      await page.mouse.move(startX, startY)
      await page.mouse.down()
      for (let i = 1; i <= total; i++) {
        const t = i / total
        await page.mouse.move(startX + dx * t, startY + dy * t)
        await page.waitForTimeout(delay)
      }
      await page.mouse.up()
      await page.waitForTimeout(120)
      const name = resolved.target.name || clippedName(input.name) || ref
      return {
        result: { ok: true, dx, dy },
        label: `拖拽「${name}」(${dx}, ${dy})`,
        evidenceUrl: await saveEvidence(ctx),
        target: resolved.target,
      }
    },
  },
  {
    name: 'browser_wait_for',
    description:
      '等待条件成立：元素可见/隐藏、文本出现、网络空闲。比固定 browser_wait 更可靠；超时会返回原因。',
    schema: z.object({
      kind: z.enum(['visible', 'hidden', 'text', 'networkIdle']),
      ref: z.string().optional().describe('visible / hidden 时必填'),
      text: z.string().optional().describe('text 时必填'),
      timeoutMs: z.number().int().positive().max(30000).default(10000),
    }),
    async run(input, ctx) {
      checkAbort(ctx)
      const browser = requireBrowser(ctx)
      const page = await browser.runnerPage()
      const timeout = Number(input.timeoutMs ?? 10000)
      const kind = String(input.kind)
      if (kind === 'visible' || kind === 'hidden') {
        const ref = typeof input.ref === 'string' ? input.ref : ''
        if (!ref) throw new Error(`${kind} 需要提供 ref`)
        const resolved = await browser.resolveRef(ref)
        if (!resolved) throw new Error('ref 已失效：请先调用 browser_snapshot')
        await resolved.locator.waitFor({
          state: kind === 'hidden' ? 'hidden' : 'visible',
          timeout,
        })
        return {
          result: { ok: true, kind },
          label: `等待「${resolved.target.name || ref}」${kind === 'hidden' ? '隐藏' : '可见'}`,
          target: resolved.target,
        }
      }
      if (kind === 'text') {
        const text = typeof input.text === 'string' ? input.text.trim() : ''
        if (!text) throw new Error('text 等待需要提供文本')
        await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout })
        return { result: { ok: true, kind, text }, label: `等待文本「${text}」` }
      }
      await page.waitForLoadState('networkidle', { timeout })
      return { result: { ok: true, kind }, label: '等待网络空闲' }
    },
  },
  {
    name: 'skill_list',
    description:
      '查看操作库里的技能与参数。遇到滑块、文件上传、hover 菜单等复杂控件时，先查技能再调用 skill_run，不要自己猜坐标。',
    schema: z.object({}),
    async run() {
      return {
        result: { skills: SKILL_MANIFESTS },
        label: `查看操作库 · ${SKILL_MANIFESTS.length} 个技能`,
      }
    },
  },
  {
    name: 'skill_run',
    description:
      '运行操作库技能。先调用 skill_list 查看技能 id 和参数；input 里必须带 browser_snapshot 的 ref。技能会自己做验证，失败会返回具体原因。',
    schema: z.object({
      id: z.string().min(1),
      input: z.record(z.string(), z.unknown()).default({}),
    }),
    async run(input, ctx) {
      checkAbort(ctx)
      const skill = SKILL_MAP.get(String(input.id))
      if (!skill) {
        throw new Error(`未知技能：${String(input.id)}，请先调用 skill_list`)
      }
      const parsed = skill.schema.parse(input.input ?? {}) as Record<string, unknown>
      const browser = requireBrowser(ctx)
      const ref = String(parsed.ref ?? '')
      const resolved = await browser.resolveRef(ref)
      if (!resolved) throw new Error('ref 已失效：请先调用 browser_snapshot')
      const page = await browser.runnerPage()
      const outcome = await skill.run(parsed, {
        page,
        locator: resolved.locator,
        target: resolved.target,
        dataDir: ctx.dataDir,
        signal: ctx.signal,
      })
      return {
        result: outcome.result,
        label: outcome.label,
        target: resolved.target,
        evidenceUrl: await saveEvidence(ctx),
      }
    },
  },
  {
    name: 'workspace_state',
    description:
      '读取平台当前状态：项目、每个项目的用例/计划/元素数量、最近运行、可用技能、是否正在录制。不确定当前平台里有什么时调用。',
    schema: z.object({}),
    async run(_input, ctx) {
      const uow = getDb().uow()
      const projects = await uow.projects.list()
      const rows = []
      for (const project of projects.slice(0, 20)) {
        const [cases, plans, elements] = await Promise.all([
          uow.cases.list(project.id),
          uow.plans.list(project.id),
          uow.elements.list(project.id),
        ])
        rows.push({
          id: project.id,
          name: project.name,
          caseCount: cases.length,
          planCount: plans.length,
          elementCount: elements.length,
        })
      }
      const runs = await uow.runs.list({})
      return {
        result: {
          recording: ctx.platform.isRecording(),
          url: ctx.browser()?.currentUrl ?? null,
          projects: rows,
          recentRuns: runs.slice(0, 10).map((run) => ({
            id: run.id,
            caseId: run.caseId,
            caseName: run.caseName,
            status: run.status,
            startedAt: run.startedAt,
          })),
          skills: SKILL_MANIFESTS.map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
          })),
        },
        label: `读取平台状态 · ${rows.length} 个项目`,
      }
    },
  },
  {
    name: 'recording_start',
    description:
      '开始录制。用户说「录制」「录一条用例」时使用。录制期间你的页面操作会被采集为步骤；完成后必须调用 recording_stop。',
    schema: z.object({}),
    async run(_input, ctx) {
      checkAbort(ctx)
      if (ctx.platform.isRecording()) throw new Error('已经在录制中')
      ctx.platform.startRecording()
      return {
        result: { ok: true, url: ctx.browser()?.currentUrl ?? null },
        label: '开始录制',
      }
    },
  },
  {
    name: 'recording_stop',
    description:
      '停止录制并生成草稿。平台会弹出「保存录制的用例」对话框，由用户确认保存；不要说已经保存。',
    schema: z.object({}),
    async run(_input, ctx) {
      checkAbort(ctx)
      if (!ctx.platform.isRecording()) throw new Error('当前没有在录制')
      const draft = await ctx.platform.stopRecording()
      ctx.platform.notifyRecordingDraft(draft)
      return {
        result: {
          ok: true,
          steps: draft.steps.length,
          elements: Object.keys(draft.elements).length,
          startUrl: draft.startUrl,
          note: '保存用例对话框已打开，等待用户命名并保存',
        },
        label: `停止录制 · ${draft.steps.length} 步`,
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
