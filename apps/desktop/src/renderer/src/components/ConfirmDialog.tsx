import { AlertDialog, Button } from '@heroui/react'
import { AlertTriangle } from 'lucide-react'
import { type ReactNode, useState } from 'react'

interface ConfirmDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'accent'
  onConfirm: () => void | Promise<void>
}

/** 破坏性操作的统一二次确认（AlertDialog + 正确的组合式嵌套） */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认删除',
  tone = 'danger',
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false)

  const confirm = async (): Promise<void> => {
    setPending(true)
    try {
      await onConfirm()
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  // 关闭时直接卸载，避免退出动画中断后遮罩残留
  if (!isOpen) return null

  return (
    <AlertDialog.Root isOpen={isOpen} onOpenChange={onOpenChange}>
      <AlertDialog.Backdrop>
        <AlertDialog.Container size="sm">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger">
                <AlertTriangle size={18} />
              </AlertDialog.Icon>
              <AlertDialog.Heading>{title}</AlertDialog.Heading>
            </AlertDialog.Header>
            {description && (
              <AlertDialog.Body className="text-sm text-muted">{description}</AlertDialog.Body>
            )}
            <AlertDialog.Footer>
              <Button variant="secondary" size="sm" onPress={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                variant={tone === 'danger' ? 'danger' : 'primary'}
                size="sm"
                isDisabled={pending}
                onPress={() => void confirm()}
              >
                {pending ? '处理中…' : confirmLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog.Root>
  )
}
