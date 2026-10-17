import { join } from 'node:path'
import type { CaseFile, Element, RunResult, Step, StepResult } from '@atp/model'
import { isPageLevelAssertion } from '@atp/model'
import { chromium } from 'playwright'
import type { Page } from 'playwright'
import { performAction } from './actions'
import { AssertionError, performAssertion } from './assertions'
import { EvidenceCollector } from './evidence'
import { resolveElement, resolveElementForAssertion } from './resolve-locator'
import { evaluateCondition, substituteStep } from './variables'

export interface RunCaseOptions {
  evidenceDir: string
  runId?: string
  /** 每步完成回调（嵌入回放用于实时进度） */
  onStep?: (result: StepResult, index: number, total: number) => void
  /** 取消信号：在步骤之间检查 */
  signal?: AbortSignal
}

export interface ReplayOptions extends RunCaseOptions {
  headless?: boolean
}

/** 在既有 Page 上执行用例（嵌入受控浏览器回放复用） */
export async function runCaseOnPage(
  page: Page,
  caseFile: CaseFile,
  opts: RunCaseOptions,
): Promise<RunResult> {
  const evidence = new EvidenceCollector(opts.evidenceDir)
  await evidence.ensure()

  const startedAt = new Date().toISOString()
  const steps: StepResult[] = []
  const variables = { ...caseFile.case.variables }
  let status: 'passed' | 'failed' = 'passed'
  let runError: string | undefined

  try {
    await page.goto(caseFile.case.startUrl, { waitUntil: 'load' })
    for (const [index, rawStep] of caseFile.case.steps.entries()) {
      if (opts.signal?.aborted) {
        status = 'failed'
        runError = '用户取消回放'
        break
      }

      const step = substituteStep(rawStep, variables)
      if (!evaluateCondition(step.condition, variables)) {
        const skipped: StepResult = {
          stepId: step.id,
          index,
          action: step.action,
          status: 'passed',
          durationMs: 0,
          skipped: true,
          error: `条件不满足，已跳过（${step.condition?.variable ?? ''}）`,
        }
        steps.push(skipped)
        opts.onStep?.(skipped, index, caseFile.case.steps.length)
        continue
      }

      const result = await runStep(page, caseFile.elements, step, index, evidence)
      steps.push(result)
      opts.onStep?.(result, index, caseFile.case.steps.length)
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

  return {
    runId: opts.runId ?? `run-${Date.now().toString(36)}`,
    caseId: caseFile.case.id,
    caseName: caseFile.case.name,
    startUrl: caseFile.case.startUrl,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    error: runError,
    steps,
  }
}

/** 独立窗口回放：自起 Chromium、录视频、最后归档证据 */
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

  const result = await runCaseOnPage(page, caseFile, {
    evidenceDir: opts.evidenceDir,
    runId: opts.runId,
    onStep: opts.onStep,
    signal: opts.signal,
  })

  const video = page.video()
  const rawVideoPath = video ? await video.path() : null
  await context.close()
  if (rawVideoPath) {
    result.videoPath = await evidence.adoptVideo(rawVideoPath)
  }
  await browser.close()
  return result
}

async function runStep(
  page: Page,
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

  // press / 页面滚动 / 非元素等待：无目标元素
  const isPageWait =
    step.action === 'wait' && step.params?.kind !== 'visible' && step.params?.kind !== 'hidden'

  if (step.action === 'press' || step.action === 'scroll' || isPageWait) {
    try {
      await performAction(page, step, null)
      const screenshotPath = await evidence.screenshot(page, `step-${index}.png`)
      return { ...base, status: 'passed', durationMs: Date.now() - t0, screenshotPath }
    } catch (err) {
      await evidence.screenshot(page, `step-${index}.png`)
      return fail(err instanceof Error ? err.message : String(err))
    }
  }

  // 页面级断言：不需要元素
  if (step.action === 'assert' && step.assertion && isPageLevelAssertion(step.assertion)) {
    try {
      const assertion = await performAssertion(page, null, null, step.assertion)
      const screenshotPath = await evidence.screenshot(page, `step-${index}.png`)
      return {
        ...base,
        status: 'passed',
        durationMs: Date.now() - t0,
        assertion,
        screenshotPath,
      }
    } catch (err) {
      await evidence.screenshot(page, `step-${index}.png`)
      if (err instanceof AssertionError) return fail(err.message, { assertion: err.outcome })
      return fail(err instanceof Error ? err.message : String(err))
    }
  }

  const element = elements[step.elementId ?? '']
  if (!element) {
    await evidence.screenshot(page, `step-${index}.png`)
    return fail(`元素不存在：${step.elementId}`)
  }

  // 断言 / 等待元素：允许元素隐藏或尚未出现（hidden / notExists 需要）
  const needsAttached =
    step.action === 'assert' ||
    (step.action === 'wait' && (step.params?.kind === 'visible' || step.params?.kind === 'hidden'))

  if (needsAttached) {
    const resolved = await resolveElementForAssertion(page, element)
    const common = {
      triedCandidates: resolved.attempts,
      locatorHit: resolved.hit ?? undefined,
    }
    const hiddenLike =
      step.action === 'assert' &&
      step.assertion &&
      (step.assertion.type === 'hidden' || step.assertion.type === 'notExists')

    if (!resolved.base) {
      if (hiddenLike) {
        try {
          const assertion = await performAssertion(page, null, null, step.assertion)
          const screenshotPath = await evidence.screenshot(page, `step-${index}.png`)
          return {
            ...base,
            ...common,
            status: 'passed',
            durationMs: Date.now() - t0,
            assertion,
            screenshotPath,
          }
        } catch (err) {
          if (err instanceof AssertionError)
            return fail(err.message, { ...common, assertion: err.outcome })
        }
      }
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

    const locator = resolved.base.first()
    try {
      if (step.action === 'assert' && step.assertion) {
        const assertion = await performAssertion(page, locator, resolved.base, step.assertion)
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
      await performAction(page, step, locator)
      const screenshotPath = await evidence.screenshot(page, `step-${index}.png`)
      return { ...base, ...common, status: 'passed', durationMs: Date.now() - t0, screenshotPath }
    } catch (err) {
      await evidence.screenshot(page, `step-${index}.png`)
      if (err instanceof AssertionError)
        return fail(err.message, { ...common, assertion: err.outcome })
      return fail(err instanceof Error ? err.message : String(err), common)
    }
  }

  // 普通动作：要求可见
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
    await performAction(page, step, resolved.locator)
    const screenshotPath = await evidence.screenshot(page, `step-${index}.png`)
    return { ...base, ...common, status: 'passed', durationMs: Date.now() - t0, screenshotPath }
  } catch (err) {
    await evidence.screenshot(page, `step-${index}.png`)
    return fail(err instanceof Error ? err.message : String(err), common)
  }
}
