import type { CaseFile } from '@atp/model'
import { Button, Input, Modal, toast } from '@heroui/react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FileCheck2, Layers, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { qk, useModules, useProjects } from '../api/client'
import { useOverlayGuard } from '../hooks/use-overlay-guard'
import { type RecordingDraft, useUiStore } from '../state/ui-store'
import { actionMeta } from '../steps/step-meta'

const SAVE_TIMEOUT_MS = 30_000

async function withTimeout<T>(work: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), SAVE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 保存对话框中可复用的草稿形态 */
export interface SaveCaseDialogProps {
  /** 外部草稿（AI 计划卡）；缺省使用录制草稿 */
  draft?: RecordingDraft | null
  defaultName?: string
  title?: string
  onClose?: () => void
  onSaved?: (saved: CaseFile) => void
}

/** 保存用例：命名 + 归属项目/模块，元素随用例 upsert 进元素库。录制与 AI 计划共用。 */
export function SaveCaseDialog(props: SaveCaseDialogProps = {}) {
  const qc = useQueryClient()
  const recordingDraft = useUiStore((s) => s.draftRecording)
  const draft = props.draft !== undefined ? props.draft : recordingDraft
  const setDraftRecording = useUiStore((s) => s.setDraftRecording)
  const setSelected = useUiStore((s) => s.setSelected)
  const currentProjectId = useUiStore((s) => s.currentProjectId)
  const setCurrentProjectId = useUiStore((s) => s.setCurrentProjectId)

  const close = (): void => {
    props.onClose?.()
    if (props.draft === undefined) setDraftRecording(null)
  }

  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: projects = [] } = useProjects()
  const { data: modules = [] } = useModules(draft ? projectId || null : null)

  // 弹窗打开时收起受控浏览器，否则原生视图会盖住这个居中弹窗
  useOverlayGuard(Boolean(draft))

  useEffect(() => {
    if (!draft) return
    setName(
      props.defaultName?.trim() ||
        `录制 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
    )
    setProjectId(currentProjectId ?? projects[0]?.id ?? '')
    setModuleId('')
  }, [draft, currentProjectId, projects, props.defaultName])

  if (!draft) return null

  const selectClass =
    'h-9 w-full rounded-md border border-border bg-field px-2 text-sm text-foreground outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15'

  const save = async (): Promise<void> => {
    if (!draft || !projectId || !name.trim()) return
    setSaving(true)
    try {
      const created = await withTimeout(
        window.atp.invoke('case:create', {
          projectId,
          moduleId: moduleId || null,
          name: name.trim(),
          startUrl: draft.startUrl || 'about:blank',
        }),
        '创建用例超时（30 秒）。请先看用例列表：若已出现同名用例，不要再重复保存',
      )
      const saved = await withTimeout(
        window.atp.invoke('case:update', {
          case: {
            ...created.case,
            name: name.trim(),
            startUrl: draft.startUrl || created.case.startUrl,
            steps: draft.steps,
            intent: draft.intent,
            groups: draft.groups,
          },
          elements: draft.elements,
        }),
        '写入用例超时（30 秒）。请检查左侧用例列表与 Agent 日志后再决定是否重试',
      )
      void qc.invalidateQueries({ queryKey: qk.cases(projectId) })
      void qc.invalidateQueries({ queryKey: qk.caseFile(saved.case.id) })
      setCurrentProjectId(projectId)
      setSelected({ kind: 'case', id: saved.case.id })
      props.onSaved?.(saved)
      close()
      toast.success(`用例「${saved.case.name}」已保存`)
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '保存用例失败')
    } finally {
      setSaving(false)
    }
  }

  const frameTotal = draft.diagnostics?.frames.length ?? 0
  const frameInjected = draft.diagnostics?.frames.filter((f) => f.injected).length ?? 0
  const uninjected = draft.diagnostics?.frames.filter((f) => !f.injected) ?? []

  return (
    <Modal.Root isOpen onOpenChange={(open) => !open && close()}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>{props.title ?? '保存录制的用例'}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>

            <Modal.Body className="space-y-4">
              <div className={`grid gap-2 ${draft.diagnostics ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div className="rounded-md border border-border bg-surface-secondary px-2.5 py-2">
                  <p className="text-[10px] text-muted">步骤</p>
                  <p className="text-lg font-semibold tabular-nums">{draft.steps.length}</p>
                </div>
                <div className="rounded-md border border-border bg-surface-secondary px-2.5 py-2">
                  <p className="text-[10px] text-muted">元素</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {Object.keys(draft.elements).length}
                  </p>
                </div>
                {draft.diagnostics && (
                  <div className="rounded-md border border-border bg-surface-secondary px-2.5 py-2">
                    <p className="text-[10px] text-muted">采集帧</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {frameInjected}/{frameTotal}
                    </p>
                  </div>
                )}
              </div>

              {draft.steps.length === 0 && (
                <div className="flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">本次录制没有捕获到任何操作</p>
                    <p className="mt-0.5 opacity-90">
                      可能是操作发生在弹窗中，或采集器注入失败。建议丢弃后重录。
                    </p>
                  </div>
                </div>
              )}

              {uninjected.length > 0 && (
                <p className="text-[11px] text-muted">
                  未注入的 frame：{uninjected.map((f) => f.url || '(空地址)').join('、')}
                </p>
              )}

              {draft.steps.length > 0 && (
                <div className="rounded-md border border-border">
                  <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-[11px] font-medium text-muted">
                    <Layers size={12} />
                    步骤预览
                  </div>
                  <ol className="max-h-40 overflow-auto px-2.5 py-1.5">
                    {draft.steps.slice(0, 8).map((step, idx) => (
                      <li
                        key={step.id}
                        className="flex items-center gap-2 py-0.5 text-xs text-foreground/80"
                      >
                        <span className="w-4 text-right font-mono text-[10px] text-muted">
                          {idx + 1}
                        </span>
                        <span className="rounded bg-surface-secondary px-1 text-[10px] text-muted">
                          {step.display?.verb ?? actionMeta(step.action).label}
                        </span>
                        {step.display?.confidence === 'confirm' && (
                          <span className="shrink-0 rounded bg-amber-500/10 px-1 text-[10px] text-amber-600 dark:text-amber-400">
                            待确认
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          {step.display
                            ? [
                                step.display.field,
                                step.display.value ? `= ${step.display.value}` : '',
                              ]
                                .filter(Boolean)
                                .join(' ') || '页面级'
                            : (draft.elements[step.elementId ?? '']?.name ??
                              step.elementId ??
                              '页面级')}
                        </span>
                      </li>
                    ))}
                    {draft.steps.length > 8 && (
                      <li className="py-0.5 pl-6 text-[11px] text-muted">
                        还有 {draft.steps.length - 8} 步…
                      </li>
                    )}
                  </ol>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted" htmlFor="atp-case-name">
                  用例名称
                </label>
                <Input
                  id="atp-case-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：登录成功"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void save()
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label
                    className="block text-xs font-medium text-muted"
                    htmlFor="atp-case-project"
                  >
                    归属项目
                  </label>
                  <select
                    id="atp-case-project"
                    className={selectClass}
                    value={projectId}
                    onChange={(e) => {
                      setProjectId(e.target.value)
                      setModuleId('')
                    }}
                  >
                    <option value="" disabled>
                      选择项目
                    </option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-muted" htmlFor="atp-case-module">
                    模块（可选）
                  </label>
                  <select
                    id="atp-case-module"
                    className={selectClass}
                    value={moduleId}
                    onChange={(e) => setModuleId(e.target.value)}
                  >
                    <option value="">（不放入模块）</option>
                    {modules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="truncate text-[11px] text-muted">
                起始地址：{draft.startUrl || '（无起始地址）'}
              </p>
            </Modal.Body>

            <Modal.Footer>
              <Button variant="ghost" size="sm" onPress={close}>
                <Trash2 size={13} />
                {props.draft !== undefined ? '取消' : '丢弃'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                isDisabled={!projectId || !name.trim() || saving}
                onPress={() => void save()}
              >
                <FileCheck2 size={13} />
                {saving ? '保存中…' : '保存用例'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  )
}
