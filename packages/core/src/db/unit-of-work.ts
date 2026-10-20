import type { EntityManager } from '@mikro-orm/sqlite'
import { AiSessionRepository } from './repositories/ai-sessions.js'
import { CaseRepository } from './repositories/cases.js'
import { DesignSessionRepository } from './repositories/design-sessions.js'
import { ElementRepository } from './repositories/elements.js'
import { ModuleRepository } from './repositories/modules.js'
import { PlanRepository, PlanRunRepository } from './repositories/plans.js'
import { ProjectRepository } from './repositories/projects.js'
import { RunRepository } from './repositories/runs.js'
import { SuiteRepository } from './repositories/suites.js'

/**
 * 工作单元：一次业务操作共享一个 EntityManager（Identity Map + 事务上下文）。
 * 仓储方法内部按需开事务；跨仓储的原子操作使用 AtpDatabase.transaction。
 */
export class UnitOfWork {
  readonly projects: ProjectRepository
  readonly modules: ModuleRepository
  readonly cases: CaseRepository
  readonly elements: ElementRepository
  readonly suites: SuiteRepository
  readonly plans: PlanRepository
  readonly planRuns: PlanRunRepository
  readonly runs: RunRepository
  readonly aiSessions: AiSessionRepository
  readonly designSessions: DesignSessionRepository

  constructor(readonly em: EntityManager) {
    this.projects = new ProjectRepository(em)
    this.modules = new ModuleRepository(em)
    this.cases = new CaseRepository(em)
    this.elements = new ElementRepository(em)
    this.suites = new SuiteRepository(em)
    this.plans = new PlanRepository(em)
    this.planRuns = new PlanRunRepository(em)
    this.runs = new RunRepository(em)
    this.aiSessions = new AiSessionRepository(em)
    this.designSessions = new DesignSessionRepository(em)
  }
}
