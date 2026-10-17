import type { CaseFile, StepResult } from '@atp/model'
import { IpcEvent } from '@atp/model'
import { replayCaseFile, runCaseOnPage } from '@atp/runner'
import type { WebContentsView } from 'electron'
import { getMainWindow } from '../app-window'
import { connectControlledPage } from '../browser/controlled-page'
import { caseRepo } from '../db/repositories/cases'
import { runRepo } from '../db/repositories/runs'
import { runDir } from '../evidence/paths'
import { isRecording } from './recording'
import { isPlanRunning } from './run-lock'

export type ReplayMode = 'embedded' | 'standalone'

interface ActiveReplay {
  abort: AbortController
  caseId: string
}

let active: ActiveReplay | null = null

/**
 * 回放：
 * - embedded：通过本地 CDP 交给 Playwright 驱动受控 WebContentsView，中栏可见地执行
 * - standalone：保持原有独立 Chromium 窗口 + 全程视频
 */
export async function startReplay(
  caseId: string,
  view: WebContentsView | null,
  mode: ReplayMode,
): Promise<{ runId: string }> {
  if (isRecording()) throw new Error('录制进行中，无法回放')
  if (isPlanRunning()) throw new Error('计划执行中，无法回放')
  if (active) throw new Error('已有回放正在执行')

  const caseFile = caseRepo.get(caseId)
  if (!caseFile) throw new Error(`用例不存在：${caseId}`)

  const runId = runRepo.newRunId()
  const abort = new AbortController()
  active = { abort, caseId }

  const onStep = (result: StepResult, index: number, total: number): void => {
    getMainWindow()?.webContents.send(IpcEvent.replayProgress, {
      runId,
      index: index + 1,
      total,
      status: result.status,
    })
  }

  try {
    const evidenceDir = runDir(runId)
    const result =
      mode === 'standalone'
        ? await replayCaseFile(caseFile, {
            evidenceDir,
            headless: false,
            runId,
            onStep,
            signal: abort.signal,
          })
        : await runEmbedded(caseFile, view, runId, evidenceDir, onStep, abort.signal)

    runRepo.save(result)
    getMainWindow()?.webContents.send(IpcEvent.replayProgress, {
      runId,
      index: result.steps.length,
      total: result.steps.length,
      status: result.status,
    })
    return { runId }
  } finally {
    active = null
  }
}

async function runEmbedded(
  caseFile: CaseFile,
  view: WebContentsView | null,
  runId: string,
  evidenceDir: string,
  onStep: (result: StepResult, index: number, total: number) => void,
  signal: AbortSignal,
) {
  if (!view) throw new Error('受控浏览器未就绪')
  const controlled = await connectControlledPage(view, `atp-replay-${runId}`)
  try {
    return await runCaseOnPage(controlled.page, caseFile, {
      evidenceDir,
      runId,
      onStep,
      signal,
    })
  } finally {
    await controlled.close()
  }
}

export function stopReplay(): { ok: true } {
  active?.abort.abort()
  return { ok: true }
}

export function isReplaying(): boolean {
  return active !== null
}
