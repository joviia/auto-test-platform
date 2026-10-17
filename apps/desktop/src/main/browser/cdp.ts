import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

let resolvedPort: number | null = null

/**
 * 为嵌入回放启用本地 CDP。
 * 必须在 app ready 之前调用；端口 0 让 Chromium 选一个空闲端口，
 * 之后从 userData/DevToolsActivePort 读取真实端口。
 */
export function configureRemoteDebugging(): void {
  const envPort = process.env.ATP_REMOTE_DEBUG
  if (envPort) {
    resolvedPort = Number(envPort)
    // E2E/调试启动参数里通常已经带了 remote-debugging-port
    return
  }
  const hasFlag = process.argv.some((arg) => arg.startsWith('--remote-debugging-port'))
  if (!hasFlag) {
    app.commandLine.appendSwitch('remote-debugging-port', '0')
  }
}

export async function getCdpPort(): Promise<number> {
  if (resolvedPort) return resolvedPort
  const file = join(app.getPath('userData'), 'DevToolsActivePort')
  for (let i = 0; i < 50; i++) {
    try {
      const text = await readFile(file, 'utf8')
      const port = Number(text.split('\n')[0]?.trim())
      if (Number.isInteger(port) && port > 0) {
        resolvedPort = port
        return port
      }
    } catch {
      // 文件尚未生成
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('无法获取本地 CDP 端口（DevToolsActivePort 未生成）')
}
