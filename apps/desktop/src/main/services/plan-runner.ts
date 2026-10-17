import type { IpcEventPayload } from '@atp/model'
import { IpcEvent } from '@atp/model'
import { runCaseOnPage } from '@atp/runner'
import type { WebContentsView } from 'electron'
import { getMainWindow } from '../app-window'
import { connectControlledPage } from '../browser/controlled-page'
import { caseRepo } from '../db/repositories/cases'
import { planRepo, planRunRepo } from '../db/repositories/plans'
import { runRepo } from '../db/repositories/runs'
import { runDir } from '../evidence/paths'
import { isRecording } from './recording'
import { isReplaying } from './replay'
import { setPlanRunning } from './run-lock'

interface ActivePlanRun {
  planRunId: string
  abort: AbortController
}

let active: ActivePlanRun | null = null

type PlanProgress = IpcEventPayload<'event:plan-progress'>

function emitProgress(progress: PlanProgress): void {
  getMainWindow()?.webContents.send(IpcEvent.planProgress, progress)
}

/** 合并计划级取消与单用例超时信号 */
function combineSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  if (first.aborted || second.aborted) controller.abort()
  first.addEventListener('abort', onAbort)
  second.addEventListener('abort', onAbort)
  controller.signal.addEventListener('abort', () => {
    first.removeEventListener('abort', onAbort)
    second.removeEventListener('abort', onAbort)
  })
  return controller.signal
}

/**
 * 本地测试计划执行：按计划顺序逐条用例执行，
 * 支持重试、用例超时、失败继续/即停、取消与实时进度。
 */
export async function startPlanRun(
  planId: string,
  view: WebContentsView | null,
  onlyCaseIds?: string[],
): Promise<{ planRunId: string }> {
  if (isRecording()) throw new Error('录制进行中，无法执行计划')
  if (isReplaying()) throw new Error('单用例回放进行中，无法执行计划')
  if (active) throw new Error('已有计划正在执行')
  if (!view) throw new Error('受控浏览器未就绪')

  const detail = planRepo.get(planId)
  if (!detail) throw new Error(`计划不存在：${planId}`)
  const { plan } = detail
  // 重跑子集时仍按计划内的顺序执行，并忽略已不在计划里的用例
  const wanted = onlyCaseIds ? new Set(onlyCaseIds) : null
  const caseIds = wanted ? detail.caseIds.filter((id) => wanted.has(id)) : detail.caseIds
  if (caseIds.length === 0) {
    throw new Error(wanted ? '计划内没有可执行的用例' : '计划内没有用例')
  }

  const planRunId = planRunRepo.create(planId, caseIds.length).id
  const abort = new AbortController()
  active = { planRunId, abort }
  setPlanRunning(true)

  const maxAttempts = Math.max(1, plan.retries + 1)
  let passed = 0
  let failed = 0
  let runError: string | undefined

  const progressBase = {
    planRunId,
    planName: plan.name,
    caseTotal: caseIds.length,
    maxAttempts,
  }

  emitProgress({
    ...progressBase,
    phase: 'run-start',
    caseIndex: 0,
    caseName: '',
    attempt: 1,
    status: 'running',
  })

  try {
    const controlled = await connectControlledPage(view, `atp-plan-${planRunId}`)
    controlled.page.setDefaultTimeout(plan.timeoutMs)
    try {
      for (const [caseIndex, caseId] of caseIds.entries()) {
        if (abort.signal.aborted) break

        const caseFile = caseRepo.get(caseId)
        const caseName = caseFile?.case.name ?? caseId
        if (!caseFile) {
          failed++
          runError = runError ?? `用例不存在：${caseId}`
          emitProgress({
            ...progressBase,
            phase: 'case-end',
            caseIndex,
            caseId,
            caseName,
            attempt: 1,
            status: 'failed',
            error: '用例不存在',
          })
          if (!plan.continueOnFailure) break
          continue
        }

        let casePassed = false
        let lastError = ''
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (abort.signal.aborted) break
          emitProgress({
            ...progressBase,
            phase: 'case-start',
            caseIndex,
            caseId,
            caseName,
            attempt,
            status: 'running',
          })

          const runId = runRepo.newRunId()
          const caseAbort = new AbortController()
          const timer = setTimeout(() => caseAbort.abort(), plan.timeoutMs)
          try {
            const result = await runCaseOnPage(controlled.page, caseFile, {
              evidenceDir: runDir(runId),
              runId,
              signal: combineSignals(abort.signal, caseAbort.signal),
              onStep: (stepResult, index, total) => {
                emitProgress({
                  ...progressBase,
                  phase: 'step',
                  caseIndex,
                  caseId,
                  caseName,
                  attempt,
                  stepIndex: index + 1,
                  stepTotal: total,
                  status: stepResult.status,
                })
              },
            })
            if (caseAbort.signal.aborted && !abort.signal.aborted) {
              result.error = `用例超时（${plan.timeoutMs}ms）`
            }
            runRepo.save(result, {
              planRunId,
              attempt,
              caseSnapshot: JSON.stringify(caseFile),
            })
            if (result.status === 'passed') {
              casePassed = true
              break
            }
            lastError = result.error ?? '用例失败'
            if (attempt < maxAttempts && !abort.signal.aborted) {
              emitProgress({
                ...progressBase,
                phase: 'case-start',
                caseIndex,
                caseId,
                caseName,
                attempt: attempt + 1,
                status: 'retrying',
                error: lastError,
              })
            }
          } finally {
            clearTimeout(timer)
          }
        }

        if (casePassed) {
          passed++
        } else {
          failed++
          if (!abort.signal.aborted) runError = runError ?? `${caseName}: ${lastError}`
        }
        emitProgress({
          ...progressBase,
          phase: 'case-end',
          caseIndex,
          caseId,
          caseName,
          attempt: maxAttempts,
          status: casePassed ? 'passed' : 'failed',
          error: casePassed ? undefined : lastError,
        })
        if (!casePassed && !plan.continueOnFailure) break
      }
    } finally {
      await controlled.close()
    }
  } finally {
    const cancelled = abort.signal.aborted
    const status = cancelled ? 'cancelled' : failed > 0 ? 'failed' : 'passed'
    const finalError = cancelled ? '用户取消计划执行' : runError
    planRunRepo.finish(planRunId, { status, passed, failed, error: finalError })
    emitProgress({
      ...progressBase,
      phase: 'run-end',
      caseIndex: caseIds.length,
      caseName: '',
      attempt: 1,
      status,
      error: finalError,
    })
    setPlanRunning(false)
    active = null
  }

  return { planRunId }
}

export function stopPlanRun(): { ok: true } {
  active?.abort.abort()
  return { ok: true }
}
