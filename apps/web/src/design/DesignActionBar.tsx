import type { DesignSelection } from '@atp/model'
import { Button, toast } from '@heroui/react'
import { Database, Loader2, Play, Square, XCircle } from 'lucide-react'
import { useMemo } from 'react'
import { useUiStore } from '../state/ui-store'

export function useDesignSelections(): DesignSelection[] {
  const design = useUiStore((s) => s.design)
  const rowSelected = useUiStore((s) => s.designRowSelected)
  return useMemo(() => {
    if (!design) return []
    return rowSelected
      .map((key) => {
        const index = key.indexOf('::')
        if (index < 0) return null
        const scenarioId = key.slice(0, index)
        const dataRecordId = key.slice(index + 2)
        const scenario = design.scenarios.find((item) => item.id === scenarioId)
        const record = design.dataRecords?.[dataRecordId]
        if (
          !scenario ||
          !record ||
          record.status !== 'ready' ||
          scenario.status === 'rejected' ||
          scenario.status === 'excluded'
        ) {
          return null
        }
        return { scenarioId, dataRecordId }
      })
      .filter((item): item is DesignSelection => item !== null)
  }, [design, rowSelected])
}

export function DesignActionBar({
  onAccept,
  onRun,
}: {
  onAccept: (selections: DesignSelection[]) => void
  onRun: (selections: DesignSelection[]) => void
}) {
  const design = useUiStore((s) => s.design)
  const selectedScenarioIds = useUiStore((s) => s.designSelected)
  const running = useUiStore((s) => s.designRunning)
  const decide = useUiStore((s) => s.decideDesignScenario)
  const selections = useDesignSelections()

  if (!design) return null

  const writeRows = selections.filter((selection) => {
    const scenario = design.scenarios.find((item) => item.id === selection.scenarioId)
    return scenario?.requiresWrite === true
  }).length

  const exclude = (): void => {
    if (selectedScenarioIds.length === 0) {
      toast.info('先勾选要排除的场景')
      return
    }
    for (const id of selectedScenarioIds) decide(id, 'rejected')
    toast.success(`已排除 ${selectedScenarioIds.length} 个场景，不计入覆盖`)
  }

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-t border-border bg-surface px-4">
      <div className="min-w-0 text-[10.5px] text-muted">
        <span data-design-selected-rows={selections.length}>
          已选 <span className="font-medium text-foreground">{selectedScenarioIds.length}</span>{' '}
          个场景 / <span className="font-medium text-foreground">{selections.length}</span> 行
        </span>
        {writeRows > 0 && (
          <span className="ml-2 text-purple-600 dark:text-purple-400">
            · {writeRows} 行会写业务数据
          </span>
        )}
      </div>

      <span className="ml-auto flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          isDisabled={running || selectedScenarioIds.length === 0}
          onPress={exclude}
        >
          <XCircle size={11} />
          排除所选
        </Button>
        <Button
          size="sm"
          variant="secondary"
          isDisabled={running || selections.length === 0}
          onPress={() => onAccept(selections)}
        >
          <Database size={11} />
          接受并入库
        </Button>
        {running ? (
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              void window.atp.invoke('design:stop').catch((err: unknown) => {
                toast.danger(err instanceof Error ? err.message : '停止执行失败')
              })
            }}
          >
            <Square size={10} fill="currentColor" />
            停止
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            isDisabled={selections.length === 0}
            onPress={() => onRun(selections)}
          >
            <Play size={11} />
            执行选中
          </Button>
        )}
        {running && <Loader2 size={12} className="animate-spin text-muted" />}
      </span>
    </div>
  )
}
