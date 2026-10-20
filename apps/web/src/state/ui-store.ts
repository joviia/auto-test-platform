import type {
  AiCaseProposal as AiCaseProposalPayload,
  AiConfig,
  AiPlanProgress,
  AiPlanProposal as AiPlanProposalPayload,
  AiPlanResult,
  AiSessionMessage,
  AiToolEndPayload,
  AiToolStartPayload,
  CaseFile,
  CaseGroup,
  DebugState,
  DesignCase,
  DesignDataRecord,
  DesignMatrix,
  DesignResult,
  DesignSelection,
  Element,
  IpcEventPayload,
  LiveStep,
  Step,
} from '@atp/model'
import { create } from 'zustand'
import type { AiContext, AiMessage, AiRightTab, AiSeed } from '../ai/types'

export type SelectedNode = {
  kind: 'project' | 'module' | 'case' | 'plan' | 'skill'
  id: string
}

export type NavTab = 'cases' | 'plans' | 'skills'

export type ThemePreference = 'system' | 'light' | 'dark'

export type DevicePresetId =
  | 'responsive'
  | 'desktop-1440'
  | 'laptop-1280'
  | 'tablet-1024'
  | 'iphone-14'
  | 'android-412'

export type DeviceOrientation = 'portrait' | 'landscape'
export type DeviceZoom = 'fit' | 0.5 | 0.75 | 1 | 1.25
export type ReplayMode = 'embedded' | 'standalone'

export interface RecordingDraft {
  steps: Step[]
  elements: Record<string, Element>
  startUrl: string
  /** 意图层：一句话摘要 */
  intent?: string
  /** 意图层：步骤分组 */
  groups?: CaseGroup[]
  diagnostics?: {
    rawEvents: number
    frames: Array<{ url: string; injected: boolean }>
  }
}

/** AI 的用例修改建议：pending 等用户确认，applied 已写入（可撤销） */
export interface AiCaseProposal extends AiCaseProposalPayload {
  status: 'pending' | 'applied'
}

export type AiPlanStatus = 'pending' | 'running' | 'passed' | 'failed' | 'saved'

export interface AiPlanStepResult {
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
  skipped?: boolean
  screenshotUrl?: string
}

/** AI 生成的新用例计划卡：可编辑草稿，执行与保存由用户触发 */
export type DesignRunStatus = 'running' | 'passed' | 'failed' | 'stopped'

export interface DesignRunState {
  status: DesignRunStatus
  runId?: string
  error?: string
}

export type DesignView = 'scenarios' | 'matrix'

export interface DesignFilter {
  fieldRef?: string
  ruleId?: string
  /** 多规范筛选；与 ruleId 二选一 */
  ruleIds?: string[]
  status?: string
}

export interface DesignUndoEntry {
  label: string
  matrix: DesignMatrix
  /** 用于「AI 更新了…撤销」临时条自动消失 */
  at: number
}

export type DesignSaveState = 'idle' | 'saving' | 'saved' | 'conflict'

export interface AiPlanProposal extends AiPlanProposalPayload {
  status: AiPlanStatus
  runId?: string
  error?: string
  stepResults: Record<string, AiPlanStepResult>
  savedCaseId?: string
  savedCaseName?: string
  /** 保存时是否已经执行通过 */
  verified?: boolean
}

const THEME_KEY = 'atp.theme'
const DEVICE_KEY = 'atp.device'
const REPLAY_MODE_KEY = 'atp.replayMode'
const RIGHT_WIDTH_KEY = 'atp.rightWidth'
const DEBUG_BREAKPOINTS_KEY = 'atp.debugBreakpoints'
const RIGHT_MIN = 360
const RIGHT_MAX = 560

function readRightWidth(): number {
  try {
    const value = Number(localStorage.getItem(RIGHT_WIDTH_KEY))
    if (Number.isFinite(value) && value >= RIGHT_MIN && value <= RIGHT_MAX) return value
  } catch {
    // 忽略
  }
  return 404
}

function storeRightWidth(width: number): void {
  try {
    localStorage.setItem(RIGHT_WIDTH_KEY, String(width))
  } catch {
    // 忽略
  }
}

function readStoredTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY)
    if (value === 'light' || value === 'dark' || value === 'system') return value
  } catch {
    // 私密窗口/被禁用时忽略
  }
  return 'system'
}

function storeTheme(theme: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // 忽略写入失败
  }
}

interface StoredDevice {
  presetId: DevicePresetId
  orientation: DeviceOrientation
  zoom: DeviceZoom
}

function readStoredDevice(): StoredDevice {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredDevice>
      if (parsed.presetId) {
        return {
          presetId: parsed.presetId,
          orientation: parsed.orientation === 'landscape' ? 'landscape' : 'portrait',
          zoom: parsed.zoom === 'fit' || typeof parsed.zoom === 'number' ? parsed.zoom : 'fit',
        }
      }
    }
  } catch {
    // 忽略
  }
  return { presetId: 'responsive', orientation: 'portrait', zoom: 'fit' }
}

function storeDevice(device: StoredDevice): void {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(device))
  } catch {
    // 忽略
  }
}

function readDebugBreakpoints(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(DEBUG_BREAKPOINTS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const result: Record<string, string[]> = {}
    for (const [caseId, ids] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(ids)) {
        result[caseId] = ids.filter((id): id is string => typeof id === 'string')
      }
    }
    return result
  } catch {
    return {}
  }
}

function storeDebugBreakpoints(value: Record<string, string[]>): void {
  try {
    localStorage.setItem(DEBUG_BREAKPOINTS_KEY, JSON.stringify(value))
  } catch {
    // 忽略
  }
}

function readReplayMode(): ReplayMode {
  try {
    return localStorage.getItem(REPLAY_MODE_KEY) === 'standalone' ? 'standalone' : 'embedded'
  } catch {
    return 'embedded'
  }
}

function storeReplayMode(mode: ReplayMode): void {
  try {
    localStorage.setItem(REPLAY_MODE_KEY, mode)
  } catch {
    // 忽略
  }
}

interface UiState {
  selected: SelectedNode | null
  setSelected: (node: SelectedNode | null) => void

  /** 左栏导航：用例库 / 测试计划 */
  navTab: NavTab
  setNavTab: (tab: NavTab) => void

  /** 当前项目：左树、新建用例、保存对话框共用 */
  currentProjectId: string | null
  setCurrentProjectId: (projectId: string | null) => void

  recording: boolean
  recordingStartedAt: number | null
  setRecording: (recording: boolean) => void

  liveSteps: LiveStep[]
  pushLiveStep: (step: IpcEventPayload<'event:recording-step'>) => void
  resetLiveSteps: () => void

  draftRecording: RecordingDraft | null
  setDraftRecording: (draft: RecordingDraft | null) => void

  url: string
  setUrl: (url: string) => void

  /** 打开的弹层层数：原生受控浏览器视图必须让位，否则会盖住弹窗 */
  overlayDepth: number
  pushOverlay: () => void
  popOverlay: () => void

  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void

  devicePresetId: DevicePresetId
  deviceOrientation: DeviceOrientation
  deviceZoom: DeviceZoom
  setDevice: (patch: Partial<StoredDevice>) => void

  replayMode: ReplayMode
  setReplayMode: (mode: ReplayMode) => void

  replayProgress: { runId: string | null; index: number; total: number } | null
  setReplayProgress: (
    progress: { runId: string | null; index: number; total: number } | null,
  ) => void

  replaying: boolean
  setReplaying: (replaying: boolean) => void

  /** 中栏回看：选中的运行记录 */
  selectedRunId: string | null
  setSelectedRunId: (runId: string | null) => void

  planProgress: IpcEventPayload<'event:plan-progress'> | null
  setPlanProgress: (progress: IpcEventPayload<'event:plan-progress'> | null) => void

  /** 右侧面板宽度（可拖拽） */
  rightWidth: number
  setRightWidth: (width: number) => void

  /** 右侧当前页签 */
  rightTab: AiRightTab
  setRightTab: (tab: AiRightTab) => void

  /** AI 是否占用右侧面板（启动台整幅模式下也能打开） */
  aiOpen: boolean
  setAiOpen: (open: boolean) => void
  aiSettingsOpen: boolean
  setAiSettingsOpen: (open: boolean) => void
  aiConfig: AiConfig | null
  setAiConfig: (config: AiConfig | null) => void

  aiSessionId: string | null
  aiMessages: AiMessage[]
  aiRunning: boolean
  aiStartedAt: number | null
  aiActiveTool: { callId: string; name: string; label: string; startedAt: number } | null
  aiTarget: { target: NonNullable<AiToolEndPayload['target']>; label: string } | null
  aiSeed: AiSeed | null
  aiProposals: AiCaseProposal[]
  aiPlans: AiPlanProposal[]

  /** 测试设计矩阵与生成/执行状态 */
  design: DesignMatrix | null
  designLoading: boolean
  designWorkbenchOpen: boolean
  designView: DesignView
  designFilter: DesignFilter
  designActiveScenarioId: string | null
  designActiveDataRecordId: string | null
  designSelected: string[]
  designRowSelected: string[]
  designUndo: DesignUndoEntry[]
  designSaveState: DesignSaveState
  designCases: DesignCase[]
  designRun: Record<string, DesignRunState>
  designRunning: boolean

  /** 单步调试状态；结束后保留到用户关闭 */
  debugState: DebugState | null
  /** 按用例保存的断点（本机 localStorage） */
  debugBreakpoints: Record<string, string[]>
  setDebugState: (state: DebugState | null) => void
  toggleDebugBreakpoint: (caseId: string, stepId: string) => void
  setDebugBreakpoints: (caseId: string, stepIds: string[]) => void

  addAiUserMessage: (text: string) => void
  addAiAssistantMessage: (text: string) => void
  startAiMessage: (sessionId: string, messageId: string) => void
  setAiRunning: (running: boolean) => void
  appendAiDelta: (messageId: string, kind: 'text' | 'reasoning', text: string) => void
  startAiTool: (messageId: string, payload: AiToolStartPayload) => void
  endAiTool: (messageId: string, payload: AiToolEndPayload) => void
  finishAiMessage: (messageId: string, cancelled?: boolean) => void
  failAiMessage: (messageId: string, error: string) => void
  addAiErrorMessage: (error: string) => void
  requestAi: (message: string, context?: AiContext) => void
  consumeAiSeed: (id: string) => void
  addAiProposal: (proposal: AiCaseProposalPayload) => void
  patchAiProposal: (proposalId: string, patch: Partial<AiCaseProposal>) => void
  removeAiProposal: (proposalId: string) => void
  addAiPlan: (proposal: AiPlanProposalPayload) => void
  patchAiPlan: (proposalId: string, patch: Partial<AiPlanProposal>) => void
  updateAiPlanFile: (proposalId: string, file: CaseFile) => void
  applyAiPlanProgress: (progress: AiPlanProgress) => void
  applyAiPlanResult: (result: AiPlanResult) => void
  removeAiPlan: (proposalId: string) => void
  setDesign: (matrix: DesignMatrix) => void
  setDesignLoading: (loading: boolean) => void
  setDesignWorkbenchOpen: (open: boolean) => void
  setDesignView: (view: DesignView) => void
  setDesignFilter: (filter: DesignFilter) => void
  setDesignActive: (scenarioId: string | null, dataRecordId?: string | null) => void
  toggleDesignScenario: (scenarioId: string) => void
  setDesignSelection: (selected: boolean) => void
  toggleDesignRow: (scenarioId: string, dataRecordId: string) => void
  setDesignRowSelection: (scenarioId: string, selected: boolean) => void
  /** AI 指令：直接设置场景与数据行选择 */
  applyDesignSelection: (scenarioIds: string[], rowKeys: string[]) => void
  setDesignDataValue: (scenarioId: string, dataRecordId: string, value: string) => void
  setDesignDataExpectedValue: (
    scenarioId: string,
    dataRecordId: string,
    value: string | undefined,
  ) => void
  decideDesignScenario: (scenarioId: string, decision: 'accepted' | 'rejected') => void
  applyDesignUpdate: (matrix: DesignMatrix) => void
  /** 持久化成功后只同步 revision/sessionId，不清空草稿与执行结果 */
  setDesignPersisted: (revision: number, sessionId?: string) => void
  /** 入库成功：记录行的 savedCaseId，并把对应场景标记为已接受 */
  markDesignSaved: (
    items: Array<{ scenarioId: string; dataRecordId: string; caseId: string }>,
  ) => void
  setDesignSaveState: (state: DesignSaveState) => void
  pushDesignUndo: (label: string, matrix: DesignMatrix) => void
  undoDesign: () => void
  setDesignCases: (cases: DesignCase[]) => void
  beginDesignRun: (selections: DesignSelection[]) => void
  setDesignRunning: (running: boolean) => void
  applyDesignResult: (result: DesignResult) => void
  resetDesign: () => void
  /** 从 SQLite 恢复历史会话；工具卡与证据一并还原 */
  replaceAiSession: (sessionId: string, messages: AiSessionMessage[]) => void
  resetAi: () => void
}

const initialDevice = readStoredDevice()

function newAiId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function storedToAiMessage(message: AiSessionMessage): AiMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    reasoning: message.reasoning ?? '',
    tools: (message.tools ?? []).map((tool) => ({
      ...tool,
      input: tool.input ?? {},
      status: tool.status === 'running' ? 'error' : tool.status,
      ...(tool.status === 'running' ? { error: '执行中断' } : {}),
    })),
    pending: false,
    ...(message.cancelled ? { cancelled: true } : {}),
    ...(message.error ? { error: message.error } : {}),
  }
}

function designRowKey(scenarioId: string, dataRecordId: string): string {
  return `${scenarioId}::${dataRecordId}`
}

function recordsOfScenario(matrix: DesignMatrix, scenarioId: string): DesignDataRecord[] {
  const scenario = matrix.scenarios.find((item) => item.id === scenarioId)
  return (scenario?.dataRecordIds ?? [])
    .map((id) => matrix.dataRecords?.[id])
    .filter((record): record is DesignDataRecord => Boolean(record))
}

function deriveScenarioStatus(
  scenario: DesignMatrix['scenarios'][number],
  records: DesignDataRecord[],
  reset = false,
): DesignMatrix['scenarios'][number]['status'] {
  if (!reset && ['accepted', 'rejected', 'excluded'].includes(scenario.status)) {
    return scenario.status
  }
  const ready = records.filter((record) => record.status === 'ready').length
  if (records.length > 0 && ready === records.length) return 'ready'
  if (ready > 0) return 'partial'
  return 'pending'
}

/** 前端本地重算场景状态、统计与覆盖；与 Agent 引擎口径一致 */
function recomputeDesign(matrix: DesignMatrix, resetScenarioIds: string[] = []): DesignMatrix {
  const reset = new Set(resetScenarioIds)
  const scenarios = matrix.scenarios.map((scenario) => ({
    ...scenario,
    status: deriveScenarioStatus(
      scenario,
      recordsOfScenario(matrix, scenario.id),
      reset.has(scenario.id),
    ),
  }))
  const scenarioByRecord = new Map<string, DesignMatrix['scenarios'][number]>()
  for (const scenario of scenarios) {
    for (const recordId of scenario.dataRecordIds) scenarioByRecord.set(recordId, scenario)
  }
  const allRecords = Object.values(matrix.dataRecords ?? {})
  const activeRecords = allRecords.filter((record) => {
    const scenario = scenarioByRecord.get(record.id)
    return (
      Boolean(scenario) &&
      scenario?.status !== 'rejected' &&
      scenario?.status !== 'excluded' &&
      record.status !== 'excluded'
    )
  })
  const readyRows = activeRecords.filter((record) => record.status === 'ready').length
  const pendingRows = activeRecords.filter((record) => record.status === 'pending').length
  const acceptedRows = scenarios
    .filter((scenario) => scenario.status === 'accepted')
    .flatMap((scenario) => scenario.dataRecordIds)
    .map((id) => activeRecords.find((record) => record.id === id))
    .filter((record): record is DesignDataRecord => Boolean(record))
    .filter((record) => record.status === 'ready').length
  const savedRows = activeRecords.filter((record) => record.savedCaseId).length
  const executedRows = activeRecords.filter((record) => record.lastRun).length
  const passedRows = activeRecords.filter((record) => record.lastRun?.status === 'passed').length
  const applicableRows = readyRows + pendingRows
  const count = (status: DesignMatrix['scenarios'][number]['status']): number =>
    scenarios.filter((scenario) => scenario.status === status).length
  return {
    ...matrix,
    scenarios,
    stats: {
      ...matrix.stats,
      scenarios: scenarios.length,
      rows: activeRecords.length,
      ready: count('ready') + count('partial'),
      readyRows,
      pending: count('pending'),
      pendingRows,
      accepted: count('accepted'),
    },
    coverage: {
      ...matrix.coverage,
      designCoverage: applicableRows === 0 ? 0 : readyRows / applicableRows,
      acceptCoverage: applicableRows === 0 ? 0 : acceptedRows / applicableRows,
      executionCoverage: applicableRows === 0 ? 0 : executedRows / applicableRows,
      passRate: executedRows === 0 ? 0 : passedRows / executedRows,
      scenarios: scenarios.length,
      readyScenarios: count('ready'),
      partialScenarios: count('partial'),
      pendingScenarios: count('pending'),
      acceptedScenarios: count('accepted'),
      rejectedScenarios: count('rejected'),
      rows: activeRecords.length,
      readyRows,
      pendingRows,
      acceptedRows,
      savedRows,
      executedRows,
      passedRows,
    },
  }
}

function readySelections(matrix: DesignMatrix): DesignSelection[] {
  return matrix.scenarios.flatMap((scenario) =>
    (scenario.dataRecordIds ?? [])
      .map((dataRecordId) => ({ scenario, dataRecordId }))
      .filter(({ scenario: owner, dataRecordId }) => {
        if (owner.status === 'rejected' || owner.status === 'excluded') return false
        return matrix.dataRecords?.[dataRecordId]?.status === 'ready'
      })
      .map(({ dataRecordId }) => ({ scenarioId: scenario.id, dataRecordId })),
  )
}

export const useUiStore = create<UiState>((set, get) => ({
  selected: null,
  setSelected: (selected) => set({ selected }),

  navTab: 'cases',
  setNavTab: (navTab) => set({ navTab }),

  currentProjectId: null,
  setCurrentProjectId: (currentProjectId) => set({ currentProjectId }),

  recording: false,
  recordingStartedAt: null,
  setRecording: (recording) =>
    set((s) => ({
      recording,
      // 只在本轮录制开始时打点，重复的 true 事件不重置计时
      recordingStartedAt: recording ? (s.recordingStartedAt ?? Date.now()) : null,
    })),

  liveSteps: [],
  pushLiveStep: (step) => set((s) => ({ liveSteps: [...s.liveSteps, step] })),
  resetLiveSteps: () => set({ liveSteps: [] }),

  draftRecording: null,
  setDraftRecording: (draftRecording) => set({ draftRecording }),

  url: '',
  setUrl: (url) => set({ url }),

  overlayDepth: 0,
  pushOverlay: () => set((s) => ({ overlayDepth: s.overlayDepth + 1 })),
  popOverlay: () => set((s) => ({ overlayDepth: Math.max(0, s.overlayDepth - 1) })),

  theme: readStoredTheme(),
  setTheme: (theme) => {
    storeTheme(theme)
    set({ theme })
  },

  devicePresetId: initialDevice.presetId,
  deviceOrientation: initialDevice.orientation,
  deviceZoom: initialDevice.zoom,
  setDevice: (patch) => {
    const current = get()
    const next: StoredDevice = {
      presetId: patch.presetId ?? current.devicePresetId,
      orientation: patch.orientation ?? current.deviceOrientation,
      zoom: patch.zoom ?? current.deviceZoom,
    }
    storeDevice(next)
    set({
      devicePresetId: next.presetId,
      deviceOrientation: next.orientation,
      deviceZoom: next.zoom,
    })
  },

  replayMode: readReplayMode(),
  setReplayMode: (mode) => {
    storeReplayMode(mode)
    set({ replayMode: mode })
  },

  replayProgress: null,
  setReplayProgress: (replayProgress) => set({ replayProgress }),

  replaying: false,
  setReplaying: (replaying) => set({ replaying }),

  selectedRunId: null,
  setSelectedRunId: (selectedRunId) => set({ selectedRunId }),

  planProgress: null,
  setPlanProgress: (planProgress) => set({ planProgress }),

  rightWidth: readRightWidth(),
  setRightWidth: (width) => {
    const next = Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, Math.round(width)))
    storeRightWidth(next)
    set({ rightWidth: next })
  },

  rightTab: 'steps',
  setRightTab: (rightTab) => set({ rightTab }),

  aiOpen: false,
  setAiOpen: (aiOpen) => set({ aiOpen }),
  aiSettingsOpen: false,
  setAiSettingsOpen: (aiSettingsOpen) => set({ aiSettingsOpen }),
  aiConfig: null,
  setAiConfig: (aiConfig) => set({ aiConfig }),

  aiSessionId: null,
  aiMessages: [],
  aiRunning: false,
  aiStartedAt: null,
  aiActiveTool: null,
  aiTarget: null,
  aiSeed: null,
  aiProposals: [],
  aiPlans: [],

  design: null,
  designLoading: false,
  designWorkbenchOpen: false,
  designView: 'scenarios',
  designFilter: {},
  designActiveScenarioId: null,
  designActiveDataRecordId: null,
  designSelected: [],
  designRowSelected: [],
  designUndo: [],
  designSaveState: 'idle',
  designCases: [],
  designRun: {},
  designRunning: false,

  debugState: null,
  debugBreakpoints: readDebugBreakpoints(),

  addAiUserMessage: (text) =>
    set((s) => ({
      aiMessages: [
        ...s.aiMessages,
        {
          id: newAiId('u'),
          role: 'user' as const,
          text,
          reasoning: '',
          tools: [],
          pending: false,
        },
      ],
      aiOpen: true,
      rightTab: 'ai' as const,
    })),

  addAiAssistantMessage: (text) =>
    set((s) => ({
      aiMessages: [
        ...s.aiMessages,
        {
          id: newAiId('a'),
          role: 'assistant' as const,
          text,
          reasoning: '',
          tools: [],
          pending: false,
        },
      ],
      aiOpen: true,
      rightTab: 'ai' as const,
    })),

  startAiMessage: (sessionId, messageId) =>
    set((s) => ({
      aiSessionId: sessionId,
      aiRunning: true,
      aiStartedAt: s.aiStartedAt ?? Date.now(),
      aiMessages: s.aiMessages.some((message) => message.id === messageId)
        ? s.aiMessages
        : [
            ...s.aiMessages,
            {
              id: messageId,
              role: 'assistant' as const,
              text: '',
              reasoning: '',
              tools: [],
              pending: true,
            },
          ],
    })),

  appendAiDelta: (messageId, kind, text) =>
    set((s) => ({
      aiMessages: s.aiMessages.map((message) =>
        message.id === messageId
          ? kind === 'text'
            ? { ...message, text: message.text + text }
            : { ...message, reasoning: message.reasoning + text }
          : message,
      ),
    })),

  startAiTool: (messageId, payload) =>
    set((s) => ({
      aiActiveTool: {
        callId: payload.callId,
        name: payload.name,
        label: payload.label,
        startedAt: Date.now(),
      },
      aiTarget: null,
      aiMessages: s.aiMessages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              tools: [
                ...message.tools,
                {
                  id: payload.callId,
                  name: payload.name,
                  label: payload.label,
                  input: payload.input,
                  status: 'running' as const,
                },
              ],
            }
          : message,
      ),
    })),

  endAiTool: (messageId, payload) =>
    set((s) => {
      const message = s.aiMessages.find((item) => item.id === messageId)
      const tool = message?.tools.find((item) => item.id === payload.callId)
      const label = tool?.label ?? payload.callId
      // AI 观察/导航到的页面立即成为舞台内容：
      // 启动台上发起的任务也能在中间看到 Agent 的操作
      const observedUrl =
        payload.status === 'ok' && payload.output && typeof payload.output === 'object'
          ? (payload.output as { url?: unknown }).url
          : undefined
      const stageUrl =
        typeof observedUrl === 'string' && /^(https?|file):/i.test(observedUrl)
          ? observedUrl
          : undefined
      return {
        ...(stageUrl ? { url: stageUrl } : {}),
        aiActiveTool: s.aiActiveTool?.callId === payload.callId ? null : s.aiActiveTool,
        aiTarget:
          payload.status === 'ok' && payload.target
            ? { target: payload.target, label }
            : s.aiTarget,
        aiMessages: s.aiMessages.map((item) =>
          item.id === messageId
            ? {
                ...item,
                tools: item.tools.map((call) =>
                  call.id === payload.callId
                    ? {
                        ...call,
                        status: payload.status,
                        durationMs: payload.durationMs,
                        ...(payload.output !== undefined ? { output: payload.output } : {}),
                        ...(payload.error ? { error: payload.error } : {}),
                        ...(payload.evidenceUrl ? { evidenceUrl: payload.evidenceUrl } : {}),
                        ...(payload.target ? { target: payload.target } : {}),
                      }
                    : call,
                ),
              }
            : item,
        ),
      }
    }),

  finishAiMessage: (messageId, cancelled) =>
    set((s) => ({
      aiRunning: false,
      aiStartedAt: null,
      aiActiveTool: null,
      aiSeed: null,
      aiMessages: s.aiMessages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              pending: false,
              ...(cancelled ? { cancelled: true } : {}),
            }
          : message,
      ),
    })),

  setAiRunning: (aiRunning) =>
    set((s) => ({
      aiRunning,
      aiStartedAt: aiRunning ? (s.aiStartedAt ?? Date.now()) : null,
      ...(aiRunning ? {} : { aiActiveTool: null }),
    })),

  failAiMessage: (messageId, error) =>
    set((s) => ({
      aiMessages: s.aiMessages.map((message) =>
        message.id === messageId ? { ...message, error } : message,
      ),
    })),

  addAiErrorMessage: (error) =>
    set((s) => ({
      aiRunning: false,
      aiStartedAt: null,
      aiActiveTool: null,
      aiMessages: [
        ...s.aiMessages,
        {
          id: newAiId('e'),
          role: 'assistant' as const,
          text: '',
          reasoning: '',
          tools: [],
          pending: false,
          error,
        },
      ],
    })),

  requestAi: (message, context) =>
    set({
      aiOpen: true,
      rightTab: 'ai',
      aiSeed: { id: newAiId('seed'), message, ...(context ? { context } : {}) },
    }),

  consumeAiSeed: (id) => set((s) => (s.aiSeed?.id === id ? { aiSeed: null } : {})),

  addAiProposal: (proposal) =>
    set((s) => ({
      aiProposals: [
        { ...proposal, status: 'pending' as const },
        ...s.aiProposals.filter((item) => item.proposalId !== proposal.proposalId),
      ].slice(0, 8),
    })),

  addAiPlan: (proposal) =>
    set((s) => ({
      aiPlans: [
        { ...proposal, status: 'pending' as const, stepResults: {} },
        ...s.aiPlans.filter((item) => item.proposalId !== proposal.proposalId),
      ].slice(0, 3),
      aiOpen: true,
      rightTab: 'ai' as const,
    })),

  patchAiPlan: (proposalId, patch) =>
    set((s) => ({
      aiPlans: s.aiPlans.map((item) =>
        item.proposalId === proposalId ? { ...item, ...patch } : item,
      ),
    })),

  updateAiPlanFile: (proposalId, file) =>
    set((s) => ({
      aiPlans: s.aiPlans.map((item) =>
        item.proposalId === proposalId ? { ...item, caseFile: file } : item,
      ),
    })),

  applyAiPlanProgress: (progress) =>
    set((s) => ({
      aiPlans: s.aiPlans.map((item) => {
        if (item.proposalId !== progress.proposalId) return item
        const previous = item.stepResults[progress.stepId]
        return {
          ...item,
          status: 'running' as const,
          runId: progress.runId,
          error: undefined,
          stepResults: {
            ...item.stepResults,
            [progress.stepId]: {
              status: progress.status,
              durationMs: previous?.durationMs ?? 0,
              ...(previous?.error ? { error: previous.error } : {}),
              ...(previous?.screenshotUrl ? { screenshotUrl: previous.screenshotUrl } : {}),
              ...(previous?.skipped !== undefined ? { skipped: previous.skipped } : {}),
            },
          },
        }
      }),
    })),

  applyAiPlanResult: (result) =>
    set((s) => ({
      aiPlans: s.aiPlans.map((item) => {
        if (item.proposalId !== result.proposalId) return item
        const stepResults: Record<string, AiPlanStepResult> = {}
        for (const step of result.steps) {
          stepResults[step.stepId] = {
            status: step.status,
            durationMs: step.durationMs,
            ...(step.error ? { error: step.error } : {}),
            ...(step.skipped !== undefined ? { skipped: step.skipped } : {}),
            ...(step.screenshotUrl ? { screenshotUrl: step.screenshotUrl } : {}),
          }
        }
        return {
          ...item,
          status: result.status,
          runId: result.runId,
          stepResults,
          error: result.error,
          verified: result.status === 'passed',
        }
      }),
    })),

  removeAiPlan: (proposalId) =>
    set((s) => ({
      aiPlans: s.aiPlans.filter((item) => item.proposalId !== proposalId),
    })),

  setDesign: (design) => {
    const selections = readySelections(design)
    const first = design.scenarios[0]
    set({
      design,
      designLoading: false,
      designView: 'scenarios',
      designFilter: {},
      designActiveScenarioId: first?.id ?? null,
      designActiveDataRecordId: first?.dataRecordIds[0] ?? null,
      designSelected: design.scenarios
        .filter((scenario) =>
          scenario.dataRecordIds.some((id) => design.dataRecords?.[id]?.status === 'ready'),
        )
        .map((scenario) => scenario.id),
      designRowSelected: selections.map((selection) =>
        designRowKey(selection.scenarioId, selection.dataRecordId),
      ),
      designUndo: [],
      designSaveState: 'idle',
      designCases: [],
      designRun: {},
      designRunning: false,
    })
  },

  setDesignLoading: (designLoading) => set({ designLoading }),

  setDesignWorkbenchOpen: (designWorkbenchOpen) => set({ designWorkbenchOpen }),

  setDesignView: (designView) => set({ designView }),

  setDesignFilter: (designFilter) => set({ designFilter }),

  setDesignActive: (designActiveScenarioId, designActiveDataRecordId = null) =>
    set({ designActiveScenarioId, designActiveDataRecordId }),

  toggleDesignScenario: (scenarioId) =>
    set((s) => {
      if (!s.design) return {}
      const scenario = s.design.scenarios.find((item) => item.id === scenarioId)
      if (!scenario || scenario.status === 'rejected' || scenario.status === 'excluded') return {}
      const readyKeys = scenario.dataRecordIds
        .filter((id) => s.design?.dataRecords?.[id]?.status === 'ready')
        .map((id) => designRowKey(scenarioId, id))
      const selected = s.designSelected.includes(scenarioId)
      const designSelected = selected
        ? s.designSelected.filter((id) => id !== scenarioId)
        : [...s.designSelected, scenarioId]
      const designRowSelected = selected
        ? s.designRowSelected.filter((key) => !readyKeys.includes(key))
        : [...new Set([...s.designRowSelected, ...readyKeys])]
      return { designSelected, designRowSelected }
    }),

  setDesignSelection: (selected) =>
    set((s) => {
      if (!s.design) return {}
      if (!selected) return { designSelected: [], designRowSelected: [] }
      const usable = s.design.scenarios.filter(
        (scenario) => scenario.status !== 'rejected' && scenario.status !== 'excluded',
      )
      return {
        designSelected: usable.map((scenario) => scenario.id),
        designRowSelected: readySelections(s.design).map((selection) =>
          designRowKey(selection.scenarioId, selection.dataRecordId),
        ),
      }
    }),

  toggleDesignRow: (scenarioId, dataRecordId) =>
    set((s) => {
      if (!s.design) return {}
      const record = s.design.dataRecords?.[dataRecordId]
      const scenario = s.design.scenarios.find((item) => item.id === scenarioId)
      if (
        !record ||
        !scenario ||
        record.status !== 'ready' ||
        scenario.status === 'rejected' ||
        scenario.status === 'excluded'
      ) {
        return {}
      }
      const key = designRowKey(scenarioId, dataRecordId)
      const selected = s.designRowSelected.includes(key)
      const designRowSelected = selected
        ? s.designRowSelected.filter((item) => item !== key)
        : [...s.designRowSelected, key]
      const readyKeys = scenario.dataRecordIds
        .filter((id) => s.design?.dataRecords?.[id]?.status === 'ready')
        .map((id) => designRowKey(scenarioId, id))
      const allSelected =
        readyKeys.length > 0 && readyKeys.every((item) => designRowSelected.includes(item))
      const designSelected = allSelected
        ? [...new Set([...s.designSelected, scenarioId])]
        : s.designSelected.filter((id) => id !== scenarioId)
      return { designRowSelected, designSelected }
    }),

  setDesignRowSelection: (scenarioId, selected) =>
    set((s) => {
      if (!s.design) return {}
      const scenario = s.design.scenarios.find((item) => item.id === scenarioId)
      if (!scenario || scenario.status === 'rejected' || scenario.status === 'excluded') return {}
      const keys = scenario.dataRecordIds
        .filter((id) => s.design?.dataRecords?.[id]?.status === 'ready')
        .map((id) => designRowKey(scenarioId, id))
      const designRowSelected = selected
        ? [...new Set([...s.designRowSelected, ...keys])]
        : s.designRowSelected.filter((key) => !keys.includes(key))
      const designSelected = selected
        ? [...new Set([...s.designSelected, scenarioId])]
        : s.designSelected.filter((id) => id !== scenarioId)
      return { designRowSelected, designSelected }
    }),

  applyDesignSelection: (scenarioIds, rowKeys) =>
    set((s) => {
      if (!s.design) return {}
      const usable = s.design.scenarios.filter(
        (scenario) => scenario.status !== 'rejected' && scenario.status !== 'excluded',
      )
      const validScenarioIds = new Set(usable.map((scenario) => scenario.id))
      const validKeys = new Set(
        usable.flatMap((scenario) =>
          scenario.dataRecordIds
            .filter((id) => s.design?.dataRecords?.[id]?.status === 'ready')
            .map((id) => designRowKey(scenario.id, id)),
        ),
      )
      return {
        designSelected: [...new Set(scenarioIds.filter((id) => validScenarioIds.has(id)))],
        designRowSelected: [...new Set(rowKeys.filter((key) => validKeys.has(key)))],
      }
    }),

  // 改数据后旧的用例草稿与结果作废；截断行的期望值同步跟随新数据
  setDesignDataValue: (scenarioId, dataRecordId, value) =>
    set((s) => {
      if (!s.design) return {}
      const scenario = s.design.scenarios.find((item) => item.id === scenarioId)
      const record = s.design.dataRecords?.[dataRecordId]
      if (!scenario || !record) return {}
      const field = s.design.fields.find((item) => item.ref === scenario.fieldRef)
      const maxConstraint = field?.constraints.find(
        (constraint) => constraint.kind === 'maxLength' && constraint.status !== 'rejected',
      )
      const max = typeof maxConstraint?.value === 'number' ? maxConstraint.value : undefined
      const expectedValue =
        record.expectedValue === undefined
          ? undefined
          : max !== undefined
            ? value.slice(0, max)
            : value
      const nextRecord: DesignDataRecord = {
        ...record,
        values: { ...record.values, [scenario.fieldRef]: value },
        source: 'manual',
        ...(expectedValue !== undefined ? { expectedValue } : {}),
      }
      const design = recomputeDesign(
        {
          ...s.design,
          dataRecords: { ...s.design.dataRecords, [dataRecordId]: nextRecord },
        },
        [scenarioId],
      )
      return {
        design,
        designCases: [],
        designRun: {},
        designRunning: false,
        designSaveState: 'idle',
      }
    }),

  setDesignDataExpectedValue: (scenarioId, dataRecordId, value) =>
    set((s) => {
      if (!s.design?.dataRecords?.[dataRecordId]) return {}
      const record = s.design.dataRecords[dataRecordId]
      const nextRecord: DesignDataRecord = {
        ...record,
        ...(value === undefined ? { expectedValue: undefined } : { expectedValue: value }),
        source: 'manual',
      }
      return {
        design: recomputeDesign(
          {
            ...s.design,
            dataRecords: { ...s.design.dataRecords, [dataRecordId]: nextRecord },
          },
          [scenarioId],
        ),
        designCases: [],
        designRun: {},
        designRunning: false,
        designSaveState: 'idle',
      }
    }),

  decideDesignScenario: (scenarioId, decision) =>
    set((s) => {
      if (!s.design) return {}
      const design = recomputeDesign({
        ...s.design,
        scenarios: s.design.scenarios.map((scenario) =>
          scenario.id === scenarioId ? { ...scenario, status: decision } : scenario,
        ),
      })
      return { design, designSaveState: 'idle' }
    }),

  applyDesignUpdate: (matrix) =>
    set((s) => {
      const scenarioIds = new Set(matrix.scenarios.map((scenario) => scenario.id))
      const keys = new Set(
        matrix.scenarios.flatMap((scenario) =>
          scenario.dataRecordIds.map((id) => designRowKey(scenario.id, id)),
        ),
      )
      const activeScenarioId =
        s.designActiveScenarioId && scenarioIds.has(s.designActiveScenarioId)
          ? s.designActiveScenarioId
          : (matrix.scenarios[0]?.id ?? null)
      const activeScenario = matrix.scenarios.find((scenario) => scenario.id === activeScenarioId)
      const activeDataRecordId =
        s.designActiveDataRecordId &&
        activeScenario?.dataRecordIds.includes(s.designActiveDataRecordId)
          ? s.designActiveDataRecordId
          : (activeScenario?.dataRecordIds[0] ?? null)
      return {
        design: matrix,
        designSelected: s.designSelected.filter((id) => scenarioIds.has(id)),
        designRowSelected: s.designRowSelected.filter((key) => keys.has(key)),
        designActiveScenarioId: activeScenarioId,
        designActiveDataRecordId: activeDataRecordId,
        designCases: [],
        designRun: {},
        designRunning: false,
        designSaveState: 'saved',
      }
    }),

  setDesignPersisted: (revision, sessionId) =>
    set((s) =>
      s.design
        ? {
            design: {
              ...s.design,
              revision,
              ...(sessionId ? { sessionId, id: s.design.id ?? sessionId } : {}),
            },
          }
        : {},
    ),

  markDesignSaved: (items) =>
    set((s) => {
      if (!s.design?.dataRecords) return {}
      const byRecord = new Map(items.map((item) => [item.dataRecordId, item]))
      const acceptedScenarioIds = new Set(items.map((item) => item.scenarioId))
      const dataRecords = { ...s.design.dataRecords }
      for (const [recordId, item] of byRecord) {
        const record = dataRecords[recordId]
        if (record) dataRecords[recordId] = { ...record, savedCaseId: item.caseId }
      }
      const design = recomputeDesign({
        ...s.design,
        dataRecords,
        scenarios: s.design.scenarios.map((scenario) =>
          acceptedScenarioIds.has(scenario.id) ? { ...scenario, status: 'accepted' } : scenario,
        ),
      })
      return { design, designSaveState: 'idle' }
    }),

  setDesignSaveState: (designSaveState) => set({ designSaveState }),

  pushDesignUndo: (label, matrix) =>
    set((s) => ({
      designUndo: [...s.designUndo.slice(-9), { label, matrix, at: Date.now() }],
    })),

  undoDesign: () =>
    set((s) => {
      const entry = s.designUndo.at(-1)
      if (!entry) return {}
      const revision = s.design?.revision ?? entry.matrix.revision
      return {
        design: { ...entry.matrix, revision },
        designUndo: s.designUndo.slice(0, -1),
        designCases: [],
        designRun: {},
        designRunning: false,
        designSaveState: 'idle',
      }
    }),

  setDesignCases: (designCases) => set({ designCases, designRun: {}, designRunning: false }),

  beginDesignRun: (selections) =>
    set({
      designRun: Object.fromEntries(
        selections.map((selection) => [
          designRowKey(selection.scenarioId, selection.dataRecordId),
          { status: 'running' as const },
        ]),
      ),
      designRunning: true,
    }),

  setDesignRunning: (designRunning) => set({ designRunning }),

  applyDesignResult: (result) =>
    set((s) => {
      const key = designRowKey(result.scenarioId, result.dataRecordId)
      const designRun = {
        ...s.designRun,
        [key]: {
          status: result.status,
          runId: result.runId,
          ...(result.error ? { error: result.error } : {}),
        },
      }
      const designRunning = Object.values(designRun).some((run) => run.status === 'running')
      if (!s.design) return { designRun, designRunning }
      const record = s.design.dataRecords?.[result.dataRecordId]
      const design = record
        ? recomputeDesign({
            ...s.design,
            dataRecords: {
              ...s.design.dataRecords,
              [result.dataRecordId]: {
                ...record,
                lastRun: {
                  runId: result.runId,
                  status: result.status,
                  at: new Date().toISOString(),
                },
              },
            },
          })
        : s.design
      return { designRun, designRunning, design, designSaveState: 'idle' }
    }),

  resetDesign: () =>
    set({
      design: null,
      designLoading: false,
      designWorkbenchOpen: false,
      designView: 'scenarios',
      designFilter: {},
      designActiveScenarioId: null,
      designActiveDataRecordId: null,
      designSelected: [],
      designRowSelected: [],
      designUndo: [],
      designSaveState: 'idle',
      designCases: [],
      designRun: {},
      designRunning: false,
    }),

  setDebugState: (debugState) =>
    set((s) => {
      if (debugState?.breakpoints) {
        const next = { ...s.debugBreakpoints, [debugState.caseId]: debugState.breakpoints }
        storeDebugBreakpoints(next)
        return { debugState, debugBreakpoints: next }
      }
      return { debugState }
    }),

  toggleDebugBreakpoint: (caseId, stepId) =>
    set((s) => {
      const current = s.debugBreakpoints[caseId] ?? []
      const nextIds = current.includes(stepId)
        ? current.filter((id) => id !== stepId)
        : [...current, stepId]
      const next = { ...s.debugBreakpoints, [caseId]: nextIds }
      storeDebugBreakpoints(next)
      return { debugBreakpoints: next }
    }),

  setDebugBreakpoints: (caseId, stepIds) =>
    set((s) => {
      const next = { ...s.debugBreakpoints, [caseId]: stepIds }
      storeDebugBreakpoints(next)
      return { debugBreakpoints: next }
    }),

  patchAiProposal: (proposalId, patch) =>
    set((s) => ({
      aiProposals: s.aiProposals.map((item) =>
        item.proposalId === proposalId ? { ...item, ...patch } : item,
      ),
    })),

  removeAiProposal: (proposalId) =>
    set((s) => ({
      aiProposals: s.aiProposals.filter((item) => item.proposalId !== proposalId),
    })),

  replaceAiSession: (sessionId, messages) =>
    set({
      aiSessionId: sessionId,
      aiMessages: messages.map(storedToAiMessage),
      aiRunning: false,
      aiStartedAt: null,
      aiActiveTool: null,
      aiTarget: null,
      aiSeed: null,
      aiProposals: [],
      aiPlans: [],
    }),

  resetAi: () =>
    set({
      aiSessionId: null,
      aiMessages: [],
      aiRunning: false,
      aiStartedAt: null,
      aiActiveTool: null,
      aiTarget: null,
      aiSeed: null,
      aiProposals: [],
      aiPlans: [],
    }),
}))
