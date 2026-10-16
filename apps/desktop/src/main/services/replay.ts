import type { RunResult } from '@atp/model'
import { IpcEvent } from '@atp/model'
import { replayCaseFile } from '@atp/runner'
import type { WebContentsView } from 'electron'
import { getMainWindow } from '../app-window'
import { caseRepo } from '../db/repositories/cases'
import { runRepo } from '../db/repositories/runs'
import { runDir } from '../evidence/paths'

/**
 * 回放：@atp/runner 起 Playwright Chromium 执行用例，证据落
 * userData/runs/<runId>/，完整结果入执行记录（与用例定义分离）。
 * M1 内联 await（回放期间中栏显示占位，见 BrowserStage）。
 */
export async function startReplay(
  caseId: string,
  view: WebContentsView | null,
): Promise<{ runId: string }> {
  const caseFile = caseRepo.get(caseId)
  if (!caseFile) throw new Error(`用例不存在：${caseId}`)

  const runId = runRepo.newRunId()
  const result: RunResult = await replayCaseFile(caseFile, {
    evidenceDir: runDir(runId),
    headless: false,
    runId,
  })
  runRepo.save(result)

  // 完成后通知 renderer 刷新报告
  getMainWindow()?.webContents.send(IpcEvent.replayProgress, {
    runId,
    index: result.steps.length,
    total: result.steps.length,
    status: result.status,
  })
  void view
  return { runId }
}
