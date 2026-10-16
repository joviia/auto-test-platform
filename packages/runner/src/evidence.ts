import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

/** 证据采集：步骤截图 + 全程视频落盘（方案 §4.3，证据到步骤粒度） */
export class EvidenceCollector {
  private lastShot: string | undefined

  constructor(readonly dir: string) {}

  async ensure(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
  }

  async screenshot(page: Page, name: string): Promise<string | undefined> {
    try {
      const path = join(this.dir, name)
      await page.screenshot({ path })
      this.lastShot = path
      return path
    } catch {
      return undefined
    }
  }

  /** 失败时可能来不及重截，回退用最近一次截图 */
  lastScreenshotPath(): string | undefined {
    return this.lastShot
  }

  async adoptVideo(rawPath: string): Promise<string> {
    const target = join(this.dir, 'video.webm')
    await rename(rawPath, target)
    return target
  }
}
