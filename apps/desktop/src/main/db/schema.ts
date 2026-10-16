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
})

export const elements = sqliteTable('elements', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  locators: text('locators').notNull(),
})

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  caseId: text('case_id').notNull(),
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
  screenshotPath: text('screenshot_path'),
})
