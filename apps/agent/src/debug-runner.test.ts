import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb, initEvidence } from '@atp/core'
import type { CaseFile, DebugState } from '@atp/model'
import { type Browser, chromium, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DebugController } from './debug-runner.js'

const fixture = `<!doctype html>
<html><body>
<button data-testid="a">A</button>
<input data-testid="input" />
<button data-testid="b">B</button>
<script>
  window.__clicks = [];
  document.querySelector('[data-testid=a]').addEventListener('click', () => window.__clicks.push('a'));
  document.querySelector('[data-testid=b]').addEventListener('click', () => window.__clicks.push('b'));
</script>
</body></html>`

const caseFile: CaseFile = {
  case: {
    id: 'c-debug',
    name: '调试测试',
    projectId: 'p-test',
    startUrl: `data:text/html,${encodeURIComponent(fixture)}`,
    variables: { name: '电影_1' },
    steps: [
      { id: 's-1', action: 'click', elementId: 'el-a', display: { verb: '点击', field: 'A' } },
      {
        id: 's-2',
        action: 'fill',
        elementId: 'el-input',
        params: { value: '${name}' },
        display: { verb: '填写', field: '输入' },
      },
      { id: 's-3', action: 'click', elementId: 'el-b', display: { verb: '点击', field: 'B' } },
    ],
  },
  elements: {
    'el-a': { id: 'el-a', name: 'A', locators: [{ type: 'testId', value: 'a' }] },
    'el-input': {
      id: 'el-input',
      name: '输入',
      locators: [{ type: 'testId', value: 'input' }],
    },
    'el-b': { id: 'el-b', name: 'B', locators: [{ type: 'testId', value: 'b' }] },
  },
}

let dir: string
let browser: Browser
let page: Page

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'atp-debug-'))
  await initDb({ dataDir: dir })
  initEvidence(dir)
  browser = await chromium.launch()
  page = await browser.newPage()
})

afterAll(async () => {
  await browser?.close()
  await closeDb()
  rmSync(dir, { recursive: true, force: true })
})

function createController(): {
  controller: DebugController
  waitFor: (predicate: (state: DebugState) => boolean) => Promise<DebugState>
} {
  const waits: Array<{
    predicate: (state: DebugState) => boolean
    resolve: (state: DebugState) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []
  const controller: DebugController = new DebugController((state) => {
    for (const wait of [...waits]) {
      if (!wait.predicate(state)) continue
      clearTimeout(wait.timer)
      waits.splice(waits.indexOf(wait), 1)
      wait.resolve(state)
    }
  })
  return {
    controller,
    waitFor: (predicate) =>
      new Promise((resolve, reject) => {
        const current = controller.state
        if (current && predicate(current)) {
          resolve(current)
          return
        }
        const timer = setTimeout(() => {
          const index = waits.findIndex((wait) => wait.timer === timer)
          if (index >= 0) waits.splice(index, 1)
          reject(new Error(`等待调试状态超时：${JSON.stringify(controller.state)}`))
        }, 8_000)
        waits.push({ predicate, resolve, reject, timer })
      }),
  }
}

describe('DebugController', () => {
  it('逐步执行、命中断点后继续到完成', async () => {
    const { controller, waitFor } = createController()
    controller.start(page, caseFile, [])
    const first = await waitFor((state) => state.status === 'paused' && state.index === 0)
    expect(first.stepId).toBe('s-1')
    expect(first.variables).toEqual({ name: '电影_1' })

    controller.command('next')
    const second = await waitFor((state) => state.status === 'paused' && state.index === 1)
    expect(second.stepId).toBe('s-2')
    expect(second.results['s-1']?.status).toBe('passed')
    expect(second.step?.params?.value).toBe('电影_1')

    controller.command('set-breakpoints', ['s-3'])
    controller.command('continue')
    const third = await waitFor((state) => state.status === 'paused' && state.index === 2)
    expect(third.breakpoints).toEqual(['s-3'])
    expect(third.results['s-2']?.status).toBe('passed')

    controller.command('continue')
    const done = await waitFor((state) => state.status === 'passed')
    expect(done.results['s-1']?.status).toBe('passed')
    expect(done.results['s-2']?.status).toBe('passed')
    expect(done.results['s-3']?.status).toBe('passed')
    expect(await page.evaluate(() => (window as { __clicks?: string[] }).__clicks ?? [])).toEqual([
      'a',
      'b',
    ])
  })

  it('停止时不再执行被门闩拦住的步骤', async () => {
    await page.goto(`data:text/html,${encodeURIComponent(fixture)}`)
    const { controller, waitFor } = createController()
    controller.start(page, caseFile, [])
    await waitFor((state) => state.status === 'paused' && state.index === 0)
    controller.command('stop')
    const stopped = await waitFor((state) => state.status === 'stopped')
    expect(stopped.index).toBe(stopped.total)
    expect(stopped.results).toEqual({})
    expect(await page.evaluate(() => (window as { __clicks?: string[] }).__clicks ?? [])).toEqual(
      [],
    )
  })
})
