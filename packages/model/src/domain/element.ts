import { z } from 'zod'
import { locatorSchema } from './locator.js'

/**
 * 元素库条目：集中登记、多候选定位器、跨用例复用。
 * 修改候选定位器即修复所有引用该元素的用例。
 */
export const elementSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  locators: z.array(locatorSchema).min(1),
  /** 元素所属 iframe 路径（从主文档到目标 frame 的索引链）；主文档为空 */
  framePath: z.array(z.number().int().nonnegative()).optional(),
})

export type Element = z.infer<typeof elementSchema>
