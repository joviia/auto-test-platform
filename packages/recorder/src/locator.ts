import { createHash } from 'node:crypto'
import type { Element, Locator } from '@atp/model'
import type { RawLocatorCandidate, RawTargetInfo } from './collector.js'

/** 保序去重并映射为模型定位器（testId → role → text → css → xpath；scope 生成 within） */
export function toLocatorCandidates(raw: RawLocatorCandidate[]): Locator[] {
  const seen = new Set<string>()
  const out: Locator[] = []
  for (const c of raw) {
    const key = JSON.stringify(c)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(withScope(toLocator(c), c.scope))
  }
  return out
}

function toLocator(c: RawLocatorCandidate): Locator {
  switch (c.type) {
    case 'testId':
      return { type: 'testId', value: c.value }
    case 'role':
      return c.name === undefined
        ? { type: 'role', value: c.value }
        : { type: 'role', value: c.value, name: c.name }
    case 'text':
      return { type: 'text', value: c.value }
    case 'css':
      return { type: 'css', value: c.value }
    case 'xpath':
      return { type: 'xpath', value: c.value }
  }
}

/** 作用域链（外→内）包成嵌套 within */
function withScope(target: Locator, scopes?: RawLocatorCandidate[]): Locator {
  if (!scopes || scopes.length === 0) return target
  let out = target
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i]
    const scopeLocator = toLocator(scope)
    out = {
      type: 'within',
      scope: scopeLocator,
      target: out,
      ...(scope.topmost ? { topmost: true } : {}),
    }
  }
  return out
}

function hashJson(v: unknown): string {
  return createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 8)
}

/** 元素 id 由候选链派生：同一元素重复录制时复用 id（元素库 upsert 语义） */
export function elementIdOf(locators: Locator[], framePath?: number[]): string {
  return `el-${hashJson(framePath && framePath.length > 0 ? { locators, framePath } : locators)}`
}

function elementName(target: RawTargetInfo, candidates: RawLocatorCandidate[]): string {
  return (
    target.name ||
    candidates.find((c) => c.type === 'role' && c.name)?.name ||
    target.placeholder ||
    target.text ||
    target.tag
  )
}

export function buildElement(
  target: RawTargetInfo,
  candidates: RawLocatorCandidate[],
  framePath?: number[],
): Element {
  const locators = toLocatorCandidates(candidates)
  return {
    id: elementIdOf(locators, framePath),
    name: elementName(target, candidates),
    locators,
    ...(framePath && framePath.length > 0 ? { framePath } : {}),
  }
}
