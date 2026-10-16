import { createHash } from 'node:crypto'
import type { Element, Locator } from '@atp/model'
import type { RawLocatorCandidate, RawTargetInfo } from './collector'

/** 保序去重并映射为模型定位器（testId → role → text → css） */
export function toLocatorCandidates(raw: RawLocatorCandidate[]): Locator[] {
  const seen = new Set<string>()
  const out: Locator[] = []
  for (const c of raw) {
    const key = `${c.type}:${c.value}:${c.name ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    if (c.type === 'testId') out.push({ type: 'testId', value: c.value })
    else if (c.type === 'role')
      out.push(
        c.name === undefined
          ? { type: 'role', value: c.value }
          : { type: 'role', value: c.value, name: c.name },
      )
    else if (c.type === 'text') out.push({ type: 'text', value: c.value })
    else if (c.type === 'css') out.push({ type: 'css', value: c.value })
  }
  return out
}

function hashJson(v: unknown): string {
  return createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 8)
}

/** 元素 id 由候选链派生：同一元素重复录制时复用 id（元素库 upsert 语义） */
export function elementIdOf(locators: Locator[]): string {
  return `el-${hashJson(locators)}`
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

export function buildElement(target: RawTargetInfo, candidates: RawLocatorCandidate[]): Element {
  const locators = toLocatorCandidates(candidates)
  return { id: elementIdOf(locators), name: elementName(target, candidates), locators }
}
