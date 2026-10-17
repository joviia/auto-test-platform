import type { CaseRow, ModuleRow, SuiteRow } from '@atp/model'
import { Button, Input, Modal, toast } from '@heroui/react'
import { useQueryClient } from '@tanstack/react-query'
import { ListChecks, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { qk, useCases, useModules, usePlan, useSuite, useSuites } from '../api/client'
import { useOverlayGuard } from '../hooks/use-overlay-guard'

const selectClass =
  'h-9 w-full rounded-md border border-border bg-field px-2 text-sm text-foreground outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15'

function moduleLabel(modules: ModuleRow[], id: string | null): string {
  if (!id) return '未分组'
  const map = new Map(modules.map((m) => [m.id, m]))
  const parts: string[] = []
  let cur = map.get(id)
  let guard = 0
  while (cur && guard < 20) {
    parts.unshift(cur.name)
    cur = cur.parentId ? map.get(cur.parentId) : undefined
    guard++
  }
  return parts.join(' / ') || '未分组'
}

function CasePicker({
  cases,
  modules,
  selected,
  onChange,
}: {
  cases: CaseRow[]
  modules: ModuleRow[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const filtered = cases.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
  const groups = useMemo(() => {
    const map = new Map<string, CaseRow[]>()
    for (const c of filtered) {
      const key = moduleLabel(modules, c.moduleId)
      const list = map.get(key) ?? []
      list.push(c)
      map.set(key, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
  }, [filtered, modules])

  const toggle = (id: string): void => {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索用例"
            className="h-7 py-1 pl-7 text-xs"
          />
        </div>
        <span className="shrink-0 text-[11px] text-muted">已选 {selected.length}</span>
        <button
          type="button"
          onClick={() => onChange(filtered.map((c) => c.id))}
          className="shrink-0 text-[11px] text-accent hover:underline"
        >
          全选
        </button>
        <button
          type="button"
          onClick={() => onChange([])}
          className="shrink-0 text-[11px] text-muted hover:text-foreground"
        >
          清空
        </button>
      </div>
      <div className="max-h-56 overflow-auto p-1.5">
        {groups.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted">没有匹配的用例</p>
        )}
        {groups.map(([label, list]) => (
          <div key={label} className="mb-1.5">
            <p className="px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              {label}
            </p>
            {list.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-surface-secondary"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted">{c.id}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function SuiteDialog({
  open,
  projectId,
  suiteId,
  onClose,
}: {
  open: boolean
  projectId: string
  suiteId?: string | null
  onClose: () => void
}) {
  useOverlayGuard(open)
  const qc = useQueryClient()
  const { data: cases = [] } = useCases(projectId)
  const { data: modules = [] } = useModules(projectId)
  const { data: existing } = useSuite(suiteId ?? null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [caseIds, setCaseIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (existing) {
      setName(existing.suite.name)
      setDescription(existing.suite.description ?? '')
      setCaseIds(existing.caseIds)
    }
  }, [existing])

  useEffect(() => {
    if (open && !suiteId) {
      setName('')
      setDescription('')
      setCaseIds([])
    }
  }, [open, suiteId])

  const save = async (): Promise<void> => {
    if (!name.trim()) return
    setSaving(true)
    try {
      if (suiteId) {
        await window.atp.invoke('suite:update', {
          id: suiteId,
          name: name.trim(),
          description: description.trim() || undefined,
          caseIds,
        })
        toast.success('套件已更新')
      } else {
        await window.atp.invoke('suite:create', {
          projectId,
          name: name.trim(),
          description: description.trim() || undefined,
          caseIds,
        })
        toast.success('套件已创建')
      }
      void qc.invalidateQueries({ queryKey: qk.suites(projectId) })
      if (suiteId) void qc.invalidateQueries({ queryKey: qk.suite(suiteId) })
      onClose()
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '保存套件失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal.Root isOpen onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{suiteId ? '编辑套件' : '新建套件'}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="space-y-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted" htmlFor="atp-suite-name">
                  套件名称
                </label>
                <Input
                  id="atp-suite-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：登录回归"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted" htmlFor="atp-suite-desc">
                  描述（可选）
                </label>
                <Input
                  id="atp-suite-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="这套件覆盖什么"
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted">用例</p>
                <CasePicker
                  cases={cases}
                  modules={modules}
                  selected={caseIds}
                  onChange={setCaseIds}
                />
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onPress={onClose}>
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                isDisabled={!name.trim() || saving}
                onPress={() => void save()}
              >
                {saving ? '保存中…' : suiteId ? '保存套件' : '创建套件'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  )
}

export function PlanDialog({
  open,
  projectId,
  planId,
  onClose,
  onSaved,
}: {
  open: boolean
  projectId: string
  planId?: string | null
  onClose: () => void
  onSaved?: (planId: string) => void
}) {
  useOverlayGuard(open)
  const qc = useQueryClient()
  const { data: cases = [] } = useCases(projectId)
  const { data: modules = [] } = useModules(projectId)
  const { data: suites = [] } = useSuites(projectId)
  const { data: existing } = usePlan(planId ?? null)

  const [name, setName] = useState('')
  const [caseIds, setCaseIds] = useState<string[]>([])
  const [retries, setRetries] = useState(0)
  const [timeoutMs, setTimeoutMs] = useState(15000)
  const [continueOnFailure, setContinueOnFailure] = useState(true)
  const [suiteId, setSuiteId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (existing) {
      setName(existing.plan.name)
      setCaseIds(existing.caseIds)
      setRetries(existing.plan.retries)
      setTimeoutMs(existing.plan.timeoutMs)
      setContinueOnFailure(existing.plan.continueOnFailure)
    }
  }, [existing])

  useEffect(() => {
    if (open && !planId) {
      setName('')
      setCaseIds([])
      setRetries(0)
      setTimeoutMs(15000)
      setContinueOnFailure(true)
      setSuiteId('')
    }
  }, [open, planId])

  const applySuite = async (id: string): Promise<void> => {
    setSuiteId(id)
    if (!id) return
    try {
      const detail = await window.atp.invoke('suite:get', { id })
      setCaseIds(detail.caseIds)
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '读取套件失败')
    }
  }

  const save = async (): Promise<void> => {
    if (!name.trim() || caseIds.length === 0) return
    setSaving(true)
    try {
      let saved: { id: string }
      if (planId) {
        saved = await window.atp.invoke('plan:update', {
          id: planId,
          name: name.trim(),
          caseIds,
          retries,
          timeoutMs,
          continueOnFailure,
        })
        toast.success('计划已更新')
      } else {
        saved = await window.atp.invoke('plan:create', {
          projectId,
          name: name.trim(),
          suiteId: suiteId || null,
          caseIds,
          retries,
          timeoutMs,
          continueOnFailure,
        })
        toast.success('计划已创建')
      }
      void qc.invalidateQueries({ queryKey: qk.plans(projectId) })
      if (planId) void qc.invalidateQueries({ queryKey: qk.plan(planId) })
      onSaved?.(saved.id)
      onClose()
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '保存计划失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal.Root isOpen onOpenChange={(next) => !next && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{planId ? '编辑测试计划' : '新建测试计划'}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted" htmlFor="atp-plan-name">
                    计划名称
                  </label>
                  <Input
                    id="atp-plan-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：P0 登录回归"
                    autoFocus
                  />
                </div>
                {!planId && (
                  <div className="space-y-1.5">
                    <label
                      className="block text-xs font-medium text-muted"
                      htmlFor="atp-plan-suite"
                    >
                      从套件导入（可选）
                    </label>
                    <select
                      id="atp-plan-suite"
                      className={selectClass}
                      value={suiteId}
                      onChange={(e) => void applySuite(e.target.value)}
                    >
                      <option value="">不导入，手动选择</option>
                      {suites.map((s: SuiteRow) => (
                        <option key={s.id} value={s.id}>
                          {s.name}（{s.caseCount} 条）
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted">计划用例</p>
                <CasePicker
                  cases={cases}
                  modules={modules}
                  selected={caseIds}
                  onChange={setCaseIds}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label
                    className="block text-xs font-medium text-muted"
                    htmlFor="atp-plan-retries"
                  >
                    失败重试
                  </label>
                  <select
                    id="atp-plan-retries"
                    className={selectClass}
                    value={retries}
                    onChange={(e) => setRetries(Number(e.target.value))}
                  >
                    {[0, 1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n} 次
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label
                    className="block text-xs font-medium text-muted"
                    htmlFor="atp-plan-timeout"
                  >
                    用例超时（ms）
                  </label>
                  <Input
                    id="atp-plan-timeout"
                    type="number"
                    value={String(timeoutMs)}
                    onChange={(e) => setTimeoutMs(Number(e.target.value))}
                  />
                </div>
                <label className="flex items-end gap-2 pb-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={continueOnFailure}
                    onChange={(e) => setContinueOnFailure(e.target.checked)}
                  />
                  失败后继续执行
                </label>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" size="sm" onPress={onClose}>
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                isDisabled={!name.trim() || caseIds.length === 0 || saving}
                onPress={() => void save()}
              >
                {saving ? '保存中…' : planId ? '保存计划' : '创建计划'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  )
}

export function PlanEmptyIcon() {
  return <ListChecks size={16} />
}
