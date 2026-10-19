import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Browser, chromium, type Page } from 'playwright'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SKILL_MAP, type SkillContext } from './skills.js'

let browser: Browser
let page: Page
let dataDir: string

beforeEach(async () => {
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()
  dataDir = await mkdtemp(join(tmpdir(), 'atp-skill-'))
})

afterEach(async () => {
  await browser.close().catch(() => undefined)
  await rm(dataDir, { recursive: true, force: true })
})

function skill(id: string) {
  const found = SKILL_MAP.get(id)
  if (!found) throw new Error(`技能不存在：${id}`)
  return found
}

function context(locator: SkillContext['locator']): SkillContext {
  return {
    page,
    locator,
    target: {
      rect: { x: 0, y: 0, width: 100, height: 20 },
      viewport: { width: 800, height: 600 },
      role: 'slider',
      name: 'test',
    },
    dataDir,
    signal: new AbortController().signal,
  }
}

describe('slider_set', () => {
  it('把原生 range 调到目标值并读回校验', async () => {
    await page.setContent(
      '<input type="range" id="volume" min="0" max="100" step="1" value="50" />',
    )
    const locator = page.locator('#volume')
    const result = await skill('slider_set').run({ ref: 'x', value: 80 }, context(locator))
    expect(await locator.inputValue()).toBe('80')
    expect((result.result as { value: number }).value).toBe(80)
  })

  it('支持 aria slider 的键盘操作', async () => {
    await page.setContent(`
      <div id="s" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="10" aria-valuenow="3"></div>
      <script>
        var el = document.getElementById('s');
        el.addEventListener('keydown', function (event) {
          var now = Number(el.getAttribute('aria-valuenow'));
          if (event.key === 'Home') now = 0;
          else if (event.key === 'ArrowRight') now += 1;
          else if (event.key === 'ArrowUp') now += 1;
          el.setAttribute('aria-valuenow', String(Math.min(10, now)));
        });
      </script>
    `)
    const locator = page.locator('#s')
    const result = await skill('slider_set').run({ ref: 'x', value: 7 }, context(locator))
    expect(await locator.getAttribute('aria-valuenow')).toBe('7')
    expect((result.result as { value: number }).value).toBe(7)
  })

  it('目标值按 step 量化', async () => {
    await page.setContent(
      '<input type="range" id="volume" min="0" max="100" step="10" value="50" />',
    )
    const locator = page.locator('#volume')
    const result = await skill('slider_set').run({ ref: 'x', value: 77 }, context(locator))
    expect(await locator.inputValue()).toBe('80')
    expect((result.result as { target: number }).target).toBe(80)
  })
})

describe('hover_menu', () => {
  it('悬停后返回可见菜单项', async () => {
    await page.setContent(`
      <div id="wrap">
        <button id="trigger">用户</button>
        <div role="menu" hidden>
          <button role="menuitem">个人资料</button>
          <button role="menuitem">退出登录</button>
        </div>
      </div>
      <script>
        var wrap = document.getElementById('wrap');
        var menu = wrap.querySelector('[role=menu]');
        wrap.addEventListener('mouseenter', function () { menu.hidden = false; });
        wrap.addEventListener('mouseleave', function () { menu.hidden = true; });
      </script>
    `)
    const result = await skill('hover_menu').run({ ref: 'x' }, context(page.locator('#trigger')))
    expect((result.result as { opened: boolean }).opened).toBe(true)
    expect((result.result as { items: string[] }).items).toEqual(['个人资料', '退出登录'])
  })
})

describe('upload_file', () => {
  it('上传 uploads 目录下的文件', async () => {
    const dir = join(dataDir, 'uploads')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'avatar.png')
    await writeFile(file, 'fake-image')
    await page.setContent('<input type="file" id="avatar" />')
    const result = await skill('upload_file').run(
      { ref: 'x', path: file },
      context(page.locator('#avatar')),
    )
    expect((result.result as { file: string }).file).toBe('avatar.png')
    expect(
      await page.locator('#avatar').evaluate((el) => (el as HTMLInputElement).files?.length),
    ).toBe(1)
  })

  it('拒绝 uploads 目录之外的文件', async () => {
    await page.setContent('<input type="file" id="avatar" />')
    await expect(
      skill('upload_file').run({ ref: 'x', path: '/etc/hosts' }, context(page.locator('#avatar'))),
    ).rejects.toThrow('只允许上传')
  })
})
