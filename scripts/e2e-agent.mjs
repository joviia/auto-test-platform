#!/usr/bin/env node
/**
 * Agent E2E：CLI 启动 → 真实 Chrome 录制 → 保存 → 回放 → 报告证据。
 * 全程操作从 Electron 迁移过来的 React UI（不再使用最小页面）。
 *
 * 前置：pnpm --filter @atp/web build && pnpm --filter @atp/agent build
 * 运行：node scripts/e2e-agent.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const cli = resolve(import.meta.dirname, '../apps/agent/dist/cli.js')
const dataDir = await mkdtemp(join(tmpdir(), 'atp-agent-e2e-'))

function startAgent() {
  // 清掉开发机上可能存在的真实密钥，保证 Copilot 从演示模式开始
  const env = { ...process.env }
  for (const key of [
    'ATP_AI_PROFILE',
    'ATP_AI_MODEL',
    'ATP_AI_BASE_URL',
    'ATP_AI_API_KEY',
    'DEEPSEEK_API_KEY',
    'ANTHROPIC_API_KEY',
    'ATP_AI_STUB',
  ]) {
    delete env[key]
  }
  const child = spawn(
    process.execPath,
    [cli, '--demo', '--no-open', '--headless', '--port', '0', '--data-dir', dataDir],
    { stdio: ['ignore', 'pipe', 'pipe'], env },
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

  // 实时画面按订阅数管理：弹层打开时暂停，关闭后恢复；避免长连接泄漏拖垮浏览器
  const liveCount = async () => (await (await fetch(`${origin}/api/state`)).json()).liveSubscribers
  if ((await liveCount()) !== 1) throw new Error('实时画面订阅数不是 1')
  await page.locator('button[aria-label="模型设置"]').click()
  await page.getByRole('heading', { name: '模型设置' }).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(900)
  if ((await liveCount()) !== 0) throw new Error('弹层打开后实时画面没有暂停')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1600)
  if ((await liveCount()) !== 1) throw new Error('弹层关闭后实时画面没有恢复')
  console.log('[agent] 实时画面暂停/恢复 ✓')

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

  // Copilot 演示链路：页签 → 流式输出 → 工具卡 → 落款
  await page.locator('[role=tab]').filter({ hasText: 'Copilot' }).click()
  const composer = page.locator('textarea[placeholder^="描述要测什么"]')
  await composer.waitFor({ state: 'visible' })
  const panelText = await page.locator('body').innerText()
  if (!panelText.includes('让 Copilot 操作页面')) throw new Error('Copilot 空状态未渲染')
  await composer.fill('帮我观察一下当前页面')
  await composer.press('Enter')
  await page.getByText('当前是演示模式', { exact: false }).first().waitFor({ timeout: 20_000 })
  await page.getByText('已验证', { exact: false }).first().waitFor({ timeout: 20_000 })
  // 工具调用收成一组，完成后默认折叠；展开后能看到具体卡片
  const toolGroup = page.getByRole('button', { name: /工具调用/ }).first()
  await toolGroup.waitFor({ timeout: 20_000 })
  const expanded = await toolGroup.getAttribute('aria-expanded')
  if (expanded !== 'true') await toolGroup.click()
  await page.getByText('观察页面', { exact: false }).first().waitFor({ timeout: 20_000 })
  console.log('[agent] Copilot ✓ 流式输出与工具卡分组')

  // 会话持久化：消息与工具卡落 SQLite，历史入口可恢复
  const sessions = await invoke(origin, 'ai:session-list', { limit: 10 })
  if (sessions.length === 0) throw new Error('Copilot 会话没有落库')
  const storedSession = await invoke(origin, 'ai:session-get', { id: sessions[0].id })
  if (storedSession.messages.length < 2) {
    throw new Error(`会话消息不足：${storedSession.messages.length}`)
  }
  const storedAssistant = storedSession.messages.find((message) => message.role === 'assistant')
  if (!storedAssistant?.text.includes('已验证')) throw new Error('助手回复没有落库')
  if (!storedAssistant.tools?.length) throw new Error('工具卡没有落库')
  await page.locator('button[aria-label="历史会话"]').click()
  await page.getByRole('heading', { name: '历史会话' }).waitFor({ timeout: 10_000 })
  const historyDialog = page.getByRole('dialog')
  await historyDialog.getByText(sessions[0].title, { exact: true }).first().click()
  await page.getByText('已验证', { exact: false }).first().waitFor({ timeout: 10_000 })
  console.log('[agent] 会话持久化 ✓ 落库 / 历史恢复')

  // 模型设置：保存密钥 → Copilot 切到真实模型 → 掩码与权限位 → 清除后回到演示
  await page.locator('button[aria-label="模型设置"]').click()
  await page.getByRole('heading', { name: '模型设置' }).waitFor({ timeout: 10_000 })
  const keyField = page.locator('#atp-ai-key')
  await keyField.waitFor({ state: 'visible' })
  if ((await page.locator('#atp-ai-model').inputValue()) !== 'deepseek-flash') {
    throw new Error('模型设置未回填默认模型 deepseek-flash')
  }
  await keyField.fill('sk-e2e-test-0000abcd')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page
    .getByRole('button', { name: 'deepseek-flash', exact: true })
    .waitFor({ timeout: 10_000 })

  const savedConfig = await invoke(origin, 'ai:config')
  if (savedConfig.stub || !savedConfig.ready) throw new Error('保存密钥后 Copilot 仍是演示模式')
  if (savedConfig.keyHint !== '…abcd') throw new Error(`密钥掩码不正确：${savedConfig.keyHint}`)
  if (savedConfig.keySource !== 'file') throw new Error('密钥来源不是本机文件')
  if (JSON.stringify(savedConfig).includes('sk-e2e-test')) {
    throw new Error('ai:config 泄漏了明文密钥')
  }
  const configFile = join(dataDir, 'config.json')
  const configText = await readFile(configFile, 'utf8')
  if (!configText.includes('sk-e2e-test-0000abcd')) throw new Error('密钥没有写入本机配置')
  const mode = (await stat(configFile)).mode & 0o777
  if (mode !== 0o600) throw new Error(`config.json 权限应为 0600，实际 ${mode.toString(8)}`)
  console.log('[agent] 模型设置 ✓ 保存 / 掩码 / 0600')

  // 重新打开：显示掩码而不是明文
  await page.locator('button[aria-label="模型设置"]').click()
  await page.getByText('…abcd', { exact: false }).waitFor({ timeout: 10_000 })
  await page.getByText('本机保存', { exact: true }).waitFor({ timeout: 10_000 })
  if ((await page.locator('#atp-ai-key').count()) > 0) {
    throw new Error('已有密钥时不应展示明文输入框')
  }
  console.log('[agent] 模型设置 ✓ 回显掩码')

  // 清除密钥 → 回到演示模式
  await page.getByRole('button', { name: '清除', exact: true }).click()
  await page.getByRole('button', { name: '确认清除', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '演示模式', exact: true }).waitFor({ timeout: 10_000 })
  const clearedConfig = await invoke(origin, 'ai:config')
  if (clearedConfig.hasKey || clearedConfig.keySource !== 'none') {
    throw new Error('清除密钥后仍检测到密钥')
  }
  console.log('[agent] 模型设置 ✓ 清除密钥')

  // 操作库：IPC、左栏页签、右侧参数详情
  const skills = await invoke(origin, 'skill:list')
  const skillIds = skills.map((skill) => skill.id).sort()
  if (skillIds.join(',') !== 'hover_menu,slider_set,upload_file') {
    throw new Error(`操作库技能不正确：${skillIds.join(',')}`)
  }
  await page.getByRole('button', { name: '操作库', exact: true }).click()
  await page.getByText('设置滑块', { exact: true }).waitFor({ timeout: 10_000 })
  await page.getByText('展开悬停菜单', { exact: true }).waitFor({ timeout: 10_000 })
  await page.getByText('上传文件', { exact: true }).waitFor({ timeout: 10_000 })
  await page.getByText('设置滑块', { exact: true }).click()
  await page.getByText('skill_run({', { exact: false }).waitFor({ timeout: 10_000 })
  await page.getByText('value', { exact: true }).waitFor({ timeout: 10_000 })
  console.log('[agent] 操作库 ✓ 3 个技能与参数详情')

  // 环境面板：切回用例，打开 Copilot，检查模型实际收到的环境
  await page.getByRole('button', { name: '用例', exact: true }).click()
  await page
    .getByRole('button', { name: /Copilot/ })
    .first()
    .click()
  await page.locator('button[aria-label="环境"]').waitFor({ timeout: 10_000 })
  await page.locator('button[aria-label="环境"]').click()
  await page.getByText('这些字段会随每条消息发送给模型', { exact: false }).waitFor({
    timeout: 10_000,
  })
  const envText = await page.locator('body').innerText()
  for (const label of ['模式', '项目', '默认项目', '页面']) {
    if (!envText.includes(label)) throw new Error(`环境面板缺少「${label}」`)
  }
  console.log('[agent] 环境面板 ✓')

  // 用例修改建议：stub 生成 diff → 应用 → 撤销
  await page.getByText('Agent E2E 用例', { exact: true }).first().click()
  await page.waitForTimeout(300)
  await composer.fill('请修改用例，精简冗余步骤')
  await composer.press('Enter')
  await page.getByText('修改建议', { exact: true }).waitFor({ timeout: 20_000 })
  await page.getByText('4 步 → 3 步', { exact: false }).waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: '应用修改' }).click()
  await page.getByText('已写入用例', { exact: false }).waitFor({ timeout: 20_000 })
  const applied = await invoke(origin, 'case:get', { id: cases[0].id })
  if (applied.case.steps.length !== 3) {
    throw new Error(`应用修改后期望 3 个步骤，实际 ${applied.case.steps.length} 个`)
  }
  await page.getByRole('button', { name: '撤销' }).first().click()
  await page.getByRole('button', { name: '应用修改' }).waitFor({ timeout: 20_000 })
  const undone = await invoke(origin, 'case:get', { id: cases[0].id })
  if (undone.case.steps.length !== 4) {
    throw new Error(`撤销后期望 4 个步骤，实际 ${undone.case.steps.length} 个`)
  }
  console.log('[agent] 用例修改建议 ✓ diff / 应用 / 撤销')

  // AI 计划卡：从页面生成 → 中栏执行 → 保存为用例
  await invoke(origin, 'browser:navigate', { url: `${origin}/demo` })
  await page.waitForTimeout(400)
  await composer.fill('从当前页面生成一条测试用例')
  await composer.press('Enter')
  await page.getByText('AI 计划', { exact: true }).first().waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: '在中栏执行' }).waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: '在中栏执行' }).click()
  await page.getByText('已通过', { exact: true }).first().waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: '保存为用例' }).click()
  await page.getByRole('heading', { name: '保存为用例' }).waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: '保存用例', exact: true }).click()
  await page.getByText('已保存为用例', { exact: false }).waitFor({ timeout: 20_000 })

  const planCases = await invoke(origin, 'case:list', { projectId: cases[0].projectId })
  const planCase = planCases.find((item) => item.name.startsWith('AI 计划新建内容'))
  if (!planCase) throw new Error('计划卡保存后没有出现在用例列表')
  const planFile = await invoke(origin, 'case:get', { id: planCase.id })
  if (planFile.case.steps.length !== 3) {
    throw new Error(`计划用例期望 3 个步骤，实际 ${planFile.case.steps.length} 个`)
  }
  if (Object.keys(planFile.elements).length !== 2) {
    throw new Error(`计划用例期望 2 个元素，实际 ${Object.keys(planFile.elements).length} 个`)
  }
  const fillStep = planFile.case.steps.find((step) => step.action === 'fill')
  if (!String(fillStep?.params?.value ?? '').startsWith('AI计划_')) {
    throw new Error(`计划用例的填写值不正确：${String(fillStep?.params?.value ?? '')}`)
  }
  console.log('[agent] AI 计划卡 ✓ 生成 / 执行 / 保存')

  // 单步调试：暂停在第一步 → 下一步 → 断点继续 → 完成；不写执行记录
  await page.getByText('Agent E2E 用例', { exact: true }).first().click()
  await page.waitForTimeout(300)
  await page.locator('[role=tab]').filter({ hasText: '步骤' }).first().click()
  const runsBeforeDebug = await invoke(origin, 'run:list', { caseId: cases[0].id })
  await page.getByRole('button', { name: '调试', exact: true }).click()
  await page.getByText('第 1/4 步', { exact: false }).waitFor({ timeout: 20_000 })
  await page.getByText('已暂停', { exact: true }).waitFor({ timeout: 20_000 })
  await page.getByText('变量与当前参数').click()
  await page.getByText('"value"', { exact: false }).first().waitFor({ timeout: 10_000 })

  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByText('第 2/4 步', { exact: false }).waitFor({ timeout: 20_000 })

  await page.getByRole('button', { name: '在第 3 步设置断点' }).click()
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByText('第 3/4 步', { exact: false }).waitFor({ timeout: 20_000 })
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await page.getByText('已通过', { exact: true }).first().waitFor({ timeout: 20_000 })

  const runsAfterDebug = await invoke(origin, 'run:list', { caseId: cases[0].id })
  if (runsAfterDebug.length !== runsBeforeDebug.length) {
    throw new Error('调试不应写入执行记录')
  }
  await page.getByRole('button', { name: '关闭', exact: true }).last().click()
  console.log('[agent] 单步调试 ✓ 暂停 / 下一步 / 断点 / 完成')

  // 调试恢复与导航接管：新窗口能看到控制条；手动导航自动结束调试而不是报错
  await page.getByRole('button', { name: '调试', exact: true }).click()
  await page.getByText('已暂停', { exact: true }).waitFor({ timeout: 20_000 })

  const debugPage = await browser.newPage()
  debugPage.on('pageerror', (err) => errors.push(err.message))
  await debugPage.goto(uiUrl, { waitUntil: 'networkidle' })
  await debugPage.getByText('已暂停', { exact: true }).waitFor({ timeout: 20_000 })
  await debugPage.getByRole('button', { name: '下一步', exact: true }).waitFor({ timeout: 10_000 })
  await debugPage.close()

  const takeover = await invoke(origin, 'browser:navigate', { url: `${origin}/demo?takeover=1` })
  if (!takeover?.ok) throw new Error('调试中手动导航应自动接管并成功')
  let stoppedState
  for (let i = 0; i < 100; i += 1) {
    const state = await invoke(origin, 'debug:state')
    if (state?.status === 'stopped') {
      stoppedState = state
      break
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!stoppedState) throw new Error('手动导航后调试会话应结束为 stopped')
  await page.getByText('已停止', { exact: true }).first().waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: '关闭', exact: true }).last().click()
  console.log('[agent] 单步调试 ✓ 刷新恢复控制条 / 导航自动接管')

  // 运行态恢复：吞掉 ai-done，模拟 SSE 断线丢事件；5s 心跳应自动解除执行态
  const resumePage = await browser.newPage()
  resumePage.on('pageerror', (err) => errors.push(err.message))
  await resumePage.addInitScript(() => {
    const Native = window.EventSource
    window.EventSource = class extends Native {
      addEventListener(type, fn, opts) {
        if (type === 'ai-done') return super.addEventListener(type, () => {}, opts)
        return super.addEventListener(type, fn, opts)
      }
    }
  })
  await resumePage.goto(uiUrl, { waitUntil: 'networkidle' })
  await resumePage.waitForTimeout(800)
  await resumePage.getByText('Agent E2E 用例', { exact: true }).first().click()
  await resumePage.locator('[role=tab]').filter({ hasText: 'Copilot' }).first().click()
  const resumeComposer = resumePage.locator('textarea[placeholder^="描述要测什么"]')
  await resumeComposer.waitFor({ state: 'visible', timeout: 20_000 })
  await resumeComposer.fill('帮我观察一下当前页面')
  await resumeComposer.press('Enter')
  await resumePage
    .getByRole('button', { name: '停止' })
    .waitFor({ state: 'visible', timeout: 20_000 })
  await resumePage
    .getByRole('button', { name: '发送' })
    .waitFor({ state: 'visible', timeout: 15_000 })
  await resumePage.close()
  console.log('[agent] 运行态恢复 ✓ ai-done 丢失后心跳自动解除执行态')

  if (errors.length > 0) throw new Error(`页面错误：${errors.join(' / ')}`)
  console.log('[agent] 通过 ✅')
} finally {
  await browser?.close().catch(() => {})
  await stop(child)
  await rm(dataDir, { recursive: true, force: true })
}
