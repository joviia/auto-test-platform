import type { Step } from '@atp/model'

export type ActionKey = Step['action']

export const ACTION_META: Record<ActionKey, { label: string; className: string }> = {
  click: { label: '点击', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  fill: { label: '输入', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  select: { label: '选择', className: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
  press: { label: '按键', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  assert: { label: '断言', className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
  scroll: { label: '滚动', className: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400' },
  wait: { label: '等待', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
  drag: { label: '拖拽', className: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400' },
}

export function actionMeta(action: string): { label: string; className: string } {
  return (
    ACTION_META[action as ActionKey] ?? {
      label: action,
      className: 'bg-default text-muted',
    }
  )
}

/** 行内预览：输入值 / 按键 / 断言期望 / 滚动位置 / 等待条件 */
export function stepPreview(step: Step): string {
  const params = step.params ?? {}
  if (step.action === 'fill' || step.action === 'select') return String(params.value ?? '')
  if (step.action === 'press') return String(params.key ?? 'Enter')
  if (step.action === 'scroll') return `(${Number(params.x ?? 0)}, ${Number(params.y ?? 0)})`
  if (step.action === 'drag') return `Δ${Number(params.dx ?? 0)}, ${Number(params.dy ?? 0)}`
  if (step.action === 'wait') {
    const kind = String(params.kind ?? 'timeout')
    return kind === 'timeout' ? `${Number(params.ms ?? 1000)}ms` : kind
  }
  if (step.action === 'assert') {
    const a = step.assertion
    if (!a) return ''
    if ('expected' in a && typeof a.expected === 'string') {
      return a.expected
    }
    if (a.type === 'count') return `${a.op} ${a.expected}`
    return ''
  }
  return ''
}
