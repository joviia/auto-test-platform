import type { SkillManifest } from '@atp/model'
import { MousePointerClick, SlidersHorizontal, Upload, Wrench } from 'lucide-react'
import { useSkills } from '../api/client'
import { useUiStore } from '../state/ui-store'

const CATEGORY = {
  input: { label: '输入', icon: SlidersHorizontal },
  pointer: { label: '指针', icon: MousePointerClick },
  file: { label: '文件', icon: Upload },
} as const

export function SkillCategoryIcon({ category }: { category: SkillManifest['category'] }) {
  const Icon = CATEGORY[category].icon
  return <Icon size={11} />
}

export function SkillList() {
  const { data: skills = [], isLoading } = useSkills()
  const selected = useUiStore((s) => s.selected)
  const setSelected = useUiStore((s) => s.setSelected)
  const setAiOpen = useUiStore((s) => s.setAiOpen)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Wrench size={13} className="text-accent" />
        <span className="text-[12px] font-semibold">操作库</span>
        <span className="rounded bg-surface-secondary px-1.5 py-px text-[10px] text-muted tabular-nums">
          {skills.length}
        </span>
        <span className="ml-auto truncate text-[10px] text-muted">AI 可直接调用</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <p className="px-2 py-3 text-[11.5px] text-muted">正在读取技能…</p>
        ) : skills.length === 0 ? (
          <p className="px-2 py-3 text-[11.5px] text-muted">还没有可用的技能。</p>
        ) : (
          <div className="space-y-1">
            {skills.map((skill) => {
              const active = selected?.kind === 'skill' && selected.id === skill.id
              const Icon = CATEGORY[skill.category].icon
              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => {
                    setSelected({ kind: 'skill', id: skill.id })
                    setAiOpen(false)
                  }}
                  className={`flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors ${
                    active
                      ? 'border-accent/40 bg-accent/[0.05]'
                      : 'border-transparent hover:border-border hover:bg-surface-secondary'
                  }`}
                >
                  <span
                    className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded ${
                      active ? 'bg-accent/10 text-accent' : 'bg-surface-secondary text-muted'
                    }`}
                  >
                    <Icon size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-medium">{skill.name}</span>
                      <span className="shrink-0 rounded bg-surface-secondary px-1 py-px text-[9px] text-muted">
                        {CATEGORY[skill.category].label}
                      </span>
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-[10.5px] leading-4 text-muted">
                      {skill.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-2 text-[10px] leading-4 text-muted">
        技能是确定性的操作脚本：同样的参数，执行同样的步骤，并读回结果校验。
      </div>
    </div>
  )
}
