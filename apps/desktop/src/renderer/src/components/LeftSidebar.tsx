import { FlaskConical, ListChecks } from 'lucide-react'
import { PlanList } from '../plans/PlanList'
import { useUiStore } from '../state/ui-store'
import { CaseTree } from '../tree/CaseTree'

const TABS = [
  { id: 'cases' as const, label: '用例', icon: FlaskConical },
  { id: 'plans' as const, label: '测试计划', icon: ListChecks },
]

export function LeftSidebar() {
  const navTab = useUiStore((s) => s.navTab)
  const setNavTab = useUiStore((s) => s.setNavTab)
  const setSelected = useUiStore((s) => s.setSelected)

  const switchTab = (tab: 'cases' | 'plans'): void => {
    if (tab === navTab) return
    setNavTab(tab)
    setSelected(null)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-border p-2">
        <div className="flex rounded-md bg-surface-secondary p-0.5">
          {TABS.map((tab) => {
            const Icon = tab.icon
            const active = navTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => switchTab(tab.id)}
                className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded text-[12px] font-medium transition-colors ${
                  active
                    ? 'bg-surface text-foreground shadow-surface'
                    : 'text-muted hover:text-foreground'
                }`}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {navTab === 'cases' ? <CaseTree /> : <PlanList />}
      </div>
    </div>
  )
}
