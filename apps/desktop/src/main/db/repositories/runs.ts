import { randomUUID } from 'node:crypto'
import type { RunResult, RunRow, RunStepRow } from '@atp/model'
import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { runSteps, runs } from '../schema'

function toRunRow(r: typeof runs.$inferSelect): RunRow {
  return {
    id: r.id,
    caseId: r.caseId,
    status: r.status as RunRow['status'],
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    videoPath: r.videoPath,
    error: r.error,
  }
}

export const runRepo = {
  list(caseId?: string): RunRow[] {
    const rows = caseId
      ? getDb().select().from(runs).where(eq(runs.caseId, caseId)).all()
      : getDb().select().from(runs).all()
    return rows.map(toRunRow).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
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
        screenshotPath: s.screenshotPath,
      }))
    return { run: toRunRow(r), steps }
  },

  /** 落库一次完整回放结果（执行记录与用例定义分离），事务写入 */
  save(result: RunResult): void {
    getDb().transaction((tx) => {
      tx.insert(runs)
        .values({
          id: result.runId,
          caseId: result.caseId,
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
