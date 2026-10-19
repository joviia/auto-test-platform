import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CaseFile } from '@atp/model'
import { type Browser, chromium, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runCaseOnPage } from './engine.js'

const fixture = `<!doctype html>
<html><body>
<button data-testid="a">A</button>
<input data-testid="input" />
<script>
  window.__clicks = [];
  document.querySelector('[data-testid=a]').addEventListener('click', () => window.__clicks.push('a'));
</script>
</body></html>`

const startUrl = `data:text/html,${encodeURIComponent(fixture)}`

const caseFile: CaseFile = {
  case: {
    id: 'c-hook',
    name: '钩子测试',
    projectId: 'p-test',
    startUrl,
    variables: { name: '电影_1' },
    steps: [
      { id: 's-1', action: 'click', elementId: 'el-a' },
      {
        id: 's-2',
        action: 'fill',
        elementId: 'el-input',
        params: { value: '${name}' },
      },
    ],
  },
  elements: {
    'el-a': { id: 'el-a', name: 'A', locators: [{ type: 'testId', value: 'a' }] },
    'el-input': {
      id: 'el-input',
      name: '输入',
      locators: [{ type: 'testId', value: 'input' }],
    },
  },
}

let browser: Browser
let page: Page
const dirs: string[] = []

beforeAll(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
})

afterAll(async () => {
  await browser?.close()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function evidenceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'atp-hook-'))
  dirs.push(dir)
  return dir
}

describe('runCaseOnPage beforeStep', () => {
  it('每个要执行的步骤前都会等待钩子，且参数已替换变量', async () => {
    const seen: Array<{ index: number; value: unknown; variables: Record<string, string> }> = []
    const result = await runCaseOnPage(page, caseFile, {
      evidenceDir: evidenceDir(),
      beforeStep: async (context) => {
        seen.push({
          index: context.index,
          value: context.step.params?.value,
          variables: context.variables,
        })
        await new Promise((resolve) => setTimeout(resolve, 5))
      },
    })

    expect(result.status).toBe('passed')
    expect(seen.map((item) => item.index)).toEqual([0, 1])
    expect(seen[1]?.value).toBe('电影_1')
    expect(seen[1]?.variables).toEqual({ name: '电影_1' })
  })

  it('停止后不再执行被门闩拦住的步骤', async () => {
    const controller = new AbortController()
    const gate: { release?: () => void } = {}
    const running = runCaseOnPage(page, caseFile, {
      evidenceDir: evidenceDir(),
      signal: controller.signal,
      beforeStep: async () => {
        await new Promise<void>((resolve) => {
          gate.release = resolve
        })
      },
    })
    // 等钩子挂起后停止，再放行
    await new Promise((resolve) => setTimeout(resolve, 60))
    controller.abort()
    gate.release?.()
    const result = await running

    expect(result.status).toBe('failed')
    expect(result.error).toBe('调试已停止')
    expect(result.steps).toHaveLength(0)
    expect(await page.evaluate(() => (window as { __clicks?: string[] }).__clicks ?? [])).toEqual(
      [],
    )
  })
})
