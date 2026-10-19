import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type AiProfileKind = 'deepseek' | 'anthropic' | 'openai-compatible' | 'stub'
export type AiThinking = 'off' | 'low' | 'high' | 'max'
export type AiKeySource = 'env' | 'file' | 'none'
export type AiProviderName = 'deepseek' | 'anthropic' | 'gateway'

export interface AiProfile {
  kind: AiProfileKind
  model: string
  baseURL?: string
  /** 从哪个环境变量取 key；缺省 ATP_AI_API_KEY */
  apiKeyEnv?: string
  /** 明文 key，仅存本机 config.json；不会出现在 IPC 返回值里 */
  apiKey?: string
  thinking?: AiThinking
  fallbackModel?: string
  /** 是否把截图作为图片发给模型 */
  vision?: boolean
}

export interface AiFileConfig {
  active?: string
  profiles?: Record<string, AiProfile>
}

export interface ResolvedAiProfile {
  name: string
  profile: AiProfile
  apiKey?: string
  keySource: AiKeySource
  keyHint?: string
  keyEnv?: string
  ready: boolean
  reason?: string
  env: string[]
}

export interface AiConnectionInput {
  provider: AiProviderName
  model: string
  baseURL?: string
  apiKey?: string
  thinking?: AiThinking
}

const CONFIG_ENV = [
  'ATP_AI_PROFILE',
  'ATP_AI_MODEL',
  'ATP_AI_BASE_URL',
  'ATP_AI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
]

const DEFAULT_PROFILES: Record<string, AiProfile> = {
  deepseek: {
    kind: 'deepseek',
    model: 'deepseek-flash',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    thinking: 'high',
  },
  anthropic: {
    kind: 'anthropic',
    model: 'claude-opus-5-5',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  // 兼容旧配置里的 claude profile
  claude: {
    kind: 'anthropic',
    model: 'claude-sonnet-5-5',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  gateway: {
    kind: 'openai-compatible',
    model: 'deepseek-flash',
    apiKeyEnv: 'ATP_AI_API_KEY',
  },
}

function envValue(name: string): string | undefined {
  return process.env[name]?.trim() || undefined
}

function keyHintOf(apiKey: string | undefined): string | undefined {
  return apiKey ? `…${apiKey.slice(-4)}` : undefined
}

async function readFileConfig(dataDir: string): Promise<AiFileConfig> {
  try {
    const raw = await readFile(join(dataDir, 'config.json'), 'utf8')
    const parsed = JSON.parse(raw) as { ai?: AiFileConfig }
    return parsed.ai ?? {}
  } catch {
    return {}
  }
}

function keyFromEnv(profile: AiProfile): { value?: string; name?: string } {
  const names = [profile.apiKeyEnv, 'ATP_AI_API_KEY'].filter((name): name is string =>
    Boolean(name),
  )
  for (const name of names) {
    const value = envValue(name)
    if (value) return { value, name }
  }
  return {}
}

/** 解析一个 profile 的实际可用状态；overrideKey 用于「测试连接」里尚未保存的密钥 */
export function resolveProfile(
  name: string,
  raw: AiProfile,
  overrideKey?: string,
): ResolvedAiProfile {
  const profile = { ...raw }
  if (profile.kind === 'stub') {
    return { name: 'stub', profile, keySource: 'none', ready: true, env: CONFIG_ENV }
  }

  const fromEnv = overrideKey ? {} : keyFromEnv(profile)
  const apiKey = overrideKey ?? fromEnv.value ?? profile.apiKey?.trim()
  const keySource: AiKeySource = fromEnv.value ? 'env' : apiKey ? 'file' : 'none'
  const hint = keyHintOf(apiKey)
  const common = {
    name,
    profile,
    ...(apiKey ? { apiKey } : {}),
    keySource,
    ...(hint ? { keyHint: hint } : {}),
    ...(fromEnv.name ? { keyEnv: fromEnv.name } : {}),
    env: CONFIG_ENV,
  }

  if (!apiKey) {
    return {
      ...common,
      ready: false,
      reason: `未找到 ${profile.apiKeyEnv ?? 'ATP_AI_API_KEY'}，Copilot 将以只读演示模式运行`,
    }
  }
  if (profile.kind === 'openai-compatible' && !profile.baseURL) {
    return { ...common, ready: false, reason: 'OpenAI 兼容 profile 缺少 baseURL' }
  }
  return { ...common, ready: true }
}

/**
 * 解析模型配置。优先级：环境变量 > ~/.atp-agent/config.json > 自动探测。
 * 没有 key 时仍保留选中的 provider/model（ready=false），方便设置弹窗回填；
 * 真正的请求由 CopilotProvider 退回 Stub。
 */
export async function loadAiProfile(dataDir: string): Promise<ResolvedAiProfile> {
  const file = await readFileConfig(dataDir)
  const profiles: Record<string, AiProfile> = {
    ...DEFAULT_PROFILES,
    ...(file.profiles ?? {}),
  }

  if (envValue('ATP_AI_STUB') === '1') {
    return {
      name: 'stub',
      profile: { kind: 'stub', model: 'stub' },
      keySource: 'none',
      ready: true,
      env: CONFIG_ENV,
    }
  }

  // 没有配置文件时按常见环境变量探测
  if (!file.active && !file.profiles) {
    const explicitProfile = envValue('ATP_AI_PROFILE')
    if (!explicitProfile) {
      if (envValue('DEEPSEEK_API_KEY')) {
        profiles.deepseek.model = envValue('ATP_AI_MODEL') ?? profiles.deepseek.model
      } else if (envValue('ANTHROPIC_API_KEY')) {
        profiles.anthropic.model = envValue('ATP_AI_MODEL') ?? profiles.anthropic.model
      } else if (envValue('ATP_AI_BASE_URL') && envValue('ATP_AI_API_KEY')) {
        profiles.gateway = {
          kind: 'openai-compatible',
          baseURL: envValue('ATP_AI_BASE_URL'),
          model: envValue('ATP_AI_MODEL') ?? 'deepseek-flash',
        }
      }
    }
  }

  const requested = envValue('ATP_AI_PROFILE') ?? file.active
  const detected: AiProviderName | null =
    envValue('ATP_AI_BASE_URL') && envValue('ATP_AI_API_KEY')
      ? 'gateway'
      : envValue('DEEPSEEK_API_KEY')
        ? 'deepseek'
        : envValue('ANTHROPIC_API_KEY')
          ? 'anthropic'
          : null
  const name = requested && profiles[requested] ? requested : (detected ?? 'deepseek')

  const base = profiles[name] ?? { kind: 'stub' as const, model: 'stub' }
  const profile: AiProfile = {
    ...base,
    model: envValue('ATP_AI_MODEL') ?? base.model,
    baseURL: envValue('ATP_AI_BASE_URL') ?? base.baseURL,
  }
  return resolveProfile(name, profile)
}

/** 设置弹窗的「测试连接 / 拉模型列表」：合并输入与已保存配置，输入 key 优先 */
export async function resolveConnectionProfile(
  dataDir: string,
  input: AiConnectionInput,
): Promise<ResolvedAiProfile> {
  const file = await readFileConfig(dataDir)
  const stored =
    file.profiles?.[input.provider] ??
    (input.provider === 'anthropic' ? file.profiles?.claude : undefined) ??
    {}
  const kind: AiProfileKind = input.provider === 'gateway' ? 'openai-compatible' : input.provider
  const profile: AiProfile = {
    ...DEFAULT_PROFILES[input.provider],
    ...stored,
    kind,
    model: input.model,
    ...(input.baseURL?.trim() ? { baseURL: input.baseURL.trim() } : {}),
    ...(input.provider === 'deepseek' && input.thinking ? { thinking: input.thinking } : {}),
  }
  return resolveProfile(input.provider, profile, input.apiKey?.trim() || undefined)
}

function assertConnectionInput(input: AiConnectionInput): void {
  if (!input.model.trim()) throw new Error('模型不能为空')
  if (input.provider === 'gateway' && !input.baseURL?.trim()) {
    throw new Error('OpenAI 兼容网关需要填写 Base URL')
  }
}

/** 保存到 ~/.atp-agent/config.json：合并已有 profile，原子写入，权限 0600 */
export async function saveAiProfile(
  dataDir: string,
  input: AiConnectionInput & { clearKey?: boolean },
): Promise<ResolvedAiProfile> {
  assertConnectionInput(input)
  const path = join(dataDir, 'config.json')
  let file: Record<string, unknown> = {}
  try {
    file = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    file = {}
  }
  const ai = (file.ai as AiFileConfig | undefined) ?? {}
  const profiles = { ...(ai.profiles ?? {}) }
  const name = input.provider
  const existing =
    profiles[name] ??
    (input.provider === 'anthropic' ? profiles.claude : undefined) ??
    DEFAULT_PROFILES[name] ??
    {}
  const kind: AiProfileKind = input.provider === 'gateway' ? 'openai-compatible' : input.provider
  const next: AiProfile = {
    ...existing,
    kind,
    model: input.model.trim(),
    apiKeyEnv:
      input.provider === 'deepseek'
        ? 'DEEPSEEK_API_KEY'
        : input.provider === 'anthropic'
          ? 'ANTHROPIC_API_KEY'
          : 'ATP_AI_API_KEY',
  }
  delete next.fallbackModel
  delete next.vision

  if (input.baseURL?.trim()) next.baseURL = input.baseURL.trim()
  else delete next.baseURL

  if (input.provider === 'deepseek') next.thinking = input.thinking ?? next.thinking ?? 'high'
  else delete next.thinking

  if (input.clearKey) delete next.apiKey
  else if (input.apiKey?.trim()) next.apiKey = input.apiKey.trim()

  profiles[name] = next
  const nextFile = {
    ...file,
    ai: {
      ...ai,
      active: name,
      profiles,
    },
  }

  await mkdir(dataDir, { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(nextFile, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, path)
  await chmod(path, 0o600).catch(() => undefined)
  return loadAiProfile(dataDir)
}
