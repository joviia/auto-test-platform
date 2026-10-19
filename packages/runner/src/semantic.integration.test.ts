import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CaseFile } from '@atp/model'
import { buildRecordedCase, collectorSource, type RawRecorderEvent } from '@atp/recorder'
import { runCaseOnPage } from '@atp/runner'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const fixtureUrl = pathToFileURL(resolve(process.cwd(), 'fixtures/semantic-admin/index.html')).href

describe('语义录制 → 回放', () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>
  const evidenceDir = mkdtempSync(`${tmpdir()}/atp-semantic-`)

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser.close()
    rmSync(evidenceDir, { recursive: true, force: true })
  })

  it('弹窗 + 自定义下拉 + 开关 + 单选合并成可读步骤，并可回放', async () => {
    const page = await browser.newPage()
    await page.addInitScript(() => {
      const w = window as unknown as {
        __atpEvents: unknown[]
        __atpBridge: { send: (e: unknown) => void }
      }
      w.__atpEvents = []
      w.__atpBridge = { send: (e: unknown) => w.__atpEvents.push(e) }
    })
    await page.goto(fixtureUrl)
    await page.evaluate(collectorSource())

    await page.getByRole('button', { name: '新建内容' }).click()
    await page.getByRole('textbox', { name: '内容名称' }).fill('电影_001')
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: '电影' }).click()
    await page.getByText('显示标题').click()
    await page.getByText('非独播').click()
    await page.getByRole('button', { name: '保存' }).click()
    await page.waitForTimeout(700)

    const events = (await page.evaluate(
      () => (window as unknown as { __atpEvents: RawRecorderEvent[] }).__atpEvents,
    )) as RawRecorderEvent[]
    const actions = events.filter((event) => event.kind !== 'probe')
    expect(actions.every((event) => event.semantic !== undefined)).toBe(true)

    const draft = buildRecordedCase(events)
    const select = draft.steps.find((step) => step.action === 'select')
    expect(select?.params).toMatchObject({ value: '电影', mode: 'custom' })
    expect(select?.display).toMatchObject({
      verb: '选择',
      field: '节目类型',
      value: '电影',
    })
    expect(draft.steps.some((step) => step.display?.verb === '开启')).toBe(true)
    expect(
      draft.steps.some(
        (step) => step.display?.field === '独播标识' && step.display?.value === '非独播',
      ),
    ).toBe(true)
    expect(draft.groups[0]).toMatchObject({ kind: 'dialog', label: '新建内容' })
    expect(draft.intent).toContain('在「新建内容」中')

    const caseFile: CaseFile = {
      case: {
        id: 'c-semantic',
        name: '新建电影',
        projectId: 'p-test',
        startUrl: fixtureUrl,
        variables: {},
        intent: draft.intent,
        groups: draft.groups,
        steps: draft.steps,
      },
      elements: draft.elements,
    }
    const result = await runCaseOnPage(page, caseFile, {
      evidenceDir,
      runId: 'r-semantic',
    })
    if (result.status !== 'passed') {
      throw new Error(
        `回放失败：${result.error ?? ''}\n${result.steps
          .map((step) => `${step.index + 1}. ${step.action} ${step.status} ${step.error ?? ''}`)
          .join('\n')}`,
      )
    }
    expect(await page.locator('#content-list').textContent()).toContain('电影_001')
    expect(caseFile.case.steps.length).toBe(draft.steps.length)
  }, 60_000)
})
