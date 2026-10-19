import { Bug, Globe, ListPlus, Sparkles } from 'lucide-react'
import type { ComponentType } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../state/ui-store'
import type { AiContext } from './types'

interface PaletteAction {
  icon: ComponentType<{ size?: number | string; className?: string }>
  label: string
  hint?: string
  run: () => void
}

/**
 * ⌘K 命令栏：不是第二个聊天窗，只负责「问一句」或触发一个业务动作，
 * 提交后把请求交给右侧 Copilot 页签。
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const requestAi = useUiStore((s) => s.requestAi)
  const url = useUiStore((s) => s.url)
  const selected = useUiStore((s) => s.selected)
  const selectedRunId = useUiStore((s) => s.selectedRunId)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!open) return null

  const ask = (message: string, context?: AiContext): void => {
    requestAi(message, context)
    setOpen(false)
  }

  const caseId = selected?.kind === 'case' ? selected.id : undefined
  const actions: PaletteAction[] = []
  if (url) {
    actions.push({
      icon: Globe,
      label: '从当前页面生成用例',
      hint: url,
      run: () => ask('基于当前页面，生成一条可执行的测试用例计划。'),
    })
  }
  if (selectedRunId) {
    actions.push({
      icon: Bug,
      label: '分析当前失败的步骤',
      hint: '读取运行记录并给出归因',
      run: () =>
        ask('请分析这次运行中失败的步骤，给出原因、证据和修复建议。', {
          runId: selectedRunId,
          ...(caseId ? { caseId } : {}),
        }),
    })
  }
  if (caseId) {
    actions.push({
      icon: ListPlus,
      label: '为当前用例补断言',
      hint: '基于现有步骤补全验证点',
      run: () => ask('请检查当前用例，指出缺少的验证点，并给出建议补充的断言步骤。', { caseId }),
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-[18vh] backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Copilot 命令栏"
        className="atp-fade-in w-full max-w-[560px] overflow-hidden rounded-xl border border-border bg-surface shadow-overlay"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Sparkles size={15} className="shrink-0 text-accent" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && query.trim()) {
                event.preventDefault()
                ask(query.trim())
              }
            }}
            placeholder="问 Copilot，或输入一个任务…"
            aria-label="问 Copilot"
            className="h-11 min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted"
            spellCheck={false}
          />
          <kbd className="shrink-0 rounded border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted">
            ↵
          </kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto p-1.5">
          {query.trim() && (
            <button
              type="button"
              onClick={() => ask(query.trim())}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12.5px] hover:bg-default"
            >
              <Sparkles size={14} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">
                问 Copilot：<span className="font-medium">{query.trim()}</span>
              </span>
              <span className="shrink-0 text-[10px] text-muted">Enter</span>
            </button>
          )}
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.run}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-default"
            >
              <action.icon size={14} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium">{action.label}</span>
                {action.hint && (
                  <span className="block truncate text-[10.5px] text-muted">{action.hint}</span>
                )}
              </span>
            </button>
          ))}
          {!query.trim() && actions.length === 0 && (
            <p className="px-2 py-4 text-center text-[11.5px] text-muted">
              打开一个页面或用例后，这里会出现可执行的动作。
            </p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted">
          <span>Enter 发送 · Esc 关闭</span>
          <span>结果在右侧 Copilot 页签</span>
        </div>
      </div>
    </div>
  )
}
