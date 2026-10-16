import { useEffect, useRef } from 'react'

/**
 * T5 最小三栏占位：中栏只负责测量自身 rect 并上报（main 据此 setBounds
 * 受控浏览器视图）。完整 UI 在 T7-T10 逐步替换。
 */
export function App() {
  const centerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = centerRef.current
    if (!el) return
    const report = () => {
      const r = el.getBoundingClientRect()
      void window.atp.invoke('view:bounds-set', {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <aside style={{ width: 260, borderRight: '1px solid #e0e0e0', padding: 12, color: '#666' }}>
        项目 / 模块树 / 用例（T7）
      </aside>
      <main ref={centerRef} style={{ flex: 1, position: 'relative', background: '#fafafa' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: '#999',
          }}
        >
          受控浏览器区域（T6 挂载）
        </div>
      </main>
      <aside style={{ width: 340, borderLeft: '1px solid #e0e0e0', padding: 12, color: '#666' }}>
        步骤 / 元素 / 报告（T7-T10）
      </aside>
    </div>
  )
}
