import { randomUUID } from 'node:crypto'
import type { ProjectRow } from '@atp/model'
import type { EntityManager } from '@mikro-orm/sqlite'
import {
  CaseStep,
  Module,
  Plan,
  PlanItem,
  PlanRun,
  Project,
  Run,
  RunStep,
  Suite,
  SuiteItem,
  TestCase,
} from '../entities.js'

export class ProjectRepository {
  constructor(private readonly em: EntityManager) {}

  async list(): Promise<ProjectRow[]> {
    const rows = await this.em.find(Project, {}, { orderBy: { createdAt: 'asc' } })
    return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.createdAt }))
  }

  async create(name: string): Promise<ProjectRow> {
    const row = this.em.create(Project, {
      id: `p-${randomUUID().slice(0, 8)}`,
      name,
      createdAt: new Date().toISOString(),
    })
    await this.em.flush()
    return { id: row.id, name: row.name, createdAt: row.createdAt }
  }

  /** 删除项目及其全部从属数据；元素库全局共享，仅解除引用不删除元素 */
  async remove(id: string): Promise<void> {
    await this.em.transactional(async (em) => {
      const cases = await em.find(TestCase, { projectId: id })
      const caseIds = cases.map((row) => row.id)
      const suites = await em.find(Suite, { projectId: id })
      const suiteIds = suites.map((row) => row.id)
      const plans = await em.find(Plan, { projectId: id })
      const planIds = plans.map((row) => row.id)
      const planRuns = planIds.length ? await em.find(PlanRun, { planId: { $in: planIds } }) : []
      const planRunIds = planRuns.map((row) => row.id)
      const runs = [
        ...(caseIds.length ? await em.find(Run, { caseId: { $in: caseIds } }) : []),
        ...(planRunIds.length ? await em.find(Run, { planRunId: { $in: planRunIds } }) : []),
      ]
      const runIds = [...new Set(runs.map((row) => row.id))]

      if (runIds.length) await em.nativeDelete(RunStep, { runId: { $in: runIds } })
      if (runIds.length) await em.nativeDelete(Run, { id: { $in: runIds } })
      if (planRunIds.length) await em.nativeDelete(PlanRun, { id: { $in: planRunIds } })
      if (planIds.length) await em.nativeDelete(PlanItem, { planId: { $in: planIds } })
      if (planIds.length) await em.nativeDelete(Plan, { id: { $in: planIds } })
      if (suiteIds.length) await em.nativeDelete(SuiteItem, { suiteId: { $in: suiteIds } })
      if (suiteIds.length) await em.nativeDelete(Suite, { id: { $in: suiteIds } })
      if (caseIds.length) await em.nativeDelete(CaseStep, { caseId: { $in: caseIds } })
      if (caseIds.length) await em.nativeDelete(TestCase, { id: { $in: caseIds } })
      await em.nativeDelete(Module, { projectId: id })
      await em.nativeDelete(Project, { id })
    })
  }
}
