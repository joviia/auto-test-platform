import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
})

export const modules = sqliteTable('modules', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
})

export const cases = sqliteTable('cases', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  moduleId: text('module_id'),
  name: text('name').notNull(),
  startUrl: text('start_url').notNull(),
  /** 用例变量（JSON 对象字符串） */
  variables: text('variables'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const caseSteps = sqliteTable('case_steps', {
  id: text('id').primaryKey(),
  caseId: text('case_id').notNull(),
  idx: integer('idx').notNull(),
  action: text('action').notNull(),
  elementId: text('element_id'),
  params: text('params'),
  assertion: text('assertion'),
  condition: text('condition'),
})

export const suites = sqliteTable('suites', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const suiteItems = sqliteTable('suite_items', {
  id: text('id').primaryKey(),
  suiteId: text('suite_id').notNull(),
  caseId: text('case_id').notNull(),
  idx: integer('idx').notNull(),
})

export const plans = sqliteTable('plans', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  /** 创建计划时来源套件（仅作展示；计划成员是快照） */
  suiteId: text('suite_id'),
  retries: integer('retries').notNull().default(0),
  timeoutMs: integer('timeout_ms').notNull().default(15000),
  continueOnFailure: integer('continue_on_failure').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const planItems = sqliteTable('plan_items', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull(),
  caseId: text('case_id').notNull(),
  idx: integer('idx').notNull(),
})

export const planRuns = sqliteTable('plan_runs', {
  id: text('id').primaryKey(),
  planId: text('plan_id').notNull(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  total: integer('total').notNull(),
  passed: integer('passed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  error: text('error'),
})

export const elements = sqliteTable('elements', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  locators: text('locators').notNull(),
  /** iframe 索引路径（JSON 数组） */
  framePath: text('frame_path'),
})

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  caseId: text('case_id').notNull(),
  planRunId: text('plan_run_id'),
  attempt: integer('attempt'),
  caseSnapshot: text('case_snapshot'),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  videoPath: text('video_path'),
  error: text('error'),
})

export const runSteps = sqliteTable('run_steps', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  idx: integer('idx').notNull(),
  stepId: text('step_id').notNull(),
  action: text('action').notNull(),
  status: text('status').notNull(),
  durationMs: integer('duration_ms').notNull(),
  error: text('error'),
  locatorHit: text('locator_hit'),
  triedCandidates: text('tried_candidates'),
  assertion: text('assertion'),
  skipped: integer('skipped'),
  screenshotPath: text('screenshot_path'),
})
