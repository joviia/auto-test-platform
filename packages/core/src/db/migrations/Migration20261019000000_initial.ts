import { Migration } from '@mikro-orm/migrations'

/**
 * 基线迁移：一次性建立当前完整 schema。
 * 旧的 Drizzle 数据库不迁移，由 AtpDatabase 备份后重建。
 */
export class Migration20261019000000_initial extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "projects" (
        "id" text not null primary key,
        "name" text not null,
        "created_at" text not null
      );
    `)

    this.addSql(`
      create table if not exists "modules" (
        "id" text not null primary key,
        "project_id" text not null,
        "parent_id" text null,
        "name" text not null,
        "created_at" text not null
      );
    `)
    this.addSql(
      'create index if not exists "modules_project_id_index" on "modules" ("project_id");',
    )

    this.addSql(`
      create table if not exists "cases" (
        "id" text not null primary key,
        "project_id" text not null,
        "module_id" text null,
        "name" text not null,
        "start_url" text not null,
        "variables" text null,
        "intent" text null,
        "groups" text null,
        "created_at" text not null,
        "updated_at" text not null
      );
    `)
    this.addSql('create index if not exists "cases_project_id_index" on "cases" ("project_id");')

    this.addSql(`
      create table if not exists "case_steps" (
        "id" text not null primary key,
        "case_id" text not null,
        "idx" integer not null,
        "action" text not null,
        "element_id" text null,
        "params" text null,
        "assertion" text null,
        "condition" text null,
        "group_id" text null,
        "display" text null
      );
    `)
    this.addSql(
      'create index if not exists "case_steps_case_id_index" on "case_steps" ("case_id");',
    )

    this.addSql(`
      create table if not exists "suites" (
        "id" text not null primary key,
        "project_id" text not null,
        "name" text not null,
        "description" text null,
        "created_at" text not null,
        "updated_at" text not null
      );
    `)
    this.addSql('create index if not exists "suites_project_id_index" on "suites" ("project_id");')

    this.addSql(`
      create table if not exists "suite_items" (
        "id" text not null primary key,
        "suite_id" text not null,
        "case_id" text not null,
        "idx" integer not null
      );
    `)
    this.addSql(
      'create index if not exists "suite_items_suite_id_index" on "suite_items" ("suite_id");',
    )

    this.addSql(`
      create table if not exists "plans" (
        "id" text not null primary key,
        "project_id" text not null,
        "name" text not null,
        "suite_id" text null,
        "retries" integer not null default 0,
        "timeout_ms" integer not null default 15000,
        "continue_on_failure" integer not null default 1,
        "created_at" text not null,
        "updated_at" text not null
      );
    `)
    this.addSql('create index if not exists "plans_project_id_index" on "plans" ("project_id");')

    this.addSql(`
      create table if not exists "plan_items" (
        "id" text not null primary key,
        "plan_id" text not null,
        "case_id" text not null,
        "idx" integer not null
      );
    `)
    this.addSql(
      'create index if not exists "plan_items_plan_id_index" on "plan_items" ("plan_id");',
    )

    this.addSql(`
      create table if not exists "plan_runs" (
        "id" text not null primary key,
        "plan_id" text not null,
        "status" text not null,
        "started_at" text not null,
        "finished_at" text null,
        "total" integer not null,
        "passed" integer not null default 0,
        "failed" integer not null default 0,
        "error" text null
      );
    `)
    this.addSql('create index if not exists "plan_runs_plan_id_index" on "plan_runs" ("plan_id");')

    this.addSql(`
      create table if not exists "elements" (
        "id" text not null primary key,
        "project_id" text not null,
        "name" text not null,
        "locators" text not null,
        "frame_path" text null
      );
    `)
    this.addSql(
      'create index if not exists "elements_project_id_index" on "elements" ("project_id");',
    )

    this.addSql(`
      create table if not exists "runs" (
        "id" text not null primary key,
        "case_id" text not null,
        "plan_run_id" text null,
        "attempt" integer null,
        "case_snapshot" text null,
        "status" text not null,
        "started_at" text not null,
        "finished_at" text null,
        "video_path" text null,
        "error" text null
      );
    `)
    this.addSql('create index if not exists "runs_case_id_index" on "runs" ("case_id");')
    this.addSql('create index if not exists "runs_plan_run_id_index" on "runs" ("plan_run_id");')

    this.addSql(`
      create table if not exists "run_steps" (
        "id" text not null primary key,
        "run_id" text not null,
        "idx" integer not null,
        "step_id" text not null,
        "action" text not null,
        "status" text not null,
        "duration_ms" integer not null,
        "error" text null,
        "locator_hit" text null,
        "tried_candidates" text null,
        "assertion" text null,
        "skipped" integer null,
        "screenshot_path" text null
      );
    `)
    this.addSql('create index if not exists "run_steps_run_id_index" on "run_steps" ("run_id");')
  }

  override async down(): Promise<void> {
    for (const table of [
      'run_steps',
      'runs',
      'elements',
      'plan_runs',
      'plan_items',
      'plans',
      'suite_items',
      'suites',
      'case_steps',
      'cases',
      'modules',
      'projects',
    ]) {
      this.addSql(`drop table if exists "${table}";`)
    }
  }
}
