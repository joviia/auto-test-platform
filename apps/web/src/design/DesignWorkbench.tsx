import type { DesignCase, DesignSelection } from '@atp/model'
import { Button, toast } from '@heroui/react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ClipboardCheck,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Table2,
  TriangleAlert,
} from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { analyzeCurrentPage } from '../ai/TestDesignCard'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useOverlayGuard } from '../hooks/use-overlay-guard'
import { useUiStore } from '../state/ui-store'
import { AcceptDesignDialog } from './AcceptDesignDialog'
import { DesignActionBar } from './DesignActionBar'
import { DesignFilterBar } from './DesignFilterBar'
import { DesignInspector, type DesignInspectorTab } from './DesignInspector'
import { DesignMatrixView } from './DesignMatrixView'
import { DesignScenarioView } from './DesignScenarioView'
import { adoptDesignMatrix, useDesignPersistence } from './useDesignPersistence'

function hostOf(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch {
    return url
  }
}

function percent(value: number): string {
  return value > 0 ? `${Math.round(value * 100)}%` : '—'
}

/**
 * 测试设计全屏工作台。
 * 场景列表是唯一主画布；详情与 AI 收进按需抽屉，避免常驻三栏同时抢注意力。
 */
export function DesignWorkbench() {
  const open = useUiStore((s) => s.designWorkbenchOpen)
  const design = useUiStore((s) => s.design)
  const view = useUiStore((s) => s.designView)
  const running = useUiStore((s) => s.designRunning)
  const loading = useUiStore((s) => s.designLoading)
  const saveState = useUiStore((s) => s.designSaveState)
  const undo = useUiStore((s) => s.designUndo)
  const undoDesign = useUiStore((s) => s.undoDesign)
  const setOpen = useUiStore((s) => s.setDesignWorkbenchOpen)
  const setView = useUiStore((s) => s.setDesignView)
  const setRunning = useUiStore((s) => s.setDesignRunning)
  const setCases = useUiStore((s) => s.setDesignCases)
  const beginRun = useUiStore((s) => s.beginDesignRun)
  const setActive = useUiStore((s) => s.setDesignActive)

  const [inspector, setInspector] = useState<{
    tab: DesignInspectorTab
    open: boolean
  }>({ tab: 'detail', open: false })
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [acceptSelections, setAcceptSelections] = useState<DesignSelection[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [runSelections, setRunSelections] = useState<DesignSelection[]>([])
  const [now, setNow] = useState(Date.now())
  const titleRef = useRef<HTMLHeadingElement>(null)
  const menuRef = useRef<HTMLDetailsElement>(null)

  useDesignPersistence()
  useOverlayGuard(open)

  const lastUndo = undo.at(-1)
  useEffect(() => {
    if (!lastUndo) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [lastUndo])

  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (acceptOpen || confirmOpen) return
      if (inspector.open) {
        setInspector((current) => ({ ...current, open: false }))
        return
      }
      setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, acceptOpen, confirmOpen, inspector.open, setOpen])

  useEffect(() => {
    if (open) titleRef.current?.focus()
  }, [open])

  if (!open) return null

  const close = (): void => setOpen(false)

  const openDetail = (scenarioId: string, recordId?: string): void => {
    setActive(scenarioId, recordId ?? null)
    setInspector({ tab: 'detail', open: true })
  }

  const changeView = (next: 'scenarios' | 'matrix'): void => {
    setView(next)
    if (next === 'matrix') {
      setInspector((current) => ({ ...current, open: false }))
    }
  }

  const runNow = async (list: DesignSelection[]): Promise<void> => {
    if (!design) return
    try {
      const result: { cases: DesignCase[] } = await window.atp.invoke('design:generate', {
        matrix: design,
        selections: list,
      })
      setCases(result.cases)
      beginRun(list)
      await window.atp.invoke('design:run', { cases: result.cases })
    } catch (err) {
      setRunning(false)
      toast.danger(err instanceof Error ? err.message : '执行测试设计失败')
    }
  }

  const requestRun = (list: DesignSelection[]): void => {
    const writeRows = list.filter((selection) => {
      const scenario = design?.scenarios.find((item) => item.id === selection.scenarioId)
      return scenario?.requiresWrite === true
    })
    if (writeRows.length > 0) {
      setRunSelections(list)
      setConfirmOpen(true)
      return
    }
    void runNow(list)
  }

  const reloadSession = async (): Promise<void> => {
    try {
      const matrix = await window.atp.invoke('design:latest')
      if (!matrix) {
        toast.info('没有可以恢复的设计会话')
        return
      }
      adoptDesignMatrix(matrix)
      useUiStore.getState().setDesign(matrix)
      useUiStore.getState().setDesignSaveState('idle')
      toast.success('已重新加载最新设计会话')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '重新加载失败')
    }
  }

  const closeMenu = (): void => {
    menuRef.current?.removeAttribute('open')
  }

  const totalRows = design ? design.coverage.readyRows + design.coverage.pendingRows : 0
  const showUndo = Boolean(lastUndo && now - lastUndo.at < 10_000)
  const saveLabel =
    saveState === 'saving'
      ? '保存中…'
      : saveState === 'saved'
        ? '已保存'
        : saveState === 'conflict'
          ? '会话已更新'
          : ''

  return (
    <div
      data-design-workbench
      className="fixed inset-0 z-40 flex min-h-0 flex-col bg-background text-foreground"
    >
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <button
          type="button"
          onClick={close}
          className="grid size-7 shrink-0 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
          aria-label="返回页面"
          title="返回页面（Esc）"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="flex min-w-0 items-center gap-1.5">
          <ClipboardCheck size={14} className="shrink-0 text-accent" />
          <h2
            ref={titleRef}
            tabIndex={-1}
            className="shrink-0 text-[13.5px] font-semibold outline-none"
          >
            测试设计
          </h2>
          <span className="min-w-0 truncate text-[11px] text-muted">
            {design?.scopeLabel ?? design?.title ?? '未分析'}
            {design?.url ? ` · ${hostOf(design.url)}` : ''}
          </span>
        </div>

        <div className="ml-2 flex shrink-0 items-center rounded-md border border-border bg-surface-secondary p-0.5">
          <button
            type="button"
            onClick={() => changeView('scenarios')}
            className={`rounded px-2.5 py-0.5 text-[10.5px] ${
              view === 'scenarios' ? 'bg-surface font-medium text-accent shadow-sm' : 'text-muted'
            }`}
          >
            场景
          </button>
          <button
            type="button"
            onClick={() => changeView('matrix')}
            className={`flex items-center gap-1 rounded px-2.5 py-0.5 text-[10.5px] ${
              view === 'matrix' ? 'bg-surface font-medium text-accent shadow-sm' : 'text-muted'
            }`}
          >
            <Table2 size={10} />
            矩阵
          </button>
        </div>

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {design && (
            <details className="relative">
              <summary className="flex h-7 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-[10.5px] text-muted hover:bg-default hover:text-foreground [&::-webkit-details-marker]:hidden">
                覆盖 {percent(design.coverage.designCoverage)} · {design.coverage.readyRows}/
                {totalRows} 行
                <ChevronDown size={10} />
              </summary>
              <div className="absolute right-0 top-8 z-30 w-64 rounded-md border border-border bg-surface p-2 text-[10.5px] shadow-xl">
                <CoverageRow
                  label="设计覆盖"
                  value={design.coverage.designCoverage}
                  note={`${design.coverage.readyRows}/${totalRows} 行可执行`}
                />
                <CoverageRow
                  label="接受覆盖"
                  value={design.coverage.acceptCoverage}
                  note={`${design.coverage.acceptedRows} 行已接受`}
                />
                <CoverageRow
                  label="执行覆盖"
                  value={design.coverage.executionCoverage}
                  note={`${design.coverage.executedRows} 行已执行`}
                />
                <CoverageRow
                  label="通过率"
                  value={design.coverage.passRate}
                  note={`${design.coverage.passedRows}/${design.coverage.executedRows} 行通过`}
                />
              </div>
            </details>
          )}

          {saveLabel && (
            <span
              className={`flex items-center gap-1 text-[10px] ${
                saveState === 'conflict' ? 'text-red-600 dark:text-red-400' : 'text-muted'
              }`}
            >
              {saveState === 'saving' ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <Check size={10} />
              )}
              {saveLabel}
            </span>
          )}

          <button
            type="button"
            onClick={() => setInspector({ tab: 'ai', open: true })}
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] ${
              inspector.open && inspector.tab === 'ai'
                ? 'bg-accent/10 text-accent'
                : 'text-muted hover:bg-default hover:text-foreground'
            }`}
            aria-label="AI 助手"
          >
            <Sparkles size={11} />
            AI
          </button>

          <details ref={menuRef} className="relative">
            <summary
              className="grid size-7 cursor-pointer list-none place-items-center rounded text-muted hover:bg-default hover:text-foreground [&::-webkit-details-marker]:hidden"
              aria-label="更多操作"
            >
              <MoreHorizontal size={14} />
            </summary>
            <div className="absolute right-0 top-8 z-30 w-52 rounded-md border border-border bg-surface p-1 text-[11px] shadow-xl">
              <MenuItem
                onSelect={() => {
                  closeMenu()
                  void analyzeCurrentPage()
                }}
                disabled={loading || running}
                icon={<RefreshCw size={11} />}
              >
                重新分析当前页面
              </MenuItem>
              {undo.length > 0 && (
                <MenuItem
                  onSelect={() => {
                    closeMenu()
                    undoDesign()
                    toast.info('已撤销上一步 AI 修改')
                  }}
                  disabled={running}
                  icon={<RotateCcw size={11} />}
                >
                  撤销 AI 修改
                </MenuItem>
              )}
              {saveState === 'conflict' && (
                <MenuItem
                  onSelect={() => {
                    closeMenu()
                    void reloadSession()
                  }}
                  icon={<RefreshCw size={11} />}
                >
                  加载最新会话
                </MenuItem>
              )}
              <MenuItem
                onSelect={() => {
                  closeMenu()
                  close()
                }}
                icon={<ArrowLeft size={11} />}
              >
                返回页面
              </MenuItem>
            </div>
          </details>
        </span>
      </header>

      {!design ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6">
          <div className="text-center">
            <ClipboardCheck size={28} className="mx-auto text-muted/50" />
            <p className="mt-2 text-[12px] text-muted">还没有可展示的测试设计</p>
            <Button
              size="sm"
              variant="primary"
              className="mt-3"
              isDisabled={loading}
              onPress={() => void analyzeCurrentPage()}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              分析当前页面
            </Button>
          </div>
        </div>
      ) : (
        <main
          className={`relative min-h-0 flex-1 overflow-hidden transition-[padding] ${
            inspector.open ? 'xl:pr-[380px]' : ''
          }`}
        >
          <div className="mx-auto flex h-full w-full max-w-[1040px] flex-col px-6">
            {view === 'scenarios' ? (
              <>
                <DesignFilterBar />
                <DesignScenarioView onOpenDetail={openDetail} />
              </>
            ) : (
              <DesignMatrixView />
            )}
          </div>

          {showUndo && lastUndo && (
            <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[10.5px] shadow-lg">
              <span className="text-muted">{lastUndo.label}</span>
              <button
                type="button"
                onClick={() => {
                  undoDesign()
                  toast.info('已撤销上一步 AI 修改')
                }}
                className="font-medium text-accent hover:underline"
              >
                撤销
              </button>
            </div>
          )}
        </main>
      )}

      {design && inspector.open && (
        <>
          <button
            type="button"
            aria-label="关闭详情"
            onClick={() => setInspector((current) => ({ ...current, open: false }))}
            className="absolute inset-x-0 bottom-12 top-[52px] z-10 bg-black/10 xl:hidden"
          />
          <aside className="absolute bottom-12 right-0 top-[52px] z-20 flex w-[380px] max-w-full flex-col border-l border-border bg-surface shadow-2xl">
            <DesignInspector
              tab={inspector.tab}
              onTabChange={(tab) => setInspector({ tab, open: true })}
              onClose={() => setInspector((current) => ({ ...current, open: false }))}
            />
          </aside>
        </>
      )}

      {design && (
        <DesignActionBar
          onAccept={(list) => {
            setAcceptSelections(list)
            setAcceptOpen(true)
          }}
          onRun={requestRun}
        />
      )}

      <ConfirmDialog
        isOpen={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="accent"
        title="执行会写入业务数据"
        confirmLabel={`继续执行 ${runSelections.length} 行`}
        description={
          <span className="flex items-start gap-2">
            <TriangleAlert size={14} className="mt-0.5 shrink-0 text-amber-500" />
            选中的数据行会提交表单并创建业务数据。请确认这是测试环境，并准备好清理方式。
          </span>
        }
        onConfirm={() => runNow(runSelections)}
      />

      <AcceptDesignDialog
        open={acceptOpen}
        selections={acceptSelections}
        onClose={() => setAcceptOpen(false)}
      />

      {design && running && (
        <div className="pointer-events-none fixed bottom-16 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-surface px-3 py-1 text-[10px] text-muted shadow-lg">
          <Loader2 size={10} className="mr-1 inline animate-spin" />
          正在按数据行顺序执行…
        </div>
      )}
    </div>
  )
}

function CoverageRow({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-14 shrink-0 text-muted">{label}</span>
      <span className="w-8 shrink-0 font-medium tabular-nums">
        {value > 0 ? `${Math.round(value * 100)}%` : '—'}
      </span>
      <span className="min-w-0 flex-1 truncate text-[9.5px] text-muted">{note}</span>
    </div>
  )
}

function MenuItem({
  children,
  icon,
  onSelect,
  disabled,
}: {
  children: ReactNode
  icon: ReactNode
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-muted hover:bg-default hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
    >
      {icon}
      {children}
    </button>
  )
}
