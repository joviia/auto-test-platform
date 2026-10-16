import { join } from 'node:path'
import type { CaseFile, Element, RunResult, Step, StepResult } from '@atp/model'
import { pressParamsSchema } from '@atp/model'
import { chromium } from 'playwright'
import { performAction } from './actions'
import { AssertionError, performAssertion } from './assertions'
import { EvidenceCollector } from './evidence'
import { resolveElement } from './resolve-locator'

export interface ReplayOptions {
  evidenceDir: string
  headless?: boolean
  runId?: string
}

export async function replayCaseFile(caseFile: CaseFile, opts: ReplayOptions): Promise<RunResult> {
  const evidence = new EvidenceCollector(opts.evidenceDir)
  await evidence.ensure()

  const browser = await chromium.launch({ headless: opts.headless ?? false })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: {
      dir: join(evidence.dir, '_video'),
      size: { width: 1280, height: 800 },
    },
  })
  const page = await context.newPage()

  const startedAt = new Date().toISOString()
  const steps: StepResult[] = []
  let status: 'passed' | 'failed' = 'passed'
  let runError: string | undefined

  try {
    await page.goto(caseFile.case.startUrl, { waitUntil: 'load' })
    for (const [index, step] of caseFile.case.steps.entries()) {
      const result = await runStep(page, caseFile.elements, step, index, evidence)
      steps.push(result)
      if (result.status === 'failed') {
        status = 'failed'
        break
      }
    }
  } catch (err) {
    status = 'failed'
    runError = err instanceof Error ? err.message : String(err)
    await evidence.screenshot(page, 'run-error.png')
  }

  let videoPath: string | undefined
  const video = page.video()
  const rawVideoPath = video ? await video.path() : null
  await context.close()
  if (rawVideoPath) {
    videoPath = await evidence.adoptVideo(rawVideoPath)
  }
  await browser.close()

  return {
    runId: opts.runId ?? `run-${Date.now().toString(36)}`,
    caseId: caseFile.case.id,
    caseName: caseFile.case.name,
    startUrl: caseFile.case.startUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    error: runError,
    videoPath,
    steps,
  }
}

async function runStep(
  page: Parameters<typeof resolveElement>[0],
  elements: Record<string, Element>,
  step: Step,
  index: number,
  evidence: EvidenceCollector,
): Promise<StepResult> {
  const t0 = Date.now()
  const base = { stepId: step.id, index, action: step.action }
  const fail = (error: string, extra?: Partial<StepResult>): StepResult => ({
    ...base,
    status: 'failed',
    durationMs: Date.now() - t0,
    error,
    screenshotPath: evidence.lastScreenshotPath(),
    ...extra,
  })

  // press 为页面级按键，无目标元素
  if (step.action === 'press') {
    try {
      await page.keyboard.press(pressParamsSchema.parse(step.params).key)
      const screenshotPath = await evidence.screenshot(page, `step-${index}.png`)
      return { ...base, status: 'passed', durationMs: Date.now() - t0, screenshotPath }
    } catch (err) {
      await evidence.screenshot(page, `step-${index}.png`)
      return fail(err instanceof Error ? err.message : String(err))
    }
  }

  const element = elements[step.elementId ?? '']
  if (!element) {
    await evidence.screenshot(page, `step-${index}.png`)
    return fail(`元素不存在：${step.elementId}`)
  }

  const resolved = await resolveElement(page, element)
  const common = {
    triedCandidates: resolved.attempts,
    locatorHit: resolved.hit ?? undefined,
  }

  if (!resolved.locator) {
    await evidence.screenshot(page, `step-${index}.png`)
    return {
      ...base,
      ...common,
      status: 'failed',
      durationMs: Date.now() - t0,
      error: `全部 ${element.locators.length} 个候选定位器均未命中`,
      screenshotPath: evidence.lastScreenshotPath(),
    }
  }

  try {
    if (step.action === 'assert') {
      const assertion = await performAssertion(resolved.locator, step.assertion)
      const screenshotPath = await evidence.screenshot(page, `step-${index}.png`)
      return {
        ...base,
        ...common,
        status: 'passed',
        durationMs: Date.now() - t0,
        assertion,
        screenshotPath,
      }
    }
    await performAction(page, step, resolved.locator)
    const screenshotPath = await evidence.screenshot(page, `step-${index}.png`)
    return { ...base, ...common, status: 'passed', durationMs: Date.now() - t0, screenshotPath }
  } catch (err) {
    await evidence.screenshot(page, `step-${index}.png`)
    if (err instanceof AssertionError) {
      return fail(err.message, { assertion: err.outcome })
    }
    return fail(err instanceof Error ? err.message : String(err))
  }
}
