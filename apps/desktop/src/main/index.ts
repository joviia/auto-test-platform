import { join } from 'node:path'
import { BrowserWindow, app } from 'electron'
import { createMainWindow } from './app-window'
import { configureRemoteDebugging } from './browser/cdp'
import { ensureControlledView } from './browser/controlled-browser'
import { initDb } from './db/client'
import {
  registerEvidenceProtocolHandler,
  registerEvidenceSchemePrivileges,
} from './evidence/protocol'
import { registerIpc } from './ipc/register'
import { initRecordingService } from './services/recording'

registerEvidenceSchemePrivileges()
// 嵌入回放需要本地 CDP；端口 0 = 由 Chromium 选空闲端口（仅本机）
configureRemoteDebugging()

// E2E/自动化验收：ATP_REMOTE_DEBUG=<port> 打开 CDP 远程调试
if (process.env.ATP_REMOTE_DEBUG) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.ATP_REMOTE_DEBUG)
}

/** 打包版启动时做一次更新检查（dev 跳过；无 feed 时静默失败） */
interface UpdaterLike {
  on: (event: string, listener: (arg: unknown) => void) => void
  checkForUpdates: () => Promise<unknown>
}

function initAutoUpdate(): void {
  if (!app.isPackaged) return
  import('electron-updater')
    .then(async (mod) => {
      // CJS 互操作：autoUpdater 可能在 default 命名空间
      const m = mod as {
        autoUpdater?: UpdaterLike
        default?: { autoUpdater?: UpdaterLike }
      }
      const updater = m.autoUpdater ?? m.default?.autoUpdater
      if (!updater) throw new Error('electron-updater 导入异常')
      updater.on('update-downloaded', () => {
        console.log('[atp] 更新已下载，重启后生效')
      })
      updater.on('error', (err: unknown) => {
        // feed 未配置/网络不可达时静默——M1 只就绪代码路径
        console.info('[atp] 更新检查跳过:', err instanceof Error ? err.message : String(err))
      })
      await updater.checkForUpdates().catch(() => {})
    })
    .catch((err: unknown) =>
      console.info('[atp] 更新检查跳过:', err instanceof Error ? err.message : String(err)),
    )
}

app.whenReady().then(() => {
  registerEvidenceProtocolHandler()
  initDb()
  registerIpc()
  initRecordingService()
  initAutoUpdate()
  const win = createMainWindow()
  ensureControlledView(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const next = createMainWindow()
      ensureControlledView(next)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 打包环境提示：playwright 浏览器二进制依赖本机缓存（M1 限制，见 README）
if (app.isPackaged) {
  console.log(`[atp] packaged, userData=${join(app.getPath('userData'))}`)
}
