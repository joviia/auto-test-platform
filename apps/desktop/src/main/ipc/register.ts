import { writeFile } from 'node:fs/promises'
import {
  IpcChannel,
  type IpcContract,
  type IpcInput,
  type IpcOutput,
  parseIpcInput,
} from '@atp/model'
import { toPlaywrightSpec } from '@atp/runner'
import { dialog, ipcMain } from 'electron'
import { getMainWindow } from '../app-window'
import {
  getControlledView,
  navigateControlledView,
  setControlledViewBounds,
} from '../browser/controlled-browser'
import { caseRepo } from '../db/repositories/cases'
import { elementRepo } from '../db/repositories/elements'
import { moduleRepo } from '../db/repositories/modules'
import { projectRepo } from '../db/repositories/projects'
import { runRepo } from '../db/repositories/runs'
import { applyDeviceMetrics } from '../services/emulation'
import { armAssertion, startRecording, stopRecording } from '../services/recording'
import { startReplay, stopReplay } from '../services/replay'

type AnyFn = (input: never) => unknown
const routes = new Map<string, { parse: (raw: unknown) => unknown; fn: AnyFn }>()

function route<K extends keyof IpcContract>(
  channel: K,
  fn: (input: IpcInput<K>) => IpcOutput<K> | Promise<IpcOutput<K>>,
): void {
  routes.set(channel, {
    parse: (raw) => parseIpcInput(channel, raw),
    fn: fn as AnyFn,
  })
}

/** 薄壳注册表：zod 校验入参后直接调仓储/服务 */
export function registerIpc(): void {
  route(IpcChannel.projectList, () => projectRepo.list())
  route(IpcChannel.projectCreate, (input) => projectRepo.create(input.name))
  route(IpcChannel.projectDelete, (input) => {
    projectRepo.remove(input.id)
    return { ok: true }
  })

  route(IpcChannel.moduleList, (input) => moduleRepo.list(input.projectId))
  route(IpcChannel.moduleCreate, (input) =>
    moduleRepo.create(input.projectId, input.parentId, input.name),
  )
  route(IpcChannel.moduleRename, (input) => {
    const row = moduleRepo.rename(input.id, input.name)
    if (!row) throw new Error(`模块不存在：${input.id}`)
    return row
  })
  route(IpcChannel.moduleDelete, (input) => {
    moduleRepo.remove(input.id)
    return { ok: true }
  })

  route(IpcChannel.caseList, (input) => caseRepo.list(input.projectId))
  route(IpcChannel.caseGet, (input) => {
    const file = caseRepo.get(input.id)
    if (!file) throw new Error(`用例不存在：${input.id}`)
    return file
  })
  route(IpcChannel.caseCreate, (input) => caseRepo.create(input))
  route(IpcChannel.caseUpdate, (input) => caseRepo.save(input))
  route(IpcChannel.caseDelete, (input) => {
    caseRepo.remove(input.id)
    return { ok: true }
  })
  route(IpcChannel.caseExportTs, (input) => {
    const file = caseRepo.get(input.id)
    if (!file) throw new Error(`用例不存在：${input.id}`)
    return { code: toPlaywrightSpec(file) }
  })
  route(IpcChannel.caseExportTsFile, async (input) => {
    const file = caseRepo.get(input.id)
    if (!file) throw new Error(`用例不存在：${input.id}`)
    const fileName = `${file.case.name.replace(/[\\/:*?"<>|\s]+/g, '-')}.spec.ts`
    const win = getMainWindow()
    const result = win
      ? await dialog.showSaveDialog(win, {
          title: '保存 Playwright TS 脚本',
          defaultPath: fileName,
          filters: [{ name: 'TypeScript', extensions: ['ts'] }],
        })
      : await dialog.showSaveDialog({
          title: '保存 Playwright TS 脚本',
          defaultPath: fileName,
          filters: [{ name: 'TypeScript', extensions: ['ts'] }],
        })
    if (result.canceled || !result.filePath) return { saved: false }
    await writeFile(result.filePath, toPlaywrightSpec(file), 'utf8')
    return { saved: true, path: result.filePath }
  })

  route(IpcChannel.elementList, (input) => elementRepo.list(input.projectId))
  route(IpcChannel.elementUpsert, (input) => elementRepo.upsert(input))
  route(IpcChannel.elementDelete, (input) => {
    elementRepo.remove(input.id)
    return { ok: true }
  })

  route(IpcChannel.browserNavigate, (input) => {
    void navigateControlledView(input.url)
    return { ok: true }
  })
  route(IpcChannel.viewBoundsSet, (input) => {
    setControlledViewBounds(input)
    return { ok: true }
  })
  route(IpcChannel.viewEmulate, async (input) => {
    const view = getControlledView()
    if ('clear' in input && input.clear) {
      await applyDeviceMetrics(view, null)
    } else if ('width' in input) {
      await applyDeviceMetrics(view, {
        width: input.width,
        height: input.height,
        deviceScaleFactor: input.deviceScaleFactor,
        mobile: input.mobile,
      })
    }
    return { ok: true }
  })

  route(IpcChannel.runList, (input) => runRepo.list(input.caseId))
  route(IpcChannel.runGet, (input) => {
    const found = runRepo.get(input.runId)
    if (!found) throw new Error(`执行记录不存在：${input.runId}`)
    return found
  })
  // recording:start/stop（T6）、replay:start（T10）在对应任务接入
  route(IpcChannel.recordingStart, () => {
    const view = getControlledView()
    if (!view) throw new Error('受控浏览器未就绪')
    return startRecording(view)
  })
  route(IpcChannel.recordingStop, () => stopRecording())
  route(IpcChannel.recordingAssertArm, () => armAssertion())
  route(IpcChannel.replayStart, (input) =>
    startReplay(input.caseId, getControlledView(), input.mode),
  )
  route(IpcChannel.replayStop, () => stopReplay())

  for (const [channel, r] of routes) {
    ipcMain.handle(channel, async (_event, raw: unknown) => {
      try {
        return await r.fn(r.parse(raw) as never)
      } catch (err) {
        // zod 校验错误 → 可读中文提示（否则 renderer 收到的是一大段 JSON）
        if (err && typeof err === 'object' && 'issues' in err) {
          const issues = (err as { issues: Array<{ message?: string }> }).issues
          throw new Error(issues.map((issue) => issue.message ?? '参数不合法').join('；'))
        }
        throw err
      }
    })
  }
  console.log(`[atp] ipc registered: ${routes.size} channels`)
}
