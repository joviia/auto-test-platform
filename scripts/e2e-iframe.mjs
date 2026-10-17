#!/usr/bin/env node
/**
 * iframe 录制回放 E2E：父页 + 子 frame 操作 → 保存 → 嵌入回放 → 验证据。
 *
 * 前置：应用以 --remote-debugging-port 启动。
 * 运行：node scripts/e2e-iframe.mjs
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
  resolve(import.meta.dirname, '../packages/runner/fixtures/iframe-form/parent.html'),
).href
const stamp = Date.now().toString(36)
const projectName = `iframeE2E-${stamp}`
const caseName = `iframe回放-${stamp}`

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
await ui.reload()
await ui.waitForTimeout(1200)
await ui.locator('header button[aria-haspopup="true"]').first().click()
await ui.getByRole('menuitem', { name: projectName }).click()
await ui.waitForTimeout(800)

// 打开 iframe fixture
await ui.getByPlaceholder(/输入被测页面地址/).fill(fixture)
await ui.getByText('打开', { exact: true }).click()
let target
for (let i = 0; i < 40; i++) {
  const list = await (await fetch(`${CDP}/json/list`)).json()
  target = list.find((t) => t.type === 'page' && t.url.includes('iframe-form/parent.html'))
  if (target) break
  await ui.waitForTimeout(500)
}
if (!target) throw new Error('iframe fixture 未打开')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result)
    pending.delete(m.id)
  }
})
const call = (method, params) =>
  new Promise((res) => {
    const id = ++seq
    pending.set(id, res)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) =>
  (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value
for (let i = 0; i < 40; i++) {
  const ready = await evaluate(
    `!!document.querySelector('#child') && !!document.querySelector('#child').contentDocument?.querySelector('#child-btn')`,
  )
  if (ready) break
  await ui.waitForTimeout(500)
}

await ui.bringToFront()
await ui.getByText('开始录制').click()
await ui.waitForTimeout(600)
await evaluate(`document.querySelector('#parent-btn').click()`)
await evaluate(`(() => {
  const d = document.querySelector('#child').contentDocument
  const input = d.querySelector('#child-input')
  input.value = 'iframe-text'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  d.querySelector('#child-btn').click()
  return true
})()`)
await ui.waitForTimeout(500)
await ui.bringToFront()
await ui.getByRole('button', { name: '停止录制' }).click()
await ui.waitForTimeout(800)
await ui.getByPlaceholder('例如：登录成功').fill(caseName)
await ui.getByText('保存用例').click()
await ui.waitForTimeout(1200)

const cases = await invoke('case:list', { projectId: project.id })
const saved = cases.find((c) => c.name === caseName)
if (!saved) throw new Error('iframe 用例未落库')
const file = await invoke('case:get', { id: saved.id })
const frameElements = Object.values(file.elements).filter((e) => e.framePath?.length)
if (file.case.steps.length !== 3) throw new Error(`步骤数应为 3，实际 ${file.case.steps.length}`)
if (frameElements.length === 0) throw new Error('iframe 元素缺少 framePath')
console.log(
  `[iframe] 录制 ✓ 步骤=${file.case.steps.length} framePath=${JSON.stringify(frameElements[0].framePath)}`,
)

await ui.getByText(caseName).first().click()
await ui.getByLabel('回放方式').selectOption('embedded')
await ui.getByText('回放用例').click()
await ui.getByText('回放中…').waitFor({ timeout: 10000 })
await ui.getByText('回放用例').waitFor({ timeout: 120000 })
const runs = await invoke('run:list', { caseId: saved.id })
const detail = await invoke('run:get', { runId: runs[0].id })
if (detail.run.status !== 'passed') {
  throw new Error(
    `iframe 回放失败：${detail.run.error ?? ''} ${detail.steps.map((s) => `${s.action}:${s.status}`).join(',')}`,
  )
}
console.log('[iframe] 回放 ✓', detail.steps.map((s) => `${s.action}:${s.status}`).join(','))
ws.close()
await browser.close()
console.log('[iframe] 通过 ✅')
