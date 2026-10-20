import type { DesignMatrix } from '@atp/model'
import { toast } from '@heroui/react'
import { useCallback, useEffect, useRef } from 'react'
import { useUiStore } from '../state/ui-store'

/**
 * 测试设计矩阵的自动持久化。
 *
 * - 手动编辑后 400ms 防抖写库，带 baseRevision 乐观并发校验；
 * - AI 直接写库后由 Agent 推送新矩阵，UI 用 adoptDesignMatrix 认领，避免再写一次；
 * - 保存期间继续编辑不会丢：保存完成时若矩阵已变化，会再排一次保存。
 */

let lastPersistedRevision = -1
let adoptedMatrix: DesignMatrix | null = null
let flush: (() => Promise<void>) | null = null

/** AI / 分析已经写库的矩阵：下一次 effect 直接认领，不重复保存 */
export function adoptDesignMatrix(matrix: DesignMatrix): void {
  adoptedMatrix = matrix
  lastPersistedRevision = Math.max(lastPersistedRevision, matrix.revision)
}

/** 收到 design-updated 时记录 revision，供冲突判断与去重 */
export function noteDesignPersisted(revision: number): void {
  lastPersistedRevision = Math.max(lastPersistedRevision, revision)
}

/** 发送 AI 消息前把待保存的手动编辑立即写库，保证 AI 读到最新矩阵 */
export async function flushDesignSave(): Promise<void> {
  await flush?.()
}

export function useDesignPersistence(): void {
  const design = useUiStore((s) => s.design)
  const savedRef = useRef<DesignMatrix | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savingRef = useRef(false)
  const scheduleRef = useRef<() => void>(() => undefined)

  const saveNow = useCallback(async (): Promise<void> => {
    if (savingRef.current) return
    const matrix = useUiStore.getState().design
    if (!matrix || matrix === savedRef.current) return
    savingRef.current = true
    useUiStore.getState().setDesignSaveState('saving')
    try {
      const next: DesignMatrix = await window.atp.invoke('design:update', {
        matrix,
        baseRevision: matrix.revision,
      })
      const unchanged = useUiStore.getState().design === matrix
      lastPersistedRevision = Math.max(lastPersistedRevision, next.revision)
      // revision 必须同步，哪怕保存期间又改过；内容是否已保存由引用判断
      useUiStore.getState().setDesignPersisted(next.revision, next.sessionId)
      if (unchanged) {
        savedRef.current = useUiStore.getState().design
        useUiStore.getState().setDesignSaveState('saved')
        setTimeout(() => {
          if (useUiStore.getState().designSaveState === 'saved') {
            useUiStore.getState().setDesignSaveState('idle')
          }
        }, 1500)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '设计会话保存失败'
      if (message.includes('设计会话已更新')) {
        useUiStore.getState().setDesignSaveState('conflict')
      } else {
        useUiStore.getState().setDesignSaveState('idle')
        toast.danger(message)
      }
    } finally {
      savingRef.current = false
      if (useUiStore.getState().design !== savedRef.current) scheduleRef.current()
    }
  }, [])

  const schedule = useCallback((): void => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void saveNow()
    }, 400)
  }, [saveNow])

  scheduleRef.current = schedule

  useEffect(() => {
    if (!design) {
      savedRef.current = null
      return
    }
    if (savedRef.current === null) {
      // 首次加载 / 新分析：矩阵已由 Agent 写库
      savedRef.current = design
      return
    }
    if (design === savedRef.current) return
    // 新分析出来的会话：Agent 已经写库，直接认领
    if (
      design.sessionId &&
      savedRef.current?.sessionId &&
      design.sessionId !== savedRef.current.sessionId
    ) {
      savedRef.current = design
      return
    }
    if (design === adoptedMatrix) {
      adoptedMatrix = null
      savedRef.current = design
      return
    }
    schedule()
  }, [design, schedule])

  useEffect(() => {
    flush = async () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      await saveNow()
    }
    return () => {
      flush = null
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [saveNow])
}
