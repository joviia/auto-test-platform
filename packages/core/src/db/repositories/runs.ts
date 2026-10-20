import { randomUUID } from 'node:crypto'
import type { RunResult, RunRow, RunStepRow } from '@atp/model'
import type { EntityManager } from '@mikro-orm/sqlite'
import { PlanRun, Run, type RunEntity, RunStep, type RunStepEntity, TestCase } from '../entities.js'

function toRunRow(row: RunEntity): RunRow {
  return {
    id: row.id,
    caseId: row.caseId,
    planRunId: row.planRunId ?? null,
    attempt: row.attempt ?? null,
    status: row.status as RunRow['status'],
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    videoPath: row.videoPath ?? null,
    error: row.error ?? null,
  }
}

/** 设计执行可能没有保存到用例库；从 caseSnapshot 回退出用例名 */
function caseNameFromSnapshot(row: RunEntity): string | undefined {
  if (!row.caseSnapshot) return undefined
  try {
    const parsed = JSON.parse(row.caseSnapshot) as { case?: { name?: string } }
    return parsed.case?.name
  } catch {
    return undefined
  }
}

function toStepRow(row: RunStepEntity): RunStepRow {
  return {
    id: row.id,
    runId: row.runId,
    idx: row.idx,
    stepId: row.stepId,
    action: row.action as RunStepRow['action'],
    status: row.status as RunStepRow['status'],
    durationMs: row.durationMs,
    error: row.error ?? null,
    locatorHit: (row.locatorHit as RunStepRow['locatorHit']) ?? null,
    triedCandidates: (row.triedCandidates as RunStepRow['triedCandidates']) ?? null,
    assertion: (row.assertion as RunStepRow['assertion']) ?? null,
    skipped: row.skipped ?? false,
    screenshotPath: row.screenshotPath ?? null,
  }
}

export class RunRepository {
  constructor(private readonly em: EntityManager) {}

  async list(filter: { caseId?: string; planId?: string } = {}): Promise<RunRow[]> {
    const where: Record<string, unknown> = {}
    if (filter.caseId) where.caseId = filter.caseId
    if (filter.planId) {
      const planRuns = await this.em.find(PlanRun, { planId: filter.planId })
      if (planRuns.length === 0) return []
      where.planRunId = { $in: planRuns.map((row) => row.id) }
    }

    const rows = await this.em.find(Run, where, { orderBy: { startedAt: 'desc' } })
    const caseIds = [...new Set(rows.map((row) => row.caseId))]
    const cases = caseIds.length ? await this.em.find(TestCase, { id: { $in: caseIds } }) : []
    const nameById = new Map(cases.map((row) => [row.id, row.name]))
    return rows.map((row) => ({
      ...toRunRow(row),
      caseName: nameById.get(row.caseId) ?? caseNameFromSnapshot(row),
    }))
  }

  async get(runId: string): Promise<{ run: RunRow; steps: RunStepRow[] } | null> {
    const row = await this.em.findOne(Run, { id: runId })
    if (!row) return null
    const steps = await this.em.find(RunStep, { runId }, { orderBy: { idx: 'asc' } })
    return {
      run: { ...toRunRow(row), caseName: caseNameFromSnapshot(row) },
      steps: steps.map(toStepRow),
    }
  }

  /** 落库一次完整回放结果（执行记录与用例定义分离），事务写入 */
  async save(
    result: RunResult,
    meta?: { planRunId?: string; attempt?: number; caseSnapshot?: string },
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      em.create(Run, {
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
      for (const step of result.steps) {
        em.create(RunStep, {
          id: `${result.runId}-${step.index}`,
          runId: result.runId,
          idx: step.index,
          stepId: step.stepId,
          action: step.action,
          status: step.status,
          durationMs: Math.round(step.durationMs),
          error: step.error ?? null,
          locatorHit: step.locatorHit ?? null,
          triedCandidates: step.triedCandidates ?? null,
          assertion: step.assertion ?? null,
          skipped: step.skipped ? true : null,
          screenshotPath: step.screenshotPath ?? null,
        })
      }
      await em.flush()
    })
  }

  newRunId(): string {
    return `r-${randomUUID().slice(0, 8)}`
  }
}
