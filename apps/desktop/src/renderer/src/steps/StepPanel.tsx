import type { CaseFile, Step } from '@atp/model'
import {
  Button,
  Input,
  ModalBody,
  ModalDialog,
  ModalFooter,
  ModalHeader,
  ModalRoot,
} from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Save, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { qk } from '../api/client'
import { useUiStore } from '../state/ui-store'

const ACTION_LABEL: Record<Step['action'], string> = {
  click: '点击',
  fill: '输入',
  select: '选择',
  press: '按键',
  assert: '断言',
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr
  const next = [...arr]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
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
  const [status, setStatus] = useState('')
  useEffect(() => {
    setDraft(file ?? null)
    setStatus('')
  }, [file])

  if (!caseId) return <p className="text-default-400">在左树选择一条用例</p>
  if (!draft) return <p className="text-default-400">加载中…</p>

  const mutate = (fn: (d: CaseFile) => void): void => {
    setDraft((prev) => {
      if (!prev) return prev
      const next = structuredClone(prev)
      fn(next)
      return next
    })
    setStatus('')
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

  const save = async (): Promise<void> => {
    if (!draft) return
    setStatus('保存中…')
    await window.atp.invoke('case:update', draft)
    void qc.invalidateQueries({ queryKey: qk.caseFile(caseId) })
    void qc.invalidateQueries({ queryKey: qk.cases(draft.case.projectId) })
    setStatus('已保存 ✓')
  }

  const [exportedCode, setExportedCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const exportTs = async (): Promise<void> => {
    if (!caseId) return
    const { code } = await window.atp.invoke('case:export-ts', { id: caseId })
    setExportedCode(code)
    setCopied(false)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-2">
        <span className="truncate text-sm font-medium">{draft.case.name}</span>
        <div className="flex items-center gap-1">
          {status && <span className="text-xs text-default-400">{status}</span>}
          <Button size="sm" variant="ghost" onPress={() => void exportTs()}>
            导出 TS
          </Button>
          <Button size="sm" variant="primary" onPress={() => void save()}>
            <Save size={14} />
            保存
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-2 pb-2">
        {draft.case.steps.length === 0 && (
          <p className="text-default-400">用例还没有步骤：录制或稍后添加</p>
        )}
        {draft.case.steps.map((step, idx) => {
          const element = draft.elements[step.elementId ?? '']
          return (
            <div key={step.id} className="rounded-lg border border-default-200 p-2 text-sm">
              <div className="flex items-center gap-1">
                <span className="font-mono text-xs text-default-400">{idx + 1}</span>
                <span className="rounded bg-default-100 px-1.5 py-0.5 text-xs">
                  {ACTION_LABEL[step.action]}
                </span>
                <span className="min-w-0 flex-1 truncate text-default-600">
                  {element?.name ?? step.elementId}
                </span>
                <Button
                  variant="ghost"
                  isDisabled={idx === 0}
                  onPress={() =>
                    mutate((d) => {
                      d.case.steps = move(d.case.steps, idx, idx - 1)
                    })
                  }
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  variant="ghost"
                  isDisabled={idx === draft.case.steps.length - 1}
                  onPress={() =>
                    mutate((d) => {
                      d.case.steps = move(d.case.steps, idx, idx + 1)
                    })
                  }
                >
                  <ArrowDown size={14} />
                </Button>
                <Button
                  variant="danger"
                  onPress={() =>
                    mutate((d) => {
                      d.case.steps = d.case.steps.filter((_, i) => i !== idx)
                    })
                  }
                >
                  <X size={14} />
                </Button>
              </div>

              <div className="mt-1 space-y-1">
                {(step.action === 'fill' || step.action === 'select') && (
                  <Input
                    placeholder="输入值"
                    value={(step.params?.value as string) ?? ''}
                    onChange={(e) => patchStep(idx, { params: { value: e.target.value } })}
                  />
                )}
                {step.action === 'press' && (
                  <Input
                    placeholder="按键（如 Enter）"
                    value={(step.params?.key as string) ?? ''}
                    onChange={(e) => patchStep(idx, { params: { key: e.target.value } })}
                  />
                )}
                {step.action === 'assert' && (
                  <div className="flex items-center gap-1">
                    <select
                      className="h-8 rounded-md border border-default-300 bg-white px-1 text-xs"
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
              </div>
            </div>
          )
        })}
      </div>

      <ModalRoot
        isOpen={exportedCode !== null}
        onOpenChange={(open) => !open && setExportedCode(null)}
      >
        <ModalDialog>
          <ModalHeader>导出 Playwright TS 脚本</ModalHeader>
          <ModalBody>
            <p className="text-xs text-default-500">
              定位器取元素库第一候选；可直接放入 @playwright/test 项目运行
            </p>
            <pre className="max-h-96 overflow-auto rounded-md bg-default-100 p-2 text-xs leading-5">
              {exportedCode}
            </pre>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="ghost"
              onPress={() => {
                void navigator.clipboard.writeText(exportedCode ?? '')
                setCopied(true)
              }}
            >
              {copied ? '已复制 ✓' : '复制代码'}
            </Button>
            <Button variant="primary" onPress={() => setExportedCode(null)}>
              关闭
            </Button>
          </ModalFooter>
        </ModalDialog>
      </ModalRoot>
    </div>
  )
}
