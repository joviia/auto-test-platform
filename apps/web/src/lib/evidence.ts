/** 文件绝对路径 → /evidence/<runId>/<file>（本地 Agent 的 HTTP 证据服务） */
export function toEvidenceUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined
  const idx = path.indexOf('runs/')
  if (idx < 0) return undefined
  const rel = path.slice(idx + 5)
  return `/evidence/${rel}`
}
