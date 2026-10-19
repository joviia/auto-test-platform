import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadAiProfile, resolveConnectionProfile, saveAiProfile } from './config.js'

const ENV_NAMES = [
  'ATP_AI_PROFILE',
  'ATP_AI_MODEL',
  'ATP_AI_BASE_URL',
  'ATP_AI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
  'ATP_AI_STUB',
]

const savedEnv = new Map<string, string | undefined>()
const dirs: string[] = []

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atp-ai-config-'))
  dirs.push(dir)
  return dir
}

beforeEach(() => {
  for (const name of ENV_NAMES) {
    savedEnv.set(name, process.env[name])
    delete process.env[name]
  }
})

afterEach(async () => {
  for (const name of ENV_NAMES) {
    const value = savedEnv.get(name)
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  savedEnv.clear()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('loadAiProfile', () => {
  it('没有密钥时保留默认 provider/model，标记为未就绪', async () => {
    const dir = await makeDir()
    const resolved = await loadAiProfile(dir)
    expect(resolved.name).toBe('deepseek')
    expect(resolved.profile.model).toBe('deepseek-flash')
    expect(resolved.ready).toBe(false)
    expect(resolved.keySource).toBe('none')
    expect(resolved.keyHint).toBeUndefined()
    expect(resolved.reason).toContain('DEEPSEEK_API_KEY')
  })

  it('环境变量优先，并且只暴露末四位', async () => {
    const dir = await makeDir()
    process.env.DEEPSEEK_API_KEY = 'sk-env-secret-9876'
    const resolved = await loadAiProfile(dir)
    expect(resolved.ready).toBe(true)
    expect(resolved.keySource).toBe('env')
    expect(resolved.keyEnv).toBe('DEEPSEEK_API_KEY')
    expect(resolved.keyHint).toBe('…9876')
    expect(resolved.apiKey).toBe('sk-env-secret-9876')
  })

  it('ATP_AI_MODEL 覆盖默认模型', async () => {
    const dir = await makeDir()
    process.env.DEEPSEEK_API_KEY = 'sk-env-1234'
    process.env.ATP_AI_MODEL = 'deepseek-v4-pro'
    const resolved = await loadAiProfile(dir)
    expect(resolved.profile.model).toBe('deepseek-v4-pro')
  })
})

describe('saveAiProfile', () => {
  it('合并已有配置，原子写入且权限为 0600', async () => {
    const dir = await makeDir()
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        mcp: { enabled: true },
        ai: {
          profiles: {
            anthropic: {
              kind: 'anthropic',
              model: 'claude-haiku-5-5',
              apiKey: 'sk-ant-keep',
            },
          },
        },
      }),
    )

    const resolved = await saveAiProfile(dir, {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'sk-deep-1234',
      thinking: 'max',
      baseURL: 'https://proxy.example.com',
    })
    expect(resolved.ready).toBe(true)
    expect(resolved.keySource).toBe('file')
    expect(resolved.keyHint).toBe('…1234')
    expect(resolved.profile.thinking).toBe('max')
    expect(resolved.profile.baseURL).toBe('https://proxy.example.com')

    const text = await readFile(join(dir, 'config.json'), 'utf8')
    const file = JSON.parse(text) as {
      mcp?: { enabled?: boolean }
      ai?: {
        active?: string
        profiles?: Record<string, { apiKey?: string; model?: string }>
      }
    }
    expect(file.mcp?.enabled).toBe(true)
    expect(file.ai?.active).toBe('deepseek')
    expect(file.ai?.profiles?.anthropic?.apiKey).toBe('sk-ant-keep')
    expect(file.ai?.profiles?.deepseek?.apiKey).toBe('sk-deep-1234')
    expect(file.ai?.profiles?.deepseek?.model).toBe('deepseek-v4-pro')

    const mode = (await stat(join(dir, 'config.json'))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('环境变量仍然高于本机保存的密钥', async () => {
    const dir = await makeDir()
    await saveAiProfile(dir, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      apiKey: 'sk-file-1111',
    })
    process.env.DEEPSEEK_API_KEY = 'sk-env-2222'
    const resolved = await loadAiProfile(dir)
    expect(resolved.keySource).toBe('env')
    expect(resolved.keyHint).toBe('…2222')
  })

  it('clearKey 删除本机密钥', async () => {
    const dir = await makeDir()
    await saveAiProfile(dir, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      apiKey: 'sk-file-3333',
    })
    const cleared = await saveAiProfile(dir, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      clearKey: true,
    })
    expect(cleared.ready).toBe(false)
    expect(cleared.apiKey).toBeUndefined()
    expect(cleared.keySource).toBe('none')
    const text = await readFile(join(dir, 'config.json'), 'utf8')
    expect(text).not.toContain('sk-file-3333')
  })

  it('OpenAI 兼容网关必须有 Base URL', async () => {
    const dir = await makeDir()
    await expect(
      saveAiProfile(dir, { provider: 'gateway', model: 'gpt-4.1', apiKey: 'sk-gw' }),
    ).rejects.toThrow('Base URL')
  })
})

describe('resolveConnectionProfile', () => {
  it('测试连接时输入的密钥优先于已保存的密钥', async () => {
    const dir = await makeDir()
    await saveAiProfile(dir, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      apiKey: 'sk-saved-4444',
    })
    process.env.DEEPSEEK_API_KEY = 'sk-env-5555'
    const resolved = await resolveConnectionProfile(dir, {
      provider: 'deepseek',
      model: 'deepseek-flash',
      apiKey: 'sk-input-6666',
    })
    expect(resolved.apiKey).toBe('sk-input-6666')
    expect(resolved.keyHint).toBe('…6666')
  })
})
