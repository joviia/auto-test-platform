import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { arch, platform } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execa } from 'execa'
import semver from 'semver'
import * as tar from 'tar'
import { z } from 'zod'

export type UpdateChannel = 'stable' | 'beta'
export type InstallMode = 'npm' | 'bundle'

const platformEntrySchema = z.object({
  url: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  size: z.number().int().nonnegative(),
})

export const manifestBodySchema = z.object({
  version: z.string().refine((value) => semver.valid(value) !== null, '版本号不合法'),
  channel: z.enum(['stable', 'beta']),
  publishedAt: z.string(),
  minVersion: z.string().optional(),
  platforms: z.record(z.string(), platformEntrySchema),
})

export const signedManifestSchema = manifestBodySchema.extend({
  signature: z.string().min(1),
})

export type ManifestBody = z.infer<typeof manifestBodySchema>
export type SignedManifest = z.infer<typeof signedManifestSchema>
export type PlatformEntry = z.infer<typeof platformEntrySchema>

export interface UpdateOptions {
  currentVersion: string
  mode: InstallMode
  /** 数据目录；bundle 模式下也是安装根目录（versions/、current） */
  dataDir: string
  channel?: UpdateChannel
  updateUrl?: string
  /** Ed25519 公钥 PEM；缺省读 ATP_UPDATE_PUBLIC_KEY */
  publicKey?: string
  /** 检查间隔，默认 24h */
  checkIntervalMs?: number
  now?: () => number
}

export interface UpdateCheck {
  available: boolean
  version?: string
  manifest?: SignedManifest
  platform?: PlatformEntry
  reason?: string
}

export interface UpdateResult {
  updated: boolean
  version?: string
  reason?: string
}

interface UpdateCache {
  checkedAt: number
  channel: UpdateChannel
  version?: string
  manifest?: SignedManifest
  reason?: string
}

const DAY = 24 * 60 * 60 * 1000

/** 仅使用固定字段与固定顺序，签名与验签必须走同一序列化 */
export function canonicalManifest(body: ManifestBody): Buffer {
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

export function signManifest(body: ManifestBody, privateKeyPem: string): string {
  return sign(null, canonicalManifest(body), createPrivateKey(privateKeyPem)).toString('base64')
}

export function verifyManifest(manifest: SignedManifest, publicKeyPem: string): boolean {
  const { signature, ...body } = manifest
  return verify(
    null,
    canonicalManifest(body),
    createPublicKey(publicKeyPem),
    Buffer.from(signature, 'base64'),
  )
}

export function platformKey(): string {
  return `${platform()}-${arch()}`
}

export function defaultUpdateUrl(channel: UpdateChannel = 'stable'): string {
  return (
    process.env.ATP_UPDATE_URL ??
    `https://github.com/zhouwei/auto-test-platform/releases/latest/download/${channel}/latest.json`
  )
}

/**
 * 判断安装形态：
 * - 显式 ATP_BUNDLE_ROOT
 * - 当前代码位于 versions/<v>/... 下
 */
export function detectInstallMode(): InstallMode {
  if (process.env.ATP_BUNDLE_ROOT) return 'bundle'
  if (/[\\/]versions[\\/]/.test(import.meta.dirname)) return 'bundle'
  return 'npm'
}

async function readCache(path: string): Promise<UpdateCache | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as UpdateCache
  } catch {
    return null
  }
}

async function writeCache(path: string, cache: UpdateCache): Promise<void> {
  await writeFile(path, JSON.stringify(cache, null, 2), 'utf8').catch(() => {})
}

async function downloadFile(url: string, target: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`下载失败：HTTP ${response.status}`)
  }
  const hash = createHash('sha256')
  const digest = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
    digest,
    createWriteStream(target),
  )
  return hash.digest('hex')
}

/**
 * 自动更新：manifest 验签 → tarball SHA-256 → staging → 健康检查 → 原子切换。
 * bundle 模式真正静默更新；npm 模式只检查与提示。
 */
export class UpdateService {
  readonly currentVersion: string
  readonly mode: InstallMode
  readonly dataDir: string
  readonly bundleRoot: string
  readonly channel: UpdateChannel
  readonly updateUrl: string
  readonly checkIntervalMs: number
  private readonly publicKey?: string
  private readonly now: () => number

  constructor(options: UpdateOptions) {
    this.currentVersion = options.currentVersion
    this.mode = options.mode
    this.dataDir = options.dataDir
    this.bundleRoot = process.env.ATP_BUNDLE_ROOT ?? options.dataDir
    this.channel = options.channel ?? 'stable'
    this.updateUrl = options.updateUrl ?? defaultUpdateUrl(this.channel)
    this.checkIntervalMs = options.checkIntervalMs ?? DAY
    this.publicKey = options.publicKey ?? process.env.ATP_UPDATE_PUBLIC_KEY
    this.now = options.now ?? Date.now
  }

  private get cachePath(): string {
    return join(this.dataDir, 'update-check.json')
  }

  async check(options: { force?: boolean } = {}): Promise<UpdateCheck> {
    if (this.mode === 'npm') return this.checkNpm(options)
    return this.checkBundle(options)
  }

  private async checkBundle(options: { force?: boolean }): Promise<UpdateCheck> {
    const cache = await readCache(this.cachePath)
    if (!options.force && cache && this.now() - cache.checkedAt < this.checkIntervalMs) {
      if (cache.version && semver.gt(cache.version, this.currentVersion)) {
        const target = cache.manifest?.platforms[platformKey()]
        if (
          cache.manifest &&
          target &&
          this.publicKey &&
          verifyManifest(cache.manifest, this.publicKey)
        ) {
          return {
            available: true,
            version: cache.version,
            manifest: cache.manifest,
            platform: target,
          }
        }
      }
      return { available: false, reason: '刚刚检查过' }
    }

    let manifest: SignedManifest
    try {
      const response = await fetch(this.updateUrl, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      manifest = signedManifestSchema.parse(await response.json())
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      await writeCache(this.cachePath, {
        checkedAt: this.now(),
        channel: this.channel,
        reason,
      })
      return { available: false, reason: `检查更新失败：${reason}` }
    }

    if (!this.publicKey) {
      return { available: false, reason: '未配置更新公钥（ATP_UPDATE_PUBLIC_KEY）' }
    }
    if (!verifyManifest(manifest, this.publicKey)) {
      return { available: false, reason: '更新清单签名无效' }
    }

    const entry = manifest.platforms[platformKey()]
    await writeCache(this.cachePath, {
      checkedAt: this.now(),
      channel: this.channel,
      version: manifest.version,
      manifest,
    })

    if (!entry) {
      return { available: false, reason: `没有当前平台的安装包：${platformKey()}` }
    }
    if (manifest.minVersion && semver.lt(this.currentVersion, manifest.minVersion)) {
      return { available: false, reason: `当前版本过旧，需要手动安装 >= ${manifest.minVersion}` }
    }
    if (!semver.gt(manifest.version, this.currentVersion)) {
      return { available: false, version: manifest.version }
    }

    return { available: true, version: manifest.version, manifest, platform: entry }
  }

  private async checkNpm(options: { force?: boolean }): Promise<UpdateCheck> {
    const cache = await readCache(this.cachePath)
    if (!options.force && cache && this.now() - cache.checkedAt < this.checkIntervalMs) {
      if (cache.version && semver.gt(cache.version, this.currentVersion)) {
        return { available: true, version: cache.version }
      }
      return { available: false, reason: '刚刚检查过' }
    }

    const npm = platform() === 'win32' ? 'npm.cmd' : 'npm'
    try {
      const { stdout } = await execa(npm, ['view', '@atp/agent', 'version'], { timeout: 20_000 })
      const version = stdout.trim()
      await writeCache(this.cachePath, {
        checkedAt: this.now(),
        channel: this.channel,
        version,
      })
      return semver.gt(version, this.currentVersion)
        ? { available: true, version }
        : { available: false, version }
    } catch (err) {
      return {
        available: false,
        reason: `检查 npm 版本失败：${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  /** 下载、校验、解压、健康检查并原子落到 versions/<version> */
  async stage(check: UpdateCheck): Promise<string> {
    if (this.mode !== 'bundle') throw new Error('npm 模式不支持静默安装')
    if (!check.available || !check.version || !check.manifest || !check.platform) {
      throw new Error('没有可安装的更新')
    }

    const versionsDir = join(this.bundleRoot, 'versions')
    await mkdir(versionsDir, { recursive: true })
    const finalDir = join(versionsDir, check.version)
    if (existsSync(join(finalDir, 'app', 'dist', 'cli.js'))) return finalDir

    const staging = join(versionsDir, `.staging-${check.version}-${Date.now()}`)
    const archive = join(versionsDir, `.download-${check.version}-${Date.now()}.tar.gz`)
    await mkdir(staging, { recursive: true })

    try {
      const digest = await downloadFile(check.platform.url, archive)
      if (digest.toLowerCase() !== check.platform.sha256.toLowerCase()) {
        throw new Error(`SHA-256 不匹配：期望 ${check.platform.sha256}，实际 ${digest}`)
      }

      await tar.x({ file: archive, cwd: staging, strict: true })
      await this.healthCheck(staging, check.version)

      await rm(finalDir, { recursive: true, force: true })
      await rename(staging, finalDir)
      return finalDir
    } catch (err) {
      await rm(staging, { recursive: true, force: true }).catch(() => {})
      throw err
    } finally {
      await rm(archive, { force: true }).catch(() => {})
    }
  }

  private async healthCheck(staging: string, version: string): Promise<void> {
    const runtime = join(staging, 'runtime', platform() === 'win32' ? 'node.exe' : 'node')
    const node = existsSync(runtime) ? runtime : process.execPath
    const cli = join(staging, 'app', 'dist', 'cli.js')
    if (!existsSync(cli)) throw new Error('安装包缺少 app/dist/cli.js')

    const { stdout } = await execa(node, [cli, 'version', '--json'], { timeout: 30_000 })
    const info = JSON.parse(stdout.trim()) as { version?: string }
    if (info.version !== version) {
      throw new Error(`健康检查失败：期望 ${version}，实际 ${info.version ?? '未知'}`)
    }
  }

  /** 原子切换 current；失败时保持旧指针 */
  async apply(version: string): Promise<void> {
    if (this.mode !== 'bundle') throw new Error('npm 模式不支持静默切换')
    const target = join('versions', version)
    const current = join(this.bundleRoot, 'current')
    const temp = join(this.bundleRoot, `.current-${Date.now()}`)

    await rm(temp, { force: true }).catch(() => {})
    try {
      const type = platform() === 'win32' ? 'junction' : 'dir'
      await symlink(target, temp, type)
      await rename(temp, current)
      await writeFile(join(this.bundleRoot, 'current.txt'), version, 'utf8')
    } catch (err) {
      await rm(temp, { force: true }).catch(() => {})
      // Windows 无权限创建 junction 时退回文本指针
      if (platform() === 'win32') {
        await writeFile(join(this.bundleRoot, 'current.txt'), version, 'utf8')
        return
      }
      throw err
    }
  }

  /** 检查 → 下载 → 切换（bundle 模式） */
  async update(options: { force?: boolean; apply?: boolean } = {}): Promise<UpdateResult> {
    const check = await this.check({ force: options.force })
    if (!check.available || !check.version) {
      return { updated: false, reason: check.reason }
    }
    if (this.mode === 'npm') {
      return { updated: false, version: check.version, reason: 'npm 模式请执行 atp-agent update' }
    }
    const dir = await this.stage(check)
    if (options.apply !== false) {
      const version = dir.split(/[\\/]/).pop() as string
      await this.apply(version)
    }
    return { updated: true, version: check.version }
  }
}

/** 显式执行全局安装（npm 模式）；由 `atp-agent update` 调用 */
export async function runNpmUpdate(): Promise<void> {
  const npm = platform() === 'win32' ? 'npm.cmd' : 'npm'
  const ua = process.env.npm_config_user_agent ?? ''
  const manager = ua.startsWith('pnpm/')
    ? { cmd: 'pnpm', args: ['add', '-g', '@atp/agent@latest'] }
    : ua.startsWith('yarn/')
      ? { cmd: 'yarn', args: ['global', 'add', '@atp/agent@latest'] }
      : { cmd: npm, args: ['install', '-g', '@atp/agent@latest'] }

  await execa(manager.cmd, manager.args, { stdio: 'inherit' })
}

export async function ensureExecutable(path: string): Promise<void> {
  if (platform() !== 'win32') await chmod(path, 0o755)
}
