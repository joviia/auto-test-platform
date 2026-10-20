import { defineEntity, type InferEntity } from '@mikro-orm/sqlite'

/**
 * 领域实体（MikroORM 7 defineEntity，无装饰器、无需 emitDecoratorMetadata）。
 * 表名与列名显式声明，实体属性用 camelCase，DB 用 snake_case。
 */

export const Project = defineEntity({
  name: 'Project',
  tableName: 'projects',
  properties: (p) => ({
    id: p.string().primary(),
    name: p.string(),
    createdAt: p.string().fieldName('created_at'),
  }),
})

export const Module = defineEntity({
  name: 'Module',
  tableName: 'modules',
  properties: (p) => ({
    id: p.string().primary(),
    projectId: p.string().fieldName('project_id').index(),
    parentId: p.string().fieldName('parent_id').nullable(),
    name: p.string(),
    createdAt: p.string().fieldName('created_at'),
  }),
})

export const TestCase = defineEntity({
  name: 'TestCase',
  tableName: 'cases',
  properties: (p) => ({
    id: p.string().primary(),
    projectId: p.string().fieldName('project_id').index(),
    moduleId: p.string().fieldName('module_id').nullable(),
    name: p.string(),
    startUrl: p.string().fieldName('start_url'),
    /** 用例变量（JSON 对象） */
    variables: p.json<Record<string, string>>().nullable(),
    /** 意图层：一句话摘要 */
    intent: p.string().nullable(),
    /** 意图层：步骤分组（JSON 数组） */
    groups: p.json<unknown[]>().nullable(),
    createdAt: p.string().fieldName('created_at'),
    updatedAt: p.string().fieldName('updated_at'),
  }),
})

export const CaseStep = defineEntity({
  name: 'CaseStep',
  tableName: 'case_steps',
  properties: (p) => ({
    id: p.string().primary(),
    caseId: p.string().fieldName('case_id').index(),
    idx: p.integer(),
    action: p.string(),
    elementId: p.string().fieldName('element_id').nullable(),
    params: p.json<unknown>().nullable(),
    assertion: p.json<unknown>().nullable(),
    condition: p.json<unknown>().nullable(),
    /** 意图层：所属分组（弹窗 / 区块 / 导航） */
    groupId: p.string().fieldName('group_id').nullable(),
    /** 意图层：自然语言投影 */
    display: p.json<unknown>().nullable(),
  }),
})

export const Suite = defineEntity({
  name: 'Suite',
  tableName: 'suites',
  properties: (p) => ({
    id: p.string().primary(),
    projectId: p.string().fieldName('project_id').index(),
    name: p.string(),
    description: p.string().nullable(),
    createdAt: p.string().fieldName('created_at'),
    updatedAt: p.string().fieldName('updated_at'),
  }),
})

export const SuiteItem = defineEntity({
  name: 'SuiteItem',
  tableName: 'suite_items',
  properties: (p) => ({
    id: p.string().primary(),
    suiteId: p.string().fieldName('suite_id').index(),
    caseId: p.string().fieldName('case_id'),
    idx: p.integer(),
  }),
})

export const Plan = defineEntity({
  name: 'Plan',
  tableName: 'plans',
  properties: (p) => ({
    id: p.string().primary(),
    projectId: p.string().fieldName('project_id').index(),
    name: p.string(),
    /** 创建计划时来源套件（仅作展示；计划成员是快照） */
    suiteId: p.string().fieldName('suite_id').nullable(),
    retries: p.integer().default(0),
    timeoutMs: p.integer().fieldName('timeout_ms').default(15000),
    continueOnFailure: p.boolean().fieldName('continue_on_failure').default(true),
    createdAt: p.string().fieldName('created_at'),
    updatedAt: p.string().fieldName('updated_at'),
  }),
})

export const PlanItem = defineEntity({
  name: 'PlanItem',
  tableName: 'plan_items',
  properties: (p) => ({
    id: p.string().primary(),
    planId: p.string().fieldName('plan_id').index(),
    caseId: p.string().fieldName('case_id'),
    idx: p.integer(),
  }),
})

export const PlanRun = defineEntity({
  name: 'PlanRun',
  tableName: 'plan_runs',
  properties: (p) => ({
    id: p.string().primary(),
    planId: p.string().fieldName('plan_id').index(),
    status: p.string(),
    startedAt: p.string().fieldName('started_at'),
    finishedAt: p.string().fieldName('finished_at').nullable(),
    total: p.integer(),
    passed: p.integer().default(0),
    failed: p.integer().default(0),
    error: p.string().nullable(),
  }),
})

export const Element = defineEntity({
  name: 'Element',
  tableName: 'elements',
  properties: (p) => ({
    id: p.string().primary(),
    projectId: p.string().fieldName('project_id').index(),
    name: p.string(),
    locators: p.json<unknown[]>(),
    /** iframe 索引路径（JSON 数组） */
    framePath: p.json<number[]>().nullable(),
  }),
})

export const Run = defineEntity({
  name: 'Run',
  tableName: 'runs',
  properties: (p) => ({
    id: p.string().primary(),
    caseId: p.string().fieldName('case_id').index(),
    planRunId: p.string().fieldName('plan_run_id').nullable().index(),
    attempt: p.integer().nullable(),
    caseSnapshot: p.string().fieldName('case_snapshot').nullable(),
    status: p.string(),
    startedAt: p.string().fieldName('started_at'),
    finishedAt: p.string().fieldName('finished_at').nullable(),
    videoPath: p.string().fieldName('video_path').nullable(),
    error: p.string().nullable(),
  }),
})

export const RunStep = defineEntity({
  name: 'RunStep',
  tableName: 'run_steps',
  properties: (p) => ({
    id: p.string().primary(),
    runId: p.string().fieldName('run_id').index(),
    idx: p.integer(),
    stepId: p.string().fieldName('step_id'),
    action: p.string(),
    status: p.string(),
    durationMs: p.integer().fieldName('duration_ms'),
    error: p.string().nullable(),
    locatorHit: p.json<unknown>().nullable(),
    triedCandidates: p.json<unknown[]>().nullable(),
    assertion: p.json<unknown>().nullable(),
    skipped: p.boolean().nullable(),
    screenshotPath: p.string().fieldName('screenshot_path').nullable(),
  }),
})

export const AiSession = defineEntity({
  name: 'AiSession',
  tableName: 'ai_sessions',
  properties: (p) => ({
    id: p.string().primary(),
    title: p.string(),
    createdAt: p.string().fieldName('created_at'),
    updatedAt: p.string().fieldName('updated_at'),
  }),
})

export const AiMessage = defineEntity({
  name: 'AiMessage',
  tableName: 'ai_messages',
  properties: (p) => ({
    id: p.string().primary(),
    sessionId: p.string().fieldName('session_id').index(),
    /** 会话内单调递增，避免同一毫秒的消息排序不稳定 */
    seq: p.integer(),
    role: p.string(),
    payload: p.json<unknown>(),
    createdAt: p.string().fieldName('created_at'),
  }),
})

/** 测试设计会话：保存矩阵快照，支持重新打开与追溯 */
export const DesignSession = defineEntity({
  name: 'DesignSession',
  tableName: 'design_sessions',
  properties: (p) => ({
    id: p.string().primary(),
    projectId: p.string().fieldName('project_id').nullable().index(),
    objectId: p.string().fieldName('object_id').index(),
    status: p.string(),
    matrix: p.json<unknown>(),
    createdAt: p.string().fieldName('created_at'),
    updatedAt: p.string().fieldName('updated_at'),
  }),
})

export type ProjectEntity = InferEntity<typeof Project>
export type ModuleEntity = InferEntity<typeof Module>
export type TestCaseEntity = InferEntity<typeof TestCase>
export type CaseStepEntity = InferEntity<typeof CaseStep>
export type SuiteEntity = InferEntity<typeof Suite>
export type SuiteItemEntity = InferEntity<typeof SuiteItem>
export type PlanEntity = InferEntity<typeof Plan>
export type PlanItemEntity = InferEntity<typeof PlanItem>
export type PlanRunEntity = InferEntity<typeof PlanRun>
export type ElementEntity = InferEntity<typeof Element>
export type RunEntity = InferEntity<typeof Run>
export type RunStepEntity = InferEntity<typeof RunStep>
export type AiSessionEntity = InferEntity<typeof AiSession>
export type AiMessageEntity = InferEntity<typeof AiMessage>
export type DesignSessionEntity = InferEntity<typeof DesignSession>

export const entities = [
  Project,
  Module,
  TestCase,
  CaseStep,
  Suite,
  SuiteItem,
  Plan,
  PlanItem,
  PlanRun,
  Element,
  Run,
  RunStep,
  AiSession,
  AiMessage,
  DesignSession,
] as const
