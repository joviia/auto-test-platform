import type {
  Element as CaseElement,
  CaseFile,
  CaseGroup,
  LiveStep,
  Step,
  StepResult,
} from '@atp/model'
import {
  buildElement,
  buildRecordedCase,
  collectorSource,
  normalizeEvents,
  type RawActionEvent,
  type RawProbeEvent,
  type RawRecorderEvent,
  type RecorderStep,
} from '@atp/recorder'
import { runCaseOnPage } from '@atp/runner'
import {
  type BrowserContext,
  type CDPSession,
  chromium,
  type Frame,
  type Locator,
  type Page,
} from 'playwright'
import { LiveView } from './live-view.js'

export type BrowserEvent =
  | { type: 'recording-step'; step: LiveStep }
  | { type: 'recording-status'; recording: boolean; url: string }
  | { type: 'recording-error'; message: string }

export interface BrowserOptions {
  profileDir: string
  headless: boolean
  onEvent: (event: BrowserEvent) => void
}

export interface DeviceMetrics {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
}

export interface RecordedDraft {
  steps: Step[]
  elements: Record<string, CaseElement>
  startUrl: string
  intent: string
  groups: CaseGroup[]
  rawEvents: number
  diagnostics: {
    rawEvents: number
    frames: Array<{ url: string; injected: boolean }>
  }
}

export interface ReplayOptions {
  evidenceDir: string
  runId: string
  signal?: AbortSignal
  onStep?: (result: StepResult, index: number, total: number) => void
}

export interface SnapshotElement {
  ref: string
  role: string
  name: string
  value?: string
  checked?: boolean
  disabled?: boolean
  tag: string
  inViewport: boolean
  /** 滑块类控件的范围信息，帮助模型理解如何设值 */
  min?: number
  max?: number
  step?: number
  orientation?: 'horizontal' | 'vertical'
}

export interface PageSnapshot {
  url: string
  title: string
  viewport: { width: number; height: number }
  scroll: { x: number; y: number }
  /** 页面可见文本摘录，帮助模型理解内容 */
  text: string
  elements: SnapshotElement[]
  truncated: boolean
}

export interface TargetInfo {
  rect: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number }
  role: string
  name: string
}

/** 把一次快照里的 ref 解析成可持久化的定位信息（AI 计划卡生成用） */
export interface RefDescription {
  role: string
  name: string
  tag: string
  testId?: string
  text?: string
  css: string
  xpath: string
}

const INIT_SCRIPT = `window.__atpBridge={send:(e)=>window.__atpSend(e)};${collectorSource()}`

function framePathOf(frame: Frame): number[] {
  const path: number[] = []
  let cur: Frame = frame
  while (cur.parentFrame()) {
    const parent = cur.parentFrame()
    if (!parent) break
    const idx = parent.childFrames().indexOf(cur)
    if (idx < 0) break
    path.unshift(idx)
    cur = parent
  }
  return path
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'about:blank'
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `http://${trimmed}`
}

function isRealUrl(url: string | undefined): url is string {
  return typeof url === 'string' && url.length > 0 && !url.startsWith('about:')
}

/** RecorderStep 就是 renderer 需要的实时预览结构（含候选与作用域） */
function toLiveStep(step: RecorderStep | LiveStep): LiveStep {
  return {
    action: step.action,
    target: step.target,
    candidates: step.candidates,
    url: step.url,
    ts: step.ts,
    ...(step.value !== undefined ? { value: step.value } : {}),
    ...(step.key !== undefined ? { key: step.key } : {}),
    ...(step.x !== undefined ? { x: step.x } : {}),
    ...(step.y !== undefined ? { y: step.y } : {}),
    ...(step.dx !== undefined ? { dx: step.dx } : {}),
    ...(step.dy !== undefined ? { dy: step.dy } : {}),
    ...(step.startX !== undefined ? { startX: step.startX } : {}),
    ...(step.startY !== undefined ? { startY: step.startY } : {}),
    ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
  }
}

/** 真实 Chrome 的生命周期、录制注入与回放 */
export class ChromeController {
  private page: Page
  private cdp: CDPSession | null = null
  private recording = false
  private buffer: RawRecorderEvent[] = []
  private startUrl = ''
  private assertionArmed = false
  private assertionSteps: Step[] = []
  private assertionElements: Record<string, CaseElement> = {}
  readonly live: LiveView

  private constructor(
    readonly context: BrowserContext,
    readonly engine: string,
    private readonly options: BrowserOptions,
  ) {
    this.page = context.pages()[0] as Page
    this.live = new LiveView(() => (this.page && !this.page.isClosed() ? this.page : null))
  }

  static async launch(options: BrowserOptions): Promise<ChromeController> {
    const attempts: Array<{ channel?: 'chrome'; label: string }> = [
      { channel: 'chrome', label: 'Google Chrome' },
      { label: 'Playwright Chromium' },
    ]
    let lastError: unknown
    for (const attempt of attempts) {
      try {
        const context = await chromium.launchPersistentContext(options.profileDir, {
          ...(attempt.channel ? { channel: attempt.channel } : {}),
          headless: options.headless,
          viewport: { width: 1280, height: 800 },
          args: [
            '--no-first-run',
            '--no-default-browser-check',
            // 窗口被遮挡时 Chrome 默认会停止重绘，实时镜像会停在旧帧
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
          ],
        })
        const version = context.browser()?.version()
        const engine = version ? `${attempt.label} ${version}` : attempt.label
        const controller = new ChromeController(context, engine, options)
        await controller.init()
        return controller
      } catch (err) {
        lastError = err
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError)
    throw new Error(
      `无法启动浏览器（Chrome 或 Chromium）。如果之前打开过 ATP 窗口，请先关闭。原因：${reason}`,
    )
  }

  private async init(): Promise<void> {
    await this.context.exposeBinding('__atpSend', async (source, event: unknown) => {
      this.handleRaw(event, source.frame)
    })
    await this.context.addInitScript({ content: INIT_SCRIPT })
    this.page = await this.ensurePage()
    this.context.on('page', (page) => {
      if (this.page.isClosed()) {
        this.page = page
        void this.live.rebind()
      }
    })
  }

  private async ensurePage(): Promise<Page> {
    if (!this.page || this.page.isClosed()) {
      this.page = await this.context.newPage()
      void this.live.rebind()
    }
    return this.page
  }

  private handleRaw(raw: unknown, frame: Frame): void {
    if (!this.recording) return
    const event = raw as RawRecorderEvent
    if (!event || typeof event.kind !== 'string') return
    if (event.kind === 'probe') {
      const probe: RawProbeEvent = { ...event, framePath: framePathOf(frame) }
      this.buffer.push(probe)
      return
    }
    if (!Array.isArray(event.candidates)) return
    const withFrame: RawActionEvent = { ...event, framePath: framePathOf(frame) }
    try {
      if (this.assertionArmed) {
        this.assertionArmed = false
        const el = buildElement(withFrame.target, withFrame.candidates, withFrame.framePath)
        this.assertionElements[el.id] = el
        const step: Step = {
          id: `s-assert-${Date.now().toString(36)}`,
          action: 'assert',
          elementId: el.id,
          assertion: { type: 'visible' },
        }
        this.assertionSteps.push(step)
        this.options.onEvent({
          type: 'recording-step',
          step: toLiveStep({
            action: 'assert',
            target: withFrame.target,
            candidates: withFrame.candidates,
            url: withFrame.url,
            ts: withFrame.ts,
          }),
        })
        return
      }

      this.buffer.push(withFrame)
      const steps = normalizeEvents(this.buffer)
      const last = steps[steps.length - 1]
      if (last) this.options.onEvent({ type: 'recording-step', step: toLiveStep(last) })
    } catch (err) {
      this.options.onEvent({
        type: 'recording-error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  get currentUrl(): string {
    return this.page.isClosed() ? '' : this.page.url()
  }

  get isRecording(): boolean {
    return this.recording
  }

  /** 计划执行需要直接用同一个真实 Chrome 页 */
  async runnerPage(): Promise<Page> {
    return this.ensurePage()
  }

  async navigate(input: string): Promise<string> {
    const page = await this.ensurePage()
    const url = normalizeUrl(input)
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
    return page.url()
  }

  async focus(): Promise<void> {
    const page = await this.ensurePage()
    await page.bringToFront()
  }

  async emulate(metrics: DeviceMetrics | null): Promise<void> {
    const page = await this.ensurePage()
    this.cdp ??= await page.context().newCDPSession(page)
    if (!metrics) {
      await this.cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
      return
    }
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: metrics.width,
      height: metrics.height,
      deviceScaleFactor: metrics.deviceScaleFactor,
      mobile: metrics.mobile,
      screenWidth: metrics.width,
      screenHeight: metrics.height,
    })
    await this.cdp
      .send('Emulation.setTouchEmulationEnabled', {
        enabled: metrics.mobile,
        maxTouchPoints: metrics.mobile ? 5 : 1,
      })
      .catch(() => undefined)
  }

  startRecording(): void {
    this.buffer = []
    this.assertionSteps = []
    this.assertionElements = {}
    this.assertionArmed = false
    this.startUrl = isRealUrl(this.currentUrl) ? this.currentUrl : ''
    this.recording = true
    this.options.onEvent({ type: 'recording-status', recording: true, url: this.currentUrl })
  }

  armAssertion(): void {
    if (this.recording) this.assertionArmed = true
  }

  async stopRecording(): Promise<RecordedDraft> {
    this.recording = false
    const events = this.buffer
    this.buffer = []
    const draft = buildRecordedCase(events, {
      startUrl: this.startUrl || events.find((e) => e.isTop)?.url || this.currentUrl || undefined,
    })
    const diagnostics = await this.collectDiagnostics()
    const result: RecordedDraft = {
      steps: [...draft.steps, ...this.assertionSteps],
      elements: { ...draft.elements, ...this.assertionElements },
      startUrl: draft.startUrl,
      intent: draft.intent,
      groups: draft.groups,
      rawEvents: events.length,
      diagnostics: { rawEvents: events.length, frames: diagnostics },
    }
    this.startUrl = ''
    this.assertionSteps = []
    this.assertionElements = {}
    this.assertionArmed = false
    this.options.onEvent({ type: 'recording-status', recording: false, url: this.currentUrl })
    return result
  }

  private async collectDiagnostics(): Promise<Array<{ url: string; injected: boolean }>> {
    if (this.page.isClosed()) return []
    return Promise.all(
      this.page.frames().map(async (frame) => {
        try {
          const injected = await frame.evaluate(() =>
            Boolean((window as { __atpRecorderInstalled?: boolean }).__atpRecorderInstalled),
          )
          return { url: frame.url(), injected: injected === true }
        } catch {
          return { url: frame.url(), injected: false }
        }
      }),
    )
  }

  async replay(file: CaseFile, opts: ReplayOptions) {
    const page = await this.ensurePage()
    return runCaseOnPage(page, file, opts)
  }

  /** 内置演示页的脚本化操作：用于一键验证录制链路 */
  async runDemo(demoUrl: string): Promise<void> {
    const page = await this.ensurePage()
    if (!page.url().includes('/demo')) {
      await page.goto(demoUrl, { waitUntil: 'load' })
    }
    const stamp = Date.now().toString(36)
    await page.fill('#content-name', `节目_${stamp}`)
    await page.selectOption('#content-type', 'movie')
    await page.check('#show-title')
    await page.click('#save')
    await page.waitForTimeout(350)
  }

  /**
   * 给 AI 的页面语义快照：只返回可交互元素与可见文本，不暴露选择器。
   * 每次快照重新分配 ref，旧 ref 立即失效，避免模型拿旧编号误点新元素。
   */
  async snapshot(): Promise<PageSnapshot> {
    const page = await this.ensurePage()
    return page.evaluate(() => {
      const MAX = 120
      document.querySelectorAll('[data-atp-ref]').forEach((el) => {
        el.removeAttribute('data-atp-ref')
      })
      const generation = Math.random().toString(36).slice(2, 6)
      const selector = [
        'a[href]',
        'button',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="combobox"]',
        '[contenteditable="true"]',
        'summary',
      ].join(',')
      const nodes = Array.from(document.querySelectorAll(selector))

      const visible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        return (
          rect.width > 0.5 &&
          rect.height > 0.5 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        )
      }
      const roleOf = (el: Element): string => {
        const explicit = el.getAttribute('role')
        if (explicit) return explicit
        const tag = el.tagName.toLowerCase()
        if (tag === 'a') return 'link'
        if (tag === 'button') return 'button'
        if (tag === 'select') return 'combobox'
        if (tag === 'textarea') return 'textbox'
        if (tag === 'input') {
          const type = (el as HTMLInputElement).type
          if (type === 'checkbox') return 'checkbox'
          if (type === 'radio') return 'radio'
          if (type === 'range') return 'slider'
          if (type === 'submit' || type === 'button' || type === 'reset') return 'button'
          return 'textbox'
        }
        if ((el as HTMLElement).isContentEditable) return 'textbox'
        return tag
      }
      const nameOf = (el: Element): string => {
        const aria = el.getAttribute('aria-label')
        if (aria?.trim()) return aria.trim()
        const labelledBy = el.getAttribute('aria-labelledby')
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
          if (text) return text.slice(0, 80)
        }
        if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement
        ) {
          if (el.id) {
            const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
            const text = label?.textContent?.replace(/\s+/g, ' ').trim()
            if (text) return text.slice(0, 80)
          }
          const parentLabel = el.closest('label')?.textContent?.replace(/\s+/g, ' ').trim()
          if (parentLabel) return parentLabel.slice(0, 80)
          const placeholder = el.getAttribute('placeholder')
          if (placeholder) return placeholder
          const name = el.getAttribute('name')
          if (name) return name
        }
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text) return text.slice(0, 80)
        return el.getAttribute('title') ?? el.getAttribute('name') ?? el.tagName.toLowerCase()
      }

      const elements: Array<{
        ref: string
        role: string
        name: string
        value?: string
        checked?: boolean
        disabled?: boolean
        tag: string
        inViewport: boolean
        min?: number
        max?: number
        step?: number
        orientation?: 'horizontal' | 'vertical'
      }> = []
      let index = 0
      for (const el of nodes) {
        if (elements.length >= MAX) break
        if (!visible(el) || el.closest('[aria-hidden="true"]')) continue
        const rect = el.getBoundingClientRect()
        const ref = `${generation}-${++index}`
        el.setAttribute('data-atp-ref', ref)
        const entry: (typeof elements)[number] = {
          ref,
          role: roleOf(el),
          name: nameOf(el),
          tag: el.tagName.toLowerCase(),
          inViewport:
            rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
        }
        if (el instanceof HTMLInputElement) {
          if (el.type === 'checkbox' || el.type === 'radio') entry.checked = el.checked
          else if (el.type !== 'password') entry.value = el.value
          entry.disabled = el.disabled
          if (el.type === 'range') {
            const min = Number(el.min)
            const max = Number(el.max)
            const step = Number(el.step)
            if (Number.isFinite(min)) entry.min = min
            if (Number.isFinite(max)) entry.max = max
            if (Number.isFinite(step) && step > 0) entry.step = step
            entry.orientation = 'horizontal'
          }
        } else if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          entry.value = el.value
          entry.disabled = el.disabled
        } else {
          if (el.getAttribute('aria-disabled') === 'true') entry.disabled = true
          if (el.getAttribute('role') === 'slider') {
            const now = el.getAttribute('aria-valuenow')
            if (now !== null) entry.value = now
            const min = Number(el.getAttribute('aria-valuemin'))
            const max = Number(el.getAttribute('aria-valuemax'))
            if (Number.isFinite(min)) entry.min = min
            if (Number.isFinite(max)) entry.max = max
            entry.orientation =
              el.getAttribute('aria-orientation') === 'vertical' ? 'vertical' : 'horizontal'
          }
        }
        elements.push(entry)
      }

      return {
        url: location.href,
        title: document.title,
        viewport: { width: innerWidth, height: innerHeight },
        scroll: { x: scrollX, y: scrollY },
        text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 1800),
        elements,
        truncated: nodes.length > MAX,
      }
    })
  }

  /** 解析一次快照里的 ref；旧 ref 已被下一次快照清除，会返回 null */
  async resolveRef(ref: string): Promise<{ locator: Locator; target: TargetInfo } | null> {
    if (!/^[a-z0-9-]{1,32}$/i.test(ref)) return null
    const page = await this.ensurePage()
    const locator = page.locator(`[data-atp-ref="${ref}"]`).first()
    if ((await locator.count()) === 0) return null
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined)
    const target = await locator.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: innerWidth, height: innerHeight },
        role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
        name: (el.getAttribute('aria-label') ?? el.textContent ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80),
      }
    })
    return { locator, target }
  }

  /** 解析 ref 的角色、可读名与定位候选（不写入 DOM） */
  async describeRef(ref: string): Promise<RefDescription | null> {
    if (!/^[a-z0-9-]{1,32}$/i.test(ref)) return null
    const page = await this.ensurePage()
    const locator = page.locator(`[data-atp-ref="${ref}"]`).first()
    if ((await locator.count()) === 0) return null
    return locator.evaluate((el) => {
      const cssEscape = (value: string): string =>
        typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value

      const roleOf = (node: Element): string => {
        const explicit = node.getAttribute('role')
        if (explicit) return explicit
        const tag = node.tagName.toLowerCase()
        if (tag === 'a') return 'link'
        if (tag === 'button') return 'button'
        if (tag === 'select') return 'combobox'
        if (tag === 'textarea') return 'textbox'
        if (tag === 'input') {
          const type = (node as HTMLInputElement).type
          if (type === 'checkbox') return 'checkbox'
          if (type === 'radio') return 'radio'
          if (type === 'range') return 'slider'
          if (type === 'submit' || type === 'button' || type === 'reset') return 'button'
          return 'textbox'
        }
        if ((node as HTMLElement).isContentEditable) return 'textbox'
        return tag
      }

      const nameOf = (node: Element): string => {
        const aria = node.getAttribute('aria-label')
        if (aria?.trim()) return aria.trim()
        const labelledBy = node.getAttribute('aria-labelledby')
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
          if (text) return text.slice(0, 80)
        }
        if (
          node instanceof HTMLInputElement ||
          node instanceof HTMLTextAreaElement ||
          node instanceof HTMLSelectElement
        ) {
          if (node.id) {
            const label = document.querySelector(`label[for="${cssEscape(node.id)}"]`)
            const text = label?.textContent?.replace(/\s+/g, ' ').trim()
            if (text) return text.slice(0, 80)
          }
          const parentLabel = node.closest('label')?.textContent?.replace(/\s+/g, ' ').trim()
          if (parentLabel) return parentLabel.slice(0, 80)
          const placeholder = node.getAttribute('placeholder')
          if (placeholder) return placeholder
          const name = node.getAttribute('name')
          if (name) return name
        }
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text) return text.slice(0, 80)
        return node.getAttribute('title') ?? node.getAttribute('name') ?? node.tagName.toLowerCase()
      }

      const nthOfType = (node: Element): number => {
        let index = 1
        let sibling = node.previousElementSibling
        while (sibling) {
          if (sibling.tagName === node.tagName) index++
          sibling = sibling.previousElementSibling
        }
        return index
      }

      const cssChain = (node: Element): string => {
        const parts: string[] = []
        let current: Element | null = node
        while (current && current.nodeType === 1 && current !== document.documentElement) {
          let segment = current.tagName.toLowerCase()
          if (current.id) {
            parts.unshift(`${segment}#${cssEscape(current.id)}`)
            break
          }
          const testId = current.getAttribute('data-testid')
          if (testId) segment += `[data-testid="${cssEscape(testId)}"]`
          else if (current.classList.length > 0) segment += `.${cssEscape(current.classList[0])}`
          else segment += `:nth-of-type(${nthOfType(current)})`
          parts.unshift(segment)
          current = current.parentElement
          try {
            if (document.querySelectorAll(parts.join(' > ')).length === 1) break
          } catch {
            break
          }
        }
        return parts.join(' > ')
      }

      const xpathOf = (node: Element): string => {
        const parts: string[] = []
        let current: Element | null = node
        while (current && current.nodeType === 1) {
          if (current === document.documentElement) {
            parts.unshift('html[1]')
            break
          }
          let index = 1
          let sibling = current.previousElementSibling
          while (sibling) {
            if (sibling.tagName === current.tagName) index++
            sibling = sibling.previousElementSibling
          }
          parts.unshift(`${current.tagName.toLowerCase()}[${index}]`)
          current = current.parentElement
        }
        return `/${parts.join('/')}`
      }

      const testId = el.getAttribute('data-testid')?.trim()
      const directText =
        el.children.length === 0 ? (el.textContent ?? '').replace(/\s+/g, ' ').trim() : ''
      const name = nameOf(el)
      return {
        role: roleOf(el),
        name,
        tag: el.tagName.toLowerCase(),
        ...(testId ? { testId } : {}),
        ...(directText && directText.length <= 60 ? { text: directText } : {}),
        css: cssChain(el),
        xpath: xpathOf(el),
      }
    })
  }

  /** AI 证据截图（操作后自动调用） */
  async screenshotJpeg(quality = 55): Promise<Buffer> {
    const page = await this.ensurePage()
    return page.screenshot({ type: 'jpeg', quality, timeout: 8000 })
  }

  async close(): Promise<void> {
    await this.live.stop()
    await this.cdp?.detach().catch(() => undefined)
    this.cdp = null
    await this.context.close()
  }
}
