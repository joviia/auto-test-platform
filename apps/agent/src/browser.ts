import type { CaseFile, CaseGroup, Element, LiveStep, Step, StepResult } from '@atp/model'
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
import { type BrowserContext, type CDPSession, chromium, type Frame, type Page } from 'playwright'
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
  elements: Record<string, Element>
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
  private assertionElements: Record<string, Element> = {}
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

  async close(): Promise<void> {
    await this.live.stop()
    await this.cdp?.detach().catch(() => undefined)
    this.cdp = null
    await this.context.close()
  }
}
