import { BrowserWindow, app } from 'electron'
import { createMainWindow } from './app-window'
import { ensureControlledView } from './browser/controlled-browser'
import { initDb } from './db/client'
import {
  registerEvidenceProtocolHandler,
  registerEvidenceSchemePrivileges,
} from './evidence/protocol'
import { registerIpc } from './ipc/register'

registerEvidenceSchemePrivileges()

app.whenReady().then(() => {
  registerEvidenceProtocolHandler()
  initDb()
  registerIpc()
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
