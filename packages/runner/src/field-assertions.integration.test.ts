import { chromium, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AssertionError, performAssertion } from './assertions.js'

describe('表单语义断言', () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>>
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
  })

  afterAll(async () => {
    await browser.close()
  })

  async function prepare(html: string): Promise<void> {
    await page.setContent(html)
  }

  it('原生必填为空时 fieldInvalid 与 fieldError 都通过', async () => {
    await prepare('<form><input id="name" required></form>')
    const locator = page.locator('#name').first()
    await expect(
      performAssertion(page, locator, page.locator('#name'), { type: 'fieldInvalid' }),
    ).resolves.toMatchObject({ type: 'fieldInvalid', actual: 'invalid' })
    await expect(
      performAssertion(page, locator, page.locator('#name'), { type: 'fieldError' }),
    ).resolves.toMatchObject({ type: 'fieldError' })
  })

  it('自定义组件的 aria-invalid 与提示文案可被识别', async () => {
    await prepare(`
      <div class="el-form-item is-error">
        <input id="city" aria-invalid="true" value="">
        <div class="el-form-item__error" role="alert">请选择城市</div>
      </div>
    `)
    const locator = page.locator('#city').first()
    await expect(
      performAssertion(page, locator, page.locator('#city'), { type: 'fieldInvalid' }),
    ).resolves.toMatchObject({ actual: 'invalid' })
    await expect(
      performAssertion(page, locator, page.locator('#city'), {
        type: 'fieldError',
        expected: '城市',
      }),
    ).resolves.toMatchObject({ actual: '请选择城市' })
  })

  it('Element Plus 只渲染错误文案时也算字段无效', async () => {
    await prepare(`
      <div class="el-form-item">
        <div class="el-form-item__content">
          <div class="el-select"><input id="platform" role="combobox"></div>
        </div>
        <div class="el-form-item__error" style="color: red">请选择授权平台</div>
      </div>
    `)
    const locator = page.locator('#platform').first()
    await expect(
      performAssertion(page, locator, page.locator('#platform'), { type: 'fieldInvalid' }),
    ).resolves.toMatchObject({ actual: 'invalid' })
  })

  it('隐藏的错误节点不算提示', async () => {
    await prepare(`
      <div>
        <input id="email" value="a@b.com">
        <div class="atp-field-error" style="display:none">旧错误</div>
      </div>
    `)
    const locator = page.locator('#email').first()
    await expect(
      performAssertion(page, locator, page.locator('#email'), {
        type: 'fieldError',
        timeoutMs: 150,
      }),
    ).rejects.toBeInstanceOf(AssertionError)
  })

  it('有效字段在超时后报出 failed 断言', async () => {
    await prepare('<form><input id="ok" value="已填写"></form>')
    const locator = page.locator('#ok').first()
    await expect(
      performAssertion(page, locator, page.locator('#ok'), {
        type: 'fieldInvalid',
        timeoutMs: 150,
      }),
    ).rejects.toMatchObject({ outcome: { actual: 'valid' } })
  })

  it('提示文案不匹配时失败并返回实际文案', async () => {
    await prepare(`
      <div>
        <input id="phone" aria-invalid="true">
        <div class="el-form-item__error">请输入 11 位手机号</div>
      </div>
    `)
    const locator = page.locator('#phone').first()
    await expect(
      performAssertion(page, locator, page.locator('#phone'), {
        type: 'fieldError',
        expected: '邮箱',
        timeoutMs: 150,
      }),
    ).rejects.toMatchObject({ outcome: { actual: '(无错误提示)' } })
  })
})
