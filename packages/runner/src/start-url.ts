import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** startUrl 解析：http(s) 原样；否则按相对仓库工作目录转 file:// */
export function toStartUrl(raw: string, override?: string): string {
  const s = override ?? raw
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  return pathToFileURL(resolve(process.cwd(), s)).href
}
