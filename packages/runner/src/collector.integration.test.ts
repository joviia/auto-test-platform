import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { collectorSource } from '@atp/recorder'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'

/** 采集器与真实页面的集成验证：注入 → 交互 → 校验语义事件与候选链 */
describe('collector 在真实页面上', () => {
  it('click/fill 产出语义事件与四层候选', async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.addInitScript(() => {
      const w = window as unknown as {
        __atpEvents: unknown[]
        __atpBridge: { send: (e: unknown) => void }
      }
      w.__atpEvents = []
      w.__atpBridge = { send: (e: unknown) => w.__atpEvents.push(e) }
    })
    const fixtureUrl = pathToFileURL(resolve(process.cwd(), 'fixtures/login-form/index.html')).href
    await page.goto(fixtureUrl)
    await page.evaluate(collectorSource())

    await page.fill('#username', 'admin')
    await page.fill('#password', 'admin123')
    await page.click('#login-submit')
    await page.waitForTimeout(600) // 等页内 300ms 输入去抖

    const events = (await page.evaluate(
      () => (window as unknown as { __atpEvents: unknown[] }).__atpEvents,
    )) as Array<{ kind: string; candidates: Array<{ type: string; value: string; name?: string }> }>
    await browser.close()

    const actions = events.filter((e) => e.kind !== 'probe')
    expect(actions.map((e) => e.kind)).toEqual(['fill', 'fill', 'click'])

    const click = actions[2]
    expect(click.candidates[0].type).toBe('testId')
    expect(click.candidates.map((c) => c.type)).toEqual(
      expect.arrayContaining(['testId', 'role', 'text', 'css']),
    )
    const role = click.candidates.find((c) => c.type === 'role')
    expect(role?.name).toBe('登录')
  }, 30000)

  it('弹窗内元素产出作用域候选与 XPath 兜底', async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.setContent(`
      <div>
        <label>内容名称 <input aria-label="内容名称"></label>
      </div>
      <div role="dialog" aria-modal="true" aria-label="新建内容">
        <label>内容名称 <input aria-label="内容名称"></label>
      </div>
    `)
    await page.evaluate(() => {
      const w = window as unknown as {
        __atpEvents: unknown[]
        __atpBridge: { send: (e: unknown) => void }
      }
      w.__atpEvents = []
      w.__atpBridge = { send: (e: unknown) => w.__atpEvents.push(e) }
    })
    await page.evaluate(collectorSource())

    await page
      .getByRole('dialog', { name: '新建内容' })
      .getByRole('textbox', { name: '内容名称' })
      .click()
    await page.waitForTimeout(100)

    const events = (await page.evaluate(
      () => (window as unknown as { __atpEvents: unknown[] }).__atpEvents,
    )) as Array<{
      kind: string
      candidates: Array<{
        type: string
        scope?: Array<{ type: string; value: string; name?: string; topmost?: boolean }>
        topmost?: boolean
      }>
    }>
    await browser.close()

    const actions = events.filter((e) => e.kind !== 'probe')
    expect(actions.map((e) => e.kind)).toEqual(['click'])
    const candidates = actions[0].candidates
    const scoped = candidates.find((c) => c.scope && c.scope.length > 0)
    expect(scoped?.scope?.[0]).toMatchObject({
      type: 'role',
      value: 'dialog',
      name: '新建内容',
      topmost: true,
    })
    expect(candidates.at(-1)?.type).toBe('xpath')
  }, 30000)
})
