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
  // 元素库
  elementList: 'element:list',
  elementUpsert: 'element:upsert',
  elementDelete: 'element:delete',
  // 受控浏览器与录制
  browserNavigate: 'browser:navigate',
  viewBoundsSet: 'view:bounds-set',
  recordingStart: 'recording:start',
  recordingStop: 'recording:stop',
  recordingAssertArm: 'recording:assert-arm',
  // 回放与执行记录
  replayStart: 'replay:start',
  runList: 'run:list',
  runGet: 'run:get',
} as const

/** 推送类 channel：main → renderer（webContents.send） */
export const IpcEvent = {
  recordingStatus: 'event:recording-status',
  recordingStep: 'event:recording-step',
  replayProgress: 'event:replay-progress',
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]
export type IpcEventName = (typeof IpcEvent)[keyof typeof IpcEvent]
