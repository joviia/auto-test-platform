import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Locator as ModelLocator } from '@atp/model'
import { caseFileSchema } from '@atp/model'
import { replayCaseFile } from './engine.js'
import { toStartUrl } from './start-url.js'

function locatorLabel(loc: ModelLocator): string {
  if (loc.type === 'within') {
    return `${locatorLabel(loc.scope)} → ${locatorLabel(loc.target)}`
  }
  return `${loc.type}:${loc.value}`
}

function render(result: Awaited<ReturnType<typeof replayCaseFile>>): void {
  const mark = result.status === 'passed' ? '✅ 通过' : '❌ 失败'
  console.log(`\n▶ 用例「${result.caseName}」 ${mark}`)
  console.log(`  ${result.startedAt} → ${result.finishedAt}`)
  if (result.error) console.log(`  运行错误：${result.error}`)

  for (const s of result.steps) {
    const hit = s.locatorHit
      ? ` [命中候选#${s.locatorHit.tier} ${locatorLabel(s.locatorHit.locator)}${s.locatorHit.degraded ? ' 降级' : ''}]`
      : ''
    console.log(
      `  ${s.status === 'passed' ? '✓' : '✗'} #${s.index + 1} ${s.action} ${s.durationMs}ms${hit}`,
    )
    if (s.status === 'failed') {
      for (const c of s.triedCandidates ?? []) {
        console.log(`      候选 ${locatorLabel(c.locator)} → 未命中（${c.error ?? ''}）`)
      }
      if (s.assertion) {
        console.log(
          `      断言 ${s.assertion.type}：期望「${s.assertion.expected}」实际「${s.assertion.actual}」`,
        )
      }
    }
    if (s.error) console.log(`      ${s.error}`)
    if (s.screenshotPath) console.log(`      截图 ${s.screenshotPath}`)
  }
  if (result.videoPath) console.log(`  视频 ${result.videoPath}`)
  console.log()
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  const urlIdx = args.indexOf('--url')
  const urlOverride = urlIdx >= 0 ? args[urlIdx + 1] : undefined
  const headless = args.includes('--headless')

  if (!file) {
    console.error('用法：replay <case.json> [--url <startUrl>] [--headless]')
    return 2
  }

  const raw = JSON.parse(readFileSync(resolve(file), 'utf8')) as unknown
  const caseFile = caseFileSchema.parse(raw)
  caseFile.case.startUrl = toStartUrl(caseFile.case.startUrl, urlOverride)

  const evidenceDir = resolve(process.cwd(), 'artifacts', caseFile.case.id, String(Date.now()))
  const result = await replayCaseFile(caseFile, { evidenceDir, headless })
  render(result)
  return result.status === 'passed' ? 0 : 1
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (err) => {
    console.error(err)
    process.exitCode = 1
  },
)
