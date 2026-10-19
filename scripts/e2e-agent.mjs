#!/usr/bin/env node
/**
 * Agent E2E：CLI 启动 → 真实 Chrome 录制 → 保存 → 回放 → 报告证据。
 * 全程操作从 Electron 迁移过来的 React UI（不再使用最小页面）。
 *
 * 前置：pnpm --filter @atp/web build && pnpm --filter @atp/agent build
 * 运行：node scripts/e2e-agent.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const cli = resolve(import.meta.dirname, '../apps/agent/dist/cli.js')
const dataDir = await mkdtemp(join(tmpdir(), 'atp-agent-e2e-'))

function startAgent() {
  const child = spawn(
    process.execPath,
    [cli, '--demo', '--no-open', '--headless', '--port', '0', '--data-dir', dataDir],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  const ready = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`Agent 启动超时：\n${output}`)), 60_000)
    const onData = (chunk) => {
      output += chunk.toString()
      if (output.includes('就绪')) {
        clearTimeout(timer)
        resolveReady(output)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Agent 提前退出（code=${code}）：\n${output}`))
    })
  })
  return { child, ready }
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolveStop()
    }, 5000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveStop()
    })
  })
}

async function invoke(origin, channel, payload) {
  const res = await fetch(`${origin}/api/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel, payload }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`${channel}: ${data.error}`)
  return data.result
}

const { child, ready } = startAgent()
let browser
try {
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
  const output = (await ready).replace(ansi, '')
  const uiUrl = /UI: (\S+)/.exec(output)?.[1]
  if (!uiUrl) throw new Error('没有从 Agent 输出中找到 UI 地址')
  const origin = new URL(uiUrl).origin
  console.log(`[agent] UI ${uiUrl}`)

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  await page.goto(uiUrl)
  await page.waitForSelector('#root', { timeout: 20_000 })
  await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0)

  // 打开演示页
  const urlInput = page.getByPlaceholder('输入被测页面地址')
  await urlInput.fill(`${origin}/demo`)
  await urlInput.press('Enter')
  await page.getByPlaceholder(/输入被测页面地址，回车打开/).waitFor({ state: 'visible' })
  await page.waitForTimeout(300)

  // 实时镜像：真实 Chrome 画面通过 MJPEG 显示在中栏
  await page.waitForFunction(
    () => {
      const img = document.querySelector('img[alt="Chrome 实时画面"]')
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0
    },
    null,
    { timeout: 20_000 },
  )
  console.log('[agent] 实时镜像 ✓')

  // 录制：UI 负责开关，演示操作由内置脚本完成（真实 Chrome 里执行）
  await page.getByRole('button', { name: '开始录制' }).click()
  await page.waitForTimeout(300)
  const demo = await fetch(`${origin}/api/demo`, {
    method: 'POST',
    headers: {},
  })
  if (!demo.ok) throw new Error(`演示操作失败：HTTP ${demo.status}`)

  await page.waitForFunction(
    () => (document.body.innerText.match(/\n4 步\n/) ?? []).length > 0,
    null,
    { timeout: 20_000 },
  )
  console.log('[agent] 录制 4 步 ✓')

  // 停止 → 保存
  await page.getByRole('button', { name: '停止录制' }).click()
  await page.waitForSelector('#atp-case-name', { timeout: 10_000 })
  await page.locator('#atp-case-name').fill('Agent E2E 用例')
  await page.getByRole('button', { name: '保存用例' }).click()
  await page.waitForFunction(
    () =>
      document.body.innerText.includes('Agent E2E 用例') &&
      document.body.innerText.includes('1 条用例'),
    null,
    { timeout: 10_000 },
  )
  const cases = await invoke(origin, 'case:list', {
    projectId: (await invoke(origin, 'project:list'))[0].id,
  })
  if (cases.length !== 1) throw new Error(`期望保存 1 条用例，实际 ${cases.length} 条`)
  const caseFile = await invoke(origin, 'case:get', { id: cases[0].id })
  if (caseFile.case.steps.length !== 4) {
    throw new Error(`期望 4 个步骤，实际 ${caseFile.case.steps.length} 个`)
  }
  console.log('[agent] 保存 ✓（4 个步骤）')

  // 选中并检查意图层
  await page.getByText('Agent E2E 用例', { exact: true }).last().click()
  await page.getByLabel('用例意图摘要').waitFor({ state: 'visible' })
  const intent = await page.getByLabel('用例意图摘要').inputValue()
  for (const verb of ['填写', '选择', '开启', '点击']) {
    if (!intent.includes(verb)) throw new Error(`意图摘要缺少「${verb}」：${intent}`)
  }
  const caseText = await page.locator('body').innerText()
  if (!caseText.includes('内容名称') || !caseText.includes('显示标题')) {
    throw new Error('意图视图未显示字段名')
  }
  console.log(`[agent] 意图视图 ✓ ${intent}`)
  await page.getByRole('button', { name: '回放用例' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '回放用例' }).click()
  let run = null
  for (let i = 0; i < 60; i++) {
    const runs = await invoke(origin, 'run:list', { caseId: cases[0].id })
    if (runs.length > 0) {
      run = runs[0]
      break
    }
    await page.waitForTimeout(500)
  }
  if (!run) throw new Error('回放未产生执行记录')
  if (run.status !== 'passed') throw new Error(`回放失败：${run.status}`)
  const detail = await invoke(origin, 'run:get', { runId: run.id })
  if (detail.steps.length !== 4) throw new Error(`期望 4 步结果，实际 ${detail.steps.length} 步`)
  console.log('[agent] 回放 ✓ 4 步通过')

  // 报告页证据图片
  await page.locator('[role=tab]').filter({ hasText: '报告' }).click()
  const runButton = page
    .locator('button')
    .filter({ hasText: 'Agent E2E 用例' })
    .filter({ hasText: '通过' })
  await runButton.first().click()
  await page.waitForTimeout(500)
  const images = await page
    .locator('img[src^="/evidence/"]')
    .evaluateAll((els) =>
      els.map((el) => ({ src: el.getAttribute('src'), width: el.naturalWidth })),
    )
  if (images.length !== 4) throw new Error(`期望 4 张步骤截图，实际 ${images.length} 张`)
  if (images.some((img) => img.width === 0)) throw new Error('存在未成功加载的步骤截图')
  if (errors.length > 0) throw new Error(`页面错误：${errors.join(' / ')}`)
  console.log('[agent] 报告 ✓ 4 张截图可加载')
  console.log('[agent] 通过 ✅')
} finally {
  await browser?.close().catch(() => {})
  await stop(child)
  await rm(dataDir, { recursive: true, force: true })
}
