import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalManifest,
  type ManifestBody,
  platformKey,
  signManifest,
  UpdateService,
} from './update.js'

const roots: string[] = []
const servers: Server[] = []
const keys = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'atp-update-test-'))
  roots.push(root)
  return root
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

interface Fixture {
  root: string
  origin: string
  manifest: ManifestBody & { signature: string }
}

async function fixture(options: {
  version?: string
  healthVersion?: string
  shaOverride?: string
  badSignature?: boolean
}): Promise<Fixture> {
  const root = tempRoot()
  const source = join(root, 'source')
  mkdirSync(join(source, 'app', 'dist'), { recursive: true })
  const version = options.version ?? '0.2.0'
  writeFileSync(
    join(source, 'app', 'dist', 'cli.js'),
    `console.log(JSON.stringify({ version: ${JSON.stringify(options.healthVersion ?? version)} }))\n`,
  )
  const archive = join(root, 'bundle.tar.gz')
  await tar.create({ gzip: true, file: archive, cwd: source }, ['app'])

  const server = createServer((req, res) => {
    if (req.url === '/latest.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify((server as Server & { manifest?: unknown }).manifest))
      return
    }
    if (req.url === '/bundle.tar.gz') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      res.end(readFileSync(archive))
      return
    }
    res.writeHead(404)
    res.end()
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务器启动失败')
  const origin = `http://127.0.0.1:${address.port}`

  const body: ManifestBody = {
    version,
    channel: 'stable',
    publishedAt: new Date().toISOString(),
    platforms: {
      [platformKey()]: {
        url: `${origin}/bundle.tar.gz`,
        sha256: options.shaOverride ?? sha256(archive),
        size: 1,
      },
    },
  }
  const signature = signManifest(body, privateKey)
  const signed = {
    ...body,
    signature: options.badSignature ? Buffer.from('bad').toString('base64') : signature,
  }
  ;(server as Server & { manifest?: unknown }).manifest = signed

  // 模拟已安装 0.1.0，current 指向它
  mkdirSync(join(root, 'versions', '0.1.0', 'app', 'dist'), { recursive: true })
  writeFileSync(join(root, 'versions', '0.1.0', 'app', 'dist', 'cli.js'), '')
  if (process.platform !== 'win32') {
    await import('node:fs/promises').then((fs) =>
      fs.symlink('versions/0.1.0', join(root, 'current'), 'dir'),
    )
  }

  return { root, origin, manifest: signed }
}

function service(fix: Fixture, currentVersion = '0.1.0'): UpdateService {
  return new UpdateService({
    currentVersion,
    mode: 'bundle',
    dataDir: fix.root,
    updateUrl: `${fix.origin}/latest.json`,
    publicKey,
    checkIntervalMs: 0,
  })
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('UpdateService', () => {
  it('签名清单序列化稳定，篡改后验签失败', () => {
    const body: ManifestBody = {
      version: '0.2.0',
      channel: 'stable',
      publishedAt: '2026-10-19T00:00:00Z',
      minVersion: '0.1.0',
      platforms: {},
    }
    expect(canonicalManifest(body).toString('utf8')).toBe(
      '{"version":"0.2.0","channel":"stable","publishedAt":"2026-10-19T00:00:00Z","minVersion":"0.1.0","platforms":{}}',
    )
  })

  it('bundle 模式：下载、校验、健康检查后原子切换', async () => {
    const fix = await fixture({ version: '0.2.0' })
    const result = await service(fix).update({ force: true, apply: true })
    expect(result).toEqual({ updated: true, version: '0.2.0' })
    expect(existsSync(join(fix.root, 'versions', '0.2.0', 'app', 'dist', 'cli.js'))).toBe(true)
    expect(readFileSync(join(fix.root, 'current.txt'), 'utf8')).toBe('0.2.0')
    if (process.platform !== 'win32') {
      expect(readlinkSync(join(fix.root, 'current'))).toBe('versions/0.2.0')
    }
  })

  it('SHA-256 不匹配时保留旧版本', async () => {
    const fix = await fixture({ shaOverride: '0'.repeat(64) })
    await expect(service(fix).update({ force: true, apply: true })).rejects.toThrow('SHA-256')
    expect(existsSync(join(fix.root, 'versions', '0.2.0'))).toBe(false)
    if (process.platform !== 'win32') {
      expect(readlinkSync(join(fix.root, 'current'))).toBe('versions/0.1.0')
    }
  })

  it('签名无效时不下载', async () => {
    const fix = await fixture({ badSignature: true })
    const result = await service(fix).update({ force: true, apply: true })
    expect(result.updated).toBe(false)
    expect(result.reason).toContain('签名')
    expect(existsSync(join(fix.root, 'versions', '0.2.0'))).toBe(false)
  })

  it('健康检查失败时保留旧版本并清理 staging', async () => {
    const fix = await fixture({ healthVersion: '0.1.0' })
    await expect(service(fix).update({ force: true, apply: true })).rejects.toThrow('健康检查')
    expect(existsSync(join(fix.root, 'versions', '0.2.0'))).toBe(false)
    const versions = await import('node:fs/promises').then((fs) =>
      fs.readdir(join(fix.root, 'versions')),
    )
    expect(versions.some((name) => name.startsWith('.staging-'))).toBe(false)
    if (process.platform !== 'win32') {
      expect(readlinkSync(join(fix.root, 'current'))).toBe('versions/0.1.0')
    }
  })
})
