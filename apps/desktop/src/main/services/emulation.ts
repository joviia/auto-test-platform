import type { WebContentsView } from 'electron'
import { acquireDebugger, releaseDebugger } from '../browser/debugger'

export interface DeviceMetrics {
  width: number
  height: number
  deviceScaleFactor: number
  mobile: boolean
}

/**
 * 设备模拟：把受控视图的 CSS 视口固定为指定设备尺寸。
 * 原生 view 的显示尺寸由 renderer 计算（按舞台等比缩放），
 * Chrome 负责把模拟视口缩放到 view 大小。
 */
export async function applyDeviceMetrics(
  view: WebContentsView | null,
  metrics: DeviceMetrics | null,
): Promise<void> {
  if (!view) return
  if (!metrics) {
    try {
      await view.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
    } catch {
      // 未附加或页面已关闭
    }
    releaseDebugger(view, 'emulation')
    return
  }

  await acquireDebugger(view, 'emulation')
  await view.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: metrics.width,
    height: metrics.height,
    deviceScaleFactor: metrics.deviceScaleFactor,
    mobile: metrics.mobile,
    screenWidth: metrics.width,
    screenHeight: metrics.height,
  })
  try {
    await view.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
      enabled: metrics.mobile,
      maxTouchPoints: metrics.mobile ? 5 : 1,
    })
  } catch {
    // 部分页面/Debugger 版本不支持触摸模拟
  }
}
