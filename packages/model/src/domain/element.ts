import { z } from 'zod'
import { locatorSchema } from './locator'

/**
 * 元素库条目：集中登记、多候选定位器、跨用例复用。
 * 修改候选定位器即修复所有引用该元素的用例。
 */
export const elementSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  locators: z.array(locatorSchema).min(1),
})

export type Element = z.infer<typeof elementSchema>
