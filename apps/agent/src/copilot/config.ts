import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type AiProfileKind = 'deepseek' | 'anthropic' | 'openai-compatible' | 'stub'

export interface AiProfile {
  kind: AiProfileKind
  model: string
  baseURL?: string
  /** 从哪个环境变量取 key；缺省 ATP_AI_API_KEY */
  apiKeyEnv?: string
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
  ready: boolean
  reason?: string
  env: string[]
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
    fallbackModel: 'deepseek-chat',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  claude: {
    kind: 'anthropic',
    model: 'claude-sonnet-5-5',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
}

function envValue(name: string): string | undefined {
  return process.env[name]?.trim() || undefined
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

/**
 * 解析模型配置。优先级：环境变量 > ~/.atp-agent/config.json > 自动探测 > Stub。
 * 不做登录；没有可用 key 时以 Stub 运行，UI 会显示配置卡。
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
        // 只有 Claude key 时，默认仍交由用户通过 ATP_AI_MODEL 指定模型
        profiles.claude.model = envValue('ATP_AI_MODEL') ?? profiles.claude.model
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
  const name =
    requested && profiles[requested]
      ? requested
      : envValue('ATP_AI_BASE_URL') && envValue('ATP_AI_API_KEY')
        ? 'gateway'
        : envValue('DEEPSEEK_API_KEY')
          ? 'deepseek'
          : envValue('ANTHROPIC_API_KEY')
            ? 'claude'
            : 'stub'

  const base = profiles[name] ?? { kind: 'stub' as const, model: 'stub' }
  const profile: AiProfile = {
    ...base,
    model: envValue('ATP_AI_MODEL') ?? base.model,
    baseURL: envValue('ATP_AI_BASE_URL') ?? base.baseURL,
  }
  if (profile.kind === 'stub') {
    return { name: 'stub', profile, ready: true, env: CONFIG_ENV }
  }

  const apiKey = profile.apiKeyEnv
    ? (envValue(profile.apiKeyEnv) ?? envValue('ATP_AI_API_KEY'))
    : envValue('ATP_AI_API_KEY')
  if (!apiKey) {
    return {
      name,
      profile,
      ready: false,
      reason: `未找到 ${profile.apiKeyEnv ?? 'ATP_AI_API_KEY'}，Copilot 将以只读演示模式运行`,
      env: CONFIG_ENV,
    }
  }
  if (profile.kind === 'openai-compatible' && !profile.baseURL) {
    return {
      name,
      profile,
      apiKey,
      ready: false,
      reason: 'OpenAI 兼容 profile 缺少 baseURL',
      env: CONFIG_ENV,
    }
  }
  return { name, profile, apiKey, ready: true, env: CONFIG_ENV }
}
