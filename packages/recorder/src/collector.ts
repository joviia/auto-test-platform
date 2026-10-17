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

/** 录制期候选（count 仅供唯一性参考，不入库） */
export interface RawLocatorCandidate {
  type: 'testId' | 'role' | 'text' | 'css'
  value: string
  name?: string
  count: number | null
}

export interface RawRecorderEvent {
  kind: 'click' | 'fill' | 'select' | 'keydown' | 'scroll' | 'drag'
  url: string
  ts: number
  /** 是否顶层文档（iframe 内的事件为 false，用于起始地址判定） */
  isTop?: boolean
  target: RawTargetInfo
  candidates: RawLocatorCandidate[]
  value?: string
  key?: string
  /** 滚动位置（仅 scroll 事件） */
  x?: number
  y?: number
  /** 元素所属 iframe 路径（主进程根据 senderFrame 填充） */
  framePath?: number[]
  /** 拖拽位移与时长（仅 drag 事件） */
  dx?: number
  dy?: number
  /** 按下点相对目标元素左上角的偏移 */
  startX?: number
  startY?: number
  durationMs?: number
}

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

  const directText = (el: Element): string => {
    if (el.children.length > 0) return ''
    const t = (el.textContent ?? '').trim()
    return t && t.length <= 60 ? t : ''
  }

  const candidatesFor = (el: Element): RawLocatorCandidate[] => {
    const out: RawLocatorCandidate[] = []
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
      out.push({ type: 'role', value: role, name: name || undefined, count: null })
    }
    const text = directText(el)
    if (text) out.push({ type: 'text', value: text, count: null })
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
      if (!start || !start.moved) return
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
      if (!target || !target.closest) return
      const el = pickClickTarget(target)
      send({
        kind: 'click',
        url: location.href,
        ts: Date.now(),
        target: describe(el),
        candidates: candidatesFor(el),
      })
    },
    true,
  )

  let lastSelect: { el: Element | null; value: string; ts: number } = { el: null, value: '', ts: 0 }
  const onInput = (e: Event): void => {
    const el = e.target as Element | null
    if (!el || !el.tagName) return
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
      if (!target || !target.tagName) return
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
