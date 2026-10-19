import type { AiTarget } from '@atp/model'
import { Button } from '@heroui/react'
import { Globe, Loader2, MonitorPlay } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const RETRY_MS = 3000
/** 暂停时把 <img> 的 src 换成 1x1，显式结束 MJPEG 请求；仅卸载元素浏览器不一定断开连接 */
const BLANK_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * 真实 Chrome 的只读实时镜像。
 *
 * Agent 用 CDP screencast 推 JPEG 帧，这里用 `<img>` 直接吃 MJPEG，
 * 不做输入转发：需要操作时用「在 Chrome 中接管」回到真实窗口。
 */
interface MirrorHighlight {
  target: AiTarget
  label: string
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

export function LiveMirror({
  onTakeover,
  highlight,
  paused = false,
}: {
  onTakeover: () => void
  highlight?: MirrorHighlight | null
  /** 弹层/下拉打开时暂停拉流，避免后台解码占用主线程 */
  paused?: boolean
}) {
  const [epoch, setEpoch] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
  const [imageBox, setImageBox] = useState<Box | null>(null)
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  const rootRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const active = visible && !paused
  const activeRef = useRef(active)

  // 多标签页 / 弹层遮挡时停止拉流：MJPEG 是长连接，后台标签也会解码每一帧
  useEffect(() => {
    const onChange = (): void => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  useEffect(() => {
    if (activeRef.current === active) return
    activeRef.current = active
    setStatus('connecting')
    // 隐藏时就换 epoch：恢复时首帧直接请求新地址，避免同一轮发两次流
    if (!active) setEpoch((value) => value + 1)
  }, [active])

  // 镜像按 object-contain 显示，记下图片实际占用的矩形，用来把页面坐标映射到舞台
  useLayoutEffect(() => {
    if (!active) {
      setImageBox(null)
      return
    }
    const update = (): void => {
      const root = rootRef.current
      const image = imageRef.current
      if (!root || !image) return
      if (!image.complete || image.naturalWidth === 0) return
      const imageRect = image.getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      setImageBox({
        left: imageRect.left - rootRect.left,
        top: imageRect.top - rootRect.top,
        width: imageRect.width,
        height: imageRect.height,
      })
    }
    update()
    const observer = new ResizeObserver(update)
    if (rootRef.current) observer.observe(rootRef.current)
    if (imageRef.current) observer.observe(imageRef.current)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [active])

  const highlightBox =
    active && highlight && imageBox && status === 'live'
      ? {
          left:
            imageBox.left +
            (highlight.target.rect.x / Math.max(1, highlight.target.viewport.width)) *
              imageBox.width,
          top:
            imageBox.top +
            (highlight.target.rect.y / Math.max(1, highlight.target.viewport.height)) *
              imageBox.height,
          width:
            (highlight.target.rect.width / Math.max(1, highlight.target.viewport.width)) *
            imageBox.width,
          height:
            (highlight.target.rect.height / Math.max(1, highlight.target.viewport.height)) *
            imageBox.height,
        }
      : null

  // 流断开后自动重连；每次重连换一个 URL 参数，确保 <img> 重新发起请求
  useEffect(() => {
    if (status !== 'error' || !active) return
    const timer = setTimeout(() => {
      setStatus('connecting')
      setEpoch((value) => value + 1)
    }, RETRY_MS)
    return () => clearTimeout(timer)
  }, [status, active])

  const labelBelow =
    highlightBox !== null && imageBox !== null && highlightBox.top - imageBox.top < 24

  return (
    <div ref={rootRef} className="absolute inset-0">
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <img
          ref={imageRef}
          src={active ? `/api/live/stream?v=${epoch}` : BLANK_IMAGE}
          alt="Chrome 实时画面"
          draggable={false}
          onLoad={() => {
            if (active) setStatus('live')
          }}
          onError={() => {
            if (active) setStatus('error')
          }}
          className={
            active
              ? `max-h-full max-w-full rounded-md border border-border bg-white object-contain shadow-[0_18px_50px_rgba(10,16,28,0.22)] transition-opacity ${
                  status === 'live' ? 'opacity-100' : 'opacity-0'
                }`
              : 'hidden'
          }
        />
        {!active && (
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-[11px] text-muted shadow-surface">
            {paused ? '弹层打开中，实时画面已暂停' : '标签页在后台，实时画面已暂停'}
          </div>
        )}
      </div>

      {active && status === 'connecting' && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[11.5px] text-muted shadow-surface">
            <Loader2 size={13} className="animate-spin text-accent" />
            正在连接实时画面…
          </span>
        </div>
      )}

      {active && status === 'error' && (
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

      {highlightBox && (
        <div
          className="pointer-events-none absolute z-20 rounded-[3px] outline-2 outline-offset-1 outline-accent transition-all duration-200"
          style={{
            left: highlightBox.left,
            top: highlightBox.top,
            width: highlightBox.width,
            height: highlightBox.height,
          }}
        >
          <span className="absolute inset-0 rounded-[3px] ring-4 ring-accent/20" />
          <span
            className={`absolute left-0 max-w-full truncate bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground shadow-surface ${
              labelBelow ? 'top-full mt-1 rounded-b' : 'bottom-full mb-1 rounded-t'
            }`}
          >
            {highlight?.label}
          </span>
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
