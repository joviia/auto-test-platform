import { createReadStream, existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, sep } from 'node:path'
import { Readable } from 'node:stream'
import { serve } from '@hono/node-server'
import { type Context, Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { Agent, AgentEvent } from './agent.js'
import { demoHtml } from './demo.js'
import { createInvokeRouter, type InvokeRouter } from './invoke.js'
import { renderUi } from './ui.js'

export interface ServerOptions {
  dataDir: string
  /** 监听端口，0 = 随机 */
  port?: number
  /** 浏览器 UI 构建产物目录；默认 <repo>/apps/web/dist 或包内 web */
  rendererDir?: string
}

export interface AgentServer {
  start(): Promise<{ port: number; origin: string }>
  close(): Promise<void>
}

const MAX_BODY = 1024 * 1024

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

function isLocalHostname(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase()
  return name === '127.0.0.1' || name === 'localhost' || name === '::1'
}

/**
 * 本机服务只接受本机来源：
 * - Host 不是 127.0.0.1 / localhost / ::1 时拒绝，防 DNS rebinding；
 * - 浏览器带 Origin 时必须也是本机来源，防其他网页 CSRF 调本地接口。
 * 不引入 token、账号或权限层。
 */
async function localOnly(c: Context, next: () => Promise<void>): Promise<Response | undefined> {
  const host = c.req.header('host')
  if (host) {
    const hostname = host.replace(/:\d+$/, '')
    if (!isLocalHostname(hostname)) return c.text('Not found', 404)
  }
  const origin = c.req.header('origin')
  if (origin) {
    try {
      if (!isLocalHostname(new URL(origin).hostname)) return c.text('Forbidden', 403)
    } catch {
      return c.text('Forbidden', 403)
    }
  }
  await next()
}

function evidenceContent(file: string): string {
  const ext = extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.json') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

/**
 * 浏览器侧 window.atp 垫片：invoke → POST /api/invoke，on → SSE。
 * React UI 完全按 Electron preload 的契约工作。
 */
function shimSource(): string {
  return `(() => {
  const names = ['recording-status', 'recording-step', 'replay-progress', 'plan-progress', 'ai-start', 'ai-delta', 'ai-tool-start', 'ai-tool-end', 'ai-done', 'ai-error', 'ai-recording-draft', 'ai-case-proposal', 'ai-state', 'ai-plan-proposal', 'ai-plan-progress', 'ai-plan-result', 'debug-state'];
  const listeners = new Map(names.map((name) => [name, new Set()]));
  const last = new Map();
  const reportClientError = (message) => {
    try {
      navigator.sendBeacon('/api/client-log', JSON.stringify({ message: String(message).slice(0, 4000) }));
    } catch {}
  };
  window.addEventListener('error', (event) => {
    reportClientError((event.message || 'error') + ' @ ' + (event.filename || '') + ':' + (event.lineno || 0));
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportClientError((reason && (reason.stack || reason.message)) || reason || 'unhandledrejection');
  });
  const source = new EventSource('/events');
  for (const name of names) {
    source.addEventListener(name, (event) => {
      try {
        const payload = JSON.parse(event.data);
        last.set(name, payload);
        for (const fn of listeners.get(name)) fn(payload);
      } catch {
        // 忽略非法事件
      }
    });
  }
  window.atp = {
    mode: 'web',
    invoke: async (channel, payload) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      let res;
      try {
        res = await fetch('/api/invoke', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel, payload }),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) throw new Error('请求超时（60 秒），请重试');
        throw err;
      } finally {
        clearTimeout(timer);
      }
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data.result;
    },
    on: (name, fn) => {
      const key = String(name).replace(/^event:/, '');
      const set = listeners.get(key);
      if (!set) return () => {};
      set.add(fn);
      if (last.has(key)) {
        const payload = last.get(key);
        queueMicrotask(() => { if (set.has(fn)) fn(payload); });
      }
      return () => set.delete(fn);
    },
  };
})();`
}

function injectShim(html: string): string {
  const script = `<script>${shimSource()}</script>`
  return html.includes('</head>') ? html.replace('</head>', `${script}</head>`) : `${script}${html}`
}

/** 构建产物位置：发布包内是 dist/web；工作区内是 apps/web/dist */
function defaultRendererDir(): string {
  if (process.env.ATP_RENDERER_DIR) return process.env.ATP_RENDERER_DIR
  const bundled = join(import.meta.dirname, 'web')
  const workspace = join(import.meta.dirname, '../../web/dist')
  return existsSync(join(bundled, 'index.html')) ? bundled : workspace
}

function safeJoin(base: string, relative: string): string | null {
  const target = join(base, relative)
  return target === base || target.startsWith(base + sep) ? target : null
}

function fileResponse(target: string, contentType: string, cache: string) {
  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>
  return new Response(stream, {
    headers: {
      'content-type': contentType,
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
    },
  })
}

/** 本地 Agent HTTP 服务：React UI、SSE、invoke、录制/回放 API、证据文件 */
export function createAgentServer(agent: Agent, opts: ServerOptions): AgentServer {
  const rendererDir = opts.rendererDir ?? defaultRendererDir()
  const hasRenderer = existsSync(join(rendererDir, 'index.html'))
  const invoke: InvokeRouter = createInvokeRouter(agent, opts.dataDir)
  let sseClients = 0

  const app = new Hono()
  app.use('*', localOnly)

  app.get('/favicon.ico', () => new Response(null, { status: 204 }))
  app.get('/demo', (c) => c.html(demoHtml()))

  // 静态资源只提供前端代码；接口与证据统一走 localOnly。
  app.get('/assets/*', async (c) => {
    if (!hasRenderer) return c.text('前端尚未构建，请先执行 pnpm build', 404)
    const target = safeJoin(rendererDir, c.req.path.replace(/^\/+/, ''))
    if (!target) return c.text('Not found', 404)
    const info = await stat(target).catch(() => null)
    if (!info?.isFile()) return c.text('Not found', 404)
    return fileResponse(
      target,
      MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'public, max-age=3600',
    )
  })

  app.get('/', async (c) => {
    if (!hasRenderer) return c.html(renderUi())
    const html = await readFile(join(rendererDir, 'index.html'), 'utf8')
    return c.html(injectShim(html))
  })

  app.get('/simple', (c) => c.html(renderUi()))

  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown): Promise<void> =>
        stream.writeSSE({ event, data: JSON.stringify(data) })

      sseClients += 1
      console.log(`[sse] connect clients=${sseClients}`)
      let closed = false
      const close = (): void => {
        closed = true
      }
      stream.onAbort(close)

      const state = await agent.describe()
      await send('status', {
        type: 'status',
        engine: state.engine,
        url: state.url,
        recording: state.recording,
        replaying: state.replaying,
      })
      await send('recording-status', { recording: state.recording, url: state.url })
      await send('cases', { type: 'cases', cases: state.cases })
      // 建连 / 重连时校准 Copilot 运行状态，修复断线期间错过的 ai-start / ai-done
      await send('ai-state', agent.aiState())
      // 调试暂停可能发生在断线期间；重连时补一份当前状态
      const debugState = agent.debugState()
      if (debugState) await send('debug-state', debugState)

      const unsubscribe = agent.onEvent((event: AgentEvent) => {
        if (closed) return
        if (event.type === 'status') {
          void send('status', event)
          void send('recording-status', { recording: event.recording, url: event.url })
          return
        }
        if (event.type === 'step') {
          void send('step', event)
          void send('recording-step', event.step)
          return
        }
        if (event.type === 'plan-progress') {
          void send('plan-progress', event.progress)
          return
        }
        if (event.type === 'ai-plan-progress') {
          void send('ai-plan-progress', event.progress)
          return
        }
        if (event.type === 'ai-plan-result') {
          void send('ai-plan-result', event.result)
          return
        }
        if (event.type === 'ai-plan-proposal') {
          // 与 ai-case-proposal 一致：附带 type 字段，界面忽略多余字段
          void send('ai-plan-proposal', event)
          return
        }
        if (event.type === 'debug-state') {
          void send('debug-state', event.state)
          return
        }
        void send(event.type, event)
      })

      // 5s 心跳同时校准 AI 运行态：即使 ai-done 丢失，界面也能在数秒内自动解除执行态
      const timer = setInterval(() => {
        if (closed) return
        void stream.write(': ping\n\n')
        void send('ai-state', agent.aiState())
      }, 5_000)

      stream.onAbort(() => {
        clearInterval(timer)
        unsubscribe()
        sseClients = Math.max(0, sseClients - 1)
        console.log(`[sse] disconnect clients=${sseClients}`)
      })

      // 保持连接：客户端断开时 onAbort 触发，handler 结束
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve)
      })
    }),
  )

  app.post('/api/invoke', async (c) => {
    const length = Number(c.req.header('content-length') ?? '0')
    if (length > MAX_BODY) return c.json({ error: '请求体过大' }, 413)
    let body: { channel?: unknown; payload?: unknown }
    try {
      body = await c.req.json<{ channel?: unknown; payload?: unknown }>()
    } catch {
      return c.json({ error: '请求体不是合法 JSON' }, 400)
    }
    const channel = typeof body.channel === 'string' ? body.channel : ''
    if (!channel) return c.json({ error: '缺少 channel' }, 400)
    const startedAt = Date.now()
    console.log(`[ipc] -> ${channel}`)
    try {
      const result = await invoke(channel, body.payload)
      console.log(`[ipc] <- ${channel} ${Date.now() - startedAt}ms`)
      return c.json({ result })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`[ipc] !! ${channel} ${Date.now() - startedAt}ms: ${message}`)
      return c.json({ error: message }, 500)
    }
  })

  app.get('/api/state', async (c) =>
    c.json({
      ...(await agent.describe()),
      sseClients,
      liveSubscribers: agent.liveSubscriberCount(),
    }),
  )

  // 前端未捕获错误上报到本地日志：用户不必打开 DevTools 也能定位卡死原因
  app.post('/api/client-log', async (c) => {
    const length = Number(c.req.header('content-length') ?? '0')
    if (length > 16 * 1024) return c.json({ error: '日志过大' }, 413)
    try {
      const body = await c.req.json<{ message?: unknown }>()
      const message = typeof body.message === 'string' ? body.message : ''
      console.log(`[client] ${message.slice(0, 4000).replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')}`)
      return c.json({ ok: true })
    } catch {
      return c.json({ error: '日志格式错误' }, 400)
    }
  })

  /**
   * 真实 Chrome 的只读实时画面（MJPEG）。
   * `<img src="/api/live/stream">` 即可直接显示，不需要额外的前端解码。
   */
  app.get('/api/live/stream', (c) => {
    const boundary = 'atpframe'
    let unsubscribe: (() => void) | null = null
    let closed = false
    const close = (): void => {
      if (closed) return
      closed = true
      unsubscribe?.()
      unsubscribe = null
      console.log(`[live] stream closed subscribers=${agent.liveSubscriberCount()}`)
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (frame: Buffer): void => {
          if (closed) return
          // 订阅者读得慢时丢帧，只保留最新画面
          if (controller.desiredSize !== null && controller.desiredSize <= 0) return
          try {
            controller.enqueue(
              Buffer.concat([
                Buffer.from(
                  `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`,
                ),
                frame,
                Buffer.from('\r\n'),
              ]),
            )
          } catch {
            close()
          }
        }
        try {
          unsubscribe = agent.subscribeLive(write)
          console.log(`[live] stream open subscribers=${agent.liveSubscriberCount()}`)
        } catch {
          close()
          controller.close()
        }
      },
      cancel() {
        close()
      },
    })
    c.req.raw.signal.addEventListener('abort', close, { once: true })
    return new Response(stream, {
      headers: {
        'content-type': `multipart/x-mixed-replace; boundary=${boundary}`,
        'cache-control': 'no-store, no-transform',
        'x-accel-buffering': 'no',
      },
    })
  })

  app.post('/api/navigate', async (c) => {
    const body = await c.req.json<{ url?: unknown }>().catch(() => ({}) as { url?: unknown })
    const target = typeof body.url === 'string' ? body.url : ''
    if (!target) return c.json({ error: '缺少 url' }, 400)
    return c.json({ url: await agent.navigate(target) })
  })

  app.post('/api/recording/start', (c) => {
    agent.startRecording()
    return c.json({ ok: true })
  })

  app.post('/api/recording/stop', async (c) => {
    const draft = await agent.stopRecording()
    return c.json({
      ok: true,
      stepCount: draft.steps.length,
      rawEvents: draft.rawEvents,
      startUrl: draft.startUrl,
    })
  })

  app.get('/api/cases', async (c) => c.json({ cases: await agent.allCases() }))

  app.post('/api/cases', async (c) => {
    const body = await c.req.json<{ name?: unknown }>().catch(() => ({}) as { name?: unknown })
    const name = typeof body.name === 'string' ? body.name : ''
    return c.json({ case: await agent.saveCase(name) })
  })

  app.post('/api/cases/:id/replay', async (c) => {
    const result = await agent.replayCase(c.req.param('id'))
    return c.json({ runId: result.runId, status: result.status })
  })

  app.post('/api/demo', async (c) => {
    await agent.runDemo()
    return c.json({ ok: true })
  })

  app.get('/ai-evidence/:sessionId/:file', async (c) => {
    const sessionId = c.req.param('sessionId')
    const file = c.req.param('file')
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId) || !/^[A-Za-z0-9._-]+$/.test(file)) {
      return c.json({ error: '证据不存在' }, 404)
    }
    const base = join(opts.dataDir, 'ai-evidence', sessionId)
    const target = safeJoin(base, file)
    if (!target) return c.json({ error: '证据不存在' }, 404)
    const info = await stat(target).catch(() => null)
    if (!info?.isFile()) return c.json({ error: '证据不存在' }, 404)
    return fileResponse(target, 'image/jpeg', 'no-store')
  })

  app.get('/evidence/:runId/:file', async (c) => {
    const runId = c.req.param('runId')
    const file = c.req.param('file')
    if (!/^[A-Za-z0-9_-]+$/.test(runId) || !/^[A-Za-z0-9._-]+$/.test(file)) {
      return c.json({ error: '证据不存在' }, 404)
    }
    const base = join(opts.dataDir, 'runs', runId)
    const target = safeJoin(base, file)
    if (!target) return c.json({ error: '证据不存在' }, 404)
    const info = await stat(target).catch(() => null)
    if (!info?.isFile()) return c.json({ error: '证据不存在' }, 404)
    return fileResponse(target, evidenceContent(target), 'no-store')
  })

  app.notFound((c) => c.json({ error: '接口不存在' }, 404))
  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500))

  let nodeServer: ReturnType<typeof serve> | null = null

  return {
    start() {
      return new Promise((resolve) => {
        nodeServer = serve(
          {
            fetch: app.fetch,
            hostname: '127.0.0.1',
            port: opts.port ?? 0,
          },
          (info) => {
            resolve({ port: info.port, origin: `http://127.0.0.1:${info.port}` })
          },
        )
      })
    },
    async close() {
      if (!nodeServer) return
      await new Promise<void>((resolve, reject) => {
        nodeServer?.close((err) => (err ? reject(err) : resolve()))
      })
      nodeServer = null
    },
  }
}
