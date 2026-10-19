import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { Migrator } from '@mikro-orm/migrations'
import { type EntityManager, MikroORM } from '@mikro-orm/sqlite'
import Database from 'better-sqlite3'
import { entities } from './entities.js'
import { Migration20261019000000_initial } from './migrations/Migration20261019000000_initial.js'
import { UnitOfWork } from './unit-of-work.js'

export interface InitDbOptions {
  /** 数据目录，DB 落在 <dataDir>/atp.db */
  dataDir: string
  /** 打印 SQL（排查用） */
  debug?: boolean
}

/**
 * 旧版 Drizzle 数据库没有 MikroORM 的迁移表。
 * 不做数据搬运：备份后重建，避免带着旧 schema 运行。
 */
function backupLegacyDatabase(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null

  let legacy = false
  try {
    const sqlite = new Database(dbPath, { readonly: true })
    try {
      const rows = sqlite
        .prepare("select name from sqlite_master where type = 'table'")
        .all() as Array<{ name: string }>
      const tables = new Set(rows.map((row) => row.name))
      legacy = tables.size > 0 && !tables.has('mikro_orm_migrations')
    } finally {
      sqlite.close()
    }
  } catch {
    // 无法打开的空文件/损坏文件交给 MikroORM 处理
    return null
  }

  if (!legacy) return null

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${dbPath}.legacy-${stamp}`
  renameSync(dbPath, backup)
  for (const sidecar of ['-wal', '-shm']) {
    if (existsSync(`${dbPath}${sidecar}`)) {
      renameSync(`${dbPath}${sidecar}`, `${backup}${sidecar}`)
    }
  }
  return backup
}

/** 数据库实例：持有 ORM，按操作 fork EntityManager，保证每个工作单元独立 */
export class AtpDatabase {
  private constructor(
    private readonly orm: MikroORM<EntityManager, typeof entities>,
    readonly path: string,
    readonly backup: string | null,
  ) {}

  static async open(options: InitDbOptions): Promise<AtpDatabase> {
    mkdirSync(options.dataDir, { recursive: true })
    const path = join(options.dataDir, 'atp.db')
    const backup = backupLegacyDatabase(path)

    const orm = await MikroORM.init({
      entities,
      dbName: path,
      extensions: [Migrator],
      migrations: {
        migrationsList: [Migration20261019000000_initial],
        transactional: true,
        // 迁移由代码显式维护，不需要在运行期回写 schema 快照
        snapshotOnMigrate: false,
      },
      debug: options.debug ?? false,
      allowGlobalContext: false,
    })

    await orm.migrator.up()
    return new AtpDatabase(orm, path, backup)
  }

  /** 新的工作单元（独立 Identity Map 与事务边界） */
  uow(): UnitOfWork {
    return new UnitOfWork(this.orm.em.fork())
  }

  /** 在一个事务里执行一组仓储操作，失败自动回滚 */
  async transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    return this.orm.em.fork().transactional(async (em) => fn(new UnitOfWork(em)))
  }

  async close(): Promise<void> {
    await this.orm.close()
  }
}

let current: AtpDatabase | null = null

export function getDb(): AtpDatabase {
  if (!current) throw new Error('数据库尚未初始化')
  return current
}

export async function initDb(options: InitDbOptions): Promise<AtpDatabase> {
  if (current) return current
  current = await AtpDatabase.open(options)
  return current
}

export async function closeDb(): Promise<void> {
  await current?.close()
  current = null
}
