#!/usr/bin/env node
/**
 * 复现「真实（可信）输入下采集不到事件」：用 CDP Input 域派发等价真实
 * 鼠标/键盘事件操作 baidu，验证采集器是否收到。
 * 前置：打包版 --remote-debugging-port=9223 已启动。
 */
import { chromium } from 'playwright'

const CDP_HTTP = 'http://localhost:9223'
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

async function findTarget(urlPart, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${CDP_HTTP}/json/list`)
    const targets = (await res.json()).filter((t) => t.type === 'page' && t.url.includes(urlPart))
    if (targets[0]) return targets[0]
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`找不到 target: ${urlPart}`)
}

async function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', () => reject(new Error('ws error')))
  })
  let nextId = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const resolveP = pending.get(msg.id)
      pending.delete(msg.id)
      resolveP(msg)
    }
  })
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, 10000)
    })
  return call
}

const evalExpr = async (call, expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error('页面脚本异常')
  return r.result?.result?.value
}

const ui = await findPage(
  (p) => p.url().includes('localhost:51') || p.url().includes('renderer/index.html'),
)
await ui.bringToFront()
await ui.getByRole('button', { name: '项目' }).click()
await ui.getByPlaceholder('名称').fill('复现项目')
await ui.getByText('创建', { exact: true }).click()
await ui.getByText('复现项目').first().waitFor({ timeout: 5000 })
console.log('[repro] 项目已创建')

await ui.getByPlaceholder(/输入被测页面地址/).fill('https://www.baidu.com')
await ui.getByText('打开', { exact: true }).click()
const target = await findTarget('baidu.com')
console.log('[repro] baidu 已打开:', target.url)
await ui.getByText('开始录制').click()
console.log('[repro] 录制中，等注入…')
await new Promise((r) => setTimeout(r, 2500))

const ws = target.webSocketDebuggerUrl
const call = await openCdp(ws)

// 等搜索框
let box = null
for (let i = 0; i < 20; i++) {
  box = await evalExpr(
    call,
    `(() => { const el = document.querySelector('#kw'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
  )
  if (box) break
  await new Promise((r2) => setTimeout(r2, 500))
}
if (!box) throw new Error('baidu 搜索框未找到（页面加载失败？）')
console.log('[repro] 搜索框坐标:', box)

// 可信点击搜索框
await call('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: box.x,
  y: box.y,
  button: 'left',
  clickCount: 1,
})
await call('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: box.x,
  y: box.y,
  button: 'left',
  clickCount: 1,
})
await call('Input.insertText', { text: 'playwright' })
// 可信点击「百度一下」
const suBox = await evalExpr(
  call,
  `(() => { const el = document.querySelector('#su'); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
)
await call('Input.dispatchMouseEvent', {
  type: 'mousePressed',
  x: suBox.x,
  y: suBox.y,
  button: 'left',
  clickCount: 1,
})
await call('Input.dispatchMouseEvent', {
  type: 'mouseReleased',
  x: suBox.x,
  y: suBox.y,
  button: 'left',
  clickCount: 1,
})
console.log('[repro] 可信输入已派发（点击/输入/点击）')

await new Promise((r) => setTimeout(r, 1500))
// 回主窗口停止录制
await ui.bringToFront()
await ui.getByText('停止录制').click()
await new Promise((r) => setTimeout(r, 1000))
const draftInfo = await ui.evaluate(
  () => document.body.innerText.match(/共 \d+ 个步骤[^·]*/)?.[0] ?? '未找到保存框',
)
console.log('[repro] 保存框信息:', draftInfo)
await ui.getByText('丢弃').click()
console.log('[repro] 完成（查看应用日志「捕获原始事件 N 条」）')
await browser.close()
