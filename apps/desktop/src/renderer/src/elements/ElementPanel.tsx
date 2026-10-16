import type { CaseFile, ElementRow, Locator } from '@atp/model'
import { Button, Input } from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { qk } from '../api/client'
import { useUiStore } from '../state/ui-store'

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
  const [status, setStatus] = useState('')
  useEffect(() => {
    setDraft(file ?? null)
    setStatus('')
  }, [file])

  if (!caseId) return <p className="text-default-400">在左树选择一条用例</p>
  if (!draft) return <p className="text-default-400">加载中…</p>

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
    if (!draft) return
    setStatus('保存中…')
    await window.atp.invoke('case:update', draft)
    void qc.invalidateQueries({ queryKey: qk.caseFile(caseId) })
    void qc.invalidateQueries({ queryKey: qk.cases(draft.case.projectId) })
    setStatus('已保存 ✓（元素修复对所有引用它的用例生效）')
  }

  const locatorText = (loc: Locator): string =>
    loc.type === 'role' && loc.name ? `${loc.value}「${loc.name}」` : loc.value

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-2">
        <span className="text-sm font-medium">元素库（{elements.length}）</span>
        <div className="flex items-center gap-1">
          {status && <span className="text-xs text-default-400">{status}</span>}
          <Button size="sm" variant="primary" onPress={() => void save()}>
            <Save size={14} />
            保存
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-2 pb-2">
        {elements.length === 0 && <p className="text-default-400">该用例还没有引用元素</p>}
        {elements.map((el) => (
          <div key={el.id} className="rounded-lg border border-default-200 p-2 text-sm">
            <Input
              value={el.name}
              onChange={(e) => patchElement(el.id, { name: e.target.value })}
            />
            <div className="mt-1 space-y-1">
              {el.locators.map((loc, idx) => (
                <div key={`${loc.type}:${loc.value}`} className="flex items-center gap-1">
                  <span className="w-14 shrink-0 rounded bg-default-100 px-1 text-center text-xs">
                    {loc.type}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-default-600">
                    {locatorText(loc)}
                  </span>
                  <Button
                    variant="ghost"
                    isDisabled={el.locators.length <= 1}
                    onPress={() => removeLocator(el.id, idx)}
                  >
                    <X size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
