import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {
  electronVersion: process.versions.electron,
})
