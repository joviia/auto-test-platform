import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb } from '@atp/core'
import { IpcChannel, type IpcContract, parseIpcInput } from '@atp/model'
import { toPlaywrightSpec } from '@atp/runner'
import type { Agent } from './agent.js'
import { SKILL_MANIFESTS } from './ai/skills.js'

type Handler = (input: never) => Promise<unknown>

/**
 * 把 Electron 主进程的 IPC 注册表搬到 Agent 的 POST /api/invoke。
 * channel 与入参契约完全复用 @atp/model，renderer 无感。
 */
export function createInvokeRouter(agent: Agent, dataDir: string) {
  const routes = new Map<string, Handler>()
  const route = <K extends keyof IpcContract>(
    channel: K,
    fn: (input: ReturnType<typeof parseIpcInput<K>>) => Promise<unknown>,
  ): void => {
    routes.set(channel, fn as Handler)
  }

  route(IpcChannel.projectList, async () => getDb().uow().projects.list())
  route(IpcChannel.projectCreate, async (input) => getDb().uow().projects.create(input.name))
  route(IpcChannel.projectDelete, async (input) => {
    await getDb().uow().projects.remove(input.id)
    return { ok: true }
  })

  route(IpcChannel.moduleList, async (input) => getDb().uow().modules.list(input.projectId))
  route(IpcChannel.moduleCreate, async (input) =>
    getDb().uow().modules.create(input.projectId, input.parentId, input.name),
  )
  route(IpcChannel.moduleRename, async (input) => {
    const row = await getDb().uow().modules.rename(input.id, input.name)
    if (!row) throw new Error(`模块不存在：${input.id}`)
    return row
  })
  route(IpcChannel.moduleDelete, async (input) => {
    await getDb().uow().modules.remove(input.id)
    return { ok: true }
  })

  route(IpcChannel.caseList, async (input) => getDb().uow().cases.list(input.projectId))
  route(IpcChannel.caseGet, async (input) => {
    const file = await getDb().uow().cases.get(input.id)
    if (!file) throw new Error(`用例不存在：${input.id}`)
    return file
  })
  route(IpcChannel.caseCreate, async (input) => getDb().uow().cases.create(input))
  route(IpcChannel.caseUpdate, async (input) => getDb().uow().cases.save(input))
  route(IpcChannel.caseDelete, async (input) => {
    await getDb().uow().cases.remove(input.id)
    return { ok: true }
  })
  route(IpcChannel.caseExportTs, async (input) => {
    const file = await getDb().uow().cases.get(input.id)
    if (!file) throw new Error(`用例不存在：${input.id}`)
    return { code: toPlaywrightSpec(file) }
  })
  route(IpcChannel.caseExportTsFile, async (input) => {
    const file = await getDb().uow().cases.get(input.id)
    if (!file) throw new Error(`用例不存在：${input.id}`)
    const fileName = `${file.case.name.replace(/[\\/:*?"<>|\s]+/g, '-')}.spec.ts`
    const dir = join(dataDir, 'exports')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, fileName)
    await writeFile(target, toPlaywrightSpec(file), 'utf8')
    return { saved: true, path: target }
  })

  route(IpcChannel.elementList, async (input) => getDb().uow().elements.list(input.projectId))
  route(IpcChannel.elementUpsert, async (input) => getDb().uow().elements.upsert(input))
  route(IpcChannel.elementDelete, async (input) => {
    await getDb().uow().elements.remove(input.id)
    return { ok: true }
  })

  route(IpcChannel.suiteList, async (input) => getDb().uow().suites.list(input.projectId))
  route(IpcChannel.suiteGet, async (input) => {
    const found = await getDb().uow().suites.get(input.id)
    if (!found) throw new Error(`套件不存在：${input.id}`)
    return found
  })
  route(IpcChannel.suiteCreate, async (input) => getDb().uow().suites.create(input))
  route(IpcChannel.suiteUpdate, async (input) => getDb().uow().suites.update(input))
  route(IpcChannel.suiteDelete, async (input) => {
    await getDb().uow().suites.remove(input.id)
    return { ok: true }
  })

  route(IpcChannel.planList, async (input) => getDb().uow().plans.list(input.projectId))
  route(IpcChannel.planGet, async (input) => {
    const found = await getDb().uow().plans.get(input.id)
    if (!found) throw new Error(`计划不存在：${input.id}`)
    return found
  })
  route(IpcChannel.planCreate, async (input) => getDb().uow().plans.create(input))
  route(IpcChannel.planUpdate, async (input) => getDb().uow().plans.update(input))
  route(IpcChannel.planDelete, async (input) => {
    await getDb().uow().plans.remove(input.id)
    return { ok: true }
  })
  route(IpcChannel.planRunStart, async (input) => agent.startPlan(input.planId, input.caseIds))
  route(IpcChannel.planRunStop, async () => agent.stopPlan())
  route(IpcChannel.planRunList, async (input) =>
    getDb().uow().planRuns.list(input.planId, input.limit),
  )
  route(IpcChannel.planRunGet, async (input) => {
    const uow = getDb().uow()
    const planRun = await uow.planRuns.get(input.planRunId)
    if (!planRun) throw new Error(`计划执行不存在：${input.planRunId}`)
    return { planRun, runs: await uow.planRuns.runsOf(input.planRunId) }
  })

  route(IpcChannel.browserNavigate, async (input) => {
    await agent.navigate(input.url)
    return { ok: true }
  })
  route(IpcChannel.browserFocus, async () => {
    await agent.focus()
    return { ok: true }
  })
  route(IpcChannel.viewBoundsSet, async () => ({ ok: true }))
  route(IpcChannel.viewEmulate, async (input) => {
    if ('clear' in input && input.clear) {
      await agent.emulate(null)
    } else if ('width' in input) {
      await agent.emulate({
        width: input.width,
        height: input.height,
        deviceScaleFactor: input.deviceScaleFactor,
        mobile: input.mobile,
      })
    }
    return { ok: true }
  })

  route(IpcChannel.runList, async (input) => getDb().uow().runs.list(input))
  route(IpcChannel.runGet, async (input) => {
    const found = await getDb().uow().runs.get(input.runId)
    if (!found) throw new Error(`执行记录不存在：${input.runId}`)
    return found
  })

  route(IpcChannel.recordingStart, async () => {
    agent.startRecording()
    return { ok: true }
  })
  route(IpcChannel.recordingStop, async () => agent.stopRecording())
  route(IpcChannel.recordingAssertArm, async () => {
    agent.armAssertion()
    return { ok: true }
  })
  route(IpcChannel.replayStart, async (input) => {
    const result = await agent.replayCase(input.caseId)
    return { runId: result.runId }
  })
  route(IpcChannel.replayStop, async () => {
    agent.stopReplay()
    return { ok: true }
  })

  route(IpcChannel.aiSend, async (input) => agent.aiSend(input))
  route(IpcChannel.aiCancel, async (input) => agent.aiCancel(input.sessionId))
  route(IpcChannel.aiConfig, async () => agent.aiConfig())
  route(IpcChannel.aiSaveConfig, async (input) => agent.aiSaveConfig(input))
  route(IpcChannel.aiTest, async (input) => agent.aiTest(input))
  route(IpcChannel.aiModels, async (input) => agent.aiModels(input))
  route(IpcChannel.aiSessionList, async (input) => agent.aiSessionList(input.limit))
  route(IpcChannel.aiSessionGet, async (input) => agent.aiSessionGet(input.id))
  route(IpcChannel.aiSessionDelete, async (input) => agent.aiSessionDelete(input.id))
  route(IpcChannel.aiPlanRun, async (input) =>
    agent.startPlanDraft(input.proposalId, input.caseFile),
  )
  route(IpcChannel.aiPlanStop, async () => agent.stopPlanDraft())
  route(IpcChannel.debugStart, async (input) => agent.startDebug(input.caseId, input.breakpoints))
  route(IpcChannel.debugCommand, async (input) =>
    agent.debugCommand(input.action, input.breakpoints),
  )
  route(IpcChannel.debugState, async () => agent.debugState())
  route(IpcChannel.skillList, async () => SKILL_MANIFESTS)

  return async (channel: string, payload: unknown): Promise<unknown> => {
    const handler = routes.get(channel)
    if (!handler) throw new Error(`未知通道：${channel}`)
    try {
      const input = parseIpcInput(channel as keyof IpcContract, payload)
      return await handler(input as never)
    } catch (err) {
      if (err && typeof err === 'object' && 'issues' in err) {
        const issues = (err as { issues: Array<{ message?: string }> }).issues
        throw new Error(issues.map((issue) => issue.message ?? '参数不合法').join('；'))
      }
      throw err
    }
  }
}

export type InvokeRouter = ReturnType<typeof createInvokeRouter>
