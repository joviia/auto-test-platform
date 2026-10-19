import { join } from 'node:path'

let runsBase = ''

/** 初始化证据根目录（Agent 启动时调用一次） */
export function initEvidence(dataDir: string): void {
  runsBase = join(dataDir, 'runs')
}

/** 执行证据根目录：<dataDir>/runs/<runId>/ */
export function runsRoot(): string {
  if (!runsBase) throw new Error('证据目录尚未初始化')
  return runsBase
}

export function runDir(runId: string): string {
  return join(runsRoot(), runId)
}
