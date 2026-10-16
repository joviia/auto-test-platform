import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'
import { app } from 'electron'
import * as schema from './schema'

function createDb() {
  const path = join(app.getPath('userData'), 'atp.db')
  const sqlite = new DatabaseSync(path)
  sqlite.exec('PRAGMA journal_mode = WAL;')
  const instance = drizzle({ client: sqlite, schema })
  // 启动迁移：dev/build 下 __dirname=out/main，上两级即 app 根；
  // 打包后的迁移目录随 extraResources 处理（T11）
  const migrated = migrate(instance, { migrationsFolder: join(__dirname, '../../drizzle') })
  if (migrated) {
    throw new Error(`数据库迁移失败：${migrated}`)
  }
  console.log(`[atp] db ready: ${path}`)
  return instance
}

export type Db = ReturnType<typeof createDb>

let db: Db | null = null

export function getDb(): Db {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export function initDb(): Db {
  db = createDb()
  return db
}
