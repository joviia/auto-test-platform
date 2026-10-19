import { Migration } from '@mikro-orm/migrations'

/**
 * AI 会话持久化：会话标题 + 逐条消息（正文、工具卡、取消/错误）。
 * 单独迁移，避免影响已经跑过基线迁移的本地库。
 */
export class Migration20261019120000AiSessions extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "ai_sessions" (
        "id" text not null primary key,
        "title" text not null,
        "created_at" text not null,
        "updated_at" text not null
      );
    `)

    this.addSql(`
      create table if not exists "ai_messages" (
        "id" text not null primary key,
        "session_id" text not null,
        "seq" integer not null,
        "role" text not null,
        "payload" text not null,
        "created_at" text not null
      );
    `)
    this.addSql(
      'create index if not exists "ai_messages_session_id_index" on "ai_messages" ("session_id");',
    )
    this.addSql(
      'create index if not exists "ai_sessions_updated_at_index" on "ai_sessions" ("updated_at");',
    )
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "ai_messages";')
    this.addSql('drop table if exists "ai_sessions";')
  }
}
