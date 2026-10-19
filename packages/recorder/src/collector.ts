/**
 * 页面侧采集器：`collectorSource()` 返回自包含脚本，经 executeJavaScript 注入。
 *
 * 约束：pageCollector 编译后整体 toString 注入，函数体内不得引用任何模块级
 * 标识符；事件经 window.__atpBridge.send（recorder-preload 提供）回传主进程。
 */

export interface RawTargetInfo {
  tag: string
  inputType?: string
  role?: string
  name?: string
  text?: string
  value?: string
  placeholder?: string
}

/** 录制时采集的意图线索（字段名、弹层、开关状态、弹窗标题） */
export interface RawSemanticMeta {
  /** 字段名：aria-label → 关联 label → placeholder → name → 表单项标签 → 元素名 */
  label?: string
  role?: string
  tag?: string
  inputType?: string
  hasPopup?: string
  expanded?: boolean
  checked?: boolean
  /** 点击目标本身是选项时的选项文本 */
  optionText?: string
  /** 所在弹窗标题 */
  dialogTitle?: string
  inDialog?: boolean
  /** 单选框所属分组名 */
  groupLabel?: string
}

export interface RawPopupInfo {
  role: string
  options: string[]
}

/** 录制期候选（count 仅供唯一性参考，不入库） */
export interface RawLocatorCandidate {
  type: 'testId' | 'role' | 'text' | 'css' | 'xpath'
  value: string
  name?: string
  count: number | null
  /** 语义作用域链（从外到内）：dialog / row / tabpanel / 具名容器 */
  scope?: RawLocatorCandidate[]
  /** 该作用域命中多个时取最上层（仅 dialog） */
  topmost?: boolean
}

interface RawEventBase {
  url: string
  ts: number
  /** 是否顶层文档（iframe 内的事件为 false，用于起始地址判定） */
  isTop?: boolean
  /** 元素所属 iframe 路径（主进程根据 senderFrame 填充） */
  framePath?: number[]
}

/** 用户的真实动作事件 */
export interface RawActionEvent extends RawEventBase {
  kind: 'click' | 'fill' | 'select' | 'keydown' | 'scroll' | 'drag'
  target: RawTargetInfo
  candidates: RawLocatorCandidate[]
  /** click 的意图线索 */
  semantic?: RawSemanticMeta
  value?: string
  key?: string
  /** 滚动位置（仅 scroll 事件） */
  x?: number
  y?: number
  /** 拖拽位移与时长（仅 drag 事件） */
  dx?: number
  dy?: number
  /** 按下点相对目标元素左上角的偏移 */
  startX?: number
  startY?: number
  durationMs?: number
}

/** click 后 180ms 的观察结果；只用于语义聚合，不进入步骤 */
export interface RawProbeEvent extends RawEventBase {
  kind: 'probe'
  refTs: number
  popup?: RawPopupInfo
  dialogOpened?: string
  dialogClosed?: boolean
  expanded?: boolean
  checked?: boolean
  triggerValue?: string
  selectedText?: string
}

export type RawRecorderEvent = RawActionEvent | RawProbeEvent

export function collectorSource(): string {
  return `(${pageCollector.toString()})()`
}

function pageCollector(): void {
  const w = window as unknown as {
    __atpRecorderInstalled?: boolean
    __atpBridge?: { send: (event: unknown) => void }
  }
  if (w.__atpRecorderInstalled) return
  w.__atpRecorderInstalled = true

  const send = (event: unknown): void => {
    w.__atpBridge?.send({ ...(event as object), isTop: window === window.top })
  }

  const cssEscape = (s: string): string =>
    typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/(["\\])/g, '\\$1')

  const nthOfType = (el: Element): number => {
    let i = 1
    let sib = el.previousElementSibling
    while (sib) {
      if (sib.tagName === el.tagName) i++
      sib = sib.previousElementSibling
    }
    return i
  }

  const cssChain = (el: Element): string => {
    const parts: string[] = []
    let cur: Element | null = el
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let seg = cur.tagName.toLowerCase()
      if (cur.id) {
        parts.unshift(`${seg}#${cssEscape(cur.id)}`)
        break
      }
      const testId = cur.getAttribute('data-testid')
      if (testId) seg += `[data-testid="${cssEscape(testId)}"]`
      else if (cur.classList.length > 0) seg += `.${cssEscape(cur.classList[0])}`
      else seg += `:nth-of-type(${nthOfType(cur)})`
      parts.unshift(seg)
      cur = cur.parentElement
      try {
        if (document.querySelectorAll(parts.join(' > ')).length === 1) break
      } catch {
        break
      }
    }
    return parts.join(' > ')
  }

  const implicitRole = (el: Element): string | null => {
    const ariaRole = el.getAttribute('role')
    if (ariaRole) return ariaRole
    const tag = el.tagName.toLowerCase()
    if (tag === 'button') return 'button'
    if (tag === 'input') {
      const t = (el as HTMLInputElement).type
      if (t === 'checkbox') return 'checkbox'
      if (t === 'radio') return 'radio'
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button'
      return 'textbox'
    }
    if (tag === 'textarea') return 'textbox'
    if (tag === 'select') return 'combobox'
    if (tag === 'a' && el.hasAttribute('href')) return 'link'
    if (el.getAttribute('contenteditable') !== null) return 'textbox'
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') return 'heading'
    return null
  }

  const accessibleName = (el: Element): string => {
    const aria = el.getAttribute('aria-label')
    if (aria) return aria.trim()
    const labelledby = el.getAttribute('aria-labelledby')
    if (labelledby) {
      const lab = document.getElementById(labelledby)
      if (lab) return (lab.textContent ?? '').trim()
    }
    const tag = el.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const input = el as HTMLInputElement
      if (input.id) {
        const label = document.querySelector(`label[for="${cssEscape(input.id)}"]`)
        if (label) return (label.textContent ?? '').trim()
      }
      const wrap = el.closest('label')
      if (wrap) {
        const clone = wrap.cloneNode(true) as Element
        for (const n of Array.from(clone.querySelectorAll('input,textarea,select'))) n.remove()
        const t = (clone.textContent ?? '').trim()
        if (t) return t
      }
      if (input.placeholder) return input.placeholder.trim()
      return ''
    }
    return (el.textContent ?? '').trim().slice(0, 60)
  }

  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
  }

  const DIALOG_SELECTOR = 'dialog, [role="dialog"], [aria-modal="true"]'
  const POPUP_SELECTOR =
    '[role="listbox"], [role="menu"], .el-select-dropdown, .el-dropdown-menu, .ant-select-dropdown, .ant-dropdown, .el-popper'

  const visibleDialogs = (): Element[] =>
    Array.from(document.querySelectorAll(DIALOG_SELECTOR)).filter(isVisible)

  const dialogTitleOf = (node: Element): string => {
    const name = containerName(node)
    if (name) return name
    const heading = node.querySelector('h1, h2, h3, [role="heading"]')
    return heading ? (heading.textContent ?? '').trim().slice(0, 60) : ''
  }

  const activeDialog = (): Element | null => {
    const dialogs = visibleDialogs()
    return dialogs.length ? dialogs[dialogs.length - 1] : null
  }

  const optionContainer = (el: Element): Element | null =>
    el.closest('[role="option"], [role="menuitem"], [role="treeitem"], li')

  const optionTextOf = (el: Element): string => {
    const option = optionContainer(el)
    if (!option) return ''
    if (!option.closest(POPUP_SELECTOR)) return ''
    return (option.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
  }

  const popupInfo = (): RawPopupInfo | null => {
    const popups = Array.from(document.querySelectorAll(POPUP_SELECTOR)).filter(isVisible)
    const node = popups[popups.length - 1]
    if (!node) return null
    const roleAttr = node.getAttribute('role')
    const className = typeof node.className === 'string' ? node.className : ''
    const role =
      roleAttr ??
      (className.includes('select') || className.includes('dropdown') ? 'listbox' : 'popup')
    const options = Array.from(
      node.querySelectorAll('[role="option"], [role="menuitem"], [role="treeitem"], li'),
    )
      .filter(isVisible)
      .map((option) => (option.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60))
      .filter(Boolean)
      .slice(0, 30)
    return { role, options }
  }

  /** 点击 label 时真实状态在关联控件上 */
  const controlOf = (el: Element): Element => {
    if (el.tagName.toLowerCase() !== 'label') return el
    const htmlFor = el.getAttribute('for')
    if (htmlFor) {
      const control = document.getElementById(htmlFor)
      if (control) return control
    }
    return el.querySelector('input, select, textarea') ?? el
  }

  const checkedOf = (el: Element): boolean | undefined => {
    const control = controlOf(el)
    const input = control as HTMLInputElement
    if (input.type === 'checkbox' || input.type === 'radio') return input.checked
    const aria = control.getAttribute('aria-checked')
    if (aria === 'true') return true
    if (aria === 'false') return false
    return undefined
  }

  const expandedOf = (el: Element): boolean | undefined => {
    const value = el.getAttribute('aria-expanded')
    if (value === 'true') return true
    if (value === 'false') return false
    return undefined
  }

  const radioGroupLabel = (el: Element): string => {
    const control = controlOf(el)
    const group = control.closest('[role="radiogroup"], fieldset')
    if (!group) return ''
    const aria = group.getAttribute('aria-label')
    if (aria) return aria.trim()
    const legend = group.querySelector('legend')
    if (legend) return (legend.textContent ?? '').trim().slice(0, 60)
    const labelledby = group.getAttribute('aria-labelledby')
    if (labelledby) {
      const node = document.getElementById(labelledby)
      if (node) return (node.textContent ?? '').trim().slice(0, 60)
    }
    return ''
  }

  /** 字段名优先级：aria-label → 关联 label → placeholder → name → 表单项标签 → 元素名 */
  const fieldName = (el: Element): string => {
    const control = controlOf(el)
    const aria = el.getAttribute('aria-label') ?? control.getAttribute('aria-label')
    if (aria?.trim()) return aria.trim()

    const labelledby = el.getAttribute('aria-labelledby') ?? control.getAttribute('aria-labelledby')
    if (labelledby) {
      const node = document.getElementById(labelledby)
      if (node) {
        const text = (node.textContent ?? '').trim()
        if (text) return text.slice(0, 60)
      }
    }

    const input = control as HTMLInputElement
    const id = control.getAttribute('id')
    if (id) {
      const label = document.querySelector(`label[for="${cssEscape(id)}"]`)
      if (label) {
        const text = (label.textContent ?? '').trim()
        if (text) return text.slice(0, 60)
      }
    }
    const wrap = control.closest('label')
    if (wrap) {
      const clone = wrap.cloneNode(true) as Element
      for (const n of Array.from(clone.querySelectorAll('input,textarea,select'))) n.remove()
      const text = (clone.textContent ?? '').trim()
      if (text) return text.slice(0, 60)
    }

    if (input.placeholder?.trim()) return input.placeholder.trim()
    const nameAttr = control.getAttribute('name')
    if (nameAttr?.trim()) return nameAttr.trim()

    const formItem = control.closest(
      '.el-form-item, .ant-form-item, [class*="form-item"], [class*="form-group"], [class*="field"]',
    )
    if (formItem) {
      const label = formItem.querySelector(
        '.el-form-item__label, .ant-form-item-label label, label, [class*="label"]',
      )
      const text = (label?.textContent ?? '').trim()
      if (text) return text.slice(0, 60)
    }

    return accessibleName(el).slice(0, 60)
  }

  const directText = (el: Element): string => {
    if (el.children.length > 0) return ''
    const t = (el.textContent ?? '').trim()
    return t && t.length <= 60 ? t : ''
  }

  /** 绝对 XPath：没有语义标识时的最后兜底 */
  const xpathOf = (el: Element): string => {
    const parts: string[] = []
    let cur: Element | null = el
    while (cur && cur.nodeType === 1) {
      if (cur === document.documentElement) {
        parts.unshift('html[1]')
        break
      }
      let idx = 1
      let sib = cur.previousElementSibling
      while (sib) {
        if (sib.tagName === cur.tagName) idx++
        sib = sib.previousElementSibling
      }
      parts.unshift(`${cur.tagName.toLowerCase()}[${idx}]`)
      cur = cur.parentElement
    }
    return `/${parts.join('/')}`
  }

  /** 容器语义名：aria-label → aria-labelledby → 标题 */
  const containerName = (node: Element): string => {
    const aria = node.getAttribute('aria-label')
    if (aria) return aria.trim()
    const labelledby = node.getAttribute('aria-labelledby')
    if (labelledby) {
      const lab = document.getElementById(labelledby)
      if (lab) return (lab.textContent ?? '').trim().slice(0, 60)
    }
    const heading = node.querySelector('h1, h2, h3, [role="heading"]')
    return heading ? (heading.textContent ?? '').trim().slice(0, 60) : ''
  }

  const rowText = (node: Element): string => {
    const cells = Array.from(node.querySelectorAll('td, th, [role="cell"], [role="gridcell"]'))
    return cells
      .map((c) => (c.textContent ?? '').trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' ')
      .slice(0, 60)
  }

  /** 把一个元素识别成可复用的语义作用域；识别不了返回 null */
  const containerScope = (node: Element): RawLocatorCandidate | null => {
    if (node.matches('dialog, [role="dialog"], [aria-modal="true"]')) {
      const name = containerName(node)
      return {
        type: 'role',
        value: 'dialog',
        ...(name ? { name } : {}),
        count: null,
        topmost: true,
      }
    }
    if (node.matches('[role="tabpanel"]')) {
      const active = node.getAttribute('aria-hidden') !== 'true'
      return {
        type: 'css',
        value: active
          ? '[role="tabpanel"][aria-hidden="false"]'
          : '[role="tabpanel"][aria-hidden="true"]',
        count: null,
      }
    }
    if (node.matches('tr, [role="row"]')) {
      const key = node.getAttribute('data-atp-key') ?? node.getAttribute('data-key')
      if (key) {
        return {
          type: 'css',
          value: `${node.tagName.toLowerCase()}[data-atp-key="${cssEscape(key)}"]`,
          count: null,
        }
      }
      const text = rowText(node)
      if (text) {
        return {
          type: 'css',
          value: `${node.tagName.toLowerCase()}:has-text(${JSON.stringify(text)})`,
          count: null,
        }
      }
      return null
    }
    const role = node.getAttribute('role')
    if (role) {
      const name = containerName(node)
      if (name) return { type: 'role', value: role, name, count: null }
    }
    return null
  }

  /** 从目标向上收集语义作用域，外层在前 */
  const scopeChain = (el: Element): RawLocatorCandidate[] => {
    const out: RawLocatorCandidate[] = []
    let cur = el.parentElement
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const scope = containerScope(cur)
      if (scope) out.unshift(scope)
      cur = cur.parentElement
    }
    return out
  }

  const candidatesFor = (el: Element): RawLocatorCandidate[] => {
    const out: RawLocatorCandidate[] = []
    const scopes = scopeChain(el)
    const testId = el.getAttribute('data-testid')
    if (testId) {
      out.push({
        type: 'testId',
        value: testId,
        count: document.querySelectorAll(`[data-testid="${cssEscape(testId)}"]`).length,
      })
    }
    const role = implicitRole(el)
    if (role) {
      const name = accessibleName(el)
      if (scopes.length > 0) {
        out.push({
          type: 'role',
          value: role,
          ...(name ? { name } : {}),
          count: null,
          scope: scopes,
        })
      }
      out.push({ type: 'role', value: role, ...(name ? { name } : {}), count: null })
    }
    const text = directText(el)
    if (text) {
      if (scopes.length > 0) {
        out.push({ type: 'text', value: text, count: null, scope: scopes })
      }
      out.push({ type: 'text', value: text, count: null })
    }
    const css = cssChain(el)
    if (css) {
      let count: number | null = null
      try {
        count = document.querySelectorAll(css).length
      } catch {
        count = null
      }
      out.push({ type: 'css', value: css, count })
    }
    out.push({ type: 'xpath', value: xpathOf(el), count: 1 })
    return out
  }

  const describe = (el: Element, value?: string): RawTargetInfo => {
    const input = el as HTMLInputElement
    return {
      tag: el.tagName.toLowerCase(),
      inputType: input.type || undefined,
      role: implicitRole(el) ?? undefined,
      name: accessibleName(el) || undefined,
      text: directText(el) || undefined,
      value: value ?? input.value ?? undefined,
      placeholder: input.placeholder || undefined,
    }
  }

  const pickClickTarget = (target: Element): Element =>
    target.closest('button, a, input, select, label, [role="button"], [onclick]') ?? target

  /** 拖拽把手常常是 svg/path，向上找到真正的可交互容器 */
  const pickDragTarget = (target: Element): Element => {
    let el: Element | null = target
    const svgTags = ['svg', 'path', 'g', 'use', 'circle', 'rect', 'line', 'polyline', 'polygon']
    while (el?.parentElement && svgTags.includes(el.tagName.toLowerCase())) {
      el = el.parentElement
    }
    return el ? pickClickTarget(el) : target
  }

  let dragStart: {
    x: number
    y: number
    ts: number
    target: Element
    moved: boolean
    left: number
    top: number
  } | null = null
  let lastDragEnd = 0
  let lastLabelClick: { ts: number; control: Element } | null = null

  document.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 0) return
      const target = e.target as Element | null
      if (!target) return
      const dragTarget = pickDragTarget(target)
      // 必须在按下时记录元素位置：滑块被拖动后 rect 会变
      const rect = dragTarget.getBoundingClientRect()
      dragStart = {
        x: e.clientX,
        y: e.clientY,
        ts: Date.now(),
        target: dragTarget,
        moved: false,
        left: rect.left,
        top: rect.top,
      }
    },
    true,
  )

  document.addEventListener(
    'mousemove',
    (e) => {
      if (!dragStart) return
      if (Math.abs(e.clientX - dragStart.x) + Math.abs(e.clientY - dragStart.y) > 6) {
        dragStart.moved = true
      }
    },
    true,
  )

  document.addEventListener(
    'mouseup',
    (e) => {
      const start = dragStart
      dragStart = null
      if (!start?.moved) return
      lastDragEnd = Date.now()
      send({
        kind: 'drag',
        url: location.href,
        ts: lastDragEnd,
        target: describe(start.target),
        candidates: candidatesFor(start.target),
        dx: e.clientX - start.x,
        dy: e.clientY - start.y,
        startX: Math.round(start.x - start.left),
        startY: Math.round(start.y - start.top),
        durationMs: lastDragEnd - start.ts,
      })
    },
    true,
  )

  document.addEventListener(
    'click',
    (e) => {
      // 拖拽结束后浏览器常补发 click，避免把一次拖动记成两次动作
      if (Date.now() - lastDragEnd < 400) return
      const target = e.target as Element | null
      if (!target?.closest) return
      const clickedControl = target as HTMLInputElement
      // label 点击会由浏览器补发一次 input click，只保留 label 这一条
      if (
        (clickedControl.type === 'checkbox' || clickedControl.type === 'radio') &&
        lastLabelClick &&
        Date.now() - lastLabelClick.ts < 300 &&
        lastLabelClick.control === target
      ) {
        return
      }
      const clickedLabel = target.closest('label')
      if (clickedLabel) {
        lastLabelClick = { ts: Date.now(), control: controlOf(clickedLabel) }
      }
      // 点击选项内部文字时，以 option/menuitem 作为目标，定位更稳定
      const option = optionTextOf(target) ? optionContainer(target) : null
      const el = option ?? pickClickTarget(target)
      const ts = Date.now()
      const beforeDialogs = visibleDialogs()
      send({
        kind: 'click',
        url: location.href,
        ts,
        target: describe(el),
        candidates: candidatesFor(el),
        semantic: {
          label: fieldName(el),
          role: implicitRole(el) ?? undefined,
          tag: controlOf(el).tagName.toLowerCase(),
          inputType: (controlOf(el) as HTMLInputElement).type || undefined,
          hasPopup: el.getAttribute('aria-haspopup') ?? undefined,
          expanded: expandedOf(el),
          checked: checkedOf(el),
          optionText: optionTextOf(el) || undefined,
          dialogTitle: activeDialog() ? dialogTitleOf(activeDialog() as Element) : undefined,
          inDialog: Boolean(el.closest(DIALOG_SELECTOR)),
          groupLabel: radioGroupLabel(el) || undefined,
        },
      })

      // 弹层/弹窗/开关状态：立刻补一拍（同步渲染）+ 180ms 再补一拍（异步渲染）。
      // 两次 probe 的 refTs 相同，归一时合并；只进入语义层，不进入步骤。
      const sendProbe = (): void => {
        const afterDialogs = visibleDialogs()
        const opened = activeDialog()
        const popup = popupInfo()
        send({
          kind: 'probe',
          refTs: ts,
          url: location.href,
          ts: Date.now(),
          popup: popup ?? undefined,
          dialogOpened:
            afterDialogs.length > beforeDialogs.length && opened
              ? dialogTitleOf(opened) || '弹窗'
              : undefined,
          dialogClosed: beforeDialogs.length > 0 && afterDialogs.length === 0 ? true : undefined,
          expanded: expandedOf(el),
          checked: checkedOf(el),
          triggerValue: ((controlOf(el) as HTMLInputElement).value || el.textContent || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 80),
          selectedText: optionTextOf(el) || undefined,
        })
      }
      setTimeout(sendProbe, 0)
      setTimeout(sendProbe, 180)
    },
    true,
  )

  let lastSelect: { el: Element | null; value: string; ts: number } = { el: null, value: '', ts: 0 }
  const onInput = (e: Event): void => {
    const el = e.target as Element | null
    if (!el?.tagName) return
    const tag = el.tagName.toLowerCase()
    if (tag === 'input') {
      const t = (el as HTMLInputElement).type
      if (t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button') return
    }
    if (tag === 'select') {
      // select 可能同时收到 input 与 change，近距去重
      const sel = el as HTMLSelectElement
      const now = Date.now()
      if (el === lastSelect.el && sel.value === lastSelect.value && now - lastSelect.ts < 300)
        return
      lastSelect = { el, value: sel.value, ts: now }
      send({
        kind: 'select',
        url: location.href,
        ts: now,
        target: describe(el),
        candidates: candidatesFor(el),
        value: sel.value,
        semantic: {
          label: fieldName(el),
          role: 'combobox',
          tag: 'select',
          optionText: sel.selectedOptions[0]?.text?.trim() || undefined,
        },
      })
      return
    }
    if (tag !== 'input' && tag !== 'textarea' && el.getAttribute('contenteditable') === null) return
    // 文本输入只监听 input（change 在失焦时由浏览器补发会重复），即时发送保持时序；
    // 连续输入的合并交给主进程 normalizeEvents
    send({
      kind: 'fill',
      url: location.href,
      ts: Date.now(),
      target: describe(el),
      candidates: candidatesFor(el),
      value: (el as HTMLInputElement).value,
      semantic: {
        label: fieldName(el),
        role: implicitRole(el) ?? undefined,
        tag: el.tagName.toLowerCase(),
        inputType: (el as HTMLInputElement).type || undefined,
      },
    })
  }
  document.addEventListener('input', onInput, true)
  document.addEventListener(
    'change',
    (e) => {
      if ((e.target as Element | null)?.tagName?.toLowerCase() === 'select') onInput(e)
    },
    true,
  )

  document.addEventListener(
    'keydown',
    (e) => {
      const keys = ['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp']
      if (!keys.includes(e.key)) return
      const target = e.target as Element | null
      if (!target?.tagName) return
      const tag = target.tagName.toLowerCase()
      // 按钮/链接上的 Enter 就是 click，不另记 press
      if (e.key === 'Enter' && (tag === 'button' || tag === 'a')) return
      send({
        kind: 'keydown',
        url: location.href,
        ts: Date.now(),
        target: describe(target),
        candidates: candidatesFor(target),
        key: e.key,
        semantic: {
          label: fieldName(target),
          role: implicitRole(target) ?? undefined,
          tag: tag,
        },
      })
    },
    true,
  )

  // 页面滚动：只在顶层文档记录，300ms 内的连续滚动由主进程合并
  if (window === window.top) {
    let lastScrollTs = 0
    window.addEventListener(
      'scroll',
      () => {
        const now = Date.now()
        if (now - lastScrollTs < 300) return
        lastScrollTs = now
        send({
          kind: 'scroll',
          url: location.href,
          ts: now,
          target: { tag: 'window' },
          candidates: [],
          x: window.scrollX,
          y: window.scrollY,
        })
      },
      { passive: true },
    )
  }
}
