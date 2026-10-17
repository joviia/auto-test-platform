import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyHintProps {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
}

/** 统一的空状态：图标 + 标题 + 说明 + 主行动 */
export function EmptyHint({ icon: Icon, title, description, action, compact }: EmptyHintProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? 'gap-1.5 px-4 py-8' : 'gap-2 px-6 py-16'
      }`}
    >
      <div
        className={`grid place-items-center rounded-full bg-surface-secondary text-muted ${
          compact ? 'size-9' : 'size-12'
        }`}
      >
        <Icon size={compact ? 16 : 20} />
      </div>
      <p className={`font-medium text-foreground ${compact ? 'text-[13px]' : 'text-sm'}`}>
        {title}
      </p>
      {description && <p className="max-w-[320px] text-xs leading-5 text-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
