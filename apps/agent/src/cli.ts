#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initDb } from '@atp/core'
import { Command, Option } from 'commander'
import { execa } from 'execa'
import open from 'open'
import ora from 'ora'
import pc from 'picocolors'
import { chromium } from 'playwright'
import { lock } from 'proper-lockfile'
import semver from 'semver'
import { Agent } from './agent.js'
import { createAgentServer } from './server.js'
import { detectInstallMode, runNpmUpdate, UpdateService } from './update.js'

const VERSION = readVersion()
const MIN_NODE = '22.17.0'

interface StartOptions {
  url?: string
  demo: boolean
  port?: string
  dataDir?: string
  profile?: string
  headless: boolean
  open: boolean
  updateCheck: boolean
}

interface AgentInfo {
  pid: number
  origin: string
  dataDir: string
  startedAt: string
  version: string
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function dataDirOf(opts: { dataDir?: string }): string {
  return opts.dataDir ?? join(homedir(), '.atp-agent')
}

function assertNode(): void {
  if (!semver.satisfies(process.versions.node, `>=${MIN_NODE}`)) {
    throw new Error(`需要 Node.js >= ${MIN_NODE}，当前 ${process.versions.node}`)
  }
}

async function start(opts: StartOptions): Promise<void> {
  assertNode()
  const dataDir = dataDirOf(opts)
  mkdirSync(dataDir, { recursive: true })
  const profileDir = opts.profile ?? join(dataDir, 'profile')
  const headless = opts.headless
  const port = opts.port ? Number(opts.port) : 0
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`端口不合法：${opts.port}`)
  }

  const releaseLock = await lock(dataDir, {
    realpath: false,
    retries: 0,
    stale: 30_000,
  }).catch(() => {
    throw new Error(`Agent 已在运行（或数据目录被锁定）：${dataDir}`)
  })

  const agent = new Agent({ dataDir, profileDir, headless, demoUrl: '' })
  const server = createAgentServer(agent, { dataDir, port })
  let info: AgentInfo | null = null

  const shutdown = async (): Promise<void> => {
    rmSync(join(dataDir, 'agent.json'), { force: true })
    await server.close().catch(() => {})
    await agent.close().catch(() => {})
    await closeDb().catch(() => {})
    await releaseLock().catch(() => {})
  }

  try {
    const { origin } = await server.start()
    const demoUrl = `${origin}/demo`
    const uiUrl = `${origin}/`
    agent.setDemoUrl(demoUrl)

    info = {
      pid: process.pid,
      origin,
      dataDir,
      startedAt: new Date().toISOString(),
      version: VERSION,
    }
    writeFileSync(join(dataDir, 'agent.json'), JSON.stringify(info, null, 2), { mode: 0o600 })

    const initialUrl = opts.url ?? (opts.demo ? demoUrl : 'about:blank')
    console.log(`${pc.bold('ATP Agent')} ${pc.dim(VERSION)}`)
    console.log(`${pc.green('UI')}: ${uiUrl}`)
    console.log(`${pc.dim('数据')} ${dataDir}`)

    const spinner = ora('启动真实 Chrome…').start()
    try {
      await agent.start(initialUrl)
      spinner.succeed(`Chrome 就绪${headless ? '（headless）' : ''}`)
    } catch (err) {
      spinner.fail('Chrome 启动失败')
      await shutdown()
      throw err
    }

    console.log(pc.dim('Ctrl+C 退出'))
    void backgroundUpdateCheck(dataDir, opts.updateCheck)
    if (opts.open && !headless) {
      await open(uiUrl).catch(() => {
        console.log(pc.yellow('未能自动打开浏览器，请手动访问上面的 UI 地址'))
      })
    }

    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => resolve())
      process.once('SIGTERM', () => resolve())
    })
  } finally {
    await shutdown()
  }
}

function webDistPath(): string {
  const bundled = join(import.meta.dirname, 'web', 'index.html')
  const workspace = join(import.meta.dirname, '..', '..', 'web', 'dist', 'index.html')
  return existsSync(bundled) ? bundled : workspace
}

async function backgroundUpdateCheck(dataDir: string, enabled: boolean): Promise<void> {
  if (!enabled || process.env.ATP_NO_UPDATE_CHECK || process.env.CI) return
  const mode = detectInstallMode()
  try {
    const service = new UpdateService({ currentVersion: VERSION, mode, dataDir })
    const check = await service.check()
    if (!check.available || !check.version) return
    if (mode === 'npm') {
      console.error(pc.yellow(`新版本 ${check.version} 可用：atp-agent update`))
      return
    }
    await service.update({ apply: true })
    console.error(pc.green(`新版本 ${check.version} 已就绪，下次启动生效`))
  } catch {
    // 后台检查失败不影响主流程
  }
}

async function doctor(opts: { dataDir?: string }): Promise<boolean> {
  const dataDir = dataDirOf(opts)
  let ok = true
  const report = (name: string, pass: boolean, detail: string): void => {
    ok &&= pass
    console.log(`${pass ? pc.green('✓') : pc.red('✗')} ${name.padEnd(16)} ${pc.dim(detail)}`)
  }

  report('Node.js', semver.satisfies(process.versions.node, `>=${MIN_NODE}`), process.version)

  try {
    mkdirSync(dataDir, { recursive: true })
    const probe = join(dataDir, '.doctor-probe')
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    report('数据目录', true, dataDir)
  } catch (err) {
    report('数据目录', false, err instanceof Error ? err.message : String(err))
  }

  const browserPath = chromium.executablePath()
  report('Chromium', existsSync(browserPath), browserPath)
  report('浏览器 UI', existsSync(webDistPath()), webDistPath())

  try {
    const db = await initDb({ dataDir })
    await db.transaction(() => Promise.resolve())
    await closeDb()
    report('数据库', true, join(dataDir, 'atp.db'))
  } catch (err) {
    report('数据库', false, err instanceof Error ? err.message : String(err))
  }

  return ok
}

async function installBrowser(): Promise<void> {
  assertNode()
  const require = createRequire(import.meta.url)
  const cli = require.resolve('playwright/cli')
  console.log(pc.dim(`playwright cli: ${cli}`))
  await execa(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' })
}

async function update(opts: { dataDir?: string }): Promise<void> {
  const dataDir = dataDirOf(opts)
  const mode = detectInstallMode()
  const spinner = ora('检查更新…').start()
  const service = new UpdateService({ currentVersion: VERSION, mode, dataDir })
  try {
    const check = await service.check({ force: true })
    if (!check.available || !check.version) {
      spinner.succeed(
        `已是最新版本 ${pc.green(VERSION)}${check.reason ? pc.dim(`（${check.reason}）`) : ''}`,
      )
      return
    }
    spinner.text = `发现 ${check.version}，开始更新…`
    if (mode === 'npm') {
      spinner.stop()
      console.log(`当前 ${VERSION} → 最新 ${pc.green(check.version)}`)
      await runNpmUpdate()
      console.log(pc.green('更新完成，请重新启动 atp-agent'))
      return
    }
    const result = await service.update({ force: true, apply: true })
    spinner.stop()
    console.log(
      result.updated
        ? pc.green(`已更新到 ${result.version}，下次启动生效`)
        : pc.yellow(`更新未完成：${result.reason ?? '未知原因'}`),
    )
  } catch (err) {
    spinner.stop()
    console.error(pc.red('更新失败：') + (err instanceof Error ? err.message : String(err)))
    process.exitCode = 1
  }
}

const program = new Command()
program
  .name('atp-agent')
  .description('ATP 本地 Agent：用真实 Chrome 录制与回放 Web UI 测试')
  .version(VERSION, '-v, --version')

program
  .command('start', { isDefault: true })
  .description('启动本地 Agent（默认命令）')
  .option('--url <地址>', '启动后打开的被测地址')
  .option('--demo', '打开内置演示页（适合第一次试用）', false)
  .option('--port <端口>', '本地服务端口，默认随机')
  .option('--data-dir <目录>', '数据目录，默认 ~/.atp-agent')
  .option('--profile <目录>', 'Chrome 专用 profile，默认 <data-dir>/profile')
  .option('--headless', '不显示 Chrome 窗口（CI/无桌面环境）', false)
  .addOption(new Option('--no-open', '不自动打开浏览器'))
  .addOption(new Option('--no-update-check', '启动后不检查更新'))
  .action(async (opts: StartOptions) => {
    await start(opts)
  })

program
  .command('doctor')
  .description('检查运行环境、数据目录、数据库与浏览器')
  .option('--data-dir <目录>', '数据目录，默认 ~/.atp-agent')
  .action(async (opts: { dataDir?: string }) => {
    const ok = await doctor(opts)
    if (!ok) process.exitCode = 1
  })

program
  .command('install-browser')
  .description('安装 Playwright Chromium（无系统 Chrome 时使用）')
  .action(installBrowser)

program
  .command('update')
  .description('检查并执行更新（npm / bundle 两种安装形态）')
  .option('--data-dir <目录>', '数据目录，默认 ~/.atp-agent')
  .action(update)

program
  .command('version')
  .description('输出版本（供健康检查使用）')
  .option('--json', 'JSON 输出')
  .action((opts: { json?: boolean }) => {
    if (opts.json) {
      console.log(JSON.stringify({ version: VERSION, mode: detectInstallMode() }))
    } else {
      console.log(VERSION)
    }
  })

program
  .command('mcp')
  .description('启动 MCP 服务（AI 能力阶段启用）')
  .action(() => {
    console.log(pc.yellow('MCP 服务将在 AI/MCP 阶段启用'))
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(pc.red(`ATP Agent 启动失败：`) + (err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
