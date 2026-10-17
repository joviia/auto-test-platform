import { useEffect } from 'react'
import { useUiStore } from '../state/ui-store'

/**
 * 弹层打开时收起原生受控浏览器视图。
 * WebContentsView 是原生子视图，层级永远高于 renderer，
 * 不收起会把居中弹窗、遮罩、阴影全部盖住。
 */
export function useOverlayGuard(open: boolean): void {
  const pushOverlay = useUiStore((s) => s.pushOverlay)
  const popOverlay = useUiStore((s) => s.popOverlay)

  useEffect(() => {
    if (!open) return
    pushOverlay()
    return () => popOverlay()
  }, [open, pushOverlay, popOverlay])
}
