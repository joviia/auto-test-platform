import type { Element as ElementModel, Locator as ModelLocator } from '@atp/model'
import type { Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveElement } from './resolve-locator.js'

const ledger = `<script>
  window.__ledger = [];
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-ledger]');
    if (el) window.__ledger.push(el.dataset.ledger);
  }, true);
</script>`

const baseStyle = `<style>
  body { font-family: sans-serif; margin: 0; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.25); z-index: 10; }
  .dialog { background: #fff; border: 1px solid #999; padding: 12px; width: 320px; }
  .dialog.fixed { position: fixed; }
  .tabpanel { border: 1px solid #ccc; padding: 8px; }
  table { border-collapse: collapse; }
  td, th { border: 1px solid #ccc; padding: 4px 8px; }
  .panel { border: 1px solid #ddd; padding: 8px; margin: 8px; }
</style>`

const fixtures = {
  modal: `${baseStyle}
<section>
  <label>内容名称 <input aria-label="内容名称" data-ledger="page.name" class="el-input__inner"></label>
  <button data-ledger="page.create" class="el-button">新建内容</button>
</section>
<div class="overlay" aria-hidden="true"></div>
<div role="dialog" aria-modal="true" aria-label="新建内容" class="dialog fixed" style="top:60px;left:60px;z-index:11">
  <label>内容名称 <input aria-label="内容名称" data-ledger="dialog.name" class="el-input__inner"></label>
</div>
${ledger}`,

  rows: `${baseStyle}
<table><tbody>
  <tr><td>专辑一</td><td><button aria-label="编辑" data-ledger="row1.edit" class="el-button">编辑</button></td></tr>
  <tr><td>专辑二</td><td><button aria-label="编辑" data-ledger="row2.edit" class="el-button">编辑</button></td></tr>
  <tr data-atp-key="album-3"><td>专辑三</td><td><button aria-label="编辑" data-ledger="row3.edit" class="el-button">编辑</button></td></tr>
</tbody></table>
${ledger}`,

  tabs: `${baseStyle}
<div role="tablist">
  <button role="tab" aria-selected="false">基本信息</button>
  <button role="tab" aria-selected="true">扩展信息</button>
</div>
<div role="tabpanel" aria-hidden="true" class="tabpanel">
  <label>备注 <input aria-label="备注" data-ledger="tabA.remark" class="el-input__inner"></label>
</div>
<div role="tabpanel" aria-hidden="false" class="tabpanel">
  <label>备注 <input aria-label="备注" data-ledger="tabB.remark" class="el-input__inner"></label>
</div>
${ledger}`,

  stacked: `${baseStyle}
<div role="dialog" aria-label="详情" class="dialog fixed" style="top:100px;left:40px;z-index:20">
  <label>标题 <input aria-label="标题" data-ledger="detailBelow.title" class="el-input__inner"></label>
</div>
<div role="dialog" aria-label="详情" class="dialog fixed" style="top:130px;left:70px;z-index:21">
  <label>标题 <input aria-label="标题" data-ledger="detailAbove.title" class="el-input__inner"></label>
</div>
${ledger}`,

  nested: `${baseStyle}
<div role="dialog" aria-label="新建内容二" class="dialog fixed" style="top:40px;left:40px;z-index:20">
  <label>分类名称 <input aria-label="分类名称" data-ledger="outer.category" class="el-input__inner"></label>
  <div role="dialog" aria-label="选择分类" class="dialog fixed" style="top:120px;left:80px;z-index:21">
    <label>分类名称 <input aria-label="分类名称" data-ledger="inner.category" class="el-input__inner"></label>
  </div>
</div>
${ledger}`,

  panels: `${baseStyle}
<section class="panel"><label>编号 <input aria-label="编号" data-ledger="panel1.code" class="el-input__inner"></label></section>
<section class="panel"><label>编号 <input aria-label="编号" data-ledger="panel2.code" class="el-input__inner"></label></section>
${ledger}`,
}

function target(locators: ModelLocator[]): ElementModel {
  return { id: 'el-target', name: '目标元素', locators }
}

async function xpathOf(page: Page, selector: string): Promise<string> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const parts: string[] = []
      let cur: Element | null = el
      while (cur && cur.nodeType === 1) {
        if (cur === document.documentElement) {
          parts.unshift('html[1]')
          break
        }
        let idx = 1
        let sib = cur.previousElementSibling
        while (sib) {
          if (sib.tagName === cur.tagName) idx++
          sib = sib.previousElementSibling
        }
        parts.unshift(`${cur.tagName.toLowerCase()}[${idx}]`)
        cur = cur.parentElement
      }
      return `/${parts.join('/')}`
    })
}

async function chosen(
  page: Page,
  element: ElementModel,
): Promise<{ ledger: string; degraded: boolean }> {
  const outcome = await resolveElement(page, element)
  expect(outcome.locator, JSON.stringify(outcome.attempts, null, 2)).not.toBeNull()
  const ledgerName = await outcome.locator?.evaluate(
    (el) => (el as HTMLElement).dataset.ledger ?? '',
  )
  return { ledger: ledgerName ?? '', degraded: Boolean(outcome.hit?.degraded) }
}

/** 结构突变：包装目标、换序、改 class、重建 id —— 只保留 role/aria/文本 */
async function mutate(page: Page, ledgerName: string): Promise<void> {
  await page.evaluate((name) => {
    const el = document.querySelector(`[data-ledger="${name}"]`)
    if (!el) return
    const wrap = document.createElement('div')
    el.parentNode?.insertBefore(wrap, el)
    wrap.appendChild(el)
    const parent = el.parentElement
    const first = parent?.firstElementChild
    if (parent && first && parent.children.length > 1) parent.appendChild(first)
    for (const node of Array.from(document.querySelectorAll('[class]'))) {
      node.className = String(node.className).replace(/\bel-/g, 'x-')
    }
    for (const input of Array.from(document.querySelectorAll('input'))) {
      input.id = `el-id-${Math.floor(Math.random() * 9000 + 1000)}`
    }
  }, ledgerName)
}

const model = (s: string): ModelLocator => ({ type: 'role', value: s })

describe('定位解析：候选优先级与作用域', () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
  })

  afterAll(async () => {
    await browser.close()
  })

  it('弹窗与页面同名：选择弹窗内可交互实例，并在结构突变后保持稳定', async () => {
    await page.setContent(fixtures.modal)
    const xp = await xpathOf(page, '[aria-label="新建内容"][role="dialog"] input')
    const element = target([
      {
        type: 'within',
        scope: { type: 'role', value: 'dialog', name: '新建内容' },
        target: { type: 'role', value: 'textbox', name: '内容名称' },
      },
      { type: 'role', value: 'textbox', name: '内容名称' },
      { type: 'xpath', value: xp },
    ])

    expect((await chosen(page, element)).ledger).toBe('dialog.name')
    await mutate(page, 'dialog.name')
    expect((await chosen(page, element)).ledger).toBe('dialog.name')
  })

  it('多行同名按钮：按行作用域选择，而不是第一行', async () => {
    await page.setContent(fixtures.rows)
    const xp = await xpathOf(page, 'tbody tr:nth-child(3) button')
    const element = target([
      {
        type: 'within',
        scope: { type: 'css', value: 'tr:has-text("专辑三")' },
        target: { type: 'role', value: 'button', name: '编辑' },
      },
      { type: 'role', value: 'button', name: '编辑' },
      { type: 'xpath', value: xp },
    ])

    expect((await chosen(page, element)).ledger).toBe('row3.edit')
    await mutate(page, 'row3.edit')
    expect((await chosen(page, element)).ledger).toBe('row3.edit')
  })

  it('两个 Tab 同名字段：选择激活 panel', async () => {
    await page.setContent(fixtures.tabs)
    const xp = await xpathOf(page, '[aria-hidden="false"] input')
    const element = target([
      {
        type: 'within',
        scope: { type: 'css', value: '[role="tabpanel"][aria-hidden="false"]' },
        target: { type: 'role', value: 'textbox', name: '备注' },
      },
      { type: 'role', value: 'textbox', name: '备注' },
      { type: 'xpath', value: xp },
    ])

    expect((await chosen(page, element)).ledger).toBe('tabB.remark')
    await mutate(page, 'tabB.remark')
    expect((await chosen(page, element)).ledger).toBe('tabB.remark')
  })

  it('同名弹窗叠加：topmost 按 z-index 选最上层', async () => {
    await page.setContent(fixtures.stacked)
    const xp = await xpathOf(page, '[style*="z-index:21"] input')
    const element = target([
      {
        type: 'within',
        scope: { type: 'role', value: 'dialog', name: '详情' },
        target: { type: 'role', value: 'textbox', name: '标题' },
        topmost: true,
      },
      { type: 'role', value: 'textbox', name: '标题' },
      { type: 'xpath', value: xp },
    ])

    expect((await chosen(page, element)).ledger).toBe('detailAbove.title')
    await mutate(page, 'detailAbove.title')
    expect((await chosen(page, element)).ledger).toBe('detailAbove.title')
  })

  it('嵌套弹窗：作用域链定位到内层', async () => {
    await page.setContent(fixtures.nested)
    const xp = await xpathOf(page, '[aria-label="选择分类"] input')
    const element = target([
      {
        type: 'within',
        scope: { type: 'role', value: 'dialog', name: '新建内容二' },
        target: {
          type: 'within',
          scope: { type: 'role', value: 'dialog', name: '选择分类' },
          target: { type: 'role', value: 'textbox', name: '分类名称' },
        },
      },
      { type: 'role', value: 'textbox', name: '分类名称' },
      { type: 'xpath', value: xp },
    ])

    expect((await chosen(page, element)).ledger).toBe('inner.category')
    await mutate(page, 'inner.category')
    expect((await chosen(page, element)).ledger).toBe('inner.category')
  })

  it('无语义作用域：XPath 末位兜底，并标记 degraded', async () => {
    await page.setContent(fixtures.panels)
    const xp = await xpathOf(page, '.panel:nth-of-type(2) input')
    const element = target([
      { type: 'role', value: 'textbox', name: '编号' },
      { type: 'xpath', value: xp },
    ])

    const resolved = await chosen(page, element)
    expect(resolved.ledger).toBe('panel2.code')
    expect(resolved.degraded).toBe(true)

    // 结构突变后，XPath 可能失效或指向错误元素；但任何结构性成功都必须带 degraded
    await mutate(page, 'panel2.code')
    const outcome = await resolveElement(page, element)
    if (outcome.hit) expect(outcome.hit.degraded).toBe(true)
  })

  it('多个可交互同名元素且无作用域：返回失败并给出歧义诊断', async () => {
    await page.setContent(fixtures.rows)
    const outcome = await resolveElement(page, target([model('button')]))
    const only = target([{ type: 'role', value: 'button', name: '编辑' }])
    const ambiguous = await resolveElement(page, only)
    expect(ambiguous.locator).toBeNull()
    expect(ambiguous.attempts[0].matchCount).toBe(3)
    expect(ambiguous.attempts[0].error).toContain('歧义')
    // 空候选也应返回明确诊断
    const nothing = await resolveElement(page, target([{ type: 'testId', value: 'nope' }]))
    expect(nothing.locator).toBeNull()
    expect(nothing.attempts[0].error).toContain('未找到')
    expect(outcome.locator).toBeNull()
  })
})
