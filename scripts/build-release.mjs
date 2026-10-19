#!/usr/bin/env node
/**
 * 构建当前平台的版本化独立包：
 *   versions/<version>/app        tsup 产物 + web
 *   versions/<version>/runtime    Node 运行时
 *   bin/atp-agent                 启动器
 * 并生成 tarball + 签名 latest.json。
 *
 * 用法：
 *   node scripts/build-release.mjs --base-url https://example.com/releases
 * 环境变量：
 *   ATP_UPDATE_PRIVATE_KEY  Ed25519 私钥 PEM（必填）
 *   ATP_UPDATE_BASE_URL     manifest 中平台包的下载前缀
 */
import { createHash, createPrivateKey, sign } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execa } from 'execa'
import * as tar from 'tar'

const repoRoot = resolve(import.meta.dirname, '..')

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  return process.argv[index + 1] ?? fallback
}

const channel = arg('channel', 'stable')
const outDir = resolve(arg('out', join(repoRoot, 'release')))
const versionOverride = arg('version')
const baseUrl = arg('base-url', process.env.ATP_UPDATE_BASE_URL ?? '')
const skipBuild = process.argv.includes('--skip-build')
const skipInstall = process.argv.includes('--skip-install')

const agentPkg = JSON.parse(readFileSync(join(repoRoot, 'apps/agent/package.json'), 'utf8'))
const version = versionOverride ?? agentPkg.version
const platform = `${process.platform}-${process.arch}`

async function run(command, args, cwd = repoRoot) {
  console.log(`\n$ ${command} ${args.join(' ')}`)
  await execa(command, args, { cwd, stdio: 'inherit' })
}

function canonicalManifest(body) {
  return Buffer.from(
    JSON.stringify({
      version: body.version,
      channel: body.channel,
      publishedAt: body.publishedAt,
      ...(body.minVersion ? { minVersion: body.minVersion } : {}),
      platforms: body.platforms,
    }),
    'utf8',
  )
}

function signManifest(body, privateKeyPem) {
  return sign(null, canonicalManifest(body), createPrivateKey(privateKeyPem)).toString('base64')
}

async function main() {
  if (!skipBuild) {
    await run('pnpm', ['build'])
  }

  const productionPackage = {
    name: '@atp/agent-bundle',
    private: true,
    type: 'module',
    dependencies: agentPkg.dependencies,
  }

  const stagingRoot = await mkdtemp(join(tmpdir(), 'atp-release-'))
  const appDir = join(stagingRoot, 'app')
  const runtimeDir = join(stagingRoot, 'runtime')
  mkdirSync(appDir, { recursive: true })
  mkdirSync(runtimeDir, { recursive: true })

  try {
    // 生产依赖
    if (!skipInstall) {
      writeFileSync(join(appDir, 'package.json'), JSON.stringify(productionPackage, null, 2))
      await run(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts=false'],
        appDir,
      )
      rmSync(join(appDir, 'package-lock.json'), { force: true })
      rmSync(join(appDir, 'package.json'), { force: true })
    }

    // Agent 产物（tsup 输出 + Web）
    cpSync(join(repoRoot, 'apps/agent/dist'), join(appDir, 'dist'), { recursive: true })
    // 运行时需要从 app/package.json 读取版本
    writeFileSync(
      join(appDir, 'package.json'),
      JSON.stringify({ name: '@atp/agent', version, type: 'module' }, null, 2),
    )

    // npm 会在 .bin 里创建绝对路径软链，运行时不需要，删掉避免打包出绝对链接
    rmSync(join(appDir, 'node_modules', '.bin'), { recursive: true, force: true })

    // Node 运行时
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
    copyFileSync(process.execPath, join(runtimeDir, nodeName))
    if (process.platform !== 'win32') chmodSync(join(runtimeDir, nodeName), 0o755)

    // 版本目录
    mkdirSync(join(outDir, 'versions'), { recursive: true })
    const versionDir = join(outDir, 'versions', version)
    rmSync(versionDir, { recursive: true, force: true })
    mkdirSync(versionDir, { recursive: true })
    cpSync(join(stagingRoot, 'app'), join(versionDir, 'app'), { recursive: true })
    cpSync(join(stagingRoot, 'runtime'), join(versionDir, 'runtime'), { recursive: true })

    // 启动器（安装到 bundle 根）
    const binDir = join(outDir, 'bin')
    mkdirSync(binDir, { recursive: true })
    const launcher = `#!/bin/sh
set -e
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CURRENT="$ROOT/current"
if [ ! -d "$CURRENT" ] && [ -f "$ROOT/current.txt" ]; then
  CURRENT="$ROOT/versions/$(cat "$ROOT/current.txt")"
fi
if [ ! -d "$CURRENT" ]; then
  echo "ATP Agent 未安装或 current 指针损坏" >&2
  exit 1
fi
exec "$CURRENT/runtime/node" "$CURRENT/app/dist/cli.js" "$@"
`
    writeFileSync(join(binDir, 'atp-agent'), launcher)
    chmodSync(join(binDir, 'atp-agent'), 0o755)

    const launcherCmd = `@echo off\r
set ROOT=%~dp0..\r
set CURRENT=%ROOT%\\current\r
if not exist "%CURRENT%" if exist "%ROOT%\\current.txt" (\r
  set /p V=<"%ROOT%\\current.txt"\r
  set CURRENT=%ROOT%\\versions\\%V%\r
)\r
"%CURRENT%\\runtime\\node.exe" "%CURRENT%\\app\\dist\\cli.js" %*\r
`
    writeFileSync(join(binDir, 'atp-agent.cmd'), launcherCmd)

    // 当前版本指针
    if (process.platform !== 'win32') {
      const link = join(outDir, 'current')
      rmSync(link, { force: true })
      const { symlinkSync } = await import('node:fs')
      symlinkSync(join('versions', version), link, 'dir')
    }
    writeFileSync(join(outDir, 'current.txt'), version)

    // tarball
    const tarName = `atp-agent-${version}-${platform}.tar.gz`
    const tarPath = join(outDir, tarName)
    rmSync(tarPath, { force: true })
    await tar.create({ gzip: true, file: tarPath, cwd: versionDir, dereference: true }, [
      'app',
      'runtime',
    ])
    const data = readFileSync(tarPath)
    const sha256 = createHash('sha256').update(data).digest('hex')

    // manifest
    const privateKey = process.env.ATP_UPDATE_PRIVATE_KEY
    if (!privateKey) {
      throw new Error('缺少 ATP_UPDATE_PRIVATE_KEY（Ed25519 私钥 PEM），拒绝生成未签名清单')
    }
    const downloadBase = baseUrl.replace(/\/+$/, '')
    const body = {
      version,
      channel,
      publishedAt: new Date().toISOString(),
      platforms: {
        [platform]: {
          url: downloadBase ? `${downloadBase}/${tarName}` : tarName,
          sha256,
          size: data.length,
        },
      },
    }
    const manifest = { ...body, signature: signManifest(body, privateKey) }
    writeFileSync(join(outDir, 'latest.json'), JSON.stringify(manifest, null, 2))

    console.log(`\n✅ Release ${version} (${platform})`)
    console.log(`   bundle:  ${tarPath}`)
    console.log(`   sha256:  ${sha256}`)
    console.log(`   manifest:${join(outDir, 'latest.json')}`)
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
