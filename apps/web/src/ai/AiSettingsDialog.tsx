import type {
  AiConfig,
  AiModelInfo,
  AiProvider,
  AiSaveConfigInput,
  AiTestResult,
  AiThinking,
} from '@atp/model'
import { Button, Modal, toast } from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOverlayGuard } from '../hooks/use-overlay-guard'
import { useUiStore } from '../state/ui-store'

const PROVIDERS: Array<{ id: AiProvider; label: string; note: string }> = [
  { id: 'deepseek', label: 'DeepSeek', note: '官方 API' },
  { id: 'anthropic', label: 'Anthropic', note: 'Claude' },
  { id: 'gateway', label: 'OpenAI 兼容', note: '自建网关' },
]

const DEFAULT_MODEL: Record<AiProvider, string> = {
  deepseek: 'deepseek-flash',
  anthropic: 'claude-opus-5-5',
  gateway: 'deepseek-flash',
}

const SUGGESTIONS: Record<AiProvider, Array<{ id: string; hint: string }>> = {
  deepseek: [
    { id: 'deepseek-flash', hint: 'V4.1 Flash · 1M 上下文 · 384K 输出 · 支持图片输入' },
    { id: 'deepseek-v4-pro', hint: 'V4 Pro · 1M 上下文 · 384K 输出' },
  ],
  anthropic: [
    { id: 'claude-opus-5-5', hint: '旗舰模型 · 复杂任务与长程操作' },
    { id: 'claude-sonnet-5-5', hint: '速度与成本均衡' },
    { id: 'claude-haiku-5-5', hint: '最快、成本最低' },
    { id: 'claude-fable-5-1', hint: '最高推理能力' },
  ],
  gateway: [],
}

const THINKING_OPTIONS: Array<{ id: AiThinking; label: string }> = [
  { id: 'off', label: '关闭' },
  { id: 'low', label: '低' },
  { id: 'high', label: '高' },
  { id: 'max', label: '最高' },
]

const KEY_NOTE: Record<AiProvider, string> = {
  deepseek: '在 platform.deepseek.com 的 API Keys 页面创建',
  anthropic: '在 console.anthropic.com 的 API Keys 页面创建',
  gateway: '填写网关分配的密钥',
}

function providerOf(config: AiConfig): AiProvider {
  if (config.kind === 'anthropic') return 'anthropic'
  if (config.kind === 'openai-compatible') return 'gateway'
  return 'deepseek'
}

function formatTokens(value?: number): string | undefined {
  if (!value) return undefined
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  return `${Math.round(value / 1000)}K`
}

function describeRemote(model: AiModelInfo): string {
  const parts: string[] = []
  const context = formatTokens(model.contextWindow)
  const output = formatTokens(model.maxOutputTokens)
  if (context) parts.push(`${context} 上下文`)
  if (output) parts.push(`${output} 输出`)
  if (model.inputModalities?.includes('image')) parts.push('支持图片输入')
  return parts.join(' · ') || (model.name ?? '')
}

const fieldClass =
  'h-9 w-full rounded-md border border-border bg-field px-2.5 text-[12.5px] text-foreground outline-none placeholder:text-muted focus:border-accent/60 focus:ring-2 focus:ring-accent/15'
const labelClass = 'block text-[11px] font-medium text-muted'

export function AiSettingsDialog() {
  const open = useUiStore((s) => s.aiSettingsOpen)
  const setOpen = useUiStore((s) => s.setAiSettingsOpen)
  const storedConfig = useUiStore((s) => s.aiConfig)
  const setAiConfig = useUiStore((s) => s.setAiConfig)
  const qc = useQueryClient()

  const [provider, setProvider] = useState<AiProvider>('deepseek')
  const [model, setModel] = useState(DEFAULT_MODEL.deepseek)
  const [thinking, setThinking] = useState<AiThinking>('high')
  const [baseURL, setBaseURL] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearKey, setClearKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testState, setTestState] = useState<AiTestResult | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [remoteModels, setRemoteModels] = useState<AiModelInfo[]>([])
  const [saving, setSaving] = useState(false)
  const hydrated = useRef(false)

  useOverlayGuard(open)

  const { data: configData } = useQuery({
    queryKey: ['ai', 'config'],
    queryFn: () => window.atp.invoke('ai:config'),
    enabled: open,
    staleTime: 10_000,
  })

  useEffect(() => {
    if (configData) setAiConfig(configData)
  }, [configData, setAiConfig])

  const config = configData ?? storedConfig

  // 每次打开时从已保存配置回填一次；保存成功后的刷新不覆盖用户正在编辑的内容
  useEffect(() => {
    if (!open) {
      hydrated.current = false
      return
    }
    if (hydrated.current) return
    const current = configData ?? storedConfig
    if (!current) return
    hydrated.current = true
    const nextProvider = providerOf(current)
    setProvider(nextProvider)
    setModel(
      current.model && current.model !== 'stub' ? current.model : DEFAULT_MODEL[nextProvider],
    )
    setThinking(current.thinking ?? 'high')
    setBaseURL(current.baseURL ?? '')
    setKeyInput('')
    setShowKey(false)
    setReplacing(!current.hasKey)
    setConfirmClear(false)
    setClearKey(false)
    setTesting(false)
    setTestState(null)
    setRefreshing(false)
    setRemoteModels([])
  }, [open, configData, storedConfig])

  const typedKey = keyInput.trim()
  const sameProvider = Boolean(config) && provider === providerOf(config as AiConfig)
  const keyFromEnv = sameProvider && config?.keySource === 'env'
  const savedKey = Boolean(sameProvider && config?.hasKey)
  const keyAvailable = Boolean(typedKey) || keyFromEnv || (savedKey && !clearKey)
  const showSavedKey = savedKey && !replacing

  const suggestions = SUGGESTIONS[provider]
  const modelIds = useMemo(() => {
    const ids = new Set(suggestions.map((item) => item.id))
    for (const item of remoteModels) ids.add(item.id)
    return [...ids]
  }, [suggestions, remoteModels])

  const modelHint =
    suggestions.find((item) => item.id === model)?.hint ??
    (() => {
      const remote = remoteModels.find((item) => item.id === model)
      return remote ? describeRemote(remote) : undefined
    })()

  const switchProvider = (next: AiProvider): void => {
    if (next === provider) return
    setProvider(next)
    setModel(DEFAULT_MODEL[next])
    setBaseURL('')
    setKeyInput('')
    setShowKey(false)
    setConfirmClear(false)
    setClearKey(false)
    // 已保存的密钥属于另一个服务商，切过来后从空白输入开始
    setReplacing(!(config && providerOf(config) === next && config.hasKey))
    setTestState(null)
    setRemoteModels([])
  }

  const refreshModels = async (): Promise<void> => {
    if (provider === 'gateway' && !baseURL.trim()) {
      toast.info('OpenAI 兼容网关需要填写 Base URL')
      return
    }
    if (!keyAvailable) {
      toast.info('先填写 API Key 再拉取模型列表')
      return
    }
    setRefreshing(true)
    try {
      const result = await window.atp.invoke('ai:models', {
        provider,
        model: model.trim() || DEFAULT_MODEL[provider],
        ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
        ...(typedKey ? { apiKey: typedKey } : {}),
      })
      if (result.models.length > 0) {
        setRemoteModels(result.models)
        toast.success(`已获取 ${result.models.length} 个模型`)
      } else {
        toast.info(result.error ?? '服务商没有返回模型列表，可直接填写模型名')
      }
      if (result.models.length > 0 && result.error) toast.info(result.error)
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '获取模型列表失败')
    } finally {
      setRefreshing(false)
    }
  }

  const runTest = async (): Promise<void> => {
    if (!model.trim()) {
      toast.info('请先填写模型名')
      return
    }
    if (provider === 'gateway' && !baseURL.trim()) {
      toast.info('OpenAI 兼容网关需要填写 Base URL')
      return
    }
    if (!keyAvailable) {
      toast.info('请先填写 API Key')
      return
    }
    setTesting(true)
    setTestState(null)
    try {
      const result = await window.atp.invoke('ai:test', {
        provider,
        model: model.trim(),
        ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
        ...(typedKey ? { apiKey: typedKey } : {}),
        ...(provider === 'deepseek' ? { thinking } : {}),
      })
      setTestState(result)
    } catch (err) {
      setTestState({
        ok: false,
        latencyMs: 0,
        model: model.trim(),
        toolCall: false,
        error: err instanceof Error ? err.message : '测试连接失败',
      })
    } finally {
      setTesting(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!model.trim()) {
      toast.info('请填写模型名')
      return
    }
    if (provider === 'gateway' && !baseURL.trim()) {
      toast.info('OpenAI 兼容网关需要填写 Base URL')
      return
    }
    // 清除密钥时不需要提供新密钥
    if (!keyAvailable && !clearKey) {
      toast.info('请填写 API Key')
      return
    }
    setSaving(true)
    try {
      const input: AiSaveConfigInput = {
        provider,
        model: model.trim(),
        ...(baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
        ...(typedKey ? { apiKey: typedKey } : {}),
        ...(provider === 'deepseek' ? { thinking } : {}),
        ...(clearKey && !typedKey ? { clearKey: true } : {}),
      }
      const next = await window.atp.invoke('ai:saveConfig', input)
      setAiConfig(next)
      qc.setQueryData(['ai', 'config'], next)
      setOpen(false)
      if (next.ready && !next.stub) {
        toast.success(`${next.model} 已启用，下一条消息生效`)
      } else {
        toast.info('设置已保存；仍未检测到可用密钥，Copilot 继续以演示模式运行')
      }
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : '保存模型设置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal.Root
      isOpen={open}
      onOpenChange={(next) => {
        if (!next && !saving) setOpen(false)
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>模型设置</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>

            <Modal.Body className="max-h-[68vh] space-y-3.5 overflow-y-auto">
              {!config ? (
                <div className="flex items-center gap-2 py-6 text-[12px] text-muted">
                  <Loader2 size={13} className="animate-spin" />
                  正在读取本机配置…
                </div>
              ) : (
                <>
                  <p className="text-[11.5px] leading-5 text-muted">
                    Copilot 使用这里配置的模型操作浏览器。密钥只保存在本机，不会上传到任何服务器。
                  </p>

                  <div className="space-y-1.5">
                    <span className={labelClass}>服务商</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {PROVIDERS.map((item) => {
                        const active = provider === item.id
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => switchProvider(item.id)}
                            aria-pressed={active}
                            className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                              active
                                ? 'border-accent/50 bg-accent/[0.06]'
                                : 'border-border bg-surface hover:border-accent/30'
                            }`}
                          >
                            <span
                              className={`block truncate text-[11.5px] font-medium ${
                                active ? 'text-accent' : 'text-foreground'
                              }`}
                            >
                              {item.label}
                            </span>
                            <span className="block truncate text-[9.5px] text-muted">
                              {item.note}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {keyFromEnv && (
                    <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-2 text-[10.5px] leading-4 text-muted">
                      <Info
                        size={11}
                        className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
                      />
                      <span>
                        已由环境变量{' '}
                        <code className="font-mono text-[10px]">
                          {config.keyEnv ?? 'ATP_AI_API_KEY'}
                        </code>{' '}
                        提供密钥，优先级高于本机保存的密钥。
                      </span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <label className={labelClass} htmlFor="atp-ai-key">
                        API Key
                      </label>
                      <span className="truncate text-[9.5px] text-muted">{KEY_NOTE[provider]}</span>
                    </div>

                    {showSavedKey ? (
                      <div className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-secondary px-2.5">
                        <KeyRound size={12} className="shrink-0 text-muted" />
                        <span className="font-mono text-[12px] text-foreground">
                          {config.keyHint ?? '••••••'}
                        </span>
                        <span className="rounded bg-surface px-1 py-px text-[9.5px] text-muted">
                          {keyFromEnv ? '环境变量' : '本机保存'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setReplacing(true)
                            setConfirmClear(false)
                          }}
                          className="ml-auto rounded px-1.5 py-0.5 text-[10.5px] text-accent outline-none hover:bg-accent/[0.08]"
                        >
                          替换
                        </button>
                        {!keyFromEnv && (
                          <button
                            type="button"
                            onClick={() => setConfirmClear(true)}
                            className="rounded px-1.5 py-0.5 text-[10.5px] text-muted outline-none hover:bg-default hover:text-rose-600 dark:hover:text-rose-400"
                          >
                            清除
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="relative">
                        <input
                          id="atp-ai-key"
                          type={showKey ? 'text' : 'password'}
                          value={keyInput}
                          onChange={(event) => {
                            setKeyInput(event.target.value)
                            if (event.target.value.trim()) setClearKey(false)
                          }}
                          placeholder={
                            clearKey
                              ? '粘贴新的 API Key（留空则删除本机密钥）'
                              : savedKey
                                ? '粘贴新的 API Key（留空保留原密钥）'
                                : '粘贴 API Key'
                          }
                          autoComplete="off"
                          spellCheck={false}
                          className={`${fieldClass} pr-9 font-mono`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey((value) => !value)}
                          aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                          className="absolute top-1 right-1 grid size-7 place-items-center rounded text-muted hover:bg-default hover:text-foreground"
                        >
                          {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      </div>
                    )}

                    {confirmClear && (
                      <div className="flex flex-wrap items-center gap-2 rounded-md border border-rose-500/25 bg-rose-500/[0.05] px-2.5 py-1.5 text-[10.5px] text-muted">
                        <span>保存后删除本机密钥，Copilot 将回到演示模式。</span>
                        <span className="ml-auto flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setConfirmClear(false)}
                            className="rounded px-1.5 py-0.5 text-muted hover:bg-default hover:text-foreground"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmClear(false)
                              setClearKey(true)
                              setReplacing(true)
                              setKeyInput('')
                            }}
                            className="rounded px-1.5 py-0.5 font-medium text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                          >
                            确认清除
                          </button>
                        </span>
                      </div>
                    )}
                    {clearKey && (
                      <div className="flex items-center gap-2 rounded-md border border-rose-500/25 bg-rose-500/[0.05] px-2.5 py-1.5 text-[10.5px] text-muted">
                        <span>已标记清除本机密钥，保存后生效。</span>
                        <button
                          type="button"
                          onClick={() => {
                            setClearKey(false)
                            setReplacing(false)
                          }}
                          className="ml-auto rounded px-1.5 py-0.5 hover:bg-default hover:text-foreground"
                        >
                          撤销
                        </button>
                      </div>
                    )}
                    {savedKey && replacing && !clearKey && (
                      <button
                        type="button"
                        onClick={() => {
                          setReplacing(false)
                          setKeyInput('')
                        }}
                        className="text-[10px] text-muted underline-offset-2 hover:text-foreground hover:underline"
                      >
                        取消替换，继续使用已保存的密钥
                      </button>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className={labelClass} htmlFor="atp-ai-model">
                      模型
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        id="atp-ai-model"
                        list="atp-ai-model-list"
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                        placeholder={DEFAULT_MODEL[provider]}
                        autoComplete="off"
                        spellCheck={false}
                        className={`${fieldClass} min-w-0 flex-1 font-mono`}
                      />
                      <datalist id="atp-ai-model-list">
                        {modelIds.map((id) => (
                          <option key={id} value={id} />
                        ))}
                      </datalist>
                      <Button
                        variant="secondary"
                        size="sm"
                        isDisabled={refreshing}
                        onPress={() => void refreshModels()}
                        className="h-9 shrink-0"
                      >
                        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                        刷新
                      </Button>
                    </div>
                    {modelHint && <p className="text-[10px] leading-4 text-muted">{modelHint}</p>}
                  </div>

                  {provider === 'deepseek' && (
                    <div className="space-y-1.5">
                      <span className={labelClass}>思考强度</span>
                      <div className="grid grid-cols-4 gap-0.5 rounded-md border border-border bg-surface-secondary p-0.5">
                        {THINKING_OPTIONS.map((item) => {
                          const active = thinking === item.id
                          return (
                            <button
                              key={item.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setThinking(item.id)}
                              className={`h-7 rounded text-[11px] transition-colors ${
                                active
                                  ? 'bg-surface text-foreground shadow-sm'
                                  : 'text-muted hover:text-foreground'
                              }`}
                            >
                              {item.label}
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-[10px] leading-4 text-muted">
                        默认「高」。关闭响应更快；复杂页面操作建议保持「高」或「最高」。
                      </p>
                    </div>
                  )}

                  {provider === 'gateway' ? (
                    <div className="space-y-1.5">
                      <label className={labelClass} htmlFor="atp-ai-base-url">
                        Base URL
                      </label>
                      <input
                        id="atp-ai-base-url"
                        value={baseURL}
                        onChange={(event) => setBaseURL(event.target.value)}
                        placeholder="https://api.example.com/v1"
                        autoComplete="off"
                        spellCheck={false}
                        className={`${fieldClass} font-mono`}
                      />
                      <p className="text-[10px] leading-4 text-muted">
                        需兼容 OpenAI Chat Completions 协议；拉取模型列表时会请求{' '}
                        <code className="font-mono">{baseURL.trim() || '…'}/models</code>。
                      </p>
                    </div>
                  ) : (
                    <details className="group rounded-md border border-border">
                      <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[11px] text-muted outline-none hover:text-foreground">
                        高级：自定义接口地址
                        <span className="ml-1 font-mono text-[10px] opacity-70">
                          {baseURL || '默认'}
                        </span>
                      </summary>
                      <div className="space-y-1.5 border-t border-border px-2.5 py-2">
                        <label className={labelClass} htmlFor="atp-ai-base-url">
                          Base URL（可选）
                        </label>
                        <input
                          id="atp-ai-base-url"
                          value={baseURL}
                          onChange={(event) => setBaseURL(event.target.value)}
                          placeholder={
                            provider === 'anthropic'
                              ? 'https://api.anthropic.com'
                              : 'https://api.deepseek.com'
                          }
                          autoComplete="off"
                          spellCheck={false}
                          className={`${fieldClass} font-mono`}
                        />
                        <p className="text-[10px] leading-4 text-muted">
                          留空使用官方地址；代理或私有部署时填写完整前缀。
                        </p>
                      </div>
                    </details>
                  )}

                  {(testing || testState) && (
                    <div
                      className={`rounded-md border px-2.5 py-2 text-[11px] ${
                        testState?.ok
                          ? 'border-emerald-500/25 bg-emerald-500/[0.05]'
                          : testing
                            ? 'border-border bg-surface-secondary'
                            : 'border-rose-500/25 bg-rose-500/[0.05]'
                      }`}
                    >
                      {testing ? (
                        <span className="flex items-center gap-2 text-muted">
                          <Loader2 size={12} className="animate-spin" />
                          正在连接并调用一次工具，通常需要几秒…
                        </span>
                      ) : testState?.ok ? (
                        <div className="flex items-start gap-2">
                          <Check
                            size={12}
                            className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-emerald-700 dark:text-emerald-400">
                              连接成功 · {Math.round(testState.latencyMs)}ms
                            </p>
                            <p className="mt-0.5 break-words text-muted">
                              {testState.model} 可调用；
                              {testState.toolCall
                                ? '工具调用正常'
                                : '模型没有触发工具调用，仅完成文本回复'}
                              {testState.detail ? ` · ${testState.detail.slice(0, 120)}` : ''}
                            </p>
                          </div>
                        </div>
                      ) : testState ? (
                        <div className="flex items-start gap-2">
                          <CircleAlert
                            size={12}
                            className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400"
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-rose-700 dark:text-rose-400">连接失败</p>
                            <p className="mt-0.5 break-words text-muted">{testState.error}</p>
                            {testState.detail && testState.detail !== testState.error && (
                              <p className="mt-1 break-all font-mono text-[9.5px] text-muted/80">
                                {testState.detail.slice(0, 220)}
                              </p>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </Modal.Body>

            <Modal.Footer>
              <span className="mr-auto hidden items-center gap-1 text-[9.5px] text-muted sm:flex">
                <Lock size={9} />
                密钥仅存于本机 config.json（0600）
              </span>
              <Button variant="ghost" size="sm" onPress={() => setOpen(false)} isDisabled={saving}>
                取消
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => void runTest()}
                isDisabled={!config || testing || saving || !keyAvailable}
              >
                {testing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {testing ? '测试中…' : '测试连接'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onPress={() => void save()}
                isDisabled={!config || saving || testing}
              >
                {saving ? '保存中…' : '保存'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal.Root>
  )
}
