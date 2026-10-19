import {
  dragParamsSchema,
  fillParamsSchema,
  pressParamsSchema,
  type Step,
  scrollParamsSchema,
  selectParamsSchema,
  waitParamsSchema,
} from '@atp/model'
import type { Locator, Page } from 'playwright'

/** 执行动作；步骤参数中的变量已由引擎替换 */
export async function performAction(
  page: Page,
  step: Step,
  locator: Locator | null,
): Promise<void> {
  const params = step.params ?? {}
  switch (step.action) {
    case 'click':
      if (!locator) throw new Error('点击步骤缺少定位器')
      await locator.click()
      return
    case 'fill':
      if (!locator) throw new Error('输入步骤缺少定位器')
      await locator.fill(fillParamsSchema.parse(params).value)
      return
    case 'select': {
      if (!locator) throw new Error('选择步骤缺少定位器')
      const select = selectParamsSchema.parse(params)
      if (select.mode === 'custom') {
        await selectCustom(page, locator, select.value)
      } else {
        await locator.selectOption(select.value)
      }
      return
    }
    case 'press':
      await page.keyboard.press(pressParamsSchema.parse(params).key)
      return
    case 'drag': {
      if (!locator) throw new Error('拖拽步骤缺少定位器')
      const { dx, dy, startX, startY, durationMs, steps } = dragParamsSchema.parse(params)
      const box = await locator.boundingBox()
      if (!box) throw new Error('无法获取拖拽目标的屏幕位置')
      const startXAbs = box.x + (startX ?? box.width / 2)
      const startYAbs = box.y + (startY ?? box.height / 2)
      const total = steps ?? 24
      const delay = Math.max(4, Math.round((durationMs ?? 320) / total))
      await page.mouse.move(startXAbs, startYAbs)
      await page.mouse.down()
      for (let i = 1; i <= total; i++) {
        const t = i / total
        // 轻微正弦轨迹，模拟人手；终点严格落在 dx/dy 上
        await page.mouse.move(startXAbs + dx * t, startYAbs + dy * t + Math.sin(t * Math.PI) * 2)
        await page.waitForTimeout(delay)
      }
      await page.mouse.up()
      return
    }
    case 'scroll': {
      const { x, y } = scrollParamsSchema.parse({
        x: Number(params.x),
        y: Number(params.y),
      })
      await page.evaluate(({ x, y }) => window.scrollTo({ left: x, top: y }), { x, y })
      return
    }
    case 'wait': {
      const { kind, ms } = waitParamsSchema.parse(params)
      if (kind === 'networkIdle') {
        await page.waitForLoadState('networkidle', { timeout: ms ?? 30_000 })
      } else if (kind === 'timeout') {
        await page.waitForTimeout(ms ?? 1000)
      } else {
        if (!locator) throw new Error('等待元素步骤缺少定位器')
        await locator.waitFor({
          state: kind === 'hidden' ? 'hidden' : 'visible',
          timeout: ms ?? 10_000,
        })
      }
      return
    }
    case 'assert':
      throw new Error('assert 步骤应走 performAssertion')
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function selectDiagnostics(page: Page, trigger: Locator): Promise<string> {
  const popups = await page
    .locator(
      '[role="listbox"]:visible, [role="menu"]:visible, .el-select-dropdown:visible, .el-dropdown-menu:visible, .ant-select-dropdown:visible',
    )
    .count()
  const options = await page
    .locator('[role="option"]:visible, [role="menuitem"]:visible, li[role="option"]:visible')
    .allTextContents()
  const triggerText = await trigger.evaluate((el) => ({
    text: (el.textContent ?? '').trim().slice(0, 80),
    value: (el as HTMLInputElement).value ?? '',
    expanded: el.getAttribute('aria-expanded'),
  }))
  const visibleOptions = options
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 20)
  return [
    `可见弹层：${popups}`,
    `触发器：text=${JSON.stringify(triggerText.text)} value=${JSON.stringify(triggerText.value)} aria-expanded=${triggerText.expanded}`,
    visibleOptions.length ? `可见选项：${visibleOptions.join(' / ')}` : '可见选项：无',
  ].join('；')
}

/**
 * 自定义下拉：点击触发器 → 等待可见弹层 → 按 option/menuitem/文本找选项 →
 * 校验选中结果。失败时给出弹层、选项与触发器状态。
 */
export async function selectCustom(page: Page, trigger: Locator, value: string): Promise<void> {
  // 有些组件库点击已展开的 combobox 会把它收起
  const expanded = await trigger.getAttribute('aria-expanded').catch(() => null)
  if (expanded !== 'true') await trigger.click()

  const popupSelector =
    '[role="listbox"]:visible, [role="menu"]:visible, .el-select-dropdown:visible, .el-dropdown-menu:visible, .ant-select-dropdown:visible, .ant-dropdown:visible'
  const popup = page.locator(popupSelector).last()
  try {
    await popup.waitFor({ state: 'visible', timeout: 3000 })
  } catch {
    throw new Error(`自定义下拉「${value}」未出现弹层。${await selectDiagnostics(page, trigger)}`)
  }

  const exact = new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`)
  const option = popup
    .getByRole('option', { name: exact })
    .or(popup.getByRole('menuitem', { name: exact }))
    .or(popup.getByText(exact))
    .first()

  if ((await option.count()) === 0) {
    throw new Error(`下拉选项「${value}」不存在。${await selectDiagnostics(page, trigger)}`)
  }
  await option.click()

  // 选中校验：触发器文本/值包含选项，或 option 标记 aria-selected
  const selected = await page
    .waitForFunction(
      ({ value }: { value: string }) => {
        const options = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"]'))
        if (
          options.some(
            (el) =>
              el.getAttribute('aria-selected') === 'true' &&
              (el.textContent ?? '').trim() === value,
          )
        ) {
          return true
        }
        return false
      },
      { value },
      { timeout: 1500 },
    )
    .then(() => true)
    .catch(() => false)

  if (!selected) {
    const triggerSelected = await trigger
      .evaluate((el, value) => {
        const text = `${el.textContent ?? ''} ${(el as HTMLInputElement).value ?? ''}`
        return text.includes(value)
      }, value)
      .catch(() => false)
    // 有些组件库不在 option 上写 aria-selected：弹层收起通常也代表选择完成
    const popupClosed = await page
      .locator(popupSelector)
      .last()
      .isVisible()
      .then((visible) => !visible)
      .catch(() => true)
    if (!triggerSelected && !popupClosed) {
      throw new Error(
        `已点击选项「${value}」，但未观察到选中结果。${await selectDiagnostics(page, trigger)}`,
      )
    }
  }
}
