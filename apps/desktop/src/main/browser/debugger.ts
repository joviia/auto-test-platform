import type { WebContentsView } from 'electron'

/**
 * 受控视图的 debugger 会话共享管理。
 * 录制注入、设备模拟、回放都会用到 CDP，必须避免重复 attach/detach。
 */
const users = new Map<WebContentsView, Set<string>>()

function ensureSet(view: WebContentsView): Set<string> {
  let set = users.get(view)
  if (!set) {
    set = new Set()
    users.set(view, set)
  }
  return set
}

export async function acquireDebugger(view: WebContentsView, user: string): Promise<void> {
  const set = ensureSet(view)
  if (set.has(user)) return
  set.add(user)
  if (set.size > 1) return
  try {
    view.webContents.debugger.attach('1.3')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.includes('already attached')) {
      set.delete(user)
      throw err
    }
  }
  try {
    await view.webContents.debugger.sendCommand('Page.enable')
  } catch (err) {
    console.error('[atp] Page.enable 失败:', err)
  }
}

export function releaseDebugger(view: WebContentsView, user: string): void {
  const set = users.get(view)
  if (!set) return
  set.delete(user)
  if (set.size > 0) return
  try {
    view.webContents.debugger.detach()
  } catch {
    // 已分离
  }
  users.delete(view)
}

export function hasDebuggerUser(view: WebContentsView, user: string): boolean {
  return users.get(view)?.has(user) ?? false
}
