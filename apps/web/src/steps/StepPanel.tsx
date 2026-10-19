import type { Assertion, CaseFile, CaseGroup, Locator, Step, StepCondition } from '@atp/model'
import { formatLocator } from '@atp/model'
import { Button, Dropdown, Input, Modal, Tooltip, toast } from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Braces,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  GripVertical,
  Layers,
  ListTree,
  Plus,
  Save,
  X,
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
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
  xpath: 'xpath',
  within: 'scope',
}

const ASSERTION_GROUPS: Array<{
  group: string
  options: Array<{ value: Assertion['type']; label: string; pageLevel?: boolean }>
}> = [
  {
    group: '元素状态',
    options: [
      { value: 'visible', label: '可见' },
      { value: 'hidden', label: '隐藏' },
      { value: 'exists', label: '存在' },
      { value: 'notExists', label: '不存在' },
      { value: 'enabled', label: '启用' },
      { value: 'disabled', label: '禁用' },
      { value: 'checked', label: '已勾选' },
      { value: 'unchecked', label: '未勾选' },
    ],
  },
  { group: '数量', options: [{ value: 'count', label: '元素数量' }] },
  {
    group: '文本',
    options: [
      { value: 'text', label: '文本等于' },
      { value: 'textContains', label: '文本包含' },
      { value: 'textMatches', label: '文本匹配正则' },
    ],
  },
  {
    group: '输入值',
    options: [
      { value: 'value', label: '值等于' },
      { value: 'valueContains', label: '值包含' },
    ],
  },
  {
    group: '属性 / 样式',
    options: [
      { value: 'attribute', label: '属性' },
      { value: 'css', label: 'CSS 属性' },
    ],
  },
  {
    group: '页面级（无需元素）',
    options: [
      { value: 'urlEquals', label: 'URL 等于', pageLevel: true },
      { value: 'urlContains', label: 'URL 包含', pageLevel: true },
      { value: 'titleEquals', label: '标题等于', pageLevel: true },
      { value: 'titleContains', label: '标题包含', pageLevel: true },
      { value: 'pageText', label: '页面文本', pageLevel: true },
    ],
  },
]

const CONDITION_OPERATORS: Array<{ value: StepCondition['operator']; label: string }> = [
  { value: '=', label: '等于' },
  { value: '!=', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' },
  { value: '>', label: '大于' },
  { value: '<', label: '小于' },
  { value: '>=', label: '大于等于' },
  { value: '<=', label: '小于等于' },
  { value: 'exists', label: '变量存在' },
  { value: 'notExists', label: '变量不存在' },
]

function defaultAssertion(type: Assertion['type']): Assertion {
  switch (type) {
    case 'count':
      return { type, op: '=', expected: 1 }
    case 'text':
    case 'textContains':
    case 'textMatches':
    case 'value':
    case 'valueContains':
      return { type, expected: '' }
    case 'attribute':
      return { type, name: '', match: 'equals', expected: '' }
    case 'css':
      return { type, name: '', expected: '' }
    case 'pageText':
      return { type, match: 'contains', expected: '' }
    case 'urlEquals':
    case 'urlContains':
    case 'titleEquals':
    case 'titleContains':
      return { type, expected: '' }
    default:
      return { type }
  }
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function locatorText(loc: Locator): string {
  return formatLocator(loc)
}

const selectClass =
  'h-8 rounded-md border border-border bg-field px-2 text-xs text-foreground outline-none focus:border-accent/60'

function AssertionEditor({
  assertion,
  hasElement,
  onChange,
}: {
  assertion: Assertion | undefined
  hasElement: boolean
  onChange: (next: Assertion) => void
}) {
  const current = assertion ?? defaultAssertion('visible')
  const a = current as Record<string, unknown>
  const type = current.type
  const patch = (extra: Record<string, unknown>): void =>
    onChange({ ...current, ...extra } as Assertion)

  const needsExpected = [
    'text',
    'textContains',
    'textMatches',
    'value',
    'valueContains',
    'urlEquals',
    'urlContains',
    'titleEquals',
    'titleContains',
    'pageText',
    'css',
    'attribute',
  ].includes(type)

  return (
    <div className="space-y-1.5">
      <select
        className={`${selectClass} w-full`}
        value={type}
        onChange={(e) => onChange(defaultAssertion(e.target.value as Assertion['type']))}
        aria-label="断言类型"
      >
        {ASSERTION_GROUPS.map((group) => (
          <optgroup key={group.group} label={group.group}>
            {group.options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={!hasElement && !opt.pageLevel}>
                {opt.label}
                {!hasElement && !opt.pageLevel ? '（需元素）' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {(type === 'text' ||
        type === 'textContains' ||
        type === 'value' ||
        type === 'valueContains') && (
        <div className="flex items-center gap-2">
          <Input
            className="flex-1"
            placeholder="期望值"
            value={String(a.expected ?? '')}
            onChange={(e) => patch({ expected: e.target.value })}
          />
          <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={Boolean(a.ignoreCase)}
              onChange={(e) => patch({ ignoreCase: e.target.checked })}
            />
            忽略大小写
          </label>
        </div>
      )}

      {(type === 'textMatches' ||
        type === 'urlEquals' ||
        type === 'urlContains' ||
        type === 'titleEquals' ||
        type === 'titleContains' ||
        type === 'pageText') && (
        <Input
          placeholder={type === 'textMatches' ? '正则表达式' : '期望值'}
          value={String(a.expected ?? '')}
          onChange={(e) => patch({ expected: e.target.value })}
        />
      )}

      {type === 'pageText' && (
        <select
          className={`${selectClass} w-full`}
          value={String(a.match ?? 'contains')}
          onChange={(e) => patch({ match: e.target.value })}
          aria-label="页面文本匹配方式"
        >
          <option value="contains">包含</option>
          <option value="equals">等于</option>
        </select>
      )}

      {type === 'count' && (
        <div className="flex items-center gap-2">
          <select
            className={selectClass}
            value={String(a.op ?? '=')}
            onChange={(e) => patch({ op: e.target.value })}
            aria-label="数量比较方式"
          >
            <option value="=">=</option>
            <option value=">=">≥</option>
            <option value="<=">≤</option>
          </select>
          <Input
            type="number"
            className="flex-1"
            placeholder="数量"
            value={String(a.expected ?? 1)}
            onChange={(e) => patch({ expected: Number(e.target.value) })}
          />
        </div>
      )}

      {type === 'attribute' && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              placeholder="属性名（如 href）"
              value={String(a.name ?? '')}
              onChange={(e) => patch({ name: e.target.value })}
            />
            <select
              className={selectClass}
              value={String(a.match ?? 'equals')}
              onChange={(e) => patch({ match: e.target.value })}
              aria-label="属性匹配方式"
            >
              <option value="equals">等于</option>
              <option value="contains">包含</option>
              <option value="exists">存在</option>
            </select>
          </div>
          {String(a.match ?? 'equals') !== 'exists' && (
            <Input
              placeholder="期望值"
              value={String(a.expected ?? '')}
              onChange={(e) => patch({ expected: e.target.value })}
            />
          )}
        </div>
      )}

      {type === 'css' && (
        <div className="flex items-center gap-2">
          <Input
            className="flex-1"
            placeholder="属性名（如 color）"
            value={String(a.name ?? '')}
            onChange={(e) => patch({ name: e.target.value })}
          />
          <Input
            className="flex-1"
            placeholder="期望值"
            value={String(a.expected ?? '')}
            onChange={(e) => patch({ expected: e.target.value })}
          />
        </div>
      )}

      {needsExpected || type === 'count' ? null : (
        <p className="text-[11px] text-muted">该断言无需期望值</p>
      )}

      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span>超时</span>
        <Input
          type="number"
          className="h-7 w-24"
          placeholder="5000"
          value={a.timeoutMs === undefined ? '' : String(a.timeoutMs)}
          onChange={(e) =>
            patch({ timeoutMs: e.target.value ? Number(e.target.value) : undefined })
          }
        />
        <span>ms</span>
      </div>

      {!hasElement && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          页面级断言不绑定元素；元素级断言需要通过录制拾取目标。
        </p>
      )}
    </div>
  )
}

function ConditionEditor({
  condition,
  variables,
  onChange,
}: {
  condition: StepCondition | undefined
  variables: Record<string, string>
  onChange: (next: StepCondition | undefined) => void
}) {
  const varNames = Object.keys(variables)
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-surface-secondary/60 p-2">
      <label className="flex items-center gap-1.5 text-[11px] text-muted">
        <input
          type="checkbox"
          checked={Boolean(condition)}
          onChange={(e) =>
            onChange(
              e.target.checked
                ? { variable: varNames[0] ?? 'value', operator: '=', value: '' }
                : undefined,
            )
          }
        />
        条件执行（不满足时跳过该步）
      </label>
      {condition && (
        <div className="flex items-center gap-1.5">
          <Input
            className="h-7 flex-1"
            placeholder="变量名"
            list="atp-case-vars"
            value={condition.variable}
            onChange={(e) => onChange({ ...condition, variable: e.target.value })}
          />
          <datalist id="atp-case-vars">
            {varNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <select
            className="h-7 rounded-md border border-border bg-field px-1 text-[11px] outline-none"
            value={condition.operator}
            onChange={(e) =>
              onChange({
                ...condition,
                operator: e.target.value as StepCondition['operator'],
              })
            }
            aria-label="条件操作符"
          >
            {CONDITION_OPERATORS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
          <Input
            className="h-7 w-28"
            placeholder="比较值"
            value={condition.value ?? ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
          />
        </div>
      )}
    </div>
  )
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
  const [varsOpen, setVarsOpen] = useState(false)
  const [varRows, setVarRows] = useState<Array<{ id: string; key: string; value: string }>>([])
  const [viewMode, setViewMode] = useState<'intent' | 'raw'>('intent')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  useOverlayGuard(exportedCode !== null || varsOpen)

  useEffect(() => {
    setDraft(file ?? null)
    setSavedAt('')
  }, [file])

  useEffect(() => {
    if (!caseId) return
    setExpandedId(null)
    setDragIndex(null)
    setOverIndex(null)
    setCollapsedGroups(new Set())
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

  const reorder = (from: number, to: number): void =>
    mutate((d) => {
      d.case.steps = move(d.case.steps, from, to)
    })

  const duplicate = (idx: number): void =>
    mutate((d) => {
      const source = d.case.steps[idx]
      d.case.steps.splice(idx + 1, 0, {
        ...structuredClone(source),
        id: `${source.id}-copy-${Date.now().toString(36)}`,
      })
    })

  const appendStep = (step: Step): void =>
    mutate((d) => {
      d.case.steps.push(step)
    })

  const newId = (): string => `s-${Date.now().toString(36)}`

  const groups: CaseGroup[] = draft.case.groups ?? []
  const groupById = new Map(groups.map((group) => [group.id, group]))

  const renameGroup = (id: string, label: string): void =>
    mutate((d) => {
      const group = d.case.groups?.find((item) => item.id === id)
      if (group) group.label = label
    })

  const restoreGroup = (id: string): void =>
    mutate((d) => {
      d.case.groups = (d.case.groups ?? []).filter((group) => group.id !== id)
      for (const step of d.case.steps) {
        if (step.groupId === id) step.groupId = undefined
      }
    })

  const mergeSelect = (idx: number): void =>
    mutate((d) => {
      const current = d.case.steps[idx]
      const next = d.case.steps[idx + 1]
      if (!current || !next) return
      const nextEl = d.elements[next.elementId ?? '']
      const value = next.display?.value ?? nextEl?.name ?? ''
      const field = current.display?.field ?? d.elements[current.elementId ?? '']?.name ?? '下拉'
      d.case.steps[idx] = {
        ...current,
        action: 'select',
        params: { ...current.params, value, mode: 'custom' },
        display: {
          verb: '选择',
          field,
          value,
          details: [
            ...(current.display?.details ?? [current.display?.verb ?? '点击']),
            ...(next.display?.details ?? [next.display?.verb ?? '点击']),
          ],
          confidence: 'auto',
        },
      }
      d.case.steps.splice(idx + 1, 1)
    })

  const ignoreConfirm = (idx: number): void =>
    mutate((d) => {
      const step = d.case.steps[idx]
      if (step.display) step.display.confidence = 'auto'
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

  const openVariables = (): void => {
    const current = draft.case.variables ?? {}
    setVarRows(
      Object.entries(current).map(([key, value], idx) => ({
        id: `var-${Date.now().toString(36)}-${idx}`,
        key,
        value,
      })),
    )
    setVarsOpen(true)
  }

  const applyVariables = (): void => {
    const next: Record<string, string> = {}
    for (const row of varRows) {
      const key = row.key.trim()
      if (key) next[key] = row.value
    }
    mutate((d) => {
      d.case.variables = next
    })
    setVarsOpen(false)
    toast.success('变量已更新，点击「保存」写入用例')
  }

  const steps = draft.case.steps
  const variables = draft.case.variables ?? {}
  let lastGroupId: string | undefined

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{draft.case.name}</span>
        {dirty ? (
          <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
            未保存
          </span>
        ) : (
          savedAt && <span className="text-[10px] text-muted">{savedAt} 已保存</span>
        )}

        <Dropdown.Root>
          <Dropdown.Trigger className="grid size-7 place-items-center rounded-md text-muted outline-none hover:bg-default hover:text-foreground">
            <Plus size={14} />
          </Dropdown.Trigger>
          <Dropdown.Popover placement="bottom end">
            <Dropdown.Menu
              onAction={(key) => {
                if (key === 'wait')
                  appendStep({
                    id: newId(),
                    action: 'wait',
                    params: { kind: 'timeout', ms: 1000 },
                  })
                if (key === 'assert')
                  appendStep({
                    id: newId(),
                    action: 'assert',
                    assertion: { type: 'titleContains', expected: '' },
                  })
                if (key === 'scroll')
                  appendStep({ id: newId(), action: 'scroll', params: { x: 0, y: 0 } })
              }}
            >
              <Dropdown.Item id="wait" textValue="新建等待">
                新建等待步骤
              </Dropdown.Item>
              <Dropdown.Item id="assert" textValue="新建页面断言">
                新建页面级断言
              </Dropdown.Item>
              <Dropdown.Item id="scroll" textValue="新建滚动">
                新建滚动步骤
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown.Root>

        <Tooltip.Root>
          <Tooltip.Trigger>
            <button
              type="button"
              onClick={openVariables}
              className="grid size-7 place-items-center rounded-md text-muted outline-none hover:bg-default hover:text-foreground"
              aria-label="用例变量"
            >
              <Braces size={14} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>用例变量（{Object.keys(variables).length}）</Tooltip.Content>
        </Tooltip.Root>

        <Button size="sm" variant="secondary" onPress={() => void exportTs()}>
          <Download size={12} />
          导出
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

      <div className="flex items-center gap-2 border-b border-border bg-surface-secondary/40 px-3 py-1.5">
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted">
          意图
        </span>
        <input
          value={draft.case.intent ?? ''}
          onChange={(e) =>
            mutate((d) => {
              d.case.intent = e.target.value
            })
          }
          placeholder="一句话描述这条用例要做什么"
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted/70"
          aria-label="用例意图摘要"
        />
        <div className="flex shrink-0 rounded-md border border-border p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => setViewMode('intent')}
            className={`rounded px-1.5 py-0.5 ${viewMode === 'intent' ? 'bg-default font-medium text-foreground' : 'text-muted'}`}
          >
            意图
          </button>
          <button
            type="button"
            onClick={() => setViewMode('raw')}
            className={`rounded px-1.5 py-0.5 ${viewMode === 'raw' ? 'bg-default font-medium text-foreground' : 'text-muted'}`}
          >
            原始
          </button>
        </div>
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
              const display = step.display
              const intentView = viewMode === 'intent' && Boolean(display)
              const group = step.groupId ? groupById.get(step.groupId) : undefined
              const showGroupHeader = Boolean(group && group.id !== lastGroupId)
              const hiddenByGroup = Boolean(
                group && !showGroupHeader && collapsedGroups.has(group.id),
              )
              lastGroupId = group?.id

              return (
                <Fragment key={step.id}>
                  {showGroupHeader && group && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-surface-secondary/70 px-2 py-1 text-[11px] text-muted">
                      <Layers size={12} />
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedGroups((prev) => {
                            const next = new Set(prev)
                            if (next.has(group.id)) next.delete(group.id)
                            else next.add(group.id)
                            return next
                          })
                        }
                        className="shrink-0 text-muted hover:text-foreground"
                        aria-label={collapsedGroups.has(group.id) ? '展开分组' : '收起分组'}
                      >
                        {collapsedGroups.has(group.id) ? (
                          <ChevronDown size={11} />
                        ) : (
                          <ChevronUp size={11} />
                        )}
                      </button>
                      <input
                        value={group.label}
                        onChange={(e) => renameGroup(group.id, e.target.value)}
                        className="min-w-0 flex-1 bg-transparent font-medium text-foreground/80 outline-none"
                        aria-label="分组名称"
                      />
                      <span className="shrink-0 text-[10px] text-muted">
                        {group.kind === 'dialog'
                          ? '弹窗'
                          : group.kind === 'navigation'
                            ? '导航'
                            : '区块'}
                      </span>
                      <button
                        type="button"
                        onClick={() => restoreGroup(group.id)}
                        className="shrink-0 rounded px-1 text-[10px] text-muted hover:bg-default hover:text-foreground"
                      >
                        还原为原始步骤
                      </button>
                    </div>
                  )}
                  {!hiddenByGroup && (
                    <div
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
                          {intentView && display ? display.verb : meta.label}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {intentView && display
                            ? display.field || element?.name || '页面级操作'
                            : (element?.name ?? (step.elementId ? step.elementId : '页面级操作'))}
                        </span>
                        {intentView && display?.confidence === 'confirm' && (
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="rounded bg-amber-500/10 px-1 text-[10px] text-amber-600 dark:text-amber-400">
                              待确认
                            </span>
                            <button
                              type="button"
                              onClick={() => mergeSelect(idx)}
                              className="rounded px-1 text-[10px] text-accent hover:underline"
                            >
                              合并
                            </button>
                            <button
                              type="button"
                              onClick={() => ignoreConfirm(idx)}
                              className="rounded px-1 text-[10px] text-muted hover:underline"
                            >
                              忽略
                            </button>
                          </span>
                        )}
                        {step.condition && (
                          <span className="shrink-0 rounded bg-amber-500/10 px-1 text-[10px] text-amber-600 dark:text-amber-400">
                            条件
                          </span>
                        )}
                        {intentView && display?.value ? (
                          <span className="max-w-[160px] shrink-0 truncate font-mono text-[11px] text-muted">
                            = {display.value}
                          </span>
                        ) : (
                          preview && (
                            <span className="max-w-[120px] shrink-0 truncate font-mono text-[11px] text-muted">
                              {preview}
                            </span>
                          )
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
                            onClick={() => duplicate(idx)}
                            className="grid size-6 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
                            aria-label="复制步骤"
                          >
                            <Copy size={12} />
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
                          {display && (
                            <div className="rounded-md bg-surface-secondary px-2 py-1.5 text-[11px] text-muted">
                              <span className="font-medium text-foreground/80">
                                {display.verb}
                                {display.field ? ` ${display.field}` : ''}
                                {display.value ? ` = ${display.value}` : ''}
                              </span>
                              {display.details && display.details.length > 0 && (
                                <p className="mt-0.5">原始动作：{display.details.join(' → ')}</p>
                              )}
                            </div>
                          )}
                          <div>
                            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
                              参数
                            </p>
                            {(step.action === 'fill' || step.action === 'select') && (
                              <div className="flex items-center gap-2">
                                <Input
                                  placeholder="输入值，可用 ${变量名}"
                                  value={(step.params?.value as string) ?? ''}
                                  onChange={(e) =>
                                    patchStep(idx, {
                                      params: { ...step.params, value: e.target.value },
                                    })
                                  }
                                />
                                {step.action === 'select' && (
                                  <select
                                    className={selectClass}
                                    value={String(step.params?.mode ?? 'native')}
                                    onChange={(e) =>
                                      patchStep(idx, {
                                        params: { ...step.params, mode: e.target.value },
                                      })
                                    }
                                    aria-label="下拉类型"
                                  >
                                    <option value="native">原生下拉</option>
                                    <option value="custom">自定义下拉</option>
                                  </select>
                                )}
                              </div>
                            )}
                            {step.action === 'press' && (
                              <Input
                                placeholder="按键（如 Enter 或 Control+A）"
                                value={(step.params?.key as string) ?? ''}
                                onChange={(e) =>
                                  patchStep(idx, {
                                    params: { ...step.params, key: e.target.value },
                                  })
                                }
                              />
                            )}
                            {step.action === 'scroll' && (
                              <div className="flex items-center gap-2">
                                <Input
                                  type="number"
                                  className="flex-1"
                                  placeholder="X"
                                  value={String(step.params?.x ?? 0)}
                                  onChange={(e) =>
                                    patchStep(idx, {
                                      params: { ...step.params, x: Number(e.target.value) },
                                    })
                                  }
                                />
                                <Input
                                  type="number"
                                  className="flex-1"
                                  placeholder="Y"
                                  value={String(step.params?.y ?? 0)}
                                  onChange={(e) =>
                                    patchStep(idx, {
                                      params: { ...step.params, y: Number(e.target.value) },
                                    })
                                  }
                                />
                              </div>
                            )}
                            {step.action === 'drag' && (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="number"
                                    className="flex-1"
                                    placeholder="水平位移 dx"
                                    value={String(step.params?.dx ?? 0)}
                                    onChange={(e) =>
                                      patchStep(idx, {
                                        params: { ...step.params, dx: Number(e.target.value) },
                                      })
                                    }
                                  />
                                  <Input
                                    type="number"
                                    className="flex-1"
                                    placeholder="垂直位移 dy"
                                    value={String(step.params?.dy ?? 0)}
                                    onChange={(e) =>
                                      patchStep(idx, {
                                        params: { ...step.params, dy: Number(e.target.value) },
                                      })
                                    }
                                  />
                                </div>
                                <Input
                                  type="number"
                                  className="w-36"
                                  placeholder="时长 ms（可选）"
                                  value={
                                    step.params?.durationMs === undefined
                                      ? ''
                                      : String(step.params.durationMs)
                                  }
                                  onChange={(e) =>
                                    patchStep(idx, {
                                      params: {
                                        ...step.params,
                                        durationMs: e.target.value
                                          ? Number(e.target.value)
                                          : undefined,
                                      },
                                    })
                                  }
                                />
                                <p className="text-[11px] text-muted">
                                  从目标元素中心按住并移动 (dx, dy)；滑块验证码建议拖到轨道最右端。
                                </p>
                              </div>
                            )}
                            {step.action === 'wait' && (
                              <div className="flex items-center gap-2">
                                <select
                                  className={selectClass}
                                  value={String(step.params?.kind ?? 'timeout')}
                                  onChange={(e) =>
                                    patchStep(idx, {
                                      params: { ...step.params, kind: e.target.value },
                                    })
                                  }
                                  aria-label="等待方式"
                                >
                                  <option value="timeout">固定延时</option>
                                  <option value="networkIdle">网络空闲</option>
                                  <option value="visible">元素可见</option>
                                  <option value="hidden">元素隐藏</option>
                                </select>
                                {String(step.params?.kind ?? 'timeout') !== 'networkIdle' && (
                                  <Input
                                    type="number"
                                    className="w-24"
                                    placeholder="毫秒"
                                    value={String(step.params?.ms ?? 1000)}
                                    onChange={(e) =>
                                      patchStep(idx, {
                                        params: { ...step.params, ms: Number(e.target.value) },
                                      })
                                    }
                                  />
                                )}
                              </div>
                            )}
                            {step.action === 'assert' && (
                              <AssertionEditor
                                assertion={step.assertion}
                                hasElement={Boolean(step.elementId)}
                                onChange={(next) =>
                                  patchStep(idx, {
                                    assertion: next,
                                    elementId: [
                                      'urlEquals',
                                      'urlContains',
                                      'titleEquals',
                                      'titleContains',
                                      'pageText',
                                    ].includes(next.type)
                                      ? undefined
                                      : step.elementId,
                                  })
                                }
                              />
                            )}
                            {(step.action === 'click' || step.action === 'assert') &&
                              step.action === 'click' && (
                                <p className="text-[11px] text-muted">点击目标元素</p>
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
                                    key={`${loc.type}:${i}`}
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

                          <ConditionEditor
                            condition={step.condition}
                            variables={variables}
                            onChange={(condition) => patchStep(idx, { condition })}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </Fragment>
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

      {varsOpen && (
        <Modal.Root isOpen onOpenChange={(open) => !open && setVarsOpen(false)}>
          <Modal.Backdrop>
            <Modal.Container size="md">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>用例变量</Modal.Heading>
                  <Modal.CloseTrigger />
                </Modal.Header>
                <Modal.Body className="space-y-3">
                  <p className="text-xs text-muted">
                    在步骤参数、断言期望、条件值中写 <code>${'{变量名}'}</code> 即可引用。
                  </p>
                  <div className="space-y-1.5">
                    {varRows.map((row, idx) => (
                      <div key={row.id} className="flex items-center gap-1.5">
                        <Input
                          className="flex-1"
                          placeholder="变量名"
                          value={row.key}
                          onChange={(e) =>
                            setVarRows((rows) =>
                              rows.map((r, i) => (i === idx ? { ...r, key: e.target.value } : r)),
                            )
                          }
                        />
                        <Input
                          className="flex-[2]"
                          placeholder="值"
                          value={row.value}
                          onChange={(e) =>
                            setVarRows((rows) =>
                              rows.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)),
                            )
                          }
                        />
                        <button
                          type="button"
                          onClick={() => setVarRows((rows) => rows.filter((_, i) => i !== idx))}
                          className="grid size-7 place-items-center rounded text-muted hover:bg-danger/10 hover:text-danger"
                          aria-label="删除变量"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    {varRows.length === 0 && <p className="text-xs text-muted">还没有变量</p>}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() =>
                      setVarRows((rows) => [
                        ...rows,
                        { id: `var-${Date.now().toString(36)}`, key: '', value: '' },
                      ])
                    }
                  >
                    <Plus size={13} />
                    添加变量
                  </Button>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" size="sm" onPress={() => setVarsOpen(false)}>
                    取消
                  </Button>
                  <Button variant="primary" size="sm" onPress={applyVariables}>
                    应用
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
