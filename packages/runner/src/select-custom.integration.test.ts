import { type Browser, chromium, type Page } from 'playwright'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { selectCustom } from './actions.js'

const fixture = `<!doctype html>
<html><body>
<div class="el-select" style="width:200px">
  <input id="type" role="combobox" aria-expanded="false" aria-controls="type-list"
    aria-autocomplete="none" autocomplete="off" readonly
    style="width:100%;padding:6px;border:1px solid #ccc">
  <ul id="type-list" role="listbox" hidden
      style="position:absolute;background:#fff;border:1px solid #ccc;list-style:none;margin:0;padding:0;width:200px">
    <li role="option" class="el-select-dropdown__item" data-value="movie" style="padding:6px">电影</li>
    <li role="option" class="el-select-dropdown__item" data-value="show" style="padding:6px">节目</li>
  </ul>
</div>
<script>
  const input = document.querySelector('#type');
  const list = document.querySelector('#type-list');
  const open = () => {
    input.setAttribute('aria-expanded', 'true');
    list.hidden = false;
  };
  input.addEventListener('click', open);
  list.addEventListener('click', (event) => {
    const option = event.target.closest('li[role=option]');
    if (!option) return;
    for (const item of list.querySelectorAll('[role=option]')) {
      item.setAttribute('aria-selected', 'false');
    }
    option.setAttribute('aria-selected', 'true');
    input.value = option.textContent;
    input.setAttribute('aria-expanded', 'false');
    list.hidden = true;
    window.__selected = option.dataset.value;
  });
</script>
</body></html>`

type SelectionWindow = Window & { __selected?: string }

describe('selectCustom', () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch()
  })

  afterAll(async () => {
    await browser?.close()
  })

  beforeEach(async () => {
    page = await browser.newPage()
    await page.setContent(fixture)
  })

  it('展开自定义下拉并按可见文本选择', async () => {
    await selectCustom(page, page.locator('#type'), '电影')
    expect(await page.evaluate(() => (window as SelectionWindow).__selected)).toBe('movie')
    expect(await page.locator('#type').inputValue()).toBe('电影')
    expect(await page.locator('#type').getAttribute('aria-expanded')).toBe('false')
    await page.close()
  })

  it('已经展开时不再点击触发器（避免收起）', async () => {
    await page.evaluate(() => {
      const input = document.querySelector('#type')
      input?.setAttribute('aria-expanded', 'true')
      const list = document.querySelector('#type-list')
      if (list instanceof HTMLElement) list.hidden = false
    })
    await selectCustom(page, page.locator('#type'), '节目')
    expect(await page.evaluate(() => (window as SelectionWindow).__selected)).toBe('show')
    await page.close()
  })

  it('选项不存在时给出可行动的错误', async () => {
    await expect(selectCustom(page, page.locator('#type'), '不存在')).rejects.toThrow('不存在')
    await page.close()
  })
})
