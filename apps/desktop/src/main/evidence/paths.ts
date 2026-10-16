import { join } from 'node:path'
import { app } from 'electron'

/** 执行证据根目录：<userData>/runs/<runId>/ */
export function runsRoot(): string {
  return join(app.getPath('userData'), 'runs')
}

export function runDir(runId: string): string {
  return join(runsRoot(), runId)
}
