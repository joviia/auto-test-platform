import type { CaseFile, ElementRow, Locator } from '@atp/model'
import { Button, Input, toast } from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Boxes, Save, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { qk } from '../api/client'
import { EmptyHint } from '../components/EmptyHint'
import { useUiStore } from '../state/ui-store'

const LOCATOR_LABEL: Record<Locator['type'], string> = {
  testId: 'testId',
  role: 'role',
  text: 'text',
  css: 'css',
}

const LOCATOR_STYLE: Record<Locator['type'], string> = {
  testId: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  role: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  text: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  css: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
}

function locatorText(loc: Locator): string {
  return loc.type === 'role' && loc.name ? `${loc.value}「${loc.name}」` : loc.value
}

export function ElementPanel() {
  const selected = useUiStore((s) => s.selected)
  const qc = useQueryClient()
  const caseId = selected?.kind === 'case' ? selected.id : null

  const { data: file } = useQuery({
    queryKey: caseId ? qk.caseFile(caseId) : ['case', 'none'],
    queryFn: () => window.atp.invoke('case:get', { id: caseId as string }),
    enabled: Boolean(caseId),
  })

  const [draft, setDraft] = useState<CaseFile | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(file ?? null)
  }, [file])

  const baseline = useMemo(() => (file ? JSON.stringify(file) : ''), [file])
  const dirty = Boolean(draft) && JSON.stringify(draft) !== baseline

  if (!caseId) {
    return (
      <EmptyHint
        icon={Boxes}
        title="在左侧选择一条用例"
        description="元素随录制自动登记，修改定位器会对所有引用它的用例生效"
      />
    )
  }
  if (!draft) return <div className="p-3 text-xs text-muted">加载中…</div>

  const elements = Object.values(draft.elements)

  const patchElement = (id: string, patch: Partial<ElementRow>): void =>
    setDraft((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      const el = next.elements[id]
      if (el) Object.assign(el, patch)
      return next
    })

  const removeLocator = (elementId: string, idx: number): void =>
    setDraft((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      const el = next.elements[elementId]
      if (el && el.locators.length > 1) el.locators.splice(idx, 1)
      return next
    })

  const save = async (): Promise<void> => {
    if (!draft || saving) return
    setSaving(true)
    try {
      const saved = await window.atp.invoke('case:update', draft)
      qc.setQueryData(qk.caseFile(draft.case.id), saved)
      void qc.invalidateQueries({ queryKey: qk.cases(draft.case.projectId) })
      toast.success('元素已保存（对所有引用它的用例生效）')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="text-[13px] font-medium">元素库</span>
        <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted">
          {elements.length}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
          修改定位器会影响所有引用它的用例
        </span>
        <Button
          size="sm"
          variant="primary"
          isDisabled={!dirty || saving}
          onPress={() => void save()}
        >
          <Save size={12} />
          {saving ? '保存中…' : '保存'}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {elements.length === 0 ? (
          <EmptyHint
            icon={Boxes}
            title="该用例还没有引用元素"
            description="录制后，操作过的元素会自动登记到这里"
            compact
          />
        ) : (
          <div className="space-y-1.5">
            {elements.map((el) => (
              <div key={el.id} className="rounded-md border border-border bg-surface p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={el.name}
                    onChange={(e) => patchElement(el.id, { name: e.target.value })}
                    className="h-8 py-1 text-[13px] font-medium"
                    aria-label="元素名称"
                  />
                  <span className="shrink-0 font-mono text-[10px] text-muted">{el.id}</span>
                </div>
                <div className="mt-1.5 space-y-1">
                  {el.locators.map((loc, idx) => (
                    <div
                      key={`${loc.type}:${loc.value}:${idx}`}
                      className="group flex items-center gap-1.5 rounded bg-surface-secondary px-1.5 py-1"
                    >
                      <span
                        className={`w-12 shrink-0 rounded px-1 text-center font-mono text-[10px] ${LOCATOR_STYLE[loc.type]}`}
                      >
                        {LOCATOR_LABEL[loc.type]}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80">
                        {locatorText(loc)}
                      </span>
                      <button
                        type="button"
                        disabled={el.locators.length <= 1}
                        onClick={() => removeLocator(el.id, idx)}
                        className="grid size-5 shrink-0 place-items-center rounded text-muted opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
                        aria-label="删除该候选定位器"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
