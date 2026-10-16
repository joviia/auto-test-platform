import { randomUUID } from 'node:crypto'
import type { CaseFile, CaseRow } from '@atp/model'
import { caseFileSchema, elementSchema } from '@atp/model'
import { eq } from 'drizzle-orm'
import { getDb } from '../client'
import { caseSteps, cases, elements } from '../schema'

function toRow(r: typeof cases.$inferSelect): CaseRow {
  return {
    id: r.id,
    projectId: r.projectId,
    moduleId: r.moduleId,
    name: r.name,
    startUrl: r.startUrl,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export const caseRepo = {
  list(projectId: string): CaseRow[] {
    return getDb().select().from(cases).where(eq(cases.projectId, projectId)).all().map(toRow)
  },

  get(id: string): CaseFile | null {
    const r = getDb().select().from(cases).where(eq(cases.id, id)).get()
    if (!r) return null
    const stepRows = getDb()
      .select()
      .from(caseSteps)
      .where(eq(caseSteps.caseId, id))
      .all()
      .sort((a, b) => a.idx - b.idx)
    const elementIds = new Set(stepRows.map((s) => s.elementId).filter(Boolean) as string[])
    const elementRows = getDb()
      .select()
      .from(elements)
      .where(eq(elements.projectId, r.projectId))
      .all()
      .filter((e) => elementIds.has(e.id))
      .map((e) => elementSchema.parse({ id: e.id, name: e.name, locators: JSON.parse(e.locators) }))
    return caseFileSchema.parse({
      case: {
        id: r.id,
        name: r.name,
        projectId: r.projectId,
        moduleId: r.moduleId ?? undefined,
        startUrl: r.startUrl,
        steps: stepRows.map((s) => ({
          id: s.id.startsWith(`${id}-`) ? s.id.slice(id.length + 1) : s.id,
          action: s.action,
          elementId: s.elementId ?? undefined,
          params: s.params ? JSON.parse(s.params) : undefined,
          assertion: s.assertion ? JSON.parse(s.assertion) : undefined,
        })),
      },
      elements: Object.fromEntries(elementRows.map((e) => [e.id, e])),
    })
  },

  create(input: {
    projectId: string
    moduleId?: string | null
    name: string
    startUrl: string
  }): CaseFile {
    const now = new Date().toISOString()
    const row = {
      id: `c-${randomUUID().slice(0, 8)}`,
      projectId: input.projectId,
      moduleId: input.moduleId ?? null,
      name: input.name,
      startUrl: input.startUrl,
      createdAt: now,
      updatedAt: now,
    }
    getDb().insert(cases).values(row).run()
    return this.get(row.id) as CaseFile
  },

  /** 全量保存：更新用例行 + 事务内重建步骤 + upsert 引用的元素（元素库集中登记） */
  save(file: CaseFile): CaseFile {
    const db = getDb()
    const now = new Date().toISOString()
    db.transaction((tx) => {
      tx.update(cases)
        .set({
          name: file.case.name,
          moduleId: file.case.moduleId ?? null,
          startUrl: file.case.startUrl,
          updatedAt: now,
        })
        .where(eq(cases.id, file.case.id))
        .run()

      tx.delete(caseSteps).where(eq(caseSteps.caseId, file.case.id)).run()
      for (const [idx, step] of file.case.steps.entries()) {
        tx.insert(caseSteps)
          .values({
            // 主键带用例前缀：不同用例的 s-001 互不冲突
            id: `${file.case.id}-${step.id}`,
            caseId: file.case.id,
            idx,
            action: step.action,
            elementId: step.elementId ?? null,
            params: step.params ? JSON.stringify(step.params) : null,
            assertion: step.assertion ? JSON.stringify(step.assertion) : null,
          })
          .run()
      }

      for (const el of Object.values(file.elements)) {
        const exists = tx.select().from(elements).where(eq(elements.id, el.id)).get()
        const locators = JSON.stringify(el.locators)
        if (exists) {
          tx.update(elements).set({ name: el.name, locators }).where(eq(elements.id, el.id)).run()
        } else {
          tx.insert(elements)
            .values({ id: el.id, projectId: file.case.projectId, name: el.name, locators })
            .run()
        }
      }
    })
    return this.get(file.case.id) as CaseFile
  },

  remove(id: string): void {
    const db = getDb()
    db.delete(caseSteps).where(eq(caseSteps.caseId, id)).run()
    db.delete(cases).where(eq(cases.id, id)).run()
  },
}
