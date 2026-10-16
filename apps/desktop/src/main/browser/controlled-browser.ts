import { join } from 'node:path'
import type { Rectangle } from 'electron'
import { WebContentsView } from 'electron'

let view: WebContentsView | null = null

/**
 * 受控浏览器视图：录制的舞台（M1 回放走 Playwright 独立窗口）。
 * recorder-preload 常驻（提供 window.__atpBridge），事件是否采纳由录制服务决定；
 * bounds 由 renderer 经 IPC 上报同步。
 */
export function ensureControlledView(win: Electron.BrowserWindow): WebContentsView {
  if (!view) {
    view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/recorder.js'),
        sandbox: false,
      },
    })
    win.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }
  return view
}

export function getControlledView(): WebContentsView | null {
  return view
}

export async function navigateControlledView(url: string): Promise<void> {
  if (!view) throw new Error('受控浏览器尚未创建')
  // 已带完整 scheme（http/https/file 等）直接加载；否则视为本地路径转 file://
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    await view.webContents.loadURL(url)
    return
  }
  const { pathToFileURL } = await import('node:url')
  const { resolve } = await import('node:path')
  await view.webContents.loadURL(pathToFileURL(resolve(url)).href)
}

export function setControlledViewBounds(bounds: Rectangle): void {
  view?.setBounds(bounds)
}

export function hideControlledView(win: Electron.BrowserWindow): void {
  if (view) {
    win.contentView.removeChildView(view)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
  }
}

export function showControlledView(win: Electron.BrowserWindow): void {
  if (view && !win.contentView.children.includes(view)) {
    win.contentView.addChildView(view)
  }
}
