#!/usr/bin/env node
/**
 * 测试计划 E2E：创建 3 条用例 → 套件 → 计划（重试 1 次）→ 批量执行 → 重跑失败 → 报告按计划筛选。
 *
 * 前置：应用以 --remote-debugging-port 启动。
 * 运行：node scripts/e2e-plan.mjs
 */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const CDP = process.env.ATP_E2E_CDP ?? 'http://localhost:9222'
const DB =
  process.env.ATP_E2E_DB ?? `${process.env.HOME}/Library/Application Support/@atp/desktop/atp.db`
const fixture = pathToFileURL(
  resolve(import.meta.dirname, '../packages/runner/fixtures/login-form/index.html'),
).href
const stamp = Date.now().toString(36)
const projectName = `计划E2E-${stamp}`
const suiteName = `登录套件-${stamp}`
const planName = `登录计划-${stamp}`

const browser = await chromium.connectOverCDP(CDP)
const ui = browser
  .contexts()[0]
  .pages()
  .find((p) => p.url().includes('renderer/index.html'))
if (!ui) throw new Error('找不到主窗口')
await ui.bringToFront()
const invoke = (channel, payload) =>
  ui.evaluate(([c, p]) => window.atp.invoke(c, p), [channel, payload])

const project = await invoke('project:create', { name: projectName })
const elements = {
  'el-u': { id: 'el-u', name: '用户名', locators: [{ type: 'testId', value: 'username-input' }] },
  'el-p': { id: 'el-p', name: '密码', locators: [{ type: 'testId', value: 'password-input' }] },
  'el-s': { id: 'el-s', name: '登录按钮', locators: [{ type: 'testId', value: 'login-submit' }] },
}
const passSteps = [
  { id: 's1', action: 'fill', elementId: 'el-u', params: { value: 'admin' } },
  { id: 's2', action: 'fill', elementId: 'el-p', params: { value: 'admin123' } },
  { id: 's3', action: 'click', elementId: 'el-s' },
  {
    id: 's4',
    action: 'assert',
    assertion: { type: 'pageText', match: 'contains', expected: '登录成功' },
  },
]
const failSteps = [
  { id: 's1', action: 'fill', elementId: 'el-u', params: { value: 'admin' } },
  { id: 's2', action: 'click', elementId: 'el-s' },
  {
    id: 's3',
    action: 'assert',
    assertion: { type: 'pageText', match: 'contains', expected: '登录成功' },
  },
]
async function createCase(name, steps) {
  const created = await invoke('case:create', { projectId: project.id, name, startUrl: fixture })
  return invoke('case:update', {
    case: { ...created.case, name, startUrl: fixture, variables: {}, steps },
    elements,
  })
}
const passA = await createCase('A-登录成功', passSteps)
const failB = await createCase('B-登录失败', failSteps)
await createCase('C-登录成功2', passSteps)
console.log('[plan] 用例已创建:', [passA, failB].map((c) => c.case.name).join(', '))

await ui.reload()
await ui.waitForTimeout(1200)
await ui.locator('header button[aria-haspopup="true"]').first().click()
await ui.getByRole('menuitem', { name: projectName }).click()
await ui.waitForTimeout(800)
await ui.getByRole('button', { name: '测试计划' }).click()
await ui.waitForTimeout(500)

// 套件
await ui.getByRole('button', { name: '新建测试资产' }).click()
await ui.getByRole('menuitem', { name: '新建套件' }).click()
await ui.getByPlaceholder('例如：登录回归').fill(suiteName)
await ui.getByText('全选', { exact: true }).click()
await ui.getByRole('button', { name: '创建套件' }).click()
await ui.getByText(suiteName).first().waitFor({ timeout: 10000 })
const suite = (await invoke('suite:list', { projectId: project.id })).find(
  (s) => s.name === suiteName,
)
if (!suite || suite.caseCount !== 3) throw new Error('套件未正确落库')
console.log('[plan] 套件 ✓', suiteName)

// 计划
await ui.getByRole('button', { name: '新建测试资产' }).click()
await ui.getByRole('menuitem', { name: '新建测试计划' }).click()
await ui.getByPlaceholder('例如：P0 登录回归').fill(planName)
await ui.getByLabel('从套件导入（可选）').selectOption(suite.id)
await ui.waitForTimeout(500)
await ui.getByLabel('失败重试').selectOption('1')
await ui.getByRole('button', { name: '创建计划' }).click()
await ui.getByText(planName).first().waitFor({ timeout: 10000 })
const plan = (await invoke('plan:list', { projectId: project.id })).find((p) => p.name === planName)
if (!plan || plan.caseCount !== 3) throw new Error('计划未正确落库')
console.log('[plan] 计划 ✓', planName)

// 执行
await ui.getByRole('button', { name: '执行计划' }).click()
await ui.getByRole('button', { name: '停止' }).waitFor({ timeout: 10000 })
await ui.getByRole('button', { name: '执行计划' }).waitFor({ timeout: 180000 })
await ui.waitForTimeout(1000)
const planRuns = await invoke('plan:run-list', { planId: plan.id })
const planRun = planRuns[0]
if (!planRun) throw new Error('计划执行记录未落库')
if (planRun.status !== 'failed' || planRun.passed !== 2 || planRun.failed !== 1) {
  throw new Error(
    `计划结果应为 failed 2/1，实际 ${planRun.status} ${planRun.passed}/${planRun.failed}`,
  )
}
const detail = await invoke('plan:run-get', { planRunId: planRun.id })
const failedRuns = detail.runs.filter((r) => r.run.caseId === failB.case.id)
if (failedRuns.length !== 2) throw new Error(`失败用例应重试 2 次，实际 ${failedRuns.length}`)
const db = new DatabaseSync(DB)
const snap = db
  .prepare('SELECT case_snapshot FROM runs WHERE plan_run_id = ? LIMIT 1')
  .get(planRun.id)
if (!snap?.case_snapshot) throw new Error('运行记录缺少用例快照')
console.log(
  `[plan] 执行结果 ✓ total=${planRun.total} passed=${planRun.passed} failed=${planRun.failed} 失败用例尝试=${failedRuns.length}`,
)

// 重跑失败用例：只重跑 B，且沿用计划的重试策略
const rerunButton = ui.getByRole('button', { name: /重跑本次失败用例/ })
await rerunButton.waitFor({ timeout: 30000 })
if (!(await rerunButton.textContent())?.includes('1')) {
  throw new Error('重跑按钮应只包含 1 条失败用例')
}
await rerunButton.click()
await ui.getByRole('button', { name: '停止' }).waitFor({ timeout: 10000 })
await ui.getByRole('button', { name: '执行计划' }).waitFor({ timeout: 180000 })
await ui.waitForTimeout(1000)

const planRunsAfter = await invoke('plan:run-list', { planId: plan.id })
if (planRunsAfter.length !== 2) {
  throw new Error(`重跑应新增一条计划执行记录，实际 ${planRunsAfter.length} 条`)
}
const rerun = planRunsAfter[0]
if (rerun.id === planRun.id || rerun.total !== 1 || rerun.failed !== 1 || rerun.passed !== 0) {
  throw new Error(
    `重跑结果应为 total=1 failed=1，实际 ${rerun.total}/${rerun.failed}/${rerun.passed}`,
  )
}
const rerunDetail = await invoke('plan:run-get', { planRunId: rerun.id })
if (rerunDetail.runs.some((r) => r.run.caseId !== failB.case.id)) {
  throw new Error('重跑记录不应包含 B 以外的用例')
}
if (rerunDetail.runs.length !== 2) {
  throw new Error(`重跑应沿用重试策略（2 次尝试），实际 ${rerunDetail.runs.length}`)
}
console.log(
  `[plan] 重跑失败 ✓ planRun=${rerun.id} total=${rerun.total} 尝试=${rerunDetail.runs.length}`,
)

// 报告按计划筛选：run:list 只返回该计划产生的执行记录（含重试）
const planScoped = await invoke('run:list', { planId: plan.id })
const planRunIds = new Set(planRunsAfter.map((r) => r.id))
if (planScoped.length !== 6 || planScoped.some((r) => !planRunIds.has(r.planRunId))) {
  throw new Error(`按计划筛选应返回 6 条计划执行记录，实际 ${planScoped.length}`)
}
const passScoped = await invoke('run:list', { planId: plan.id, caseId: passA.case.id })
if (passScoped.length !== 1) {
  throw new Error(`计划 + 用例筛选应返回 1 条，实际 ${passScoped.length}`)
}

// 报告页的计划筛选入口可用
await ui.getByRole('button', { name: '用例', exact: true }).click()
await ui.waitForTimeout(500)
await ui.getByText('A-登录成功').first().click()
await ui.waitForTimeout(500)
await ui.getByRole('tab', { name: /报告/ }).click()
const planFilter = ui.getByLabel('按计划筛选执行记录')
await planFilter.selectOption(plan.id)
await planFilter.waitFor({ timeout: 10000 })
if (!(await ui.getByText('执行记录').first().isVisible())) {
  throw new Error('报告页未渲染')
}
console.log(`[plan] 报告筛选 ✓ 计划内执行记录=${planScoped.length}`)

await browser.close()
console.log('[plan] 通过 ✅')
