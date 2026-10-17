import type { CaseFile, Locator, Step } from '@atp/model'
import { Button, Input, Modal, toast } from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Download, GripVertical, ListTree, Save, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { qk } from '../api/client'
import { EmptyHint } from '../components/EmptyHint'
import { useOverlayGuard } from '../hooks/use-overlay-guard'
import { useUiStore } from '../state/ui-store'
import { ACTION_META, stepPreview } from './step-meta'

const LOCATOR_LABEL: Record<Locator['type'], string> = {
  testId: 'testId',
  role: 'role',
  text: 'text',
  css: 'css',
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function locatorText(loc: Locator): string {
  return loc.type === 'role' && loc.name ? `${loc.value}「${loc.name}」` : loc.value
}

export function StepPanel() {
  const selected = useUiStore((s) => s.selected)
  const qc = useQueryClient()
  const caseId = selected?.kind === 'case' ? selected.id : null

  const { data: file } = useQuery({
    queryKey: caseId ? qk.caseFile(caseId) : ['case', 'none'],
    queryFn: () => window.atp.invoke('case:get', { id: caseId as string }),
    enabled: Boolean(caseId),
  })

  const [draft, setDraft] = useState<CaseFile | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [exportedCode, setExportedCode] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState('')
  const [copied, setCopied] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  useOverlayGuard(exportedCode !== null)

  useEffect(() => {
    setDraft(file ?? null)
    setSavedAt('')
  }, [file])

  useEffect(() => {
    if (!caseId) return
    setExpandedId(null)
    setDragIndex(null)
    setOverIndex(null)
  }, [caseId])

  const baseline = useMemo(() => (file ? JSON.stringify(file) : ''), [file])
  const dirty = Boolean(draft) && JSON.stringify(draft) !== baseline

  const save = async (): Promise<void> => {
    if (!draft || saving) return
    setSaving(true)
    try {
      const saved = await window.atp.invoke('case:update', draft)
      qc.setQueryData(qk.caseFile(draft.case.id), saved)
      void qc.invalidateQueries({ queryKey: qk.cases(draft.case.projectId) })
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
      toast.success('用例已保存')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  // ⌘S / Ctrl+S 保存
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (!caseId) {
    return (
      <EmptyHint
        icon={ListTree}
        title="在左侧选择一条用例"
        description="选中后可编辑步骤、维护元素定位器，并导出 Playwright 脚本"
      />
    )
  }
  if (!draft) return <div className="p-3 text-xs text-muted">加载中…</div>

  const mutate = (fn: (d: CaseFile) => void): void => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      fn(next)
      return next
    })
    setSavedAt('')
  }

  const patchStep = (idx: number, patch: Partial<Step>): void =>
    mutate((d) => {
      d.case.steps[idx] = { ...d.case.steps[idx], ...patch }
    })

  const setAssertion = (idx: number, raw: unknown): void =>
    mutate((d) => {
      const step = d.case.steps[idx]
      step.assertion = raw === null ? undefined : (raw as NonNullable<Step['assertion']>)
    })

  const reorder = (from: number, to: number): void =>
    mutate((d) => {
      d.case.steps = move(d.case.steps, from, to)
    })

  const exportTs = async (): Promise<void> => {
    if (!caseId) return
    try {
      const { code } = await window.atp.invoke('case:export-ts', { id: caseId })
      setExportedCode(code)
      setCopied(false)
      setSavedPath('')
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '导出失败')
    }
  }

  const saveTsFile = async (): Promise<void> => {
    if (!caseId) return
    try {
      const result = await window.atp.invoke('case:export-ts-file', { id: caseId })
      if (result.saved && result.path) {
        setSavedPath(result.path)
        toast.success('脚本已保存')
      }
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '保存脚本失败')
    }
  }

  const steps = draft.case.steps

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{draft.case.name}</span>
        {dirty ? (
          <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
            未保存
          </span>
        ) : (
          savedAt && <span className="text-[10px] text-muted">{savedAt} 已保存</span>
        )}
        <Button size="sm" variant="secondary" onPress={() => void exportTs()}>
          <Download size={12} />
          导出 TS
        </Button>
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
        {steps.length === 0 ? (
          <EmptyHint
            icon={ListTree}
            title="还没有步骤"
            description="在中间工具栏点击「开始录制」，操作被测页面后停止并保存，步骤会自动出现在这里。"
            compact
          />
        ) : (
          <div className="space-y-1.5">
            {steps.map((step, idx) => {
              const element = draft.elements[step.elementId ?? '']
              const meta = ACTION_META[step.action]
              const expanded = expandedId === step.id
              const preview = stepPreview(step)
              const isDropTarget = overIndex === idx && dragIndex !== null && dragIndex !== idx

              return (
                <div
                  key={step.id}
                  draggable
                  onDragStart={() => setDragIndex(idx)}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setOverIndex(idx)
                  }}
                  onDragLeave={() => setOverIndex((v) => (v === idx ? null : v))}
                  onDrop={() => {
                    if (dragIndex !== null && dragIndex !== idx) reorder(dragIndex, idx)
                    setDragIndex(null)
                    setOverIndex(null)
                  }}
                  onDragEnd={() => {
                    setDragIndex(null)
                    setOverIndex(null)
                  }}
                  className={`group rounded-md border bg-surface transition-colors ${
                    isDropTarget
                      ? 'border-accent ring-2 ring-accent/20'
                      : expanded
                        ? 'border-accent/40'
                        : 'border-border hover:border-muted/40'
                  } ${dragIndex === idx ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[13px]">
                    <GripVertical
                      size={13}
                      className="shrink-0 cursor-grab text-muted opacity-0 group-hover:opacity-100"
                    />
                    <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted">
                      {idx + 1}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {element?.name ?? step.elementId ?? '页面级操作'}
                    </span>
                    {preview && (
                      <span className="max-w-[120px] shrink-0 truncate font-mono text-[11px] text-muted">
                        {preview}
                      </span>
                    )}
                    <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => reorder(idx, idx - 1)}
                        className="grid size-6 place-items-center rounded text-muted hover:bg-default hover:text-foreground disabled:opacity-30"
                        aria-label="上移"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        type="button"
                        disabled={idx === steps.length - 1}
                        onClick={() => reorder(idx, idx + 1)}
                        className="grid size-6 place-items-center rounded text-muted hover:bg-default hover:text-foreground disabled:opacity-30"
                        aria-label="下移"
                      >
                        <ChevronDown size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          mutate((d) => {
                            d.case.steps = d.case.steps.filter((_, i) => i !== idx)
                          })
                        }
                        className="grid size-6 place-items-center rounded text-muted hover:bg-danger/10 hover:text-danger"
                        aria-label="删除步骤"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : step.id)}
                      className="grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
                      aria-label={expanded ? '收起' : '展开'}
                    >
                      {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>

                  {expanded && (
                    <div className="atp-fade-in space-y-2.5 border-t border-border px-3 py-2.5">
                      <div>
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
                          参数
                        </p>
                        {(step.action === 'fill' || step.action === 'select') && (
                          <Input
                            placeholder="输入值"
                            value={(step.params?.value as string) ?? ''}
                            onChange={(e) =>
                              patchStep(idx, {
                                params: { ...step.params, value: e.target.value },
                              })
                            }
                          />
                        )}
                        {step.action === 'press' && (
                          <Input
                            placeholder="按键（如 Enter）"
                            value={(step.params?.key as string) ?? ''}
                            onChange={(e) =>
                              patchStep(idx, { params: { ...step.params, key: e.target.value } })
                            }
                          />
                        )}
                        {step.action === 'assert' && (
                          <div className="flex items-center gap-2">
                            <select
                              className="h-8 rounded-md border border-border bg-field px-2 text-xs outline-none"
                              value={step.assertion?.type ?? 'visible'}
                              onChange={(e) => {
                                const t = e.target.value as 'visible' | 'text' | 'value'
                                setAssertion(
                                  idx,
                                  t === 'visible'
                                    ? { type: 'visible' }
                                    : {
                                        type: t,
                                        expected:
                                          step.assertion?.type === t
                                            ? (step.assertion as { expected: string }).expected
                                            : '',
                                      },
                                )
                              }}
                            >
                              <option value="visible">可见</option>
                              <option value="text">文本</option>
                              <option value="value">值</option>
                            </select>
                            {step.assertion && step.assertion.type !== 'visible' && (
                              <Input
                                className="flex-1"
                                placeholder="期望值"
                                value={(step.assertion as { expected?: string }).expected ?? ''}
                                onChange={(e) =>
                                  setAssertion(idx, {
                                    type: step.assertion?.type,
                                    expected: e.target.value,
                                  })
                                }
                              />
                            )}
                          </div>
                        )}
                        {(step.action === 'click' || step.action === 'assert') && (
                          <p className="text-[11px] text-muted">
                            {step.action === 'click' ? '点击目标元素' : '断言目标元素状态'}
                          </p>
                        )}
                      </div>

                      {element && (
                        <div>
                          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
                            定位器（按优先级回放）
                          </p>
                          <div className="space-y-1">
                            {element.locators.map((loc, i) => (
                              <div
                                key={`${loc.type}:${loc.value}:${i}`}
                                className="flex items-center gap-1.5 rounded bg-surface-secondary px-1.5 py-1"
                              >
                                <span className="w-12 shrink-0 rounded bg-default px-1 text-center font-mono text-[10px] text-muted">
                                  {LOCATOR_LABEL[loc.type]}
                                </span>
                                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80">
                                  {locatorText(loc)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {exportedCode !== null && (
        <Modal.Root isOpen onOpenChange={(open) => !open && setExportedCode(null)}>
          <Modal.Backdrop>
            <Modal.Container size="lg">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>导出 Playwright TS 脚本</Modal.Heading>
                  <Modal.CloseTrigger />
                </Modal.Header>
                <Modal.Body className="space-y-2">
                  <p className="text-xs text-muted">
                    定位器取元素库第一候选；可直接放入 @playwright/test 项目运行。
                  </p>
                  {savedPath && (
                    <p className="break-all text-xs text-green-600 dark:text-green-400">
                      已保存到：{savedPath}
                    </p>
                  )}
                  <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-surface-secondary p-3 font-mono text-[11px] leading-5">
                    {exportedCode}
                  </pre>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" size="sm" onPress={() => void saveTsFile()}>
                    保存为 .spec.ts
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={() => {
                      void navigator.clipboard.writeText(exportedCode ?? '')
                      setCopied(true)
                      toast.success('代码已复制')
                    }}
                  >
                    {copied ? '已复制 ✓' : '复制代码'}
                  </Button>
                  <Button variant="primary" size="sm" onPress={() => setExportedCode(null)}>
                    关闭
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal.Root>
      )}
    </div>
  )
}
