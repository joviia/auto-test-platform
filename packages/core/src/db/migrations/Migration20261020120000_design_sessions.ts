import { Migration } from '@mikro-orm/migrations'

/**
 * 测试设计会话：矩阵 JSON 快照，支持重新打开、追溯与后续覆盖统计。
 */
export class Migration20261020120000DesignSessions extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "design_sessions" (
        "id" text not null primary key,
        "project_id" text,
        "object_id" text not null,
        "status" text not null,
        "matrix" text not null,
        "created_at" text not null,
        "updated_at" text not null
      );
    `)
    this.addSql(
      'create index if not exists "design_sessions_project_id_index" on "design_sessions" ("project_id");',
    )
    this.addSql(
      'create index if not exists "design_sessions_object_id_index" on "design_sessions" ("object_id");',
    )
    this.addSql(
      'create index if not exists "design_sessions_updated_at_index" on "design_sessions" ("updated_at");',
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "design_sessions";')
  }
}
