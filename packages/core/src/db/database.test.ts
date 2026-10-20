import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CaseFile, RunResult } from '@atp/model'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { AtpDatabase } from './database.js'

const dirs: string[] = []
const databases: AtpDatabase[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'atp-core-test-'))
  dirs.push(dir)
  return dir
}

async function open(dir = tempDir()): Promise<AtpDatabase> {
  const db = await AtpDatabase.open({ dataDir: dir })
  databases.push(db)
  return db
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close().catch(() => {})))
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('AtpDatabase / UnitOfWork', () => {
  it('用例、元素、套件、计划、执行记录走完整工作单元', async () => {
    const db = await open()
    const project = await db.uow().projects.create('默认项目')
    const module = await db.uow().modules.create(project.id, null, '内容管理')

    const created = await db.uow().cases.create({
      projectId: project.id,
      moduleId: module.id,
      name: '新建电影',
      startUrl: 'https://example.test/movies',
    })

    const file: CaseFile = {
      case: {
        ...created.case,
        variables: { name: '电影_1' },
        intent: '在内容管理中新建电影',
        groups: [{ id: 'g1', label: '新建内容', kind: 'dialog' }],
        steps: [
          {
            id: 's-1',
            action: 'click',
            elementId: 'el-name',
            groupId: 'g1',
            display: { verb: '点击', field: '内容名称', confidence: 'auto' },
          },
          {
            id: 's-2',
            action: 'fill',
            elementId: 'el-name',
            params: { value: '${name}' },
          },
          {
            id: 's-3',
            action: 'assert',
            assertion: { type: 'urlContains', expected: '/movies' },
          },
        ],
      },
      elements: {
        'el-name': {
          id: 'el-name',
          name: '内容名称',
          locators: [{ type: 'role', value: 'textbox', name: '内容名称' }],
        },
      },
    }

    await db.uow().cases.save(file)
    const saved = await db.uow().cases.get(created.case.id)
    expect(saved?.case.intent).toBe('在内容管理中新建电影')
    expect(saved?.case.groups).toEqual([{ id: 'g1', label: '新建内容', kind: 'dialog' }])
    expect(saved?.case.steps).toHaveLength(3)
    expect(saved?.case.steps[0]?.display?.field).toBe('内容名称')
    expect(saved?.elements['el-name']?.locators[0]).toEqual({
      type: 'role',
      value: 'textbox',
      name: '内容名称',
    })

    // 再次保存应整体替换步骤而不是累加
    await db
      .uow()
      .cases.save({ ...file, case: { ...file.case, steps: file.case.steps.slice(0, 2) } })
    expect((await db.uow().cases.get(created.case.id))?.case.steps).toHaveLength(2)

    const elements = await db.uow().elements.list(project.id)
    expect(elements.map((element) => element.id)).toEqual(['el-name'])

    const suite = await db.uow().suites.create({
      projectId: project.id,
      name: '冒烟',
      caseIds: [created.case.id],
    })
    expect(suite.caseCount).toBe(1)

    const plan = await db.uow().plans.create({
      projectId: project.id,
      name: '每日回归',
      suiteId: suite.id,
      caseIds: [created.case.id],
      retries: 1,
      timeoutMs: 20_000,
      continueOnFailure: true,
    })
    const planDetail = await db.uow().plans.get(plan.id)
    expect(planDetail?.caseIds).toEqual([created.case.id])
    expect(planDetail?.plan.timeoutMs).toBe(20_000)

    const planRun = await db.uow().planRuns.create(plan.id, 1)
    const result: RunResult = {
      runId: 'r-test',
      caseId: created.case.id,
      caseName: '新建电影',
      startUrl: file.case.startUrl,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'passed',
      steps: [
        {
          stepId: 's-1',
          index: 0,
          action: 'click',
          status: 'passed',
          durationMs: 12.4,
          locatorHit: {
            tier: 0,
            locator: { type: 'role', value: 'textbox', name: '内容名称' },
          },
        },
      ],
    }
    await db.uow().runs.save(result, {
      planRunId: planRun.id,
      attempt: 1,
      caseSnapshot: JSON.stringify(file),
    })

    const run = await db.uow().runs.get('r-test')
    expect(run?.run.caseName).toBe('新建电影')
    expect(run?.steps[0]?.durationMs).toBe(12)
    expect(run?.steps[0]?.locatorHit?.tier).toBe(0)

    const listed = await db.uow().runs.list({ caseId: created.case.id })
    expect(listed).toHaveLength(1)
    expect(listed[0]?.caseName).toBe('新建电影')

    const planRuns = await db.uow().planRuns.runsOf(planRun.id)
    expect(planRuns).toHaveLength(1)
    expect(planRuns[0]?.caseName).toBe('新建电影')

    await db.uow().planRuns.finish(planRun.id, { status: 'passed', passed: 1, failed: 0 })
    expect((await db.uow().planRuns.get(planRun.id))?.status).toBe('passed')

    // 删除计划级联清理执行记录
    await db.uow().plans.remove(plan.id)
    expect(await db.uow().planRuns.get(planRun.id)).toBeNull()
    expect(await db.uow().runs.get('r-test')).toBeNull()
  })

  it('旧版数据库先备份再重建', async () => {
    const dir = tempDir()
    const dbPath = join(dir, 'atp.db')
    const legacy = new Database(dbPath)
    legacy.exec('create table cases (id text primary key, name text not null)')
    legacy.exec("insert into cases (id, name) values ('c-old', '旧用例')")
    legacy.close()

    const db = await open(dir)
    expect(db.backup).toBeTruthy()
    expect(existsSync(db.backup as string)).toBe(true)

    const projects = await db.uow().projects.list()
    expect(projects).toEqual([])
  })
})
