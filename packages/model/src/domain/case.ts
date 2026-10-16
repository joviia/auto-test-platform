import { z } from 'zod'
import { elementSchema } from './element'
import { stepSchema } from './step'

/** 用例定义（与执行记录严格分离） */
export const caseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  projectId: z.string().min(1),
  moduleId: z.string().optional(),
  /** 录制时自动写入首个访问地址，可编辑 */
  startUrl: z.string().min(1),
  steps: z.array(stepSchema),
})

export type TestCase = z.infer<typeof caseSchema>

/** 自包含用例文件（用例 + 其引用的元素），runner 的直接输入 */
export const caseFileSchema = z.object({
  case: caseSchema,
  elements: z.record(z.string(), elementSchema),
})

export type CaseFile = z.infer<typeof caseFileSchema>
