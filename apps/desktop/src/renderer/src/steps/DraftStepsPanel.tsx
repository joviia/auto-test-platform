import { CheckCircle2 } from 'lucide-react'
import { useUiStore } from '../state/ui-store'
import { actionMeta, stepPreview } from './step-meta'

/**
 * 录制结束、尚未保存时的右栏内容。
 * 之前停止录制后右栏立刻切回选中用例（通常为空），看起来像步骤全丢了。
 */
export function DraftStepsPanel() {
  const draft = useUiStore((s) => s.draftRecording)
  if (!draft) return null

  const elementCount = Object.keys(draft.elements).length

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <CheckCircle2 size={13} className="text-green-600 dark:text-green-400" />
        <span className="text-[13px] font-medium">录制完成</span>
        <span className="text-[11px] text-muted">
          {draft.steps.length} 步 · {elementCount} 个元素
        </span>
        <span className="ml-auto text-[11px] text-muted">等待保存</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {draft.steps.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted">本次录制没有捕获到任何操作</p>
        ) : (
          <div className="space-y-1.5">
            {draft.steps.map((step, idx) => {
              const meta = actionMeta(step.action)
              const element = draft.elements[step.elementId ?? '']
              const preview = stepPreview(step)
              return (
                <div
                  key={step.id}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px]"
                >
                  <span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted">
                    {idx + 1}
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {element?.name ?? step.elementId ?? '页面级操作'}
                  </span>
                  {preview && (
                    <span className="max-w-[140px] shrink-0 truncate font-mono text-[11px] text-muted">
                      {preview}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted">
        在保存对话框中命名并保存，或丢弃本次录制
      </div>
    </div>
  )
}
