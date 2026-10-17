import {
  Button,
  Input,
  ModalBody,
  ModalDialog,
  ModalFooter,
  ModalHeader,
  ModalRoot,
} from '@heroui/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { qk, useModules, useProjects } from '../api/client'
import { useUiStore } from '../state/ui-store'

/** 停止录制后的保存对话框：命名 + 归属项目/模块，元素随用例 upsert 进元素库 */
export function SaveCaseDialog() {
  const qc = useQueryClient()
  const draft = useUiStore((s) => s.draftRecording)
  const setDraftRecording = useUiStore((s) => s.setDraftRecording)
  const setSelected = useUiStore((s) => s.setSelected)

  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: projects = [] } = useProjects()
  const { data: modules = [] } = useModules(draft ? projectId || null : null)

  useEffect(() => {
    if (draft) {
      setName(`录制 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`)
      setProjectId((prev) => prev || projects[0]?.id || '')
      setModuleId('')
    }
  }, [draft, projects])

  if (!draft) return null

  const selectClass =
    'h-9 w-full rounded-md border border-default-300 bg-white px-2 text-sm outline-none'

  const save = async (): Promise<void> => {
    if (!draft || !projectId || !name.trim()) return
    setSaving(true)
    try {
      const created = await window.atp.invoke('case:create', {
        projectId,
        moduleId: moduleId || null,
        name: name.trim(),
        startUrl: draft.startUrl || 'about:blank',
      })
      const saved = await window.atp.invoke('case:update', {
        case: {
          ...created.case,
          name: name.trim(),
          startUrl: draft.startUrl || created.case.startUrl,
          steps: draft.steps,
        },
        elements: draft.elements,
      })
      void qc.invalidateQueries({ queryKey: qk.cases(projectId) })
      setSelected({ kind: 'case', id: saved.case.id })
      setDraftRecording(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalRoot isOpen onOpenChange={(open) => !open && setDraftRecording(null)}>
      <ModalDialog>
        <ModalHeader>保存录制的用例</ModalHeader>
        <ModalBody className="space-y-3">
          {draft.steps.length === 0 && (
            <p className="text-sm text-red-600">
              ⚠ 本次录制没有捕获到任何操作（可能是注入失败或页面在 iframe 中），建议丢弃后重录
            </p>
          )}
          <p className="text-sm text-default-500">
            共 {draft.steps.length} 个步骤、{Object.keys(draft.elements).length} 个元素 ·{' '}
            {draft.startUrl || '（无起始地址）'}
          </p>
          <Input placeholder="用例名称" value={name} onChange={(e) => setName(e.target.value)} />
          <select
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
          <select
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
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onPress={() => setDraftRecording(null)}>
            丢弃
          </Button>
          <Button
            variant="primary"
            isDisabled={!projectId || !name.trim() || saving}
            onPress={() => void save()}
          >
            {saving ? '保存中…' : '保存用例'}
          </Button>
        </ModalFooter>
      </ModalDialog>
    </ModalRoot>
  )
}
