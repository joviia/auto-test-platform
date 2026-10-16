import {
  Button,
  Input,
  ModalBody,
  ModalDialog,
  ModalFooter,
  ModalHeader,
  ModalRoot,
} from '@heroui/react'
import { FlaskConical, Folder, FolderTree, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NodeRendererProps } from 'react-arborist'
import { Tree } from 'react-arborist'
import {
  useCases,
  useCreateCase,
  useCreateModule,
  useCreateProject,
  useDeleteNode,
  useModules,
  useProjects,
} from '../api/client'
import { useUiStore } from '../state/ui-store'

type NodeKind = 'project' | 'module' | 'case'

interface TreeNodeData {
  id: string
  name: string
  kind: NodeKind
  children?: TreeNodeData[]
}

const KIND_ICON: Record<NodeKind, typeof Folder> = {
  project: Folder,
  module: FolderTree,
  case: FlaskConical,
}

function buildModuleTree(
  modules: Array<{ id: string; parentId: string | null; name: string; projectId: string }>,
  cases: Array<{ id: string; name: string; projectId: string; moduleId: string | null }>,
  projectId: string,
  parentId: string | null,
): TreeNodeData[] {
  const childModules = modules
    .filter((m) => m.projectId === projectId && (m.parentId ?? null) === parentId)
    .map<TreeNodeData>((m) => ({
      id: m.id,
      name: m.name,
      kind: 'module',
      children: [
        ...buildModuleTree(modules, cases, projectId, m.id),
        ...cases
          .filter((c) => c.moduleId === m.id)
          .map((c) => ({ id: c.id, name: c.name, kind: 'case' as const })),
      ],
    }))
  return childModules
}

function NodeRenderer({ node, style }: NodeRendererProps<TreeNodeData>) {
  const selected = useUiStore((s) => s.selected)
  const active = selected?.id === node.id
  return (
    <div
      style={style}
      className={`flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-sm ${
        active ? 'bg-primary-100 text-primary-700' : 'hover:bg-default-100'
      }`}
    >
      {(() => {
        const Icon = KIND_ICON[node.data.kind]
        return <Icon size={14} />
      })()}
      <span className="truncate">{node.data.name}</span>
    </div>
  )
}

function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(400)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  return { ref, height }
}

export function CaseTree() {
  const selected = useUiStore((s) => s.selected)
  const setSelected = useUiStore((s) => s.setSelected)

  const { data: projects = [] } = useProjects()
  const { data: modules = [] } = useModules(projects[0]?.id ?? null)
  const { data: cases = [] } = useCases(projects[0]?.id ?? null)

  const tree = useMemo<TreeNodeData[]>(
    () =>
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        kind: 'project' as const,
        children: [
          ...buildModuleTree(modules, cases, p.id, null),
          ...cases
            .filter((c) => c.projectId === p.id && !c.moduleId)
            .map((c) => ({ id: c.id, name: c.name, kind: 'case' as const })),
        ],
      })),
    [projects, modules, cases],
  )

  const { ref: bodyRef, height } = useElementHeight<HTMLDivElement>()

  // 创建对话框：'project' | 'module' | 'case' | null
  const [dialog, setDialog] = useState<NodeKind | null>(null)
  const [name, setName] = useState('')
  const [startUrl, setStartUrl] = useState('')
  const createProject = useCreateProject()
  const createModule = useCreateModule()
  const createCase = useCreateCase()
  const deleteNode = useDeleteNode()

  const contextProjectId = selected?.kind === 'project' ? selected.id : (projects[0]?.id ?? null)
  const contextModuleId = selected?.kind === 'module' ? selected.id : null

  const submit = async (): Promise<void> => {
    if (!name.trim() || !dialog) return
    if (dialog === 'project') await createProject.mutateAsync(name.trim())
    if (dialog === 'module' && contextProjectId)
      await createModule.mutateAsync({
        projectId: contextProjectId,
        parentId: contextModuleId,
        name: name.trim(),
      })
    if (dialog === 'case' && contextProjectId)
      await createCase.mutateAsync({
        projectId: contextProjectId,
        moduleId: contextModuleId,
        name: name.trim(),
        startUrl: startUrl.trim() || 'about:blank',
      })
    setDialog(null)
    setName('')
    setStartUrl('')
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    await deleteNode.mutateAsync(selected)
    setSelected(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-default-200 p-2">
        <Button size="sm" variant="ghost" onPress={() => setDialog('project')}>
          <Plus size={14} />
          项目
        </Button>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={!contextProjectId}
          onPress={() => setDialog('module')}
        >
          <Plus size={14} />
          模块
        </Button>
        <Button
          size="sm"
          variant="ghost"
          isDisabled={!contextProjectId}
          onPress={() => setDialog('case')}
        >
          <Plus size={14} />
          用例
        </Button>
        <Button size="sm" variant="danger" isDisabled={!selected} onPress={() => void remove()}>
          <Trash2 size={14} />
          删除
        </Button>
      </div>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-hidden p-1">
        {tree.length === 0 ? (
          <p className="p-3 text-sm text-default-400">先创建一个项目</p>
        ) : (
          <Tree
            data={tree}
            rowHeight={30}
            height={height}
            width="100%"
            openByDefault
            onActivate={(node) => setSelected({ kind: node.data.kind, id: node.id })}
          >
            {NodeRenderer}
          </Tree>
        )}
      </div>

      <ModalRoot isOpen={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <ModalDialog>
          <ModalHeader>
            {{ project: '新建项目', module: '新建模块', case: '新建用例' }[dialog ?? 'project']}
          </ModalHeader>
          <ModalBody className="space-y-3">
            <Input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
            {dialog === 'case' && (
              <Input
                placeholder="起始网址（录制时会自动更新）"
                value={startUrl}
                onChange={(e) => setStartUrl(e.target.value)}
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onPress={() => setDialog(null)}>
              取消
            </Button>
            <Button variant="primary" onPress={() => void submit()}>
              创建
            </Button>
          </ModalFooter>
        </ModalDialog>
      </ModalRoot>
    </div>
  )
}
