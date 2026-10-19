import type { CDPSession, Page } from 'playwright'

/** 上限 8 fps：页面重绘再快，也不需要把每帧都推给 UI */
const FRAME_INTERVAL_MS = 125
/** 最后一个订阅者离开后延迟停止，避免刷新/切换页面时反复启停 */
const IDLE_STOP_MS = 1200
/** CDP 不可用时的兜底轮询间隔 */
const FALLBACK_INTERVAL_MS = 700
/** 窗口被遮挡等情况下拿不到重绘帧，超过这个时间就主动截一张 */
const STALE_FRAME_MS = 2000
const WATCHDOG_INTERVAL_MS = 1500

export type LiveFrameListener = (frame: Buffer) => void

/**
 * 真实 Chrome 的只读实时画面。
 *
 * 用 `Page.startScreencast` 拿 JPEG 帧：只有页面重绘才产生帧，静止页面几乎不耗 CPU。
 * 帧先缓存最新一张，再按上限 8 fps 分发给订阅者；新订阅者会立刻收到当前帧，不用等重绘。
 * 没有订阅者时停止 screencast，UI 关掉后 CPU 能回落。
 */
export class LiveView {
  private listeners = new Set<LiveFrameListener>()
  private session: CDPSession | null = null
  private page: Page | null = null
  private latest: Buffer | null = null
  private starting: Promise<void> | null = null
  private stopping: Promise<void> | null = null
  private stopTimer: NodeJS.Timeout | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private fallbackTimer: NodeJS.Timeout | null = null
  private watchdogTimer: NodeJS.Timeout | null = null
  private pending: Buffer | null = null
  private lastEmit = 0
  private lastFrameAt = 0
  private lastCaptureAt = 0
  private capturing = false
  private generation = 0

  constructor(private readonly currentPage: () => Page | null) {}

  get running(): boolean {
    return this.session !== null || this.fallbackTimer !== null
  }

  subscribe(listener: LiveFrameListener): () => void {
    this.listeners.add(listener)
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    void this.ensureStarted().then(() => {
      if (this.latest && this.listeners.has(listener)) listener(this.latest)
    })
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.scheduleStop()
    }
  }

  /** 受控页面被替换时重绑 screencast（订阅者保留） */
  async rebind(): Promise<void> {
    if (this.listeners.size === 0) return
    await this.stop()
    await this.ensureStarted()
  }

  async stop(): Promise<void> {
    this.generation++
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer)
      this.fallbackTimer = null
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
    this.pending = null
    if (this.stopping) {
      await this.stopping
      return
    }
    const session = this.session
    this.session = null
    this.page = null
    if (!session) return
    const done = (async () => {
      await session.send('Page.stopScreencast').catch(() => undefined)
      await session.detach().catch(() => undefined)
    })()
    this.stopping = done
    try {
      await done
    } finally {
      if (this.stopping === done) this.stopping = null
    }
  }

  private scheduleStop(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null
      if (this.listeners.size === 0) void this.stop()
    }, IDLE_STOP_MS)
    this.stopTimer.unref?.()
  }

  private async ensureStarted(): Promise<void> {
    if (this.listeners.size === 0) return
    if (this.stopping) await this.stopping
    if (this.listeners.size === 0) return
    const page = this.currentPage()
    if (!page) return
    // 页面被关闭后重建：旧会话已失效，换绑到新页面
    if (this.session && this.page !== page) await this.stop()
    if (this.listeners.size === 0) return
    if (this.session) return
    if (this.starting) {
      await this.starting
      return
    }
    this.starting = this.start(page)
    try {
      await this.starting
    } finally {
      this.starting = null
    }
  }

  private async start(page: Page): Promise<void> {
    const generation = ++this.generation
    let session: CDPSession
    try {
      session = await page.context().newCDPSession(page)
    } catch {
      this.startFallback(page)
      return
    }
    if (generation !== this.generation || this.listeners.size === 0) {
      await session.detach().catch(() => undefined)
      return
    }
    this.session = session
    this.page = page
    session.on('Page.screencastFrame', (event) => {
      if (generation !== this.generation) return
      this.lastFrameAt = Date.now()
      // 必须逐帧 ack，否则 Chrome 会停止推流
      void session
        .send('Page.screencastFrameAck', { sessionId: event.sessionId })
        .catch(() => undefined)
      this.accept(Buffer.from(event.data, 'base64'))
    })
    try {
      await session.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: 1600,
        maxHeight: 1000,
        everyNthFrame: 1,
      })
    } catch {
      this.generation++
      this.session = null
      this.page = null
      await session.detach().catch(() => undefined)
      this.startFallback(page)
      return
    }
    this.lastFrameAt = Date.now()
    // 静止页面可能暂时没有重绘帧，主动截一张作为首帧
    void this.prime(page, generation)
    this.startWatchdog()
  }

  /**
   * 遮挡/最小化的窗口可能不再重绘，screencast 会停在旧帧。
   * 超过 STALE_FRAME_MS 没有新帧时，用低频截图把画面续上。
   */
  private startWatchdog(): void {
    if (this.watchdogTimer) return
    this.watchdogTimer = setInterval(() => void this.captureIfStale(), WATCHDOG_INTERVAL_MS)
    this.watchdogTimer.unref?.()
  }

  private async captureIfStale(): Promise<void> {
    if (this.listeners.size === 0 || this.fallbackTimer) return
    const page = this.page
    if (!page || page.isClosed()) return
    const now = Date.now()
    if (now - this.lastFrameAt < STALE_FRAME_MS) return
    if (now - this.lastCaptureAt < WATCHDOG_INTERVAL_MS) return
    if (this.capturing) return
    this.lastCaptureAt = now
    this.capturing = true
    try {
      const shot = await page.screenshot({ type: 'jpeg', quality: 55, timeout: 4000 })
      this.accept(shot)
    } catch {
      // 单次截图失败忽略，下一轮再试
    } finally {
      this.capturing = false
    }
  }

  private async prime(page: Page, generation: number): Promise<void> {
    try {
      const shot = await page.screenshot({ type: 'jpeg', quality: 60, timeout: 4000 })
      if (generation === this.generation && !this.latest) this.accept(shot)
    } catch {
      // 首帧交给 screencast；个别页面截图失败不影响推流
    }
  }

  private startFallback(page: Page): void {
    this.page = page
    if (this.fallbackTimer) return
    const capture = async (): Promise<void> => {
      if (this.listeners.size === 0 || page.isClosed() || this.capturing) return
      this.capturing = true
      try {
        const shot = await page.screenshot({ type: 'jpeg', quality: 55, timeout: 4000 })
        this.accept(shot)
      } catch {
        // 单次截图失败忽略，下一轮再试
      } finally {
        this.capturing = false
      }
    }
    void capture()
    this.fallbackTimer = setInterval(() => void capture(), FALLBACK_INTERVAL_MS)
    this.fallbackTimer.unref?.()
  }

  private accept(frame: Buffer): void {
    this.latest = frame
    const wait = FRAME_INTERVAL_MS - (Date.now() - this.lastEmit)
    if (wait <= 0) {
      this.emit(frame)
      return
    }
    this.pending = frame
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      const next = this.pending
      this.pending = null
      if (next) this.emit(next)
    }, wait)
    this.flushTimer.unref?.()
  }

  private emit(frame: Buffer): void {
    this.lastEmit = Date.now()
    for (const listener of this.listeners) {
      try {
        listener(frame)
      } catch {
        // 单个订阅者异常不影响其他客户端
      }
    }
  }
}
