import { useEffect, useState } from 'react'

/** 录制计时：格式化 mm:ss */
export function useElapsed(startedAt: number | null): string {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  if (!startedAt) return '00:00'
  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
