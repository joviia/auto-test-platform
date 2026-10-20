import type { DesignMatrix } from '@atp/model'
import { Button, toast } from '@heroui/react'
import { ClipboardCheck, Loader2, RefreshCw, SquareArrowOutUpRight, X } from 'lucide-react'
import { adoptDesignMatrix } from '../design/useDesignPersistence'
import { useUiStore } from '../state/ui-store'

/** 从当前页面分析测试设计矩阵；AI 对话与摘要卡内「重新分析」共用 */
export async function analyzeCurrentPage(options?: {
  silentSuccess?: boolean
  openEntry?: boolean
}): Promise<DesignMatrix | null> {
  const store = useUiStore.getState()
  store.setDesignLoading(true)
  try {
    const matrix = await window.atp.invoke(
      'design:analyze',
      options?.openEntry ? { openEntry: true } : {},
    )
    adoptDesignMatrix(matrix)
    useUiStore.getState().setDesign(matrix)
    if (!options?.silentSuccess) {
      if (matrix.scenarios.length === 0) {
        toast.info(matrix.skipped[0]?.reason ?? '当前页面没有可生成的测试场景')
      } else {
        toast.success(`测试设计：${matrix.stats.scenarios} 个场景 / ${matrix.stats.rows} 行数据`)
      }
    }
    return matrix
  } catch (err) {
    useUiStore.getState().setDesignLoading(false)
    toast.danger(err instanceof Error ? err.message : '测试设计分析失败')
    return null
  }
}

/**
 * 聊天里的设计摘要卡。
 * 完整矩阵在独立的全屏工作台里审阅、编辑与执行，这里只负责发起和回摘要。
 */
export function TestDesignCard() {
  const design = useUiStore((s) => s.design)
  const loading = useUiStore((s) => s.designLoading)
  const running = useUiStore((s) => s.designRunning)
  const setOpen = useUiStore((s) => s.setDesignWorkbenchOpen)
  const resetDesign = useUiStore((s) => s.resetDesign)

  if (!design && !loading) return null

  if (loading && !design) {
    return (
      <div className="mx-2.5 mb-2 flex items-center gap-2 rounded-lg border border-border bg-field px-3 py-2.5 text-[11px] text-muted">
        <Loader2 size={13} className="animate-spin text-accent" />
        正在分析当前页面，识别字段与测试规范…
      </div>
    )
  }
  if (!design) return null

  const pendingRows = design.stats.pendingRows
  const readyRows = design.stats.readyRows
  const pendingScenarios = design.coverage.pendingScenarios
  const firstSkip = design.skipped[0]

  return (
    <div
      data-design-summary
      className="mx-2.5 mb-2 overflow-hidden rounded-lg border border-border bg-field"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ClipboardCheck size={13} className="shrink-0 text-accent" />
        <span className="min-w-0 truncate text-[11.5px] font-semibold">
          测试设计 · {design.scopeLabel ?? (design.title || design.url)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void analyzeCurrentPage()}
            disabled={loading || running}
            className="grid size-6 place-items-center rounded text-muted hover:bg-default hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="重新分析"
            title="重新分析当前页面"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button
            type="button"
            onClick={resetDesign}
            disabled={running}
            className="grid size-6 place-items-center rounded text-muted hover:bg-default hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="关闭测试设计"
            title="关闭"
          >
            <X size={12} />
          </button>
        </span>
      </div>

      <div className="px-3 py-2">
        <p className="text-[11px] leading-5 text-foreground" data-design-summary-counts>
          已生成 <strong>{design.stats.scenarios}</strong> 个场景 /{' '}
          <strong>{design.stats.rows}</strong> 行数据
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted">
          <span className="text-emerald-600 dark:text-emerald-400">可执行 {readyRows} 行</span>
          {pendingRows > 0 && (
            <>
              <span>·</span>
              <span className="text-amber-600 dark:text-amber-400">待确认 {pendingRows} 行</span>
            </>
          )}
          {design.stats.skipped > 0 && (
            <>
              <span>·</span>
              <span>跳过 {design.stats.skipped} 项</span>
            </>
          )}
          <span>·</span>
          <span>设计覆盖 {Math.round(design.coverage.designCoverage * 100)}%</span>
        </p>
        {pendingScenarios > 0 && firstSkip && (
          <p className="mt-1 truncate text-[9.5px] text-amber-600 dark:text-amber-400">
            {firstSkip.fieldLabel ? `${firstSkip.fieldLabel}：` : ''}
            {firstSkip.reason}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-border px-2.5 py-2">
        <Button
          size="sm"
          variant="primary"
          className="min-w-0 flex-1"
          onPress={() => setOpen(true)}
        >
          <SquareArrowOutUpRight size={12} />
          打开设计工作台
        </Button>
      </div>
    </div>
  )
}
