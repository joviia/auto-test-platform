import type { SkillManifest } from '@atp/model'
import { Button, toast } from '@heroui/react'
import { Info, Sparkles, Terminal, Wrench } from 'lucide-react'
import { useSkills } from '../api/client'
import { useUiStore } from '../state/ui-store'
import { SkillCategoryIcon } from './SkillList'

const CATEGORY_LABEL: Record<SkillManifest['category'], string> = {
  input: '输入控件',
  pointer: '指针交互',
  file: '文件',
}

export function SkillPanel({ skillId }: { skillId: string }) {
  const { data: skills = [] } = useSkills()
  const requestAi = useUiStore((s) => s.requestAi)
  const skill = skills.find((item) => item.id === skillId)

  if (!skill) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-[11.5px] text-muted">
        技能不存在或尚未加载。
      </div>
    )
  }

  const exampleInput = skill.params
    .filter((param) => param.required)
    .map((param) =>
      param.name === 'ref'
        ? 'ref: "browser_snapshot 返回的 ref"'
        : `${param.name}: ${param.type === 'number' ? '80' : '"..."'}`,
    )
    .join(', ')

  const useInCopilot = (): void => {
    const prompt = `使用技能「${skill.name}」（${skill.id}）：${
      skill.example ?? skill.description
    }。先 browser_snapshot 找到目标元素，再调用 skill_run。`
    requestAi(prompt)
    toast.success('已把请求放入 Copilot，确认后发送')
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-accent/[0.08] text-accent">
            <Wrench size={13} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[13px] font-semibold">{skill.name}</h2>
            <p className="font-mono text-[10px] text-muted">{skill.id}</p>
          </div>
          <span className="flex items-center gap-1 rounded bg-surface-secondary px-1.5 py-0.5 text-[9.5px] text-muted">
            <SkillCategoryIcon category={skill.category} />
            {CATEGORY_LABEL[skill.category]}
          </span>
        </div>
        <p className="mt-2 text-[11.5px] leading-5 text-muted">{skill.description}</p>
      </div>

      <div className="space-y-4 px-3 py-3">
        <section>
          <h3 className="mb-1.5 text-[11px] font-medium text-muted">参数</h3>
          <div className="overflow-hidden rounded-md border border-border">
            {skill.params.map((param, index) => (
              <div
                key={param.name}
                className={`flex items-start gap-2 px-2.5 py-2 ${
                  index > 0 ? 'border-t border-border' : ''
                }`}
              >
                <code className="shrink-0 font-mono text-[11px] text-foreground">{param.name}</code>
                <span className="shrink-0 rounded bg-surface-secondary px-1 py-px text-[9px] text-muted">
                  {param.type}
                  {param.required ? ' · 必填' : ' · 可选'}
                </span>
                <span className="min-w-0 flex-1 text-[10.5px] leading-4 text-muted">
                  {param.description}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted">
            <Terminal size={10} />
            AI 调用方式
          </h3>
          <pre className="overflow-x-auto rounded-md border border-border bg-surface-secondary px-2.5 py-2 font-mono text-[10px] leading-4 text-foreground/85">
            {`skill_run({\n  id: "${skill.id}",\n  input: { ${exampleInput} }\n})`}
          </pre>
          {skill.example && (
            <p className="mt-1.5 flex items-start gap-1 text-[10.5px] leading-4 text-muted">
              <Info size={10} className="mt-0.5 shrink-0" />
              {skill.example}
            </p>
          )}
        </section>

        <Button variant="primary" size="sm" className="w-full" onPress={useInCopilot}>
          <Sparkles size={13} />让 Copilot 使用
        </Button>
      </div>
    </div>
  )
}
