import { contextBridge, ipcRenderer } from 'electron'

/** 受控浏览器的录制桥：采集器事件 → 主进程 */
contextBridge.exposeInMainWorld('__atpBridge', {
  send: (event: unknown) => ipcRenderer.send('atp:recorder-event', event),
})
