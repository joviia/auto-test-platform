import { Button, Dropdown, Input, Modal, Tooltip, toast } from '@heroui/react'
import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FlaskConical,
  FolderKanban,
  FolderPlus,
  FolderTree,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
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
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyHint } from '../components/EmptyHint'
import { useOverlayGuard } from '../hooks/use-overlay-guard'
import { type SelectedNode, useUiStore } from '../state/ui-store'

type NodeKind = 'project' | 'module' | 'case'

interface TreeNodeData {
  id: string
  name: string
  kind: NodeKind
  children?: TreeNodeData[]
}

const KIND_LABEL: Record<NodeKind, string> = { project: '项目', module: '模块', case: '用例' }
const DIALOG_TITLE: Record<NodeKind, string> = {
  project: '新建项目',
  module: '新建模块',
  case: '新建用例',
}

function buildModuleTree(
  modules: Array<{ id: string; parentId: string | null; name: string }>,
  cases: Array<{ id: string; name: string; moduleId: string | null }>,
  parentId: string | null,
): TreeNodeData[] {
  return modules
    .filter((m) => (m.parentId ?? null) === parentId)
    .map<TreeNodeData>((m) => ({
      id: m.id,
      name: m.name,
      kind: 'module',
      children: [
        ...buildModuleTree(modules, cases, m.id),
        ...cases
          .filter((c) => c.moduleId === m.id)
          .map((c) => ({ id: c.id, name: c.name, kind: 'case' as const })),
      ],
    }))
}

function filterTree(node: TreeNodeData, query: string): TreeNodeData | null {
  if (!query) return node
  const lower = query.toLowerCase()
  if (node.name.toLowerCase().includes(lower)) return node
  const children = (node.children ?? [])
    .map((child) => filterTree(child, query))
    .filter((child): child is TreeNodeData => child !== null)
  return children.length > 0 ? { ...node, children } : null
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

function NodeRenderer({ node, style }: NodeRendererProps<TreeNodeData>) {
  const selected = useUiStore((s) => s.selected)
  const active = selected?.id === node.id
  const isCase = node.data.kind === 'case'
  const hasChildren = Boolean(node.data.children?.length)
  const Icon =
    node.data.kind === 'project'
      ? FolderKanban
      : node.data.kind === 'module'
        ? FolderTree
        : FlaskConical

  return (
    <div
      style={{ ...style, paddingLeft: 6 + node.level * 14 }}
      className={`group relative flex cursor-pointer items-center gap-1.5 rounded-md pr-2 text-[13px] ${
        active
          ? 'bg-accent/10 font-medium text-accent'
          : 'text-foreground/90 hover:bg-surface-secondary'
      }`}
    >
      {active && (
        <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" aria-hidden />
      )}
      {hasChildren ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            node.toggle()
          }}
          className="grid size-4 shrink-0 place-items-center rounded text-muted hover:text-foreground"
          aria-label={node.isOpen ? '折叠' : '展开'}
        >
          {node.isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <Icon size={14} className={isCase ? 'shrink-0 text-accent/80' : 'shrink-0 text-muted'} />
      <span className="truncate">{node.data.name}</span>
      {isCase && (
        <span className="ml-auto hidden text-[10px] text-muted group-hover:inline">用例</span>
      )}
    </div>
  )
}

export function CaseTree() {
  const selected = useUiStore((s) => s.selected)
  const setSelected = useUiStore((s) => s.setSelected)
  const currentProjectId = useUiStore((s) => s.currentProjectId)
  const setCurrentProjectId = useUiStore((s) => s.setCurrentProjectId)

  const { data: projects = [] } = useProjects()
  const { data: modules = [] } = useModules(currentProjectId)
  const { data: cases = [] } = useCases(currentProjectId)

  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<NodeKind | null>(null)
  const [name, setName] = useState('')
  const [startUrl, setStartUrl] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useOverlayGuard(dialog !== null)
  useOverlayGuard(confirmDelete)

  const createProject = useCreateProject()
  const createModule = useCreateModule()
  const createCase = useCreateCase()
  const deleteNode = useDeleteNode()

  const project = projects.find((p) => p.id === currentProjectId)

  const fullTree = useMemo<TreeNodeData[]>(() => {
    if (!project) return []
    const root: TreeNodeData = {
      id: project.id,
      name: project.name,
      kind: 'project',
      children: [
        ...buildModuleTree(modules, cases, null),
        ...cases
          .filter((c) => !c.moduleId)
          .map((c) => ({ id: c.id, name: c.name, kind: 'case' as const })),
      ],
    }
    return [root]
  }, [project, modules, cases])

  const tree = useMemo<TreeNodeData[]>(() => {
    const filtered = fullTree
      .map((node) => filterTree(node, query.trim()))
      .filter((node): node is TreeNodeData => node !== null)
    return filtered
  }, [fullTree, query])

  const { ref: bodyRef, height } = useElementHeight<HTMLDivElement>()
  const searchRef = useRef<HTMLInputElement>(null)

  // 切换项目时，选中态回到项目根节点
  const prevProjectId = useRef<string | null>(null)
  useEffect(() => {
    if (prevProjectId.current === currentProjectId) return
    prevProjectId.current = currentProjectId
    setSelected(currentProjectId ? { kind: 'project', id: currentProjectId } : null)
  }, [currentProjectId, setSelected])

  // ⌘K / Ctrl+K 聚焦搜索
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const openDialog = (kind: NodeKind): void => {
    setDialog(kind)
    setName('')
    setStartUrl('')
  }

  const submit = async (): Promise<void> => {
    if (!dialog || !name.trim()) return
    try {
      if (dialog === 'project') {
        const created = await createProject.mutateAsync(name.trim())
        setCurrentProjectId(created.id)
        setSelected({ kind: 'project', id: created.id })
        toast.success(`项目「${created.name}」已创建`)
      } else if (!currentProjectId) {
        toast.danger('请先创建项目')
        return
      } else if (dialog === 'module') {
        const parentId = selected?.kind === 'module' ? selected.id : null
        const created = await createModule.mutateAsync({
          projectId: currentProjectId,
          parentId,
          name: name.trim(),
        })
        setSelected({ kind: 'module', id: created.id })
        toast.success(`模块「${created.name}」已创建`)
      } else {
        const created = await createCase.mutateAsync({
          projectId: currentProjectId,
          moduleId: selected?.kind === 'module' ? selected.id : null,
          name: name.trim(),
          startUrl: startUrl.trim() || 'about:blank',
        })
        setSelected({ kind: 'case', id: created.case.id })
        toast.success(`用例「${created.case.name}」已创建`)
      }
      setDialog(null)
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '创建失败')
    }
  }

  const remove = async (): Promise<void> => {
    if (!selected) return
    const target: SelectedNode = selected
    try {
      await deleteNode.mutateAsync(target)
      if (target.kind === 'project') {
        setSelected(null)
        setCurrentProjectId(null)
      } else {
        setSelected(null)
      }
      toast.success(`${KIND_LABEL[target.kind]}已删除`)
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '删除失败')
    }
  }

  const selectedNode = useMemo(() => {
    if (!selected) return null
    const walk = (nodes: TreeNodeData[]): TreeNodeData | null => {
      for (const node of nodes) {
        if (node.id === selected.id) return node
        const found = walk(node.children ?? [])
        if (found) return found
      }
      return null
    }
    return walk(fullTree)
  }, [fullTree, selected])

  const canDelete = Boolean(selectedNode)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 pb-2 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold tracking-tight">用例库</h2>
            <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted">
              {cases.length}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            <Dropdown.Root>
              <Dropdown.Trigger
                aria-label="新建"
                className="grid size-7 place-items-center rounded-md text-muted outline-none hover:bg-default hover:text-foreground"
              >
                <Plus size={15} />
              </Dropdown.Trigger>
              <Dropdown.Popover placement="bottom end">
                <Dropdown.Menu onAction={(key) => openDialog(String(key) as NodeKind)}>
                  <Dropdown.Item id="project" textValue="新建项目">
                    <FolderPlus size={14} className="text-muted" />
                    新建项目
                  </Dropdown.Item>
                  <Dropdown.Item id="module" textValue="新建模块" isDisabled={!currentProjectId}>
                    <FolderTree size={14} className="text-muted" />
                    新建模块
                  </Dropdown.Item>
                  <Dropdown.Item id="case" textValue="新建用例" isDisabled={!currentProjectId}>
                    <FilePlus2 size={14} className="text-muted" />
                    新建用例
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.Root>
            <Tooltip.Root>
              <Tooltip.Trigger>
                <button
                  type="button"
                  disabled={!canDelete}
                  onClick={() => setConfirmDelete(true)}
                  className="grid size-7 place-items-center rounded-md text-muted outline-none hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="删除选中节点"
                >
                  <Trash2 size={14} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content>删除选中节点</Tooltip.Content>
            </Tooltip.Root>
          </div>
        </div>

        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索用例 / 模块"
            className="h-7 py-1 pl-7 pr-7 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted hover:text-foreground"
              aria-label="清空搜索"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-hidden px-1 py-1.5">
        {!project ? (
          <EmptyHint
            icon={FolderPlus}
            title="还没有项目"
            description="创建项目后即可录制、管理用例并回放"
            action={
              <Button size="sm" variant="primary" onPress={() => openDialog('project')}>
                <Plus size={14} />
                新建项目
              </Button>
            }
          />
        ) : tree.length === 0 ? (
          <EmptyHint
            icon={Search}
            title="没有匹配结果"
            description={`没有名称包含「${query.trim()}」的用例或模块`}
            compact
          />
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

      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted">
        <span>
          {modules.length} 个模块 · {cases.length} 条用例
        </span>
        <span className="font-mono">⌘K 搜索</span>
      </div>

      {/* 关闭时整棵弹层卸载：避免退出动画被打断后遮罩残留、拦截点击 */}
      {dialog !== null && (
        <Modal.Root isOpen onOpenChange={(open) => !open && setDialog(null)}>
          <Modal.Backdrop>
            <Modal.Container size="sm">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>
                    {DIALOG_TITLE[dialog]}
                    {dialog !== 'project' && selected?.kind === 'module'
                      ? '（位于选中模块下）'
                      : ''}
                  </Modal.Heading>
                  <Modal.CloseTrigger />
                </Modal.Header>
                <Modal.Body className="space-y-3">
                  <label className="block text-xs font-medium text-muted" htmlFor="atp-node-name">
                    名称
                  </label>
                  <Input
                    id="atp-node-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={dialog === 'case' ? '例如：登录成功' : '输入名称'}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submit()
                    }}
                  />
                  {dialog === 'case' && (
                    <>
                      <label
                        className="block text-xs font-medium text-muted"
                        htmlFor="atp-start-url"
                      >
                        起始网址（可选）
                      </label>
                      <Input
                        id="atp-start-url"
                        value={startUrl}
                        onChange={(e) => setStartUrl(e.target.value)}
                        placeholder="录制时会自动更新"
                      />
                    </>
                  )}
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="secondary" size="sm" onPress={() => setDialog(null)}>
                    取消
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    isDisabled={!name.trim()}
                    onPress={() => void submit()}
                  >
                    创建
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal.Root>
      )}

      {confirmDelete && (
        <ConfirmDialog
          isOpen
          onOpenChange={setConfirmDelete}
          title={`删除${selectedNode ? KIND_LABEL[selectedNode.kind] : ''}「${selectedNode?.name ?? ''}」？`}
          description={
            selectedNode?.kind === 'project'
              ? '项目下的模块、用例和执行记录将一并删除，此操作不可撤销。'
              : selectedNode?.kind === 'module'
                ? '模块下的子模块与用例将一并删除，此操作不可撤销。'
                : '用例及其步骤将被删除，引用它的元素会保留在元素库中。'
          }
          confirmLabel="删除"
          onConfirm={remove}
        />
      )}
    </div>
  )
}
