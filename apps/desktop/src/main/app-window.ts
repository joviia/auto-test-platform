import { join } from 'node:path'
import { BrowserWindow } from 'electron'

let mainWindow: BrowserWindow | null = null

export function createMainWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: '自动化测试平台',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // dev 可见性：renderer console 转发到主进程 stdout；加载失败显式报错
  mainWindow.webContents.on('console-message', (_event) => {
    const m = _event as unknown as { message: string; level: string }
    console.log(`[renderer:${m.level}] ${m.message}`)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[atp] did-fail-load ${code} ${desc} ${url}`)
  })

  // dev 验收辅助：ATP_DEV_SHOT=<路径> 时启动数秒后自动截屏（不依赖加载事件）
  const shotPath = process.env.ATP_DEV_SHOT
  if (shotPath) {
    setTimeout(() => {
      void mainWindow
        ?.capturePage()
        .then((image) => require('node:fs').writeFileSync(shotPath, image.toPNG()))
        .then(() => console.log(`[atp] screenshot saved: ${shotPath}`))
        .catch((err) => console.error('[atp] screenshot failed:', err))
    }, 5000)
  }
  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
