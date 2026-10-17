import type { Step } from '@atp/model'

export type ActionKey = Step['action']

export const ACTION_META: Record<ActionKey, { label: string; className: string }> = {
  click: { label: '点击', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  fill: { label: '输入', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  select: { label: '选择', className: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
  press: { label: '按键', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  assert: { label: '断言', className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
}

export function actionMeta(action: string): { label: string; className: string } {
  return (
    ACTION_META[action as ActionKey] ?? {
      label: action,
      className: 'bg-default text-muted',
    }
  )
}
