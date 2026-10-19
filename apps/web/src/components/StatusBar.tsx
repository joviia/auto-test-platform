import { CircleDot, Database, FlaskConical, ListChecks, Play, Radio } from 'lucide-react'
import { useCases, useProjects } from '../api/client'
import { useUiStore } from '../state/ui-store'

export function StatusBar() {
  const { data: projects = [] } = useProjects()
  const currentProjectId = useUiStore((s) => s.currentProjectId)
  const { data: cases = [] } = useCases(currentProjectId)
  const recording = useUiStore((s) => s.recording)
  const selected = useUiStore((s) => s.selected)
  const planProgress = useUiStore((s) => s.planProgress)

  const project = projects.find((p) => p.id === currentProjectId)
  const planRunning = Boolean(planProgress && planProgress.phase !== 'run-end')

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <Database size={11} />
        本地存储
      </span>
      <span className="flex items-center gap-1.5">
        <FlaskConical size={11} />
        {project ? `${project.name} · ${cases.length} 条用例` : '尚未创建项目'}
      </span>
      {selected?.kind === 'case' && (
        <span className="flex items-center gap-1.5">
          <CircleDot size={11} />
          已选用例
        </span>
      )}
      {selected?.kind === 'plan' && (
        <span className="flex items-center gap-1.5">
          <ListChecks size={11} />
          已选计划
        </span>
      )}
      <span className="ml-auto flex items-center gap-3">
        {recording ? (
          <span className="flex items-center gap-1.5 font-medium text-red-600 dark:text-red-400">
            <Radio size={11} />
            录制中
          </span>
        ) : planRunning ? (
          <span className="flex items-center gap-1.5 font-medium text-accent">
            <ListChecks size={11} />
            计划执行中 {planProgress?.caseIndex !== undefined ? planProgress.caseIndex + 1 : 0}/
            {planProgress?.caseTotal ?? 0}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <Play size={11} />
            就绪
          </span>
        )}
        <span className="font-mono text-[10px]">v0.1.0</span>
      </span>
    </footer>
  )
}
