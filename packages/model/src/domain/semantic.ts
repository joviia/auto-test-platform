import { z } from 'zod'

/**
 * 意图层投影：只用于展示与摘要，不参与执行。
 * 执行层永远只认 click / fill / select / press / scroll / drag / wait / assert。
 */
export const stepDisplaySchema = z.object({
  /** 填写 / 选择 / 开启 / 关闭 / 点击 / 打开 / 断言 … */
  verb: z.string().min(1),
  /** 字段或对象名：内容名称 / 节目类型 */
  field: z.string().optional(),
  /** 用户看到的值：电影 / 节目_20261019 */
  value: z.string().optional(),
  /** 合并前的原始动作，展开时展示（如自定义下拉的两次点击） */
  details: z.array(z.string()).optional(),
  /** auto = 高置信自动识别；confirm = 建议用户确认 */
  confidence: z.enum(['auto', 'confirm']).optional(),
})

export type StepDisplay = z.infer<typeof stepDisplaySchema>

export const caseGroupSchema = z.object({
  id: z.string().min(1),
  /** 新建内容 / 编辑弹窗 */
  label: z.string().min(1),
  kind: z.enum(['dialog', 'section', 'navigation']),
})

export type CaseGroup = z.infer<typeof caseGroupSchema>
