import {
  type Step,
  dragParamsSchema,
  fillParamsSchema,
  pressParamsSchema,
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
    case 'select':
      if (!locator) throw new Error('选择步骤缺少定位器')
      await locator.selectOption(selectParamsSchema.parse(params).value)
      return
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
