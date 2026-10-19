import type { IpcEventName, IpcEventPayload, RendererInvoke } from '@atp/model'

declare global {
  interface Window {
    atp: {
      invoke: RendererInvoke
      on: <K extends IpcEventName>(
        event: K,
        listener: (payload: IpcEventPayload<K>) => void,
      ) => () => void
      /** web = 本地 Agent 的浏览器 UI；缺省 = Electron 嵌入视图 */
      mode?: 'web' | 'electron'
      /** 本地 Agent 访问 token（证据图片等带 query 的请求需要） */
      token?: string
    }
  }
}
