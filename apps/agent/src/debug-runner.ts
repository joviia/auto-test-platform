import { basename } from 'node:path'
import { getDb, runDir } from '@atp/core'
import type { CaseFile, DebugState, StepResult } from '@atp/model'
import { runCaseOnPage, type StepHookContext } from '@atp/runner'
import type { Page } from 'playwright'

export type DebugAction = 'next' | 'continue' | 'pause' | 'stop' | 'set-breakpoints'

/**
 * 单步调试控制器：在 runCaseOnPage 的 beforeStep 门闩上暂停，
 * 由 next / continue / pause / stop 推进。不写 runs 表。
 */
export class DebugController {
  private currentState: DebugState | null = null
  private abort: AbortController | null = null
  private release: (() => void) | null = null
  private done: Promise<void> | null = null
  private resolveDone: (() => void) | null = null
  private mode: 'step' | 'continue' = 'step'
  private breakpoints = new Set<string>()

  constructor(private readonly onState: (state: DebugState) => void) {}

  get state(): DebugState | null {
    return this.currentState
  }

  get active(): boolean {
    return this.abort !== null
  }

  start(page: Page, file: CaseFile, breakpoints: string[]): { runId: string } {
    if (this.abort) throw new Error('已有调试会话正在执行')
    const runId = getDb().uow().runs.newRunId()
    this.breakpoints = new Set(breakpoints)
    this.mode = 'step'
    this.abort = new AbortController()
    this.done = new Promise<void>((resolve) => {
      this.resolveDone = resolve
    })
    this.currentState = {
      caseId: file.case.id,
      runId,
      startUrl: file.case.startUrl,
      status: 'running',
      index: 0,
      total: file.case.steps.length,
      breakpoints: [...this.breakpoints],
      variables: file.case.variables,
      results: {},
    }
    this.onState(this.currentState)
    void this.run(page, file, runId)
    return { runId }
  }

  /** 停止并等待当前步骤结束、执行器退出；用于用户手动接管导航 */
  async stopAndWait(): Promise<void> {
    if (!this.abort) return
    const done = this.done
    this.abort.abort()
    this.release?.()
    await done
  }

  command(action: DebugAction, breakpoints?: string[]): void {
    if (action === 'set-breakpoints') {
      this.breakpoints = new Set(breakpoints ?? [])
      this.update({ breakpoints: [...this.breakpoints] })
      return
    }
    if (!this.abort) throw new Error('没有正在进行的调试')
    if (action === 'stop') {
      this.abort.abort()
      this.release?.()
      return
    }
    if (action === 'pause') {
      // 当前步骤会执行完，下一步之前停下
      this.mode = 'step'
      return
    }
    if (action === 'next') this.mode = 'step'
    else this.mode = 'continue'
    this.release?.()
  }

  private update(patch: Partial<DebugState>): void {
    if (!this.currentState) return
    this.currentState = { ...this.currentState, ...patch }
    this.onState(this.currentState)
  }

  private async run(page: Page, file: CaseFile, runId: string): Promise<void> {
    const signal = this.abort?.signal
    let status: DebugState['status'] = 'passed'
    let error: string | undefined
    try {
      const result = await runCaseOnPage(page, file, {
        evidenceDir: runDir(runId),
        runId,
        signal,
        beforeStep: (context) => this.beforeStep(context),
        onStep: (step, index, total) => this.onStep(step, index, total, runId),
      })
      if (signal?.aborted) {
        status = 'stopped'
        error = '调试已停止'
      } else {
        status = result.status
        error = result.error
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      status = signal?.aborted ? 'stopped' : 'failed'
      error = signal?.aborted ? '调试已停止' : message
    } finally {
      this.abort = null
      this.release = null
      this.update({
        status,
        index: this.currentState?.total ?? 0,
        error,
        stepId: undefined,
        step: undefined,
      })
      this.resolveDone?.()
      this.resolveDone = null
    }
  }

  private async beforeStep(context: StepHookContext): Promise<void> {
    if (!this.currentState) return
    this.update({
      index: context.index,
      total: context.total,
      stepId: context.step.id,
      step: context.step,
      variables: context.variables,
    })
    if (this.mode === 'continue' && !this.breakpoints.has(context.step.id)) {
      this.update({ status: 'running' })
      return
    }

    this.update({ status: 'paused' })
    await new Promise<void>((resolve) => {
      this.release = resolve
    })
    this.release = null
    if (this.abort?.signal.aborted) return
    this.update({ status: 'running' })
  }

  private onStep(result: StepResult, index: number, total: number, runId: string): void {
    const results = { ...(this.currentState?.results ?? {}) }
    results[result.stepId] = {
      status: result.status,
      durationMs: result.durationMs,
      ...(result.error ? { error: result.error } : {}),
      ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
      ...(result.screenshotPath
        ? { screenshotUrl: `/evidence/${runId}/${basename(result.screenshotPath)}` }
        : {}),
    }
    this.update({ results, index: index + 1, total })
  }
}
