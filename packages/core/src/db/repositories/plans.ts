import { randomUUID } from 'node:crypto'
import type { PlanRow, PlanRunRow, RunRow } from '@atp/model'
import type { EntityManager } from '@mikro-orm/sqlite'
import {
  Plan,
  type PlanEntity,
  PlanItem,
  PlanRun,
  type PlanRunEntity,
  Run,
  RunStep,
  TestCase,
} from '../entities.js'

function toPlanRow(row: PlanEntity, caseCount: number, lastRun: PlanRunEntity | null): PlanRow {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    suiteId: row.suiteId ?? null,
    retries: row.retries,
    timeoutMs: row.timeoutMs,
    continueOnFailure: row.continueOnFailure,
    caseCount,
    lastRunStatus: (lastRun?.status as PlanRow['lastRunStatus']) ?? null,
    lastRunAt: lastRun?.startedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toPlanRunRow(row: PlanRunEntity): PlanRunRow {
  return {
    id: row.id,
    planId: row.planId,
    status: row.status as PlanRunRow['status'],
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    total: row.total,
    passed: row.passed,
    failed: row.failed,
    error: row.error ?? null,
  }
}

export class PlanRepository {
  constructor(private readonly em: EntityManager) {}

  private async latestRun(planId: string): Promise<PlanRunEntity | null> {
    return this.em.findOne(PlanRun, { planId }, { orderBy: { startedAt: 'desc' } })
  }

  async list(projectId: string): Promise<PlanRow[]> {
    const rows = await this.em.find(Plan, { projectId }, { orderBy: { updatedAt: 'desc' } })
    return Promise.all(
      rows.map(async (row) =>
        toPlanRow(
          row,
          await this.em.count(PlanItem, { planId: row.id }),
          await this.latestRun(row.id),
        ),
      ),
    )
  }

  async get(id: string): Promise<{ plan: PlanRow; caseIds: string[] } | null> {
    const row = await this.em.findOne(Plan, { id })
    if (!row) return null
    const items = await this.em.find(PlanItem, { planId: id }, { orderBy: { idx: 'asc' } })
    return {
      plan: toPlanRow(row, items.length, await this.latestRun(id)),
      caseIds: items.map((item) => item.caseId),
    }
  }

  async create(input: {
    projectId: string
    name: string
    suiteId?: string | null
    caseIds: string[]
    retries: number
    timeoutMs: number
    continueOnFailure: boolean
  }): Promise<PlanRow> {
    const id = `pl-${randomUUID().slice(0, 8)}`
    const now = new Date().toISOString()
    await this.em.transactional(async (em) => {
      em.create(Plan, {
        id,
        projectId: input.projectId,
        name: input.name,
        suiteId: input.suiteId ?? null,
        retries: input.retries,
        timeoutMs: input.timeoutMs,
        continueOnFailure: input.continueOnFailure,
        createdAt: now,
        updatedAt: now,
      })
      input.caseIds.forEach((caseId, index) => {
        em.create(PlanItem, { id: `${id}-${index}`, planId: id, caseId, idx: index })
      })
      await em.flush()
    })
    return (await this.get(id))?.plan as PlanRow
  }

  async update(input: {
    id: string
    name: string
    caseIds: string[]
    retries: number
    timeoutMs: number
    continueOnFailure: boolean
  }): Promise<PlanRow> {
    await this.em.transactional(async (em) => {
      const row = await em.findOneOrFail(Plan, { id: input.id })
      row.name = input.name
      row.retries = input.retries
      row.timeoutMs = input.timeoutMs
      row.continueOnFailure = input.continueOnFailure
      row.updatedAt = new Date().toISOString()
      await em.nativeDelete(PlanItem, { planId: input.id })
      input.caseIds.forEach((caseId, index) => {
        em.create(PlanItem, {
          id: `${input.id}-${index}`,
          planId: input.id,
          caseId,
          idx: index,
        })
      })
      await em.flush()
    })
    return (await this.get(input.id))?.plan as PlanRow
  }

  async remove(id: string): Promise<void> {
    await this.em.transactional(async (em) => {
      const planRuns = await em.find(PlanRun, { planId: id })
      const planRunIds = planRuns.map((row) => row.id)
      const runs = planRunIds.length ? await em.find(Run, { planRunId: { $in: planRunIds } }) : []
      const runIds = runs.map((row) => row.id)
      if (runIds.length) await em.nativeDelete(RunStep, { runId: { $in: runIds } })
      if (runIds.length) await em.nativeDelete(Run, { id: { $in: runIds } })
      if (planRunIds.length) await em.nativeDelete(PlanRun, { id: { $in: planRunIds } })
      await em.nativeDelete(PlanItem, { planId: id })
      await em.nativeDelete(Plan, { id })
    })
  }
}

export class PlanRunRepository {
  constructor(private readonly em: EntityManager) {}

  async create(planId: string, total: number): Promise<PlanRunRow> {
    const row = this.em.create(PlanRun, {
      id: `pr-${randomUUID().slice(0, 8)}`,
      planId,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      total,
      passed: 0,
      failed: 0,
      error: null,
    })
    await this.em.flush()
    return toPlanRunRow(row)
  }

  async finish(
    id: string,
    patch: {
      status: PlanRunRow['status']
      passed: number
      failed: number
      error?: string
    },
  ): Promise<void> {
    const row = await this.em.findOneOrFail(PlanRun, { id })
    row.status = patch.status
    row.passed = patch.passed
    row.failed = patch.failed
    row.error = patch.error ?? null
    row.finishedAt = new Date().toISOString()
    await this.em.flush()
  }

  async get(id: string): Promise<PlanRunRow | null> {
    const row = await this.em.findOne(PlanRun, { id })
    return row ? toPlanRunRow(row) : null
  }

  async list(planId?: string, limit = 20): Promise<PlanRunRow[]> {
    const rows = await this.em.find(PlanRun, planId ? { planId } : {}, {
      orderBy: { startedAt: 'desc' },
      limit,
    })
    return rows.map(toPlanRunRow)
  }

  async runsOf(planRunId: string): Promise<Array<{ run: RunRow; caseName: string }>> {
    const rows = await this.em.find(Run, { planRunId }, { orderBy: { startedAt: 'asc' } })
    const caseIds = [...new Set(rows.map((row) => row.caseId))]
    const cases = caseIds.length ? await this.em.find(TestCase, { id: { $in: caseIds } }) : []
    const nameById = new Map(cases.map((row) => [row.id, row.name]))

    return rows.map((row) => {
      let caseName = nameById.get(row.caseId) ?? row.caseId
      if (!nameById.has(row.caseId) && row.caseSnapshot) {
        try {
          const snapshot = JSON.parse(row.caseSnapshot) as { case?: { name?: string } }
          caseName = snapshot.case?.name ?? caseName
        } catch {
          // 快照损坏时用 caseId
        }
      }
      const run: RunRow = {
        id: row.id,
        caseId: row.caseId,
        caseName,
        planRunId: row.planRunId ?? null,
        attempt: row.attempt ?? 1,
        status: row.status as RunRow['status'],
        startedAt: row.startedAt,
        finishedAt: row.finishedAt ?? null,
        videoPath: row.videoPath ?? null,
        error: row.error ?? null,
      }
      return { run, caseName }
    })
  }
}
