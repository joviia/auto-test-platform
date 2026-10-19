import { Dropdown, Tooltip } from '@heroui/react'
import {
  ChevronDown,
  FlaskConical,
  FolderKanban,
  Monitor,
  Moon,
  Settings,
  Sparkles,
  Sun,
} from 'lucide-react'
import { useCases, usePlans, useProjects, useSkills } from '../api/client'
import { useUiStore } from '../state/ui-store'

const THEME_LABEL = { system: '跟随系统', light: '浅色', dark: '深色' } as const
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const
const THEME_NEXT = { system: 'light', light: 'dark', dark: 'system' } as const

export function AppBar() {
  const { data: projects = [] } = useProjects()
  const currentProjectId = useUiStore((s) => s.currentProjectId)
  const setCurrentProjectId = useUiStore((s) => s.setCurrentProjectId)
  const selected = useUiStore((s) => s.selected)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const navTab = useUiStore((s) => s.navTab)
  const setAiOpen = useUiStore((s) => s.setAiOpen)
  const setRightTab = useUiStore((s) => s.setRightTab)
  const setAiSettingsOpen = useUiStore((s) => s.setAiSettingsOpen)

  const { data: cases = [] } = useCases(currentProjectId)
  const { data: plans = [] } = usePlans(currentProjectId)
  const { data: skills = [] } = useSkills()
  const project = projects.find((p) => p.id === currentProjectId)
  const currentSkill =
    selected?.kind === 'skill' ? skills.find((skill) => skill.id === selected.id) : undefined
  const currentCase =
    selected?.kind === 'case' ? cases.find((c) => c.id === selected.id) : undefined
  const currentPlan =
    selected?.kind === 'plan' ? plans.find((p) => p.id === selected.id) : undefined

  const ThemeIcon = THEME_ICON[theme]

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
      <div className="flex items-center gap-2.5 pr-1">
        <div className="grid size-8 place-items-center rounded-md bg-accent text-accent-foreground shadow-surface">
          <FlaskConical size={17} />
        </div>
        <div className="text-[13px] font-semibold tracking-tight">ATP</div>
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

      <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <span className="text-muted">
          {navTab === 'skills'
            ? '操作库'
            : selected?.kind === 'plan' || navTab === 'plans'
              ? '测试计划'
              : '用例'}
        </span>
        <span className="text-separator">/</span>
        <span className="truncate text-foreground">
          {currentSkill?.name ??
            currentPlan?.name ??
            currentCase?.name ??
            (navTab === 'skills'
              ? '未选择操作'
              : selected?.kind === 'plan' || navTab === 'plans'
                ? '未选择计划'
                : '未选择用例')}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Tooltip.Root>
          <Tooltip.Trigger>
            <button
              type="button"
              onClick={() => {
                setAiOpen(true)
                setRightTab('copilot')
              }}
              className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-muted outline-none transition-colors hover:bg-accent/[0.07] hover:text-accent"
              aria-label="打开 Copilot"
            >
              <Sparkles size={14} className="text-accent" />
              Copilot
              <kbd className="rounded border border-border bg-surface-secondary px-1 font-mono text-[9px] font-normal text-muted">
                ⌘K
              </kbd>
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>问 Copilot，或让 Agent 操作页面（⌘K）</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            <button
              type="button"
              onClick={() => setAiSettingsOpen(true)}
              className="grid size-8 place-items-center rounded-md text-muted outline-none hover:bg-default hover:text-foreground"
              aria-label="模型设置"
            >
              <Settings size={15} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>模型设置（API Key / 模型）</Tooltip.Content>
        </Tooltip.Root>
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
