#!/usr/bin/env node
import { createRequire } from 'node:module'
/**
 * 录制闭环 E2E：驱动我们自己的 Electron UI 走完「建项目 → 打开被测页 →
 * 录制 → 停止 → 保存用例」，然后直查 SQLite 验证落库。
 *
 * 主窗口用 Playwright over CDP 驱动；受控浏览器视图（WebContentsView）
 * 不被 Playwright 的 pages() 收录，用原生 CDP WebSocket 直驱。
 *
 * 前置：构建产物 electron 以 --remote-debugging-port=9222 启动。
 * 运行：node scripts/e2e-recording.mjs
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const CDP_HTTP = 'http://localhost:9222'
const fixture = pathToFileURL(
  resolve(import.meta.dirname, '../packages/runner/fixtures/login-form/index.html'),
).href
const DB =
  process.env.ATP_E2E_DB ?? '/Users/zhouwei/Library/Application Support/@atp/desktop/atp.db'
const CASE_NAME = `冒烟-登录成功-${Date.now().toString(36)}`

const browser = await chromium.connectOverCDP(CDP_HTTP)
const context = browser.contexts()[0]

async function findPage(match, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const page = context.pages().find(match)
    if (page) return page
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('找不到目标页面')
}

/** 受控视图的 CDP 直连（轮询 /json/list 直到目标 URL 出现） */
async function findViewTarget(urlPart, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${CDP_HTTP}/json/list`)
    const targets = (await res.json()).filter((t) => t.type === 'page' && t.url.includes(urlPart))
    if (targets[0]) return targets[0]
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`找不到受控视图 target：${urlPart}`)
}

function cdpCall(wsUrl, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const id = 1
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method, params }))
    })
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id) {
        ws.close()
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    })
    ws.addEventListener('error', () => reject(new Error('ws error')))
  })
}

async function evaluateOn(wsUrl, expression) {
  const result = await cdpCall(wsUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(
      `页面脚本异常: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)}`,
    )
  }
  return result.result?.value
}

// 1. 主窗口
const ui = await findPage(
  (p) => p.url().includes('localhost:51') || p.url().includes('renderer/index.html'),
)
await ui.bringToFront()
console.log('[e2e] 主窗口就绪')

// 2. 新建项目
await ui.getByRole('button', { name: '项目' }).click()
await ui.getByPlaceholder('名称').fill('冒烟项目')
await ui.getByText('创建', { exact: true }).click()
await ui.getByText('冒烟项目').first().waitFor({ timeout: 5000 })
console.log('[e2e] 项目已创建')

// 3. 打开被测页（主窗口点「打开」，受控视图 target 用 /json/list 轮询确认）
await ui.getByPlaceholder(/输入被测页面地址/).fill(fixture)
await ui.getByText('打开', { exact: true }).click()
const viewTarget = await findViewTarget('fixtures/login-form')
console.log('[e2e] 受控浏览器已打开:', viewTarget.title)

// 4. 开始录制
await ui.bringToFront()
await ui.getByText('开始录制').click()
console.log('[e2e] 录制中…')

// 5. 在受控浏览器里操作登录流程（页面内合成事件，采集器同样捕获）
const ws = viewTarget.webSocketDebuggerUrl

// 等页面真正加载完（target 出现 ≠ 文档就绪）
let ready = false
for (let i = 0; i < 20; i++) {
  ready = await evaluateOn(
    ws,
    `document.readyState === 'complete' && !!document.querySelector('#username')`,
  )
  if (ready) break
  await new Promise((r) => setTimeout(r, 500))
}
if (!ready) throw new Error('受控页面 10s 内未就绪')

await evaluateOn(
  ws,
  `(() => { const el = document.querySelector('#username'); el.focus(); el.value = 'admin'; el.dispatchEvent(new Event('input', { bubbles: true })); return el.value })()`,
)
await evaluateOn(
  ws,
  `(() => { const el = document.querySelector('#password'); el.focus(); el.value = 'admin123'; el.dispatchEvent(new Event('input', { bubbles: true })); return el.value })()`,
)
const msg = await evaluateOn(
  ws,
  `(() => { document.querySelector('#login-submit').click(); return document.querySelector('#message').textContent })()`,
)
if (msg !== '登录成功') throw new Error(`登录页未显示成功：${msg}`)
console.log('[e2e] 登录流程已执行 ✓')

// 6. 停止录制并保存
await ui.bringToFront()
await ui.getByText('停止录制').click()
await ui.getByPlaceholder('用例名称').fill(CASE_NAME)
await ui.getByText('保存用例').click()
console.log('[e2e] 已保存:', CASE_NAME)

// 7. 数据库验证（权威判据）
const db = new DatabaseSync(DB)
const caseRow = db.prepare('SELECT id, name, start_url FROM cases WHERE name = ?').get(CASE_NAME)
if (!caseRow) throw new Error('用例未落库！')
const stepCount = db
  .prepare('SELECT COUNT(*) AS n FROM case_steps WHERE case_id = ?')
  .get(caseRow.id).n
const elementCount = db.prepare('SELECT COUNT(*) AS n FROM elements').get().n
console.log(`[e2e] 落库 ✓ 用例=${caseRow.id} 步骤=${stepCount} 元素库=${elementCount}`)
if (stepCount !== 3) throw new Error(`步骤数应为 3（fill/fill/click），实际 ${stepCount}`)

// 8. UI 验证：左树出现该用例
await ui.getByText(CASE_NAME).first().waitFor({ timeout: 10000 })
console.log('[e2e] 左树可见用例 ✓')

// 9. 回放：点「回放选中用例」，等执行完成，验证执行记录与证据文件
await ui.getByText('回放选中用例').click()
console.log('[e2e] 回放中…')
await ui.getByText('回放中…').waitFor({ timeout: 10000 })
await ui.getByText('回放选中用例').waitFor({ timeout: 120000 })
const runRow = db.prepare('SELECT id, status, video_path FROM runs WHERE case_id = ? ORDER BY started_at DESC').get(caseRow.id)
if (!runRow) throw new Error('执行记录未落库！')
const runStepCount = db.prepare('SELECT COUNT(*) AS n FROM run_steps WHERE run_id = ?').get(runRow.id).n
console.log(`[e2e] 回放落库 ✓ run=${runRow.id} status=${runRow.status} 步骤=${runStepCount}`)
if (runStepCount !== 3) throw new Error(`回放步骤数应为 3，实际 ${runStepCount}`)
const { statSync } = await import('node:fs')
if (!runRow.video_path || !statSync(runRow.video_path).size) throw new Error('回放视频缺失')
console.log('[e2e] 回放视频 ✓', runRow.video_path.split('/').slice(-2).join('/'))

await browser.close()
console.log('[e2e] 通过 ✅')
