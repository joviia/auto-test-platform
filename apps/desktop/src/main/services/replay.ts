import type { CaseFile, StepResult } from '@atp/model'
import { IpcEvent } from '@atp/model'
import { replayCaseFile, runCaseOnPage } from '@atp/runner'
import type { WebContentsView } from 'electron'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { getMainWindow } from '../app-window'
import { getCdpPort } from '../browser/cdp'
import { caseRepo } from '../db/repositories/cases'
import { runRepo } from '../db/repositories/runs'
import { runDir } from '../evidence/paths'
import { isRecording } from './recording'

export type ReplayMode = 'embedded' | 'standalone'

interface ActiveReplay {
  abort: AbortController
  caseId: string
}

let active: ActiveReplay | null = null

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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

  // 用一个唯一 hash 标记受控视图，便于 connectOverCDP 后准确定位 target
  const marker = `atp-replay-${runId}`
  await view.webContents.loadURL(`about:blank#${marker}`)

  // renderer 负责设置视图 bounds；0×0 会导致 Playwright 认为元素在视口外
  for (let i = 0; i < 15; i++) {
    const b = view.getBounds()
    if (b.width > 10 && b.height > 10) break
    await delay(100)
  }
  const bounds = view.getBounds()
  if (bounds.width <= 10 || bounds.height <= 10) {
    throw new Error('受控浏览器尚未显示，请先打开被测页面或切换设备预览后重试')
  }

  const port = await getCdpPort()
  let browser: Browser | null = null
  let page: Page | null = null

  for (let attempt = 0; attempt < 6 && !page; attempt++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    page =
      browser
        .contexts()[0]
        ?.pages()
        .find((p) => p.url().includes(marker)) ?? null
    if (!page) {
      await browser.close()
      browser = null
      await delay(200)
    }
  }

  if (!browser || !page) throw new Error('无法定位受控浏览器页面，请稍后重试')

  try {
    return await runCaseOnPage(page, caseFile, { evidenceDir, runId, onStep, signal })
  } finally {
    await browser.close()
  }
}

export function stopReplay(): { ok: true } {
  active?.abort.abort()
  return { ok: true }
}
