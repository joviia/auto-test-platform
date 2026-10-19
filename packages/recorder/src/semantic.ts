import type { CaseGroup, StepDisplay } from '@atp/model'
import type { RecorderStep } from './normalize.js'

/** 聚合后的一个意图步骤：1 个原语，或下拉的「触发器 + 选项」两次点击 */
export interface SemanticEntry {
  steps: RecorderStep[]
  /** 展示层动作；下拉合并后为 select */
  action: RecorderStep['action']
  /** 合并后的选择值 */
  value?: string
  display: StepDisplay
  groupId?: string
  confidence: 'auto' | 'confirm'
}

export interface SemanticDraft {
  entries: SemanticEntry[]
  groups: CaseGroup[]
  intent: string
}

function fieldOf(step: RecorderStep): string {
  return (
    step.semantic?.label ||
    step.target.name ||
    step.target.placeholder ||
    step.target.text ||
    step.target.tag
  )
}

function optionTextOf(step: RecorderStep): string {
  return step.semantic?.optionText || step.target.name || step.target.text || ''
}

function isOptionClick(step: RecorderStep): boolean {
  const role = step.semantic?.role ?? step.target.role
  return Boolean(
    step.semantic?.optionText || role === 'option' || role === 'menuitem' || role === 'treeitem',
  )
}

function isSelectTrigger(step: RecorderStep): boolean {
  return (
    step.semantic?.tag === 'select' ||
    step.semantic?.role === 'combobox' ||
    Boolean(step.semantic?.hasPopup)
  )
}

function rawLabel(step: RecorderStep): string {
  const field = fieldOf(step)
  switch (step.action) {
    case 'click':
      return `点击 ${field}`
    case 'fill':
      return `填写 ${field} = ${step.value ?? ''}`
    case 'select':
      return `选择 ${field} = ${optionTextOf(step) || step.value || ''}`
    case 'press':
      return `按键 ${step.key ?? 'Enter'}`
    case 'scroll':
      return `滚动到 (${step.x ?? 0}, ${step.y ?? 0})`
    case 'drag':
      return `拖拽 ${field}`
  }
}

function displayText(display: StepDisplay): string {
  const parts = [display.verb]
  if (display.field) parts.push(display.field)
  if (display.value !== undefined && display.value !== '') parts.push(`= ${display.value}`)
  return parts.join(' ')
}

/** 弹层出现的 1.5s 内点击选项 → 合并为复合 select */
function tryMergeSelect(
  step: RecorderStep,
  next: RecorderStep | undefined,
): { entry: SemanticEntry; consumed: 1 | 2 } | null {
  if (step.action !== 'click' || !next || next.action !== 'click') return null
  if (next.ts - step.ts > 1500) return null
  const popup = step.probe?.popup
  const optionText = optionTextOf(next)
  if (!popup || !optionText) return null
  if (next.probe?.dialogOpened) return null
  const matched = popup.options.includes(optionText) || isOptionClick(next)
  if (!matched) return null

  const field = fieldOf(step)
  return {
    consumed: 2,
    entry: {
      steps: [step, next],
      action: 'select',
      value: optionText,
      display: {
        verb: '选择',
        field,
        value: optionText,
        details: [rawLabel(step), rawLabel(next)],
        confidence: 'auto',
      },
      confidence: 'auto',
    },
  }
}

function displayOf(step: RecorderStep): { display: StepDisplay; confidence: 'auto' | 'confirm' } {
  const field = fieldOf(step)
  const details = [rawLabel(step)]
  const probe = step.probe
  const semantic = step.semantic
  const checkedBefore = semantic?.checked
  const checkedAfter = probe?.checked

  switch (step.action) {
    case 'click': {
      if (
        step.semantic?.tag === 'input' &&
        (step.semantic.inputType === 'checkbox' || step.semantic.inputType === 'radio')
      ) {
        const isRadio = step.semantic.inputType === 'radio'
        if (isRadio) {
          return {
            display: {
              verb: '选择',
              field: semantic?.groupLabel || field,
              value: field,
              details,
              confidence: 'auto',
            },
            confidence: 'auto',
          }
        }
        const on = checkedAfter ?? checkedBefore
        return {
          display: {
            verb: on === undefined ? '点击' : on ? '开启' : '关闭',
            field,
            details,
            confidence: 'auto',
          },
          confidence: 'auto',
        }
      }
      if (probe?.dialogOpened) {
        return {
          display: {
            verb: '打开',
            field: probe.dialogOpened,
            details,
            confidence: 'auto',
          },
          confidence: 'auto',
        }
      }
      if (probe?.url && probe.url !== step.url) {
        let target = probe.url
        try {
          const url = new URL(probe.url)
          target = url.pathname === '/' ? url.host : url.pathname
        } catch {
          // 保持原值
        }
        return {
          display: {
            verb: '打开',
            field: target,
            details,
            confidence: 'auto',
          },
          confidence: 'auto',
        }
      }
      if (isSelectTrigger(step) && !probe?.popup) {
        return {
          display: {
            verb: '点击',
            field,
            details: [...details, '可能是一个下拉选择，可合并'],
            confidence: 'confirm',
          },
          confidence: 'confirm',
        }
      }
      return {
        display: { verb: '点击', field, details, confidence: 'auto' },
        confidence: 'auto',
      }
    }
    case 'fill':
      return {
        display: {
          verb: '填写',
          field,
          ...(step.value !== undefined ? { value: step.value } : {}),
          details,
          confidence: 'auto',
        },
        confidence: 'auto',
      }
    case 'select':
      return {
        display: {
          verb: '选择',
          field,
          value: optionTextOf(step) || step.value || '',
          details,
          confidence: 'auto',
        },
        confidence: 'auto',
      }
    case 'press':
      return {
        display: {
          verb: '按键',
          value: step.key ?? 'Enter',
          details,
          confidence: 'auto',
        },
        confidence: 'auto',
      }
    case 'scroll':
      return {
        display: {
          verb: '滚动',
          value: `(${step.x ?? 0}, ${step.y ?? 0})`,
          details,
          confidence: 'auto',
        },
        confidence: 'auto',
      }
    case 'drag':
      return {
        display: { verb: '拖拽', field, details, confidence: 'auto' },
        confidence: 'auto',
      }
  }
}

/**
 * 原语步骤 → 意图层投影。
 * 只做高置信合并；不确定时保留原步骤并标 confirm，不静默改变执行语义。
 */
export function buildSemanticDraft(steps: RecorderStep[]): SemanticDraft {
  const entries: SemanticEntry[] = []
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const merged = tryMergeSelect(step, steps[i + 1])
    if (merged) {
      entries.push(merged.entry)
      i += merged.consumed - 1
      continue
    }
    const { display, confidence } = displayOf(step)
    entries.push({ steps: [step], action: step.action, display, confidence })
  }

  // 弹窗 / 导航分组
  const groups: CaseGroup[] = []
  const stack: CaseGroup[] = []
  let counter = 0
  const newGroup = (label: string, kind: CaseGroup['kind']): CaseGroup => {
    counter += 1
    return { id: `g-${counter}`, label, kind }
  }

  for (const entry of entries) {
    const step = entry.steps[0]
    const probe = step.probe

    if (probe?.dialogOpened) {
      const group = newGroup(probe.dialogOpened || '弹窗', 'dialog')
      groups.push(group)
      stack.push(group)
    } else if (probe?.url && probe.url !== step.url && !stack.some((g) => g.kind === 'dialog')) {
      const navIndex = stack.findIndex((g) => g.kind === 'navigation')
      if (navIndex >= 0) stack.splice(navIndex, 1)
      let label = '打开页面'
      try {
        const url = new URL(probe.url)
        label = `打开 ${url.pathname === '/' ? url.host : url.pathname}`
      } catch {
        // 保持默认
      }
      const group = newGroup(label, 'navigation')
      groups.push(group)
      stack.push(group)
    }

    entry.groupId = stack[stack.length - 1]?.id

    if (probe?.dialogClosed) {
      const top = stack[stack.length - 1]
      if (top?.kind === 'dialog') stack.pop()
    }
  }

  const usedGroups = groups.filter((group) => entries.some((entry) => entry.groupId === group.id))
  const mainDialog = usedGroups.find((group) => group.kind === 'dialog')
  const summary = entries
    .slice(0, 5)
    .map((entry) => displayText(entry.display))
    .join(' → ')
  const more = entries.length > 5 ? ` → …（共 ${entries.length} 步）` : ''
  const intent = `${mainDialog ? `在「${mainDialog.label}」中：` : ''}${summary}${more}`.slice(
    0,
    160,
  )

  return { entries, groups: usedGroups, intent }
}

export { displayText }
