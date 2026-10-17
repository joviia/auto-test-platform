import type { WebContentsView } from 'electron'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { getCdpPort } from './cdp'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface ControlledPage {
  browser: Browser
  page: Page
  close: () => Promise<void>
}

/**
 * 把受控 WebContentsView 交给 Playwright：
 * 先用唯一 hash 标记页面，再通过本地 CDP 找到对应 target。
 */
export async function connectControlledPage(
  view: WebContentsView,
  marker: string,
): Promise<ControlledPage> {
  await view.webContents.loadURL(`about:blank#${marker}`)

  // renderer 负责设置视图 bounds；0×0 会导致 Playwright 认为元素在视口外
  for (let i = 0; i < 15; i++) {
    const b = view.getBounds()
    if (b.width > 10 && b.height > 10) break
    await delay(100)
  }
  const bounds = view.getBounds()
  if (bounds.width <= 10 || bounds.height <= 10) {
    throw new Error('受控浏览器尚未显示，请先打开被测页面或切换设备预览后重试')
  }

  const port = await getCdpPort()
  let browser: Browser | null = null
  let page: Page | null = null
  for (let attempt = 0; attempt < 6 && !page; attempt++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    page =
      browser
        .contexts()[0]
        ?.pages()
        .find((p) => p.url().includes(marker)) ?? null
    if (!page) {
      await browser.close()
      browser = null
      await delay(200)
    }
  }
  if (!browser || !page) throw new Error('无法定位受控浏览器页面，请稍后重试')

  return {
    browser,
    page,
    close: async () => {
      await browser?.close()
    },
  }
}
