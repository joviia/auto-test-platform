import { mkdir, realpath, stat } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import type { AiTarget, SkillManifest } from '@atp/model'
import type { Locator, Page } from 'playwright'
import { z } from 'zod'

export interface SkillContext {
  page: Page
  locator: Locator
  target: AiTarget
  dataDir: string
  signal: AbortSignal
}

export interface SkillResult {
  result: unknown
  label: string
}

export interface CopilotSkill {
  manifest: SkillManifest
  schema: z.ZodType
  run(input: Record<string, unknown>, ctx: SkillContext): Promise<SkillResult>
}

function checkAbort(ctx: SkillContext): void {
  if (ctx.signal.aborted) throw new Error('已停止')
}

async function readSliderValue(locator: Locator): Promise<number | null> {
  return locator.evaluate((el) => {
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const value = Number(el.value)
      return Number.isFinite(value) ? value : null
    }
    const raw = el.getAttribute('aria-valuenow')
    if (raw === null) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  })
}

interface SliderInfo {
  isRange: boolean
  min: number
  max: number
  step: number
  now: number | null
  orientation: 'horizontal' | 'vertical'
}

async function readSliderInfo(locator: Locator): Promise<SliderInfo> {
  return locator.evaluate((el): SliderInfo => {
    const numberAttr = (name: string): number | null => {
      const raw = el.getAttribute(name)
      if (raw === null || raw.trim() === '') return null
      const value = Number(raw)
      return Number.isFinite(value) ? value : null
    }
    const isRange = el instanceof HTMLInputElement && el.type === 'range'
    const input = isRange ? (el as HTMLInputElement) : null
    const min = numberAttr('aria-valuemin') ?? (input ? Number(input.min) : 0)
    const max = numberAttr('aria-valuemax') ?? (input ? Number(input.max) : 100)
    const rawStep = numberAttr('step') ?? (input ? Number(input.step) : 1)
    const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 1
    const ariaNow = numberAttr('aria-valuenow')
    const now = ariaNow ?? (input ? Number(input.value) : null)
    return {
      isRange,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) && max > min ? max : min + 100,
      step,
      now: now !== null && Number.isFinite(now) ? now : null,
      orientation: el.getAttribute('aria-orientation') === 'vertical' ? 'vertical' : 'horizontal',
    }
  })
}

function quantize(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value))
  const count = Math.round((clamped - min) / step)
  const snapped = min + count * step
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(6))
}

function near(actual: number | null, target: number, tolerance: number): boolean {
  return actual !== null && Math.abs(actual - target) <= tolerance
}

async function tryKeyboard(
  page: Page,
  locator: Locator,
  info: SliderInfo,
  target: number,
  tolerance: number,
): Promise<number | null> {
  const count = Math.round((target - info.min) / info.step)
  if (count < 0 || count > 120) return null
  const primary = info.orientation === 'vertical' ? 'ArrowUp' : 'ArrowRight'
  const secondary = info.orientation === 'vertical' ? 'ArrowRight' : 'ArrowUp'
  for (const key of [primary, secondary]) {
    await locator.focus().catch(() => undefined)
    await page.keyboard.press('Home').catch(() => undefined)
    for (let i = 0; i < count; i++) await page.keyboard.press(key)
    const actual = await readSliderValue(locator)
    if (near(actual, target, tolerance)) return actual
  }
  return null
}

async function tryClickTrack(
  page: Page,
  locator: Locator,
  info: SliderInfo,
  target: number,
  tolerance: number,
): Promise<number | null> {
  const box = await locator.boundingBox()
  if (!box) return null
  const ratio = info.max === info.min ? 0 : (target - info.min) / (info.max - info.min)
  const x =
    info.orientation === 'vertical'
      ? box.width / 2
      : Math.min(box.width - 1, Math.max(1, ratio * box.width))
  const y =
    info.orientation === 'vertical'
      ? Math.min(box.height - 1, Math.max(1, (1 - ratio) * box.height))
      : box.height / 2
  await locator.click({ position: { x, y }, timeout: 3000 }).catch(() => undefined)
  await page.waitForTimeout(120)
  const actual = await readSliderValue(locator)
  return near(actual, target, tolerance) ? actual : null
}

async function tryDrag(
  page: Page,
  locator: Locator,
  info: SliderInfo,
  target: number,
  tolerance: number,
): Promise<number | null> {
  const box = await locator.boundingBox()
  if (!box || info.now === null) return null
  const currentRatio = (info.now - info.min) / (info.max - info.min)
  const targetRatio = (target - info.min) / (info.max - info.min)
  const startX =
    info.orientation === 'vertical' ? box.x + box.width / 2 : box.x + currentRatio * box.width
  const startY =
    info.orientation === 'vertical'
      ? box.y + (1 - currentRatio) * box.height
      : box.y + box.height / 2
  const endX = info.orientation === 'vertical' ? startX : box.x + targetRatio * box.width
  const endY = info.orientation === 'vertical' ? box.y + (1 - targetRatio) * box.height : startY
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  for (let i = 1; i <= 16; i++) {
    const t = i / 16
    await page.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t)
    await page.waitForTimeout(10)
  }
  await page.mouse.up()
  await page.waitForTimeout(120)
  const actual = await readSliderValue(locator)
  return near(actual, target, tolerance) ? actual : null
}

const sliderSet: CopilotSkill = {
  manifest: {
    id: 'slider_set',
    name: '设置滑块',
    description:
      '把滑块或范围输入调到指定值。依次尝试键盘、点击轨道和拖拽，并读回值校验，适合原生 range 与 aria-slider。',
    category: 'input',
    params: [
      {
        name: 'ref',
        type: 'string',
        required: true,
        description: 'browser_snapshot 返回的滑块 ref',
      },
      {
        name: 'value',
        type: 'number',
        required: true,
        description: '目标值，会按 min/max/step 量化',
      },
      {
        name: 'name',
        type: 'string',
        required: false,
        description: '元素可读名称，仅用于界面展示',
      },
    ],
    example: '把「音量」滑块调到 80',
  },
  schema: z.object({
    ref: z.string().min(1),
    value: z.number(),
    name: z.string().optional(),
  }),
  async run(input, ctx) {
    checkAbort(ctx)
    const info = await readSliderInfo(ctx.locator)
    const requested = Number(input.value)
    if (!Number.isFinite(requested)) throw new Error('value 必须是数字')
    const target = quantize(requested, info.min, info.max, info.step)
    const tolerance = Math.max(info.step / 2, 0.001)
    const attempts: string[] = []

    const keyboard = await tryKeyboard(ctx.page, ctx.locator, info, target, tolerance)
    attempts.push(`键盘=${keyboard ?? '未生效'}`)
    if (keyboard !== null) {
      return {
        result: {
          ok: true,
          value: keyboard,
          target,
          method: 'keyboard',
          range: { min: info.min, max: info.max, step: info.step },
        },
        label: `滑块设为 ${keyboard}`,
      }
    }

    checkAbort(ctx)
    const clicked = await tryClickTrack(ctx.page, ctx.locator, info, target, tolerance)
    attempts.push(`点击=${clicked ?? '未生效'}`)
    if (clicked !== null) {
      return {
        result: { ok: true, value: clicked, target, method: 'click', attempts },
        label: `滑块设为 ${clicked}`,
      }
    }

    checkAbort(ctx)
    const dragged = await tryDrag(ctx.page, ctx.locator, info, target, tolerance)
    attempts.push(`拖拽=${dragged ?? '未生效'}`)
    if (dragged !== null) {
      return {
        result: { ok: true, value: dragged, target, method: 'drag', attempts },
        label: `滑块设为 ${dragged}`,
      }
    }

    const actual = await readSliderValue(ctx.locator)
    throw new Error(
      `滑块没有到达目标值：期望 ${target}，实际 ${actual ?? '无法读取'}。${attempts.join('；')}`,
    )
  },
}

async function visibleMenuItems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector = [
      '[role="menuitem"]',
      '[role="option"]',
      '[role="menu"] a',
      '.ant-dropdown-menu-item',
      '.el-dropdown-menu__item',
      '.MuiMenuItem-root',
    ].join(',')
    const visible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      )
    }
    return Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 20)
  })
}

const hoverMenu: CopilotSkill = {
  manifest: {
    id: 'hover_menu',
    name: '展开悬停菜单',
    description:
      '悬停元素并读回可见菜单项，适合 hover 才出现的下拉菜单。拿到菜单项后再用 browser_click 点击。',
    category: 'pointer',
    params: [
      { name: 'ref', type: 'string', required: true, description: '触发展开菜单的元素 ref' },
      {
        name: 'name',
        type: 'string',
        required: false,
        description: '元素可读名称，仅用于界面展示',
      },
    ],
    example: '展开「用户」菜单',
  },
  schema: z.object({
    ref: z.string().min(1),
    name: z.string().optional(),
  }),
  async run(_input, ctx) {
    checkAbort(ctx)
    await ctx.locator.hover({ timeout: 4000 })
    let items: string[] = []
    for (let i = 0; i < 5; i++) {
      await ctx.page.waitForTimeout(250)
      items = await visibleMenuItems(ctx.page)
      if (items.length > 0) break
    }
    return {
      result: { ok: true, opened: items.length > 0, items },
      label: `展开菜单${items.length ? ` · ${items.length} 项` : ''}`,
    }
  },
}

async function resolveUploadPath(dataDir: string, input: string): Promise<string> {
  const uploadsRoot = resolve(dataDir, 'uploads')
  await mkdir(uploadsRoot, { recursive: true })
  const requested = resolve(input)
  const file = await realpath(requested).catch(() => null)
  if (!file) throw new Error(`文件不存在：${requested}`)
  const root = await realpath(uploadsRoot).catch(() => uploadsRoot)
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    throw new Error(`只允许上传 ${join(dataDir, 'uploads')} 目录下的文件`)
  }
  const info = await stat(file)
  if (!info.isFile()) throw new Error(`不是普通文件：${file}`)
  return file
}

const uploadFile: CopilotSkill = {
  manifest: {
    id: 'upload_file',
    name: '上传文件',
    description: '给文件输入框选择本地文件。只允许上传 ~/.atp-agent/uploads 下的文件。',
    category: 'file',
    params: [
      { name: 'ref', type: 'string', required: true, description: 'file input 的 ref' },
      { name: 'path', type: 'string', required: true, description: 'uploads 目录下的文件路径' },
      {
        name: 'name',
        type: 'string',
        required: false,
        description: '元素可读名称，仅用于界面展示',
      },
    ],
    example: '给「头像」上传 uploads/avatar.png',
  },
  schema: z.object({
    ref: z.string().min(1),
    path: z.string().min(1),
    name: z.string().optional(),
  }),
  async run(input, ctx) {
    checkAbort(ctx)
    const file = await resolveUploadPath(ctx.dataDir, String(input.path))
    try {
      await ctx.locator.setInputFiles(file, { timeout: 5000 })
    } catch (err) {
      throw new Error(
        `上传失败：目标不是可用的文件输入框（${err instanceof Error ? err.message : String(err)}）`,
      )
    }
    const info = await stat(file)
    return {
      result: {
        ok: true,
        file: basename(file),
        bytes: info.size,
        path: file,
      },
      label: `上传 ${basename(file)}`,
    }
  },
}

export const COPILOT_SKILLS: CopilotSkill[] = [sliderSet, hoverMenu, uploadFile]

export const SKILL_MANIFESTS: SkillManifest[] = COPILOT_SKILLS.map((skill) => skill.manifest)

export const SKILL_MAP = new Map(COPILOT_SKILLS.map((skill) => [skill.manifest.id, skill]))
