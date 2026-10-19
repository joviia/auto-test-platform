import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb } from '@atp/core'
import type { AiCaseProposal, AiPlanProposal, AiTarget, Element, Locator, Step } from '@atp/model'
import { assertionSchema, caseFileSchema, isPageLevelAssertion } from '@atp/model'
import { selectCustom } from '@atp/runner'
import { z } from 'zod'
import type { ChromeController, RecordedDraft, RefDescription } from '../browser.js'
import { buildCaseProposal, type CaseProposalInput, caseProposalOpsSchema } from './proposals.js'
import { SKILL_MANIFESTS, SKILL_MAP } from './skills.js'

export interface AiCaseRun {
  runId: string
  status: 'passed' | 'failed'
  durationMs?: number
  error?: string
  steps: Array<{
    index: number
    action: string
    status: string
    durationMs: number
    error?: string
    skipped?: boolean
  }>
}

export interface AiPlatform {
  isRecording: () => boolean
  startRecording: () => void
  stopRecording: () => Promise<RecordedDraft>
  notifyRecordingDraft: (draft: RecordedDraft) => void
  runCase: (caseId: string) => Promise<AiCaseRun>
  /** 把修改建议交给界面展示 diff；真正写入要等用户确认 */
  proposeCase: (proposal: AiCaseProposal) => void
  /** 把新用例计划卡交给界面；执行与保存由用户触发 */
  proposePlan: (proposal: AiPlanProposal) => void
}

export interface AiToolContext {
  sessionId: string
  callId: string
  dataDir: string
  browser: () => ChromeController | null
  platform: AiPlatform
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

export interface AiTool {
  name: string
  description: string
  schema: z.ZodType
  run: (input: Record<string, unknown>, ctx: AiToolContext) => Promise<ToolOutcome>
}

function requireBrowser(ctx: AiToolContext): ChromeController {
  const browser = ctx.browser()
  if (!browser) throw new Error('浏览器尚未就绪')
  return browser
}

function checkAbort(ctx: AiToolContext): void {
  if (ctx.signal.aborted) throw new Error('已停止')
}

async function saveEvidence(ctx: AiToolContext): Promise<string | undefined> {
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
  ctx: AiToolContext,
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

/** 计划卡的定位候选：语义优先，结构兜底 */
function planLocators(info: RefDescription): Locator[] {
  const out: Locator[] = []
  if (info.testId) out.push({ type: 'testId', value: info.testId })
  if (info.role && info.name) out.push({ type: 'role', value: info.role, name: info.name })
  if (info.text) out.push({ type: 'text', value: info.text })
  if (info.css) out.push({ type: 'css', value: info.css })
  if (info.role && !info.name) out.push({ type: 'role', value: info.role })
  if (info.xpath) out.push({ type: 'xpath', value: info.xpath })
  return out
}

const PLAN_VERB: Record<string, string> = {
  click: '点击',
  fill: '填写',
  select: '选择',
  press: '按键',
  scroll: '滚动',
  wait: '等待',
  assert: '断言',
}

const planStepSchema = z.object({
  action: z.enum(['click', 'fill', 'select', 'press', 'scroll', 'wait', 'assert']),
  ref: z.string().optional().describe('元素动作必填，来自最近一次 browser_snapshot'),
  name: z.string().optional().describe('展示用名称；缺省取页面上的可读名'),
  value: z.string().optional().describe('fill 的值 / select 的选项文本'),
  key: z.string().optional().describe('press 的按键，例如 Enter'),
  x: z.number().optional(),
  y: z.number().optional(),
  timeoutMs: z.number().int().positive().optional(),
  assertion: assertionSchema.optional(),
})

export const casePlanInputSchema = z.object({
  name: z.string().min(1).describe('建议的用例名称'),
  summary: z.string().min(1).describe('一句话说明测什么、怎么验证'),
  startUrl: z.string().optional().describe('缺省使用当前页面地址'),
  steps: z.array(planStepSchema).min(1).max(30),
})

function needsElement(action: string): boolean {
  return action === 'click' || action === 'fill' || action === 'select'
}

export const AI_TOOLS: AiTool[] = [
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
    description:
      '在下拉框里选择一个选项。原生 <select> 可传 value 或可见文本；Element Plus / Ant Design 等自定义下拉按可见文本匹配，会自动展开并点击选项，不要自己猜坐标。',
    schema: z.object({
      ref: z.string().min(1),
      value: z.string().min(1),
      name: z.string().optional(),
    }),
    run: (input, ctx) =>
      act(ctx, input, '选择', async ({ locator }) => {
        const value = String(input.value)
        const tag = await locator
          .evaluate((element) => element.tagName.toLowerCase())
          .catch(() => '')
        if (tag === 'select') {
          try {
            await locator.selectOption(value, { timeout: 6000 })
          } catch {
            await locator.selectOption({ label: value }, { timeout: 6000 })
          }
          return
        }
        // 自定义下拉：点击触发器 → 等待 listbox/menu → 按可见文本点选项
        await selectCustom(await requireBrowser(ctx).runnerPage(), locator, value)
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
    name: 'case_run',
    description:
      '执行一条用例并返回逐步结果。只有用户明确要求执行、回放或跑一下时才使用；会在受控 Chrome 里真实操作页面并产生执行记录。需要执行时直接调用，不要让用户去平台手动点回放。',
    schema: z.object({ caseId: z.string().min(1) }),
    async run(input, ctx) {
      checkAbort(ctx)
      const caseId = String(input.caseId)
      let caseName = caseId
      try {
        const file = await getDb().uow().cases.get(caseId)
        if (file) caseName = file.case.name
      } catch {
        // 单测或数据库未初始化时只影响展示名称
      }
      const result = await ctx.platform.runCase(caseId)
      return {
        result: {
          ok: result.status === 'passed',
          runId: result.runId,
          caseId,
          status: result.status,
          ...(result.error ? { error: result.error } : {}),
          ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
          steps: result.steps,
        },
        label: `执行用例「${caseName}」· ${result.status === 'passed' ? '通过' : '失败'}`,
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
    name: 'case_propose',
    description:
      '提议修改一条已有用例。先 case_get 读取当前用例，再提交操作列表：remove_step / update_step / add_step / move_step / update_case / upsert_element / remove_element。' +
      '平台会展示 diff 卡，由用户确认后才写入；不要声称已经修改。' +
      '清理冗余步骤用 remove_step；改参数用 update_step（保留该步骤原有的 action、elementId、display 等字段）；新增步骤的 id 必须唯一。' +
      '只有用户明确要求修改用例时才调用。',
    schema: z.object({
      caseId: z.string().min(1),
      summary: z.string().min(1).describe('一句话说明改了什么、为什么'),
      operations: caseProposalOpsSchema,
    }),
    async run(input, ctx) {
      checkAbort(ctx)
      const parsed = z
        .object({
          caseId: z.string().min(1),
          summary: z.string().min(1),
          operations: caseProposalOpsSchema,
        })
        .parse(input)
      const uow = getDb().uow()
      const current = await uow.cases.get(parsed.caseId)
      if (!current) throw new Error(`用例不存在：${parsed.caseId}`)
      const rows = await uow.cases.list(current.case.projectId)
      const row = rows.find((item) => item.id === parsed.caseId)

      const { proposal, diff } = buildCaseProposal(
        current,
        { summary: parsed.summary, operations: parsed.operations } satisfies CaseProposalInput,
        {
          proposalId: `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          baseUpdatedAt: row?.updatedAt ?? new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      )
      ctx.platform.proposeCase(proposal)

      const counts = [
        diff.removed ? `-${diff.removed}` : '',
        diff.added ? `+${diff.added}` : '',
        diff.changed ? `~${diff.changed}` : '',
      ]
        .filter(Boolean)
        .join(' ')
      return {
        result: {
          ok: true,
          proposalId: proposal.proposalId,
          caseId: proposal.caseId,
          summary: proposal.summary,
          diff,
          note: 'diff 卡已显示，等待用户确认应用；不要声称已经修改。',
        },
        label: `提议修改用例「${current.case.name}」${counts ? ` · ${counts}` : ''}`,
      }
    },
  },
  {
    name: 'case_plan',
    description:
      '从当前页面生成一条可执行的用例计划卡（新建用例）。必须先调用 browser_snapshot，再用快照里的 ref 指定每一步的目标元素；ref 只在最近一次快照有效。' +
      '平台会展示步骤卡，由用户决定在中栏执行、保存为用例或放弃；不要声称已经保存。' +
      '只覆盖 click / fill / select / press / scroll / wait / assert；需要悬停、上传等动作时说明当前不支持。' +
      '用户要求「生成用例」「把流程沉淀为用例」「从当前页面写一条测试」时使用。',
    schema: casePlanInputSchema,
    async run(input, ctx) {
      checkAbort(ctx)
      const parsed = casePlanInputSchema.parse(input)
      const browser = requireBrowser(ctx)
      const startUrl = (parsed.startUrl?.trim() || browser.currentUrl || '').trim()
      if (!startUrl || startUrl === 'about:blank') {
        throw new Error('当前没有可用的页面地址：请先打开被测页面，或传入 startUrl')
      }

      const elements: Record<string, Element> = {}
      const described = new Map<string, { elementId: string; info: RefDescription }>()
      const steps: Step[] = []

      for (const [index, raw] of parsed.steps.entries()) {
        checkAbort(ctx)
        const id = `s-${String(index + 1).padStart(3, '0')}`
        const elementAssertion =
          raw.action === 'assert' &&
          raw.assertion !== undefined &&
          !isPageLevelAssertion(raw.assertion)
        const needsRef = needsElement(raw.action) || elementAssertion

        let refInfo: RefDescription | undefined
        let elementId: string | undefined
        if (needsRef) {
          if (!raw.ref) {
            throw new Error(
              `第 ${index + 1} 步（${raw.action}）缺少 ref：请先 browser_snapshot，再引用快照里的元素`,
            )
          }
          const cached = described.get(raw.ref)
          if (cached) {
            refInfo = cached.info
            elementId = cached.elementId
          } else {
            const info = await browser.describeRef(raw.ref)
            if (!info) {
              throw new Error(
                `第 ${index + 1} 步的 ref「${raw.ref}」已失效：请重新 browser_snapshot 后生成计划`,
              )
            }
            elementId = `el-plan-${String(described.size + 1).padStart(3, '0')}`
            elements[elementId] = {
              id: elementId,
              name: clippedName(raw.name) ?? info.name ?? info.tag,
              locators: planLocators(info),
            }
            described.set(raw.ref, { elementId, info })
            refInfo = info
          }
        }

        let params: Record<string, unknown> | undefined
        switch (raw.action) {
          case 'click':
            break
          case 'fill':
            if (raw.value === undefined) {
              throw new Error(`第 ${index + 1} 步（fill）缺少 value`)
            }
            params = { value: raw.value }
            break
          case 'select':
            if (raw.value === undefined) {
              throw new Error(`第 ${index + 1} 步（select）缺少 value（选项可见文本）`)
            }
            params = { value: raw.value, mode: refInfo?.tag === 'select' ? 'native' : 'custom' }
            break
          case 'press':
            params = { key: raw.key ?? 'Enter' }
            break
          case 'scroll':
            params = { x: raw.x ?? 0, y: raw.y ?? 0 }
            break
          case 'wait':
            params = { kind: 'timeout', ms: raw.timeoutMs ?? 1000 }
            break
          case 'assert':
            if (!raw.assertion) {
              throw new Error(`第 ${index + 1} 步（assert）缺少 assertion`)
            }
            break
        }

        const field = clippedName(raw.name) ?? refInfo?.name
        const displayValue =
          raw.value ??
          (raw.action === 'press' ? (raw.key ?? 'Enter') : undefined) ??
          (raw.assertion && 'expected' in raw.assertion && raw.assertion.expected !== undefined
            ? String(raw.assertion.expected)
            : raw.assertion?.type)

        steps.push({
          id,
          action: raw.action,
          ...(elementId ? { elementId } : {}),
          ...(params ? { params } : {}),
          ...(raw.assertion ? { assertion: raw.assertion } : {}),
          display: {
            verb: PLAN_VERB[raw.action] ?? raw.action,
            ...(field ? { field } : {}),
            ...(displayValue ? { value: displayValue } : {}),
          },
        })
      }

      const project = (await getDb().uow().projects.list())[0]
      if (!project) throw new Error('还没有项目，请先在平台创建项目')
      const caseFile = caseFileSchema.parse({
        case: {
          id: `ai-plan-${Date.now().toString(36)}`,
          name: parsed.name,
          projectId: project.id,
          startUrl,
          variables: {},
          intent: parsed.summary,
          steps,
        },
        elements,
      })
      const proposal: AiPlanProposal = {
        proposalId: `plan-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: parsed.name,
        summary: parsed.summary,
        startUrl,
        caseFile,
        createdAt: new Date().toISOString(),
      }
      ctx.platform.proposePlan(proposal)

      return {
        result: {
          ok: true,
          proposalId: proposal.proposalId,
          name: proposal.name,
          startUrl,
          stepCount: steps.length,
          elementCount: Object.keys(elements).length,
          note: '计划卡已显示，等待用户在中栏执行或保存；不要声称已经保存。',
        },
        label: `生成用例计划「${proposal.name}」· ${steps.length} 步`,
      }
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

export const AI_TOOL_MAP = new Map(AI_TOOLS.map((tool) => [tool.name, tool]))
