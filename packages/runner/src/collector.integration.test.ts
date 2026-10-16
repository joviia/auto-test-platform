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

    expect(events.map((e) => e.kind)).toEqual(['fill', 'fill', 'click'])

    const click = events[2]
    expect(click.candidates[0].type).toBe('testId')
    expect(click.candidates.map((c) => c.type)).toEqual(
      expect.arrayContaining(['testId', 'role', 'text', 'css']),
    )
    const role = click.candidates.find((c) => c.type === 'role')
    expect(role?.name).toBe('登录')
  }, 30000)
})
