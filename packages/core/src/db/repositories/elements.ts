import type { ElementRow } from '@atp/model'
import { elementSchema } from '@atp/model'
import type { EntityManager } from '@mikro-orm/sqlite'
import { CaseStep, Element, type ElementEntity, TestCase } from '../entities.js'

function toRow(row: ElementEntity): ElementRow {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    locators: row.locators as ElementRow['locators'],
    framePath: row.framePath ?? undefined,
  }
}

export class ElementRepository {
  constructor(private readonly em: EntityManager) {}

  async list(projectId: string): Promise<ElementRow[]> {
    const owned = await this.em.find(Element, { projectId })
    // 被本项目用例引用的元素（可能最初由其他项目登记）也要出现在元素库里
    const caseIds = (await this.em.find(TestCase, { projectId })).map((row) => row.id)
    const steps = caseIds.length ? await this.em.find(CaseStep, { caseId: { $in: caseIds } }) : []
    const referencedIds = [
      ...new Set(
        steps.map((step) => step.elementId).filter((value): value is string => Boolean(value)),
      ),
    ]
    const referenced = referencedIds.length
      ? await this.em.find(Element, { id: { $in: referencedIds } })
      : []

    const byId = new Map<string, ElementEntity>()
    for (const row of [...owned, ...referenced]) byId.set(row.id, row)
    return [...byId.values()].map(toRow)
  }

  /** 元素库 upsert：修改候选定位器即修复所有引用该元素的用例 */
  async upsert(row: ElementRow): Promise<ElementRow> {
    const parsed = elementSchema.parse(row)
    const existing = await this.em.findOne(Element, { id: parsed.id })
    if (existing) {
      existing.name = parsed.name
      existing.locators = parsed.locators
      existing.framePath = parsed.framePath ?? null
    } else {
      this.em.create(Element, {
        id: parsed.id,
        projectId: row.projectId,
        name: parsed.name,
        locators: parsed.locators,
        framePath: parsed.framePath ?? null,
      })
    }
    await this.em.flush()
    return toRow(await this.em.findOneOrFail(Element, { id: parsed.id }))
  }

  async remove(id: string): Promise<void> {
    await this.em.nativeDelete(Element, { id })
  }
}
