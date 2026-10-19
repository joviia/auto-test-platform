import type { AiSessionRow } from '@atp/model'
import { Button, Modal, toast } from '@heroui/react'
import { History, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useOverlayGuard } from '../hooks/use-overlay-guard'
import { useUiStore } from '../state/ui-store'

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Copilot 历史会话：列最近会话，点开恢复消息、工具卡与证据 */
export function AiHistoryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useOverlayGuard(open)
  const running = useUiStore((s) => s.aiRunning)
  const currentSessionId = useUiStore((s) => s.aiSessionId)
  const replaceAiSession = useUiStore((s) => s.replaceAiSession)
  const resetAi = useUiStore((s) => s.resetAi)

  const [sessions, setSessions] = useState<AiSessionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    void window.atp
      .invoke('ai:session-list', { limit: 30 })
      .then((rows) => {
        if (active) setSessions(rows)
      })
      .catch((err: unknown) => {
        if (active) toast.danger(err instanceof Error ? err.message : '读取历史会话失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open])

  if (!open) return null

  const openSession = async (id: string): Promise<void> => {
    if (running) return
    setOpeningId(id)
    try {
      const result = await window.atp.invoke('ai:session-get', { id })
      replaceAiSession(result.session.id, result.messages)
      onClose()
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '恢复会话失败')
    } finally {
      setOpeningId(null)
    }
  }

  const remove = async (id: string): Promise<void> => {
    try {
      await window.atp.invoke('ai:session-delete', { id })
      setSessions((list) => list.filter((item) => item.id !== id))
      if (currentSessionId === id) resetAi()
      toast.success('会话已删除')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '删除会话失败')
    }
  }

  return (
    <>
      <Modal.Root isOpen onOpenChange={(next) => !next && onClose()}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>历史会话</Modal.Heading>
                <Modal.CloseTrigger />
              </Modal.Header>
              <Modal.Body className="space-y-2">
                <p className="text-[11px] text-muted">
                  会话保存在本机 SQLite。恢复后可以继续对话；删除不可撤销。
                </p>
                {loading ? (
                  <p className="py-8 text-center text-xs text-muted">加载中…</p>
                ) : sessions.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-8 text-muted">
                    <History size={20} />
                    <p className="text-xs">还没有历史会话</p>
                  </div>
                ) : (
                  <div className="max-h-[52vh] space-y-1 overflow-auto">
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        className={`group flex items-center gap-2 rounded-md border px-2.5 py-2 ${
                          session.id === currentSessionId
                            ? 'border-accent/40 bg-accent/[0.04]'
                            : 'border-border hover:bg-surface-secondary'
                        }`}
                      >
                        <button
                          type="button"
                          disabled={running || openingId !== null}
                          onClick={() => void openSession(session.id)}
                          className="min-w-0 flex-1 text-left outline-none disabled:opacity-50"
                        >
                          <p className="truncate text-[13px] text-foreground">{session.title}</p>
                          <p className="mt-0.5 text-[10px] text-muted">
                            {formatTime(session.updatedAt)} · {session.messageCount} 条消息
                            {session.id === currentSessionId ? ' · 当前' : ''}
                          </p>
                        </button>
                        <button
                          type="button"
                          disabled={running}
                          onClick={() => setDeleteId(session.id)}
                          className="grid size-6 shrink-0 place-items-center rounded text-muted opacity-0 hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:pointer-events-none"
                          aria-label={`删除会话 ${session.title}`}
                          title="删除会话"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" size="sm" onPress={onClose}>
                  关闭
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal.Root>
      <ConfirmDialog
        isOpen={deleteId !== null}
        onOpenChange={(next) => !next && setDeleteId(null)}
        title="删除这条会话？"
        description="会话正文与工具记录会从本机数据库移除，无法恢复。"
        confirmLabel="确认删除"
        onConfirm={async () => {
          if (deleteId) await remove(deleteId)
          setDeleteId(null)
        }}
      />
    </>
  )
}
