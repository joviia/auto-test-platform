import { Dropdown, Tooltip } from '@heroui/react'
import { ChevronDown, FlaskConical, FolderKanban, Monitor, Moon, Sun } from 'lucide-react'
import { useCases, useProjects } from '../api/client'
import { useElapsed } from '../hooks/use-elapsed'
import { useUiStore } from '../state/ui-store'

const THEME_LABEL = { system: '跟随系统', light: '浅色', dark: '深色' } as const
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const
const THEME_NEXT = { system: 'light', light: 'dark', dark: 'system' } as const

export function AppBar() {
  const { data: projects = [] } = useProjects()
  const currentProjectId = useUiStore((s) => s.currentProjectId)
  const setCurrentProjectId = useUiStore((s) => s.setCurrentProjectId)
  const selected = useUiStore((s) => s.selected)
  const recording = useUiStore((s) => s.recording)
  const recordingStartedAt = useUiStore((s) => s.recordingStartedAt)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)

  const { data: cases = [] } = useCases(currentProjectId)
  const project = projects.find((p) => p.id === currentProjectId)
  const currentCase =
    selected?.kind === 'case' ? cases.find((c) => c.id === selected.id) : undefined
  const elapsed = useElapsed(recordingStartedAt)

  const ThemeIcon = THEME_ICON[theme]

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex items-center gap-2.5 pr-1">
        <div className="grid size-8 place-items-center rounded-md bg-accent text-accent-foreground shadow-surface">
          <FlaskConical size={17} />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight">AutoTest</div>
          <div className="text-[10px] font-medium text-muted">UI 自动化测试平台</div>
        </div>
      </div>

      <div className="h-5 w-px bg-separator" />

      <Dropdown.Root>
        <Dropdown.Trigger className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] outline-none hover:bg-default data-[pressed]:bg-default">
          <FolderKanban size={14} className="text-muted" />
          <span className="max-w-[180px] truncate font-medium">
            {project?.name ?? '未选择项目'}
          </span>
          <ChevronDown size={13} className="text-muted" />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom start">
          <Dropdown.Menu
            onAction={(key) => setCurrentProjectId(String(key))}
            className="min-w-[220px]"
          >
            {projects.map((p) => (
              <Dropdown.Item key={p.id} id={p.id} textValue={p.name}>
                <FolderKanban size={14} className="text-muted" />
                <span className="truncate">{p.name}</span>
              </Dropdown.Item>
            ))}
            {projects.length === 0 && (
              <Dropdown.Item id="none" textValue="暂无项目" isDisabled>
                暂无项目，请在左侧新建
              </Dropdown.Item>
            )}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown.Root>

      <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
        <span className="truncate">{project?.name ?? '用例库'}</span>
        <span className="text-separator">/</span>
        <span className="truncate text-foreground">
          {currentCase?.name ?? (selected?.kind === 'case' ? '未命名用例' : '未选择用例')}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {recording && (
          <div className="flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 py-1 pl-2.5 pr-3 text-xs font-medium text-red-600 dark:text-red-400">
            <span className="atp-rec-dot size-2 rounded-full bg-red-500" />
            录制中
            <span className="font-mono tabular-nums">{elapsed}</span>
          </div>
        )}
        <Tooltip.Root>
          <Tooltip.Trigger>
            <button
              type="button"
              onClick={() => setTheme(THEME_NEXT[theme])}
              className="grid size-8 place-items-center rounded-md text-muted outline-none hover:bg-default hover:text-foreground"
              aria-label="切换主题"
            >
              <ThemeIcon size={15} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>主题：{THEME_LABEL[theme]}（点击切换）</Tooltip.Content>
        </Tooltip.Root>
      </div>
    </header>
  )
}
