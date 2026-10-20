/** 请求类 channel：renderer → main（invoke） */
export const IpcChannel = {
  // 项目 / 模块树 / 用例
  projectList: 'project:list',
  projectCreate: 'project:create',
  projectDelete: 'project:delete',
  moduleList: 'module:list',
  moduleCreate: 'module:create',
  moduleRename: 'module:rename',
  moduleDelete: 'module:delete',
  caseList: 'case:list',
  caseGet: 'case:get',
  caseCreate: 'case:create',
  caseUpdate: 'case:update',
  caseDelete: 'case:delete',
  caseExportTs: 'case:export-ts',
  caseExportTsFile: 'case:export-ts-file',
  // 元素库
  elementList: 'element:list',
  elementUpsert: 'element:upsert',
  elementDelete: 'element:delete',
  // 套件与测试计划
  suiteList: 'suite:list',
  suiteGet: 'suite:get',
  suiteCreate: 'suite:create',
  suiteUpdate: 'suite:update',
  suiteDelete: 'suite:delete',
  planList: 'plan:list',
  planGet: 'plan:get',
  planCreate: 'plan:create',
  planUpdate: 'plan:update',
  planDelete: 'plan:delete',
  planRunStart: 'plan:run-start',
  planRunStop: 'plan:run-stop',
  planRunList: 'plan:run-list',
  planRunGet: 'plan:run-get',
  // 受控浏览器与录制
  browserNavigate: 'browser:navigate',
  browserFocus: 'browser:focus',
  viewBoundsSet: 'view:bounds-set',
  viewEmulate: 'view:emulate',
  recordingStart: 'recording:start',
  recordingStop: 'recording:stop',
  recordingAssertArm: 'recording:assert-arm',
  // 回放与执行记录
  replayStart: 'replay:start',
  replayStop: 'replay:stop',
  runList: 'run:list',
  runGet: 'run:get',
  // AI（AI）
  aiSend: 'ai:send',
  aiCancel: 'ai:cancel',
  aiConfig: 'ai:config',
  aiSaveConfig: 'ai:saveConfig',
  aiTest: 'ai:test',
  aiModels: 'ai:models',
  /** 执行 AI 计划卡草稿（不写 runs 表） */
  aiPlanRun: 'ai:plan-run',
  aiPlanStop: 'ai:plan-stop',
  /** AI 历史会话 */
  aiSessionList: 'ai:session-list',
  aiSessionGet: 'ai:session-get',
  aiSessionDelete: 'ai:session-delete',
  // 测试设计（测试规范矩阵）
  designAnalyze: 'design:analyze',
  designGenerate: 'design:generate',
  designRun: 'design:run',
  designStop: 'design:stop',
  /** 保存矩阵编辑（数据行、审阅状态、执行结果） */
  designUpdate: 'design:update',
  /** 最近一次设计会话（矩阵快照） */
  designLatest: 'design:latest',
  // 单步调试
  debugStart: 'debug:start',
  debugCommand: 'debug:command',
  debugState: 'debug:state',
  // 操作库
  skillList: 'skill:list',
} as const

/** 推送类 channel：main → renderer（webContents.send） */
export const IpcEvent = {
  recordingStatus: 'event:recording-status',
  recordingStep: 'event:recording-step',
  replayProgress: 'event:replay-progress',
  planProgress: 'event:plan-progress',
  aiStart: 'event:ai-start',
  aiDelta: 'event:ai-delta',
  aiToolStart: 'event:ai-tool-start',
  aiToolEnd: 'event:ai-tool-end',
  aiDone: 'event:ai-done',
  aiError: 'event:ai-error',
  aiRecordingDraft: 'event:ai-recording-draft',
  aiCaseProposal: 'event:ai-case-proposal',
  aiState: 'event:ai-state',
  /** AI 计划卡：生成 / 执行进度 / 执行结果 */
  aiPlanProposal: 'event:ai-plan-proposal',
  aiPlanProgress: 'event:ai-plan-progress',
  aiPlanResult: 'event:ai-plan-result',
  /** 测试设计：单条场景的执行结果 */
  designResult: 'event:design-result',
  /** 测试设计：AI 直接修改矩阵后推送最新快照 */
  designUpdated: 'event:design-updated',
  /** 测试设计：AI 操作工作台的选择/筛选/视图 */
  designCommand: 'event:design-command',
  /** 单步调试状态（暂停 / 运行 / 结束） */
  debugState: 'event:debug-state',
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]
export type IpcEventName = (typeof IpcEvent)[keyof typeof IpcEvent]
