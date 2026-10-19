import { basename } from 'node:path'
import { getDb, initDb, initEvidence, runDir } from '@atp/core'
import type {
  AiCaseProposal,
  AiConfig,
  AiModelsInput,
  AiModelsResult,
  AiPlanProgress,
  AiPlanProposal,
  AiPlanResult,
  AiSaveConfigInput,
  AiSendInput,
  AiTestInput,
  AiTestResult,
  CaseFile,
  CaseRow,
  DebugState,
  IpcChannel,
  IpcEventPayload,
  IpcOutput,
  LiveStep,
  StepResult,
} from '@atp/model'
import {
  type BrowserEvent,
  ChromeController,
  type DeviceMetrics,
  type RecordedDraft,
} from './browser.js'
import { type CopilotEvent, CopilotService } from './copilot/service.js'
import { type DebugAction, DebugController } from './debug-runner.js'
import { isPlanRunning, startPlanRun, stopPlanRun } from './plan-runner.js'

export interface AgentOptions {
  dataDir: string
  profileDir: string
  headless: boolean
  demoUrl: string
}

export interface AgentState {
  engine: string
  url: string
  recording: boolean
  replaying: boolean
  cases: CaseRow[]
}

export type ReplayStep = StepResult & { screenshotUrl?: string }
export type ReplayResult = {
  runId: string
  status: 'passed' | 'failed'
  error?: string
  durationMs?: number
  steps: ReplayStep[]
}

export type AgentEvent =
  | {
      type: 'status'
      engine: string
      url: string
      recording: boolean
      replaying: boolean
    }
  | { type: 'step'; step: LiveStep }
  | { type: 'draft'; stepCount: number; rawEvents: number; startUrl: string }
  | ({ type: 'ai-recording-draft' } & RecordedDraft)
  | ({ type: 'ai-case-proposal' } & AiCaseProposal)
  | ({ type: 'ai-plan-proposal' } & AiPlanProposal)
  | { type: 'ai-plan-progress'; progress: AiPlanProgress }
  | { type: 'ai-plan-result'; result: AiPlanResult }
  | { type: 'debug-state'; state: DebugState }
  | {
      type: 'replay-progress'
      runId: string
      index: number
      total: number
      status: StepResult['status']
    }
  | { type: 'replay-result'; runId: string; result: ReplayResult }
  | { type: 'plan-progress'; progress: IpcEventPayload<'event:plan-progress'> }
  | { type: 'cases'; cases: CaseRow[] }
  | { type: 'error'; message: string }
  | CopilotEvent

/** 本地 Agent：SQLite 用例仓 + 真实 Chrome + 事件总线 */
export class Agent {
  private browser: ChromeController | null = null
  private lastDraft: RecordedDraft | null = null
  private replayAbort: AbortController | null = null
  private planDraftAbort: AbortController | null = null
  private readonly debugRunner = new DebugController((state) =>
    this.emit({ type: 'debug-state', state }),
  )
  private listeners = new Set<(event: AgentEvent) => void>()
  private started = false
  private copilot: CopilotService | null = null

  constructor(private readonly options: AgentOptions) {}

  async start(initialUrl: string): Promise<void> {
    if (this.started) return
    this.started = true
    const db = await initDb({ dataDir: this.options.dataDir })
    initEvidence(this.options.dataDir)
    const uow = db.uow()
    if ((await uow.projects.list()).length === 0) await uow.projects.create('默认项目')

    this.browser = await ChromeController.launch({
      profileDir: this.options.profileDir,
      headless: this.options.headless,
      onEvent: (event) => this.onBrowserEvent(event),
    })
    this.copilot = new CopilotService({
      dataDir: this.options.dataDir,
      getBrowser: () => this.browser,
      platform: {
        isRecording: () => this.browser?.isRecording ?? false,
        startRecording: () => this.startRecording(),
        stopRecording: () => this.stopRecording(),
        notifyRecordingDraft: (draft) => this.emit({ type: 'ai-recording-draft', ...draft }),
        proposeCase: (proposal) => this.emit({ type: 'ai-case-proposal', ...proposal }),
        proposePlan: (proposal) => this.emit({ type: 'ai-plan-proposal', ...proposal }),
        runCase: async (caseId) => {
          const result = await this.replayCase(caseId)
          return {
            runId: result.runId,
            status: result.status,
            ...(result.error ? { error: result.error } : {}),
            ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
            steps: result.steps.map((step) => ({
              index: step.index,
              action: step.action,
              status: step.status,
              durationMs: step.durationMs,
              ...(step.error ? { error: step.error } : {}),
              ...(step.skipped !== undefined ? { skipped: step.skipped } : {}),
            })),
          }
        },
      },
      onEvent: (event) => this.emit(event),
    })
    await this.copilot.init()
    if (initialUrl) {
      await this.browser.navigate(initialUrl).catch((err: unknown) => {
        this.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    }
    this.emitStatus()
    await this.emitCases()
  }

  onEvent(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 端口确定后才能拼出演示页地址 */
  setDemoUrl(url: string): void {
    this.options.demoUrl = url
  }

  async describe(): Promise<AgentState> {
    return {
      engine: this.browser?.engine ?? '',
      url: this.browser?.currentUrl ?? '',
      recording: this.browser?.isRecording ?? false,
      replaying: this.replayAbort !== null || this.planDraftAbort !== null,
      cases: await this.allCases(),
    }
  }

  async allCases(): Promise<CaseRow[]> {
    const uow = getDb().uow()
    const projects = await uow.projects.list()
    const rows = await Promise.all(projects.map((project) => uow.cases.list(project.id)))
    return rows.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async navigate(input: string): Promise<string> {
    if (this.browser?.isRecording) throw new Error('录制中不能导航，请先停止录制')
    if (this.replayAbort) throw new Error('回放中不能导航')
    if (this.planDraftAbort) throw new Error('AI 计划执行中不能导航')
    if (this.debugRunner.active) throw new Error('调试中不能导航，请先停止调试')
    if (isPlanRunning()) throw new Error('计划执行中不能导航')
    const browser = this.requireBrowser()
    const url = await browser.navigate(input)
    this.emitStatus()
    return url
  }

  async focus(): Promise<void> {
    await this.requireBrowser().focus()
  }

  /** 订阅真实 Chrome 的只读实时画面（JPEG 帧） */
  subscribeLive(listener: (frame: Buffer) => void): () => void {
    return this.requireBrowser().live.subscribe(listener)
  }

  liveSubscriberCount(): number {
    return this.browser?.live.subscriberCount ?? 0
  }

  async emulate(metrics: DeviceMetrics | null): Promise<void> {
    // UI 挂载时会先发一次 clear，此刻 Chrome 可能还没启动；忽略这次初始化调用
    if (!this.browser) return
    await this.browser.emulate(metrics)
  }

  startRecording(): void {
    if (this.replayAbort) throw new Error('回放中不能开始录制')
    if (this.planDraftAbort) throw new Error('AI 计划执行中不能开始录制')
    if (this.debugRunner.active) throw new Error('调试中不能开始录制')
    if (isPlanRunning()) throw new Error('计划执行中不能开始录制')
    const browser = this.requireBrowser()
    this.lastDraft = null
    browser.startRecording()
    this.emitStatus()
  }

  armAssertion(): void {
    this.requireBrowser().armAssertion()
  }

  async stopRecording(): Promise<RecordedDraft> {
    const browser = this.requireBrowser()
    if (!browser.isRecording) throw new Error('当前没有在录制')
    const draft = await browser.stopRecording()
    this.lastDraft = draft
    this.emit({
      type: 'draft',
      stepCount: draft.steps.length,
      rawEvents: draft.rawEvents,
      startUrl: draft.startUrl,
    })
    this.emitStatus()
    return draft
  }

  /** `/simple` 的一键保存：把最近一次录制写进默认项目 */
  async saveCase(name: string): Promise<CaseRow> {
    if (!this.lastDraft) throw new Error('还没有可保存的录制')
    const uow = getDb().uow()
    const project = (await uow.projects.list())[0]
    if (!project) throw new Error('没有可用项目')
    const file = await uow.cases.create({
      projectId: project.id,
      name: name.trim() || `录制 ${new Date().toLocaleString('zh-CN')}`,
      startUrl: this.lastDraft.startUrl || 'about:blank',
    })
    await uow.cases.save({
      case: {
        ...file.case,
        steps: this.lastDraft.steps,
        intent: this.lastDraft.intent,
        groups: this.lastDraft.groups,
      },
      elements: this.lastDraft.elements,
    })
    await this.emitCases()
    const saved = (await this.allCases()).find((row) => row.id === file.case.id)
    if (!saved) throw new Error('保存用例失败')
    return saved
  }

  async replayCase(id: string): Promise<ReplayResult> {
    if (this.browser?.isRecording) throw new Error('录制中不能回放')
    if (this.replayAbort) throw new Error('已有回放正在执行')
    if (this.planDraftAbort) throw new Error('AI 计划正在执行')
    if (this.debugRunner.active) throw new Error('调试中不能回放')
    if (isPlanRunning()) throw new Error('计划执行中不能回放')
    const uow = getDb().uow()
    const file = await uow.cases.get(id)
    if (!file) throw new Error(`用例不存在：${id}`)
    const browser = this.requireBrowser()
    const runId = uow.runs.newRunId()
    const abort = new AbortController()
    this.replayAbort = abort
    this.emitStatus()
    try {
      const result = await browser.replay(file, {
        evidenceDir: runDir(runId),
        runId,
        signal: abort.signal,
        onStep: (step, index, total) => {
          this.emit({
            type: 'replay-progress',
            runId,
            index: index + 1,
            total,
            status: step.status,
          })
        },
      })
      await uow.runs.save(result)
      const steps: ReplayStep[] = result.steps.map((step) => ({
        ...step,
        ...(step.screenshotPath
          ? { screenshotUrl: `/evidence/${runId}/${basename(step.screenshotPath)}` }
          : {}),
      }))
      const uiResult: ReplayResult = {
        runId,
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
        steps,
      }
      this.emit({ type: 'replay-result', runId, result: uiResult })
      return uiResult
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ type: 'error', message })
      throw err
    } finally {
      this.replayAbort = null
      this.emitStatus()
    }
  }

  stopReplay(): void {
    this.replayAbort?.abort()
  }

  async startPlan(planId: string, caseIds?: string[]): Promise<{ planRunId: string }> {
    if (this.browser?.isRecording) throw new Error('录制进行中，无法执行计划')
    if (this.replayAbort) throw new Error('单用例回放进行中，无法执行计划')
    if (this.planDraftAbort) throw new Error('AI 计划正在执行，无法启动测试计划')
    if (this.debugRunner.active) throw new Error('调试中无法启动测试计划')
    const page = await this.requireBrowser().runnerPage()
    const result = await startPlanRun(
      page,
      planId,
      (progress) => {
        this.emit({ type: 'plan-progress', progress })
      },
      caseIds,
    )
    await this.emitCases()
    return result
  }

  stopPlan(): { ok: true } {
    return stopPlanRun()
  }

  /**
   * 执行 AI 计划卡草稿。立即返回 runId，进度与结果通过事件推送；
   * 不写 runs 表（计划还没有对应的用例），证据仍落在 runDir。
   */
  startPlanDraft(proposalId: string, caseFile: CaseFile): { runId: string } {
    if (this.browser?.isRecording) throw new Error('录制进行中，无法执行计划')
    if (this.replayAbort) throw new Error('回放进行中，无法执行计划')
    if (this.planDraftAbort) throw new Error('已有 AI 计划正在执行')
    if (this.debugRunner.active) throw new Error('调试中无法执行 AI 计划')
    if (isPlanRunning()) throw new Error('测试计划执行中，无法执行 AI 计划')

    const browser = this.requireBrowser()
    const runId = getDb().uow().runs.newRunId()
    const abort = new AbortController()
    this.planDraftAbort = abort
    this.emitStatus()

    void (async () => {
      try {
        const result = await browser.replay(caseFile, {
          evidenceDir: runDir(runId),
          runId,
          signal: abort.signal,
          onStep: (step, index, total) => {
            this.emit({
              type: 'ai-plan-progress',
              progress: {
                proposalId,
                runId,
                index: index + 1,
                total,
                stepId: step.stepId,
                status: step.status,
              },
            })
          },
        })
        const steps = result.steps.map((step, index) => ({
          index: index + 1,
          stepId: step.stepId,
          action: step.action,
          status: step.status,
          durationMs: step.durationMs,
          ...(step.error ? { error: step.error } : {}),
          ...(step.skipped !== undefined ? { skipped: step.skipped } : {}),
          ...(step.screenshotPath
            ? { screenshotUrl: `/evidence/${runId}/${basename(step.screenshotPath)}` }
            : {}),
        }))
        this.emit({
          type: 'ai-plan-result',
          result: {
            proposalId,
            runId,
            status: result.status,
            ...(result.error ? { error: result.error } : {}),
            steps,
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.emit({
          type: 'ai-plan-result',
          result: { proposalId, runId, status: 'failed', error: message, steps: [] },
        })
        this.emit({ type: 'error', message })
      } finally {
        this.planDraftAbort = null
        this.emitStatus()
      }
    })()

    return { runId }
  }

  stopPlanDraft(): { ok: true } {
    this.planDraftAbort?.abort()
    return { ok: true }
  }

  /** 从一条已保存用例开始单步调试：先导航，再停在第一步之前 */
  async startDebug(caseId: string, breakpoints: string[] = []): Promise<{ runId: string }> {
    if (this.browser?.isRecording) throw new Error('录制中不能调试')
    if (this.replayAbort) throw new Error('回放中不能调试')
    if (this.planDraftAbort) throw new Error('AI 计划执行中不能调试')
    if (this.copilot?.state().running) throw new Error('Copilot 正在执行，请先停止')
    if (isPlanRunning()) throw new Error('测试计划执行中不能调试')
    if (this.debugRunner.active) throw new Error('已有调试会话正在执行')
    const file = await getDb().uow().cases.get(caseId)
    if (!file) throw new Error(`用例不存在：${caseId}`)
    const page = await this.requireBrowser().runnerPage()
    const result = this.debugRunner.start(page, file, breakpoints)
    this.emitStatus()
    return result
  }

  debugCommand(action: DebugAction, breakpoints?: string[]): { ok: true } {
    this.debugRunner.command(action, breakpoints)
    return { ok: true }
  }

  debugState(): DebugState | null {
    return this.debugRunner.state
  }

  async runDemo(): Promise<void> {
    // 演示操作本身就应该在录制中执行；只拦截回放
    if (this.replayAbort) throw new Error('回放中不能执行演示操作')
    if (this.planDraftAbort) throw new Error('AI 计划执行中不能执行演示操作')
    if (this.debugRunner.active) throw new Error('调试中不能执行演示操作')
    await this.requireBrowser().runDemo(this.options.demoUrl)
    this.emitStatus()
  }

  async aiSend(input: AiSendInput): Promise<{ sessionId: string; messageId: string }> {
    if (!this.copilot) throw new Error('Copilot 尚未初始化')
    if (this.planDraftAbort) throw new Error('AI 计划正在执行，请先停止')
    if (this.debugRunner.active) throw new Error('调试中不能操作页面，请先停止调试')
    return this.copilot.send(input)
  }

  aiCancel(sessionId?: string): { ok: true } {
    return this.copilot?.cancel(sessionId) ?? { ok: true }
  }

  aiState(): IpcEventPayload<'event:ai-state'> {
    return this.copilot?.state() ?? { running: false }
  }

  aiConfig(): AiConfig {
    return (
      this.copilot?.aiConfig ?? {
        ready: false,
        provider: 'stub',
        model: 'stub',
        stub: true,
        kind: 'stub',
        hasKey: false,
        keySource: 'none',
        reason: 'Copilot 尚未初始化',
        env: [],
      }
    )
  }

  async aiSaveConfig(input: AiSaveConfigInput): Promise<AiConfig> {
    if (!this.copilot) throw new Error('Copilot 尚未初始化')
    return this.copilot.saveConfig(input)
  }

  async aiTest(input: AiTestInput): Promise<AiTestResult> {
    if (!this.copilot) throw new Error('Copilot 尚未初始化')
    return this.copilot.test(input)
  }

  async aiModels(input: AiModelsInput): Promise<AiModelsResult> {
    if (!this.copilot) throw new Error('Copilot 尚未初始化')
    return this.copilot.models(input)
  }

  async aiSessionList(limit?: number): Promise<IpcOutput<typeof IpcChannel.aiSessionList>> {
    if (!this.copilot) return []
    return this.copilot.listSessions(limit)
  }

  async aiSessionGet(id: string): Promise<IpcOutput<typeof IpcChannel.aiSessionGet>> {
    if (!this.copilot) throw new Error('Copilot 尚未初始化')
    return this.copilot.getSession(id)
  }

  async aiSessionDelete(id: string): Promise<{ ok: true }> {
    if (!this.copilot) return { ok: true }
    await this.copilot.deleteSession(id)
    return { ok: true }
  }

  async close(): Promise<void> {
    this.aiCancel()
    this.stopReplay()
    this.stopPlan()
    this.stopPlanDraft()
    if (this.debugRunner.active) this.debugRunner.command('stop')
    await this.browser?.close()
    this.browser = null
    this.copilot = null
    this.listeners.clear()
  }

  private onBrowserEvent(event: BrowserEvent): void {
    if (event.type === 'recording-step') {
      this.emit({ type: 'step', step: event.step })
      return
    }
    if (event.type === 'recording-status') {
      this.emitStatus()
      return
    }
    this.emit({ type: 'error', message: event.message })
  }

  private emitStatus(): void {
    this.emit({
      type: 'status',
      engine: this.browser?.engine ?? '',
      url: this.browser?.currentUrl ?? '',
      recording: this.browser?.isRecording ?? false,
      replaying: this.replayAbort !== null || this.planDraftAbort !== null,
    })
  }

  private async emitCases(): Promise<void> {
    try {
      this.emit({ type: 'cases', cases: await this.allCases() })
    } catch (err) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // 单个订阅者异常不影响其他客户端
      }
    }
  }

  private requireBrowser(): ChromeController {
    if (!this.browser) throw new Error('浏览器尚未就绪')
    return this.browser
  }
}
