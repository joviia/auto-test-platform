import { randomUUID } from 'node:crypto'
import type { RunResult, RunRow, RunStepRow } from '@atp/model'
import { type SQL, and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../client'
import { cases, planRuns, runSteps, runs } from '../schema'

function toRunRow(r: typeof runs.$inferSelect): RunRow {
  return {
    id: r.id,
    caseId: r.caseId,
    planRunId: r.planRunId,
    attempt: r.attempt,
    status: r.status as RunRow['status'],
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    videoPath: r.videoPath,
    error: r.error,
  }
}

export const runRepo = {
  list(filter: { caseId?: string; planId?: string } = {}): RunRow[] {
    const conditions: SQL[] = []
    if (filter.caseId) conditions.push(eq(runs.caseId, filter.caseId))
    if (filter.planId) {
      const planRunIds = getDb()
        .select({ id: planRuns.id })
        .from(planRuns)
        .where(eq(planRuns.planId, filter.planId))
        .all()
        .map((r) => r.id)
      if (planRunIds.length === 0) return []
      conditions.push(inArray(runs.planRunId, planRunIds))
    }
    const base = getDb().select().from(runs)
    const rows = conditions.length > 0 ? base.where(and(...conditions)).all() : base.all()
    const caseName = (cid: string): string | undefined =>
      getDb().select({ name: cases.name }).from(cases).where(eq(cases.id, cid)).get()?.name
    return rows
      .map(toRunRow)
      .map((r) => ({ ...r, caseName: caseName(r.caseId) }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  },

  get(runId: string): { run: RunRow; steps: RunStepRow[] } | null {
    const r = getDb().select().from(runs).where(eq(runs.id, runId)).get()
    if (!r) return null
    const steps = getDb()
      .select()
      .from(runSteps)
      .where(eq(runSteps.runId, runId))
      .all()
      .sort((a, b) => a.idx - b.idx)
      .map((s) => ({
        id: s.id,
        runId: s.runId,
        idx: s.idx,
        stepId: s.stepId,
        action: s.action as RunStepRow['action'],
        status: s.status as RunStepRow['status'],
        durationMs: s.durationMs,
        error: s.error,
        locatorHit: s.locatorHit ? JSON.parse(s.locatorHit) : null,
        triedCandidates: s.triedCandidates ? JSON.parse(s.triedCandidates) : null,
        assertion: s.assertion ? JSON.parse(s.assertion) : null,
        skipped: Boolean(s.skipped),
        screenshotPath: s.screenshotPath,
      }))
    return { run: toRunRow(r), steps }
  },

  /** 落库一次完整回放结果（执行记录与用例定义分离），事务写入 */
  save(
    result: RunResult,
    meta?: { planRunId?: string; attempt?: number; caseSnapshot?: string },
  ): void {
    getDb().transaction((tx) => {
      tx.insert(runs)
        .values({
          id: result.runId,
          caseId: result.caseId,
          planRunId: meta?.planRunId ?? null,
          attempt: meta?.attempt ?? null,
          caseSnapshot: meta?.caseSnapshot ?? null,
          status: result.status,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          videoPath: result.videoPath ?? null,
          error: result.error ?? null,
        })
        .run()
      for (const s of result.steps) {
        tx.insert(runSteps)
          .values({
            id: `${result.runId}-${s.index}`,
            runId: result.runId,
            idx: s.index,
            stepId: s.stepId,
            action: s.action,
            status: s.status,
            durationMs: Math.round(s.durationMs),
            error: s.error ?? null,
            locatorHit: s.locatorHit ? JSON.stringify(s.locatorHit) : null,
            triedCandidates: s.triedCandidates ? JSON.stringify(s.triedCandidates) : null,
            assertion: s.assertion ? JSON.stringify(s.assertion) : null,
            skipped: s.skipped ? 1 : 0,
            screenshotPath: s.screenshotPath ?? null,
          })
          .run()
      }
    })
  },

  newRunId(): string {
    return `r-${randomUUID().slice(0, 8)}`
  },
}
