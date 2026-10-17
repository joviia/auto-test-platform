import { randomUUID } from 'node:crypto'
import type { PlanRow, PlanRunRow, RunRow } from '@atp/model'
import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { cases, planItems, planRuns, plans, runSteps, runs } from '../schema'

function toPlanRow(
  r: typeof plans.$inferSelect,
  caseCount: number,
  lastRun: typeof planRuns.$inferSelect | undefined,
): PlanRow {
  return {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    suiteId: r.suiteId,
    retries: r.retries,
    timeoutMs: r.timeoutMs,
    continueOnFailure: Boolean(r.continueOnFailure),
    caseCount,
    lastRunStatus: (lastRun?.status as PlanRow['lastRunStatus']) ?? null,
    lastRunAt: lastRun?.startedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function toPlanRunRow(r: typeof planRuns.$inferSelect): PlanRunRow {
  return {
    id: r.id,
    planId: r.planId,
    status: r.status as PlanRunRow['status'],
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    total: r.total,
    passed: r.passed,
    failed: r.failed,
    error: r.error,
  }
}

function countItems(planId: string): number {
  return getDb().select().from(planItems).where(eq(planItems.planId, planId)).all().length
}

function latestPlanRun(planId: string): typeof planRuns.$inferSelect | undefined {
  return getDb()
    .select()
    .from(planRuns)
    .where(eq(planRuns.planId, planId))
    .all()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
}

export const planRepo = {
  list(projectId: string): PlanRow[] {
    return getDb()
      .select()
      .from(plans)
      .where(eq(plans.projectId, projectId))
      .all()
      .map((r) => toPlanRow(r, countItems(r.id), latestPlanRun(r.id)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },

  get(id: string): { plan: PlanRow; caseIds: string[] } | null {
    const r = getDb().select().from(plans).where(eq(plans.id, id)).get()
    if (!r) return null
    const items = getDb()
      .select()
      .from(planItems)
      .where(eq(planItems.planId, id))
      .all()
      .sort((a, b) => a.idx - b.idx)
    return {
      plan: toPlanRow(r, items.length, latestPlanRun(id)),
      caseIds: items.map((i) => i.caseId),
    }
  },

  create(input: {
    projectId: string
    name: string
    suiteId?: string | null
    caseIds: string[]
    retries: number
    timeoutMs: number
    continueOnFailure: boolean
  }): PlanRow {
    const db = getDb()
    const now = new Date().toISOString()
    const id = `pl-${randomUUID().slice(0, 8)}`
    db.transaction((tx) => {
      tx.insert(plans)
        .values({
          id,
          projectId: input.projectId,
          name: input.name,
          suiteId: input.suiteId ?? null,
          retries: input.retries,
          timeoutMs: input.timeoutMs,
          continueOnFailure: input.continueOnFailure ? 1 : 0,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      input.caseIds.forEach((caseId, idx) => {
        tx.insert(planItems)
          .values({ id: `${id}-${idx}`, planId: id, caseId, idx })
          .run()
      })
    })
    return this.get(id)?.plan as PlanRow
  },

  update(input: {
    id: string
    name: string
    caseIds: string[]
    retries: number
    timeoutMs: number
    continueOnFailure: boolean
  }): PlanRow {
    const db = getDb()
    const now = new Date().toISOString()
    db.transaction((tx) => {
      tx.update(plans)
        .set({
          name: input.name,
          retries: input.retries,
          timeoutMs: input.timeoutMs,
          continueOnFailure: input.continueOnFailure ? 1 : 0,
          updatedAt: now,
        })
        .where(eq(plans.id, input.id))
        .run()
      tx.delete(planItems).where(eq(planItems.planId, input.id)).run()
      input.caseIds.forEach((caseId, idx) => {
        tx.insert(planItems)
          .values({ id: `${input.id}-${idx}`, planId: input.id, caseId, idx })
          .run()
      })
    })
    return this.get(input.id)?.plan as PlanRow
  },

  remove(id: string): void {
    const db = getDb()
    const planRunsOfPlan = db.select().from(planRuns).where(eq(planRuns.planId, id)).all()
    db.transaction((tx) => {
      for (const pr of planRunsOfPlan) {
        const caseRuns = tx.select().from(runs).where(eq(runs.planRunId, pr.id)).all()
        for (const run of caseRuns) {
          tx.delete(runSteps).where(eq(runSteps.runId, run.id)).run()
          tx.delete(runs).where(eq(runs.id, run.id)).run()
        }
        tx.delete(planRuns).where(eq(planRuns.id, pr.id)).run()
      }
      tx.delete(planItems).where(eq(planItems.planId, id)).run()
      tx.delete(plans).where(eq(plans.id, id)).run()
    })
  },
}

export const planRunRepo = {
  create(planId: string, total: number): PlanRunRow {
    const id = `pr-${randomUUID().slice(0, 8)}`
    const row = {
      id,
      planId,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      total,
      passed: 0,
      failed: 0,
      error: null,
    }
    getDb().insert(planRuns).values(row).run()
    return toPlanRunRow(row as typeof planRuns.$inferSelect)
  },

  finish(
    id: string,
    patch: {
      status: PlanRunRow['status']
      passed: number
      failed: number
      error?: string
    },
  ): void {
    getDb()
      .update(planRuns)
      .set({
        status: patch.status,
        passed: patch.passed,
        failed: patch.failed,
        error: patch.error ?? null,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(planRuns.id, id))
      .run()
  },

  get(id: string): PlanRunRow | null {
    const r = getDb().select().from(planRuns).where(eq(planRuns.id, id)).get()
    return r ? toPlanRunRow(r) : null
  },

  list(planId?: string, limit = 20): PlanRunRow[] {
    const rows = planId
      ? getDb().select().from(planRuns).where(eq(planRuns.planId, planId)).all()
      : getDb().select().from(planRuns).all()
    return rows
      .map(toPlanRunRow)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit)
  },

  runsOf(planRunId: string): Array<{ run: RunRow; caseName: string }> {
    return getDb()
      .select()
      .from(runs)
      .where(eq(runs.planRunId, planRunId))
      .all()
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((r) => {
        const caseRow = getDb().select().from(cases).where(eq(cases.id, r.caseId)).get()
        let caseName = caseRow?.name ?? r.caseId
        if (!caseRow && r.caseSnapshot) {
          try {
            const snapshot = JSON.parse(r.caseSnapshot) as { case?: { name?: string } }
            caseName = snapshot.case?.name ?? caseName
          } catch {
            // 快照损坏时用 caseId
          }
        }
        const attempt = r.attempt ?? 1
        return {
          run: {
            id: r.id,
            caseId: r.caseId,
            caseName,
            planRunId: r.planRunId,
            attempt,
            status: r.status as RunRow['status'],
            startedAt: r.startedAt,
            finishedAt: r.finishedAt,
            videoPath: r.videoPath,
            error: r.error,
          },
          caseName,
        }
      })
  },
}
