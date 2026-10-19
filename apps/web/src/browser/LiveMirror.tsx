import { Button } from '@heroui/react'
import { Globe, Loader2, MonitorPlay } from 'lucide-react'
import { useEffect, useState } from 'react'

const RETRY_MS = 3000

/**
 * 真实 Chrome 的只读实时镜像。
 *
 * Agent 用 CDP screencast 推 JPEG 帧，这里用 `<img>` 直接吃 MJPEG，
 * 不做输入转发：需要操作时用「在 Chrome 中接管」回到真实窗口。
 */
export function LiveMirror({ onTakeover }: { onTakeover: () => void }) {
  const [epoch, setEpoch] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')

  // 流断开后自动重连；每次重连换一个 URL 参数，确保 <img> 重新发起请求
  useEffect(() => {
    if (status !== 'error') return
    const timer = setTimeout(() => {
      setStatus('connecting')
      setEpoch((value) => value + 1)
    }, RETRY_MS)
    return () => clearTimeout(timer)
  }, [status])

  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <img
          key={epoch}
          src={`/api/live/stream?v=${epoch}`}
          alt="Chrome 实时画面"
          draggable={false}
          onLoad={() => setStatus('live')}
          onError={() => setStatus('error')}
          className={`max-h-full max-w-full rounded-md border border-border bg-white object-contain shadow-[0_18px_50px_rgba(10,16,28,0.22)] transition-opacity ${
            status === 'live' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>

      {status === 'connecting' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[11.5px] text-muted shadow-surface">
            <Loader2 size={13} className="animate-spin text-accent" />
            正在连接实时画面…
          </span>
        </div>
      )}

      {status === 'error' && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-sm text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-xl border border-border bg-surface-secondary text-muted">
              <Globe size={22} />
            </div>
            <h3 className="mt-3 text-sm font-semibold">实时画面暂不可用</h3>
            <p className="mt-1 text-xs leading-5 text-muted">
              会每 {RETRY_MS / 1000} 秒自动重连；期间仍可在真实 Chrome 窗口中操作。
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button size="sm" variant="secondary" onPress={onTakeover}>
                <MonitorPlay size={13} />
                聚焦 Chrome 窗口
              </Button>
            </div>
          </div>
        </div>
      )}

      {status === 'live' && (
        <>
          <span className="pointer-events-none absolute left-5 top-5 rounded bg-black/60 px-2 py-1 text-[10px] font-medium text-white backdrop-blur">
            实时镜像 · 只读
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-5 top-5 shadow-surface"
            onPress={onTakeover}
          >
            <MonitorPlay size={13} />在 Chrome 中接管
          </Button>
        </>
      )}
    </div>
  )
}
