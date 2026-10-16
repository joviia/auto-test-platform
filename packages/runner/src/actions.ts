import { type Step, fillParamsSchema, pressParamsSchema, selectParamsSchema } from '@atp/model'
import type { Locator, Page } from 'playwright'

export async function performAction(page: Page, step: Step, locator: Locator): Promise<void> {
  switch (step.action) {
    case 'click':
      await locator.click()
      return
    case 'fill':
      await locator.fill(fillParamsSchema.parse(step.params).value)
      return
    case 'select':
      await locator.selectOption(selectParamsSchema.parse(step.params).value)
      return
    case 'press':
      await page.keyboard.press(pressParamsSchema.parse(step.params).key)
      return
    case 'assert':
      throw new Error('assert 步骤应走 performAssertion')
  }
}
