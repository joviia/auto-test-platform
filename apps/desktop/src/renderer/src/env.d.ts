import type { IpcChannelName, IpcEventName, RendererInvoke } from '@atp/model'

declare global {
  interface Window {
    atp: {
      invoke: RendererInvoke
      on: (event: IpcEventName, listener: (payload: never) => void) => () => void
    }
  }
}
