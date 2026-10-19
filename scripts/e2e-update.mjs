#!/usr/bin/env node
/**
 * 更新 E2E：本地 HTTP 更新服务器提供 v1/v2 版本化独立包。
 * v1 实例执行 `atp-agent update`，断言 current 指向 v2 且 v2 可启动。
 *
 * 前置：pnpm build（Agent/Web 已构建）
 * 运行：node scripts/e2e-update.mjs
 */
import { spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'atp-update-e2e-'))
const installRoot = join(work, 'install')
const releaseV1 = join(work, 'release-v1')
const releaseV2 = join(work, 'release-v2')

const keys = generateKeyPairSync('ed25519')
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      if (options.echo) process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
      if (options.echo) process.stderr.write(chunk)
    })
    child.once('exit', (code) => {
      if (code === 0) resolveRun(output)
      else reject(new Error(`命令失败（${code}）：${command} ${args.join(' ')}\n${output}`))
    })
  })
}

async function buildRelease(out, version, baseUrl) {
  await run(
    process.execPath,
    [
      join(repoRoot, 'scripts/build-release.mjs'),
      '--skip-build',
      '--out',
      out,
      '--version',
      version,
      '--base-url',
      baseUrl,
    ],
    {
      env: { ...process.env, ATP_UPDATE_PRIVATE_KEY: privateKey },
      echo: false,
    },
  )
}

async function main() {
  const server = createServer((req, res) => {
    if (req.url === '/latest.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(readFileSync(join(releaseV2, 'latest.json')))
      return
    }
    if (req.url?.startsWith('/atp-agent-')) {
      const file = join(releaseV2, req.url.slice(1))
      if (existsSync(file)) {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end(readFileSync(file))
        return
      }
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const port = server.address().port
  const origin = `http://127.0.0.1:${port}`

  try {
    console.log('[update] 构建 v1 / v2')
    await buildRelease(releaseV1, '0.1.0', origin)
    await buildRelease(releaseV2, '0.2.0', origin)

    cpSync(releaseV1, installRoot, { recursive: true })
    const before = await run(join(installRoot, 'bin/atp-agent'), ['version', '--json'])
    if (JSON.parse(before).version !== '0.1.0') throw new Error(`v1 启动异常：${before}`)
    console.log('[update] v1 启动 ✓')

    const updateOut = await run(
      join(installRoot, 'bin/atp-agent'),
      ['update', '--data-dir', installRoot],
      {
        env: {
          ...process.env,
          ATP_UPDATE_URL: `${origin}/latest.json`,
          ATP_UPDATE_PUBLIC_KEY: publicKey,
          ATP_BUNDLE_ROOT: installRoot,
        },
      },
    )
    if (!updateOut.includes('0.2.0')) throw new Error(`更新输出异常：\n${updateOut}`)
    console.log('[update] 下载与切换 ✓')

    const after = await run(join(installRoot, 'bin/atp-agent'), ['version', '--json'])
    const info = JSON.parse(after)
    if (info.version !== '0.2.0') throw new Error(`v2 启动异常：${after}`)
    if (process.platform !== 'win32') {
      const link = readlinkSync(join(installRoot, 'current'))
      if (link !== 'versions/0.2.0') throw new Error(`current 未切换：${link}`)
    }
    console.log('[update] v2 启动 ✓')
    console.log('[update] 通过 ✅')
  } finally {
    await new Promise((resolveClose) => server.close(() => resolveClose()))
    rmSync(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  rmSync(work, { recursive: true, force: true })
  process.exit(1)
})
