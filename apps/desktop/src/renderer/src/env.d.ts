import type { IpcChannelName, IpcEventName, IpcEventPayload, RendererInvoke } from '@atp/model'

declare global {
  interface Window {
    atp: {
      invoke: RendererInvoke
      on: <K extends IpcEventName>(
        event: K,
        listener: (payload: IpcEventPayload<K>) => void,
      ) => () => void
    }
  }
}
