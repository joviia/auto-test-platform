import type { DesignCase, DesignSelection } from '@atp/model'
import { Button, Modal, toast } from '@heroui/react'
import { useQueryClient } from '@tanstack/react-query'
import { Database, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { qk, useModules, useProjects } from '../api/client'
import { useOverlayGuard } from '../hooks/use-overlay-guard'
import { useUiStore } from '../state/ui-store'

const selectClass =
  'h-9 w-full rounded-md border border-border bg-field px-2 text-sm text-foreground outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15'

/**
 * 接受并入库：把选中的可执行数据行生成用例并写入用例库。
 * 入库是持久化资产创建，必须由用户确认；AI 不能代为执行。
 */
export function AcceptDesignDialog({
  open,
  selections,
  onClose,
}: {
  open: boolean
  selections: DesignSelection[]
  onClose: () => void
}) {
  useOverlayGuard(open)
  const design = useUiStore((s) => s.design)
  const currentProjectId = useUiStore((s) => s.currentProjectId)
  const setCurrentProjectId = useUiStore((s) => s.setCurrentProjectId)
  const markDesignSaved = useUiStore((s) => s.markDesignSaved)
  const setDesignWorkbenchOpen = useUiStore((s) => s.setDesignWorkbenchOpen)
  const { data: projects = [] } = useProjects()
  const [projectId, setProjectId] = useState(currentProjectId ?? '')
  const [moduleId, setModuleId] = useState('')
  const { data: modules = [] } = useModules(projectId || null)
  const [cases, setCases] = useState<DesignCase[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const qc = useQueryClient()

  useEffect(() => {
    if (!projectId) setProjectId(projects[0]?.id ?? '')
  }, [projects, projectId])

  useEffect(() => {
    if (!open || !design || selections.length === 0) {
      setCases([])
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    // 执行前已经生成过用例草稿（带元素定位）；优先复用，避免页面提交后元素变化导致重新解析失败
    const existing = useUiStore.getState().designCases
    const byRecord = new Map(existing.map((item) => [item.dataRecordId, item]))
    const reused = selections
      .map((selection) => byRecord.get(selection.dataRecordId))
      .filter((item): item is DesignCase => Boolean(item))
    const missing = selections.filter((selection) => !byRecord.has(selection.dataRecordId))
    if (missing.length === 0) {
      setCases(reused)
      setLoading(false)
      return
    }
    void window.atp
      .invoke('design:generate', { matrix: design, selections: missing })
      .then((result: { cases: DesignCase[] }) => {
        if (!cancelled) setCases([...reused, ...result.cases])
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setCases(reused)
        setError(
          `${err instanceof Error ? err.message : '生成用例失败'}${
            reused.length > 0 ? `；已有 ${reused.length} 条草稿仍可入库` : ''
          }`,
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // 只在打开或选择变化时重新生成；矩阵编辑由外层重新计算 selections
  }, [open, design, selections])

  const stats = useMemo(() => {
    let steps = 0
    let assertions = 0
    let skipped = 0
    for (const item of cases) {
      const saved = design?.dataRecords?.[item.dataRecordId]?.savedCaseId
      if (saved) {
        skipped += 1
        continue
      }
      steps += item.caseFile.case.steps.length
      assertions += item.caseFile.case.steps.filter((step) => step.action === 'assert').length
    }
    return {
      cases: cases.length - skipped,
      skipped,
      steps,
      assertions,
    }
  }, [cases, design])

  const writeRows = useMemo(() => {
    if (!design) return 0
    return selections.filter((selection) => {
      const scenario = design.scenarios.find((item) => item.id === selection.scenarioId)
      return scenario?.requiresWrite === true
    }).length
  }, [design, selections])

  const save = async (): Promise<void> => {
    if (!design || !projectId || cases.length === 0) return
    setSaving(true)
    const created: Array<{ scenarioId: string; dataRecordId: string; caseId: string }> = []
    let failed = 0
    let firstError = ''
    try {
      for (const item of cases) {
        const record = design.dataRecords?.[item.dataRecordId]
        if (record?.savedCaseId) continue
        try {
          const file = item.caseFile
          const row = await window.atp.invoke('case:create', {
            projectId,
            moduleId: moduleId || null,
            name: file.case.name,
            startUrl: file.case.startUrl,
          })
          await window.atp.invoke('case:update', {
            case: {
              ...row.case,
              name: file.case.name,
              startUrl: file.case.startUrl,
              steps: file.case.steps,
              intent: file.case.intent,
              groups: file.case.groups,
            },
            elements: file.elements,
          })
          created.push({
            scenarioId: item.scenarioId,
            dataRecordId: item.dataRecordId,
            caseId: row.case.id,
          })
          void qc.invalidateQueries({ queryKey: qk.caseFile(row.case.id) })
        } catch (err) {
          failed += 1
          if (!firstError) {
            firstError = err instanceof Error ? err.message : String(err)
          }
        }
      }
      if (created.length > 0) {
        markDesignSaved(created)
        setCurrentProjectId(projectId)
        void qc.invalidateQueries({ queryKey: qk.cases(projectId) })
      }
      if (failed > 0) {
        toast.danger(
          `${created.length > 0 ? `已入库 ${created.length} 条，` : ''}${failed} 条失败：${firstError}`,
        )
      } else {
        toast.success(`已入库 ${created.length} 条用例，并标记为已接受`)
      }
      if (created.length > 0) {
        onClose()
        // 入库后关掉工作台，让用户直接看到用例库
        setDesignWorkbenchOpen(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal.Root isOpen={open} onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>接受并入库</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="space-y-4">
              <p className="text-[11.5px] leading-5 text-muted">
                每个选中的可执行数据行会生成一条独立用例（名称带行标签），保存后场景标记为已接受。
              </p>

              <div className="grid grid-cols-4 gap-2">
                <Summary label="用例" value={stats.cases} />
                <Summary label="步骤" value={stats.steps} />
                <Summary label="断言" value={stats.assertions} />
                <Summary label="写数据行" value={writeRows} warn={writeRows > 0} />
              </div>

              {stats.skipped > 0 && (
                <p className="text-[10px] text-muted">
                  其中 {stats.skipped} 行已有入库记录，本次会跳过。
                </p>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted" htmlFor="design-project">
                    归属项目
                  </label>
                  <select
                    id="design-project"
                    className={selectClass}
                    value={projectId}
                    onChange={(event) => {
                      setProjectId(event.target.value)
                      setModuleId('')
                    }}
                  >
                    <option value="" disabled>
                      选择项目
                    </option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted" htmlFor="design-module">
                    模块（可选）
                  </label>
                  <select
                    id="design-module"
                    className={selectClass}
                    value={moduleId}
                    onChange={(event) => setModuleId(event.target.value)}
                  >
                    <option value="">（不放入模块）</option>
                    {modules.map((module) => (
                      <option key={module.id} value={module.id}>
                        {module.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {writeRows > 0 && (
                <p className="rounded border border-purple-500/25 bg-purple-500/[0.06] px-2.5 py-2 text-[10.5px] leading-4 text-purple-700 dark:text-purple-300">
                  选中行中有 {writeRows}{' '}
                  行会创建业务数据。入库只生成用例，不会执行；执行前仍需确认测试数据与清理方式。
                </p>
              )}

              {loading && (
                <p className="flex items-center gap-1.5 text-[10.5px] text-muted">
                  <Loader2 size={11} className="animate-spin" />
                  正在生成用例草稿并校验页面元素…
                </p>
              )}
              {error && (
                <p className="rounded border border-red-500/25 bg-red-500/[0.05] px-2.5 py-2 text-[10.5px] leading-4 text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onPress={onClose} isDisabled={saving}>
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                isDisabled={loading || saving || cases.length === 0 || !projectId}
                onPress={() => void save()}
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
                {saving ? '入库中…' : `入库 ${stats.cases} 条用例`}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  )
}

function Summary({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-surface-secondary px-2.5 py-2">
      <p className="text-[10px] text-muted">{label}</p>
      <p
        className={`text-lg font-semibold tabular-nums ${
          warn ? 'text-purple-600 dark:text-purple-400' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}
