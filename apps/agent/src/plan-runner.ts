import { getDb, runDir } from '@atp/core'
import type { CaseFile, IpcEventPayload } from '@atp/model'
import { runCaseOnPage } from '@atp/runner'
import type { Page } from 'playwright'

type PlanProgress = IpcEventPayload<'event:plan-progress'>

interface ActivePlanRun {
  planRunId: string
  abort: AbortController
}

let active: ActivePlanRun | null = null

export function isPlanRunning(): boolean {
  return active !== null
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
  page: Page,
  planId: string,
  emit: (progress: PlanProgress) => void,
  onlyCaseIds?: string[],
): Promise<{ planRunId: string }> {
  if (active) throw new Error('已有计划正在执行')

  const db = getDb()
  const detail = await db.uow().plans.get(planId)
  if (!detail) throw new Error(`计划不存在：${planId}`)
  const { plan } = detail
  // 重跑子集时仍按计划内的顺序执行，并忽略已不在计划里的用例
  const wanted = onlyCaseIds ? new Set(onlyCaseIds) : null
  const caseIds = wanted ? detail.caseIds.filter((id) => wanted.has(id)) : detail.caseIds
  if (caseIds.length === 0) {
    throw new Error(wanted ? '计划内没有可执行的用例' : '计划内没有用例')
  }

  const planRunId = (await db.uow().planRuns.create(planId, caseIds.length)).id
  const abort = new AbortController()
  active = { planRunId, abort }

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

  emit({
    ...progressBase,
    phase: 'run-start',
    caseIndex: 0,
    caseName: '',
    attempt: 1,
    status: 'running',
  })

  try {
    page.setDefaultTimeout(plan.timeoutMs)
    for (const [caseIndex, caseId] of caseIds.entries()) {
      if (abort.signal.aborted) break

      const caseFile: CaseFile | null = await db.uow().cases.get(caseId)
      const caseName = caseFile?.case.name ?? caseId
      if (!caseFile) {
        failed++
        runError = runError ?? `用例不存在：${caseId}`
        emit({
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
        emit({
          ...progressBase,
          phase: 'case-start',
          caseIndex,
          caseId,
          caseName,
          attempt,
          status: 'running',
        })

        const runId = db.uow().runs.newRunId()
        const caseAbort = new AbortController()
        const timer = setTimeout(() => caseAbort.abort(), plan.timeoutMs)
        try {
          const result = await runCaseOnPage(page, caseFile, {
            evidenceDir: runDir(runId),
            runId,
            signal: combineSignals(abort.signal, caseAbort.signal),
            onStep: (stepResult, index, total) => {
              emit({
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
          await db.uow().runs.save(result, {
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
            emit({
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
      emit({
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
    const cancelled = abort.signal.aborted
    const status = cancelled ? 'cancelled' : failed > 0 ? 'failed' : 'passed'
    const finalError = cancelled ? '用户取消计划执行' : runError
    await db.uow().planRuns.finish(planRunId, { status, passed, failed, error: finalError })
    emit({
      ...progressBase,
      phase: 'run-end',
      caseIndex: caseIds.length,
      caseName: '',
      attempt: 1,
      status,
      error: finalError,
    })
    active = null
  }

  return { planRunId }
}

export function stopPlanRun(): { ok: true } {
  active?.abort.abort()
  return { ok: true }
}
