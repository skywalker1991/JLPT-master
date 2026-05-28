// frontend/src/components/internalize/StatsBar.tsx
import { useState, useEffect } from 'react'
import { getInternalizeStats } from '../../services/api'
import type { InternalizeStats } from '../../types'

interface Props {
  todayKnow: number
  todayUnknown: number
}

type ViewMode = 'today' | 'total'

export default function StatsBar({ todayKnow, todayUnknown }: Props) {
  const [mode, setMode] = useState<ViewMode>('today')
  const [totalStats, setTotalStats] = useState<InternalizeStats | null>(null)

  useEffect(() => {
    getInternalizeStats().then(setTotalStats).catch(() => {})
  }, [])

  function toggle() {
    setMode(m => m === 'today' ? 'total' : 'today')
  }

  return (
    <button
      onClick={toggle}
      className="w-full flex items-center justify-between px-4 py-2 bg-surface/60 border-b border-border text-xs text-fg-subtle hover:bg-surface transition-colors"
    >
      {mode === 'today' ? (
        <>
          <span className="font-medium text-fg-subtle">今日</span>
          <span>
            <span className="text-green-600 font-semibold">{todayKnow} 会</span>
            <span className="mx-1">·</span>
            <span className="text-red-500 font-semibold">{todayUnknown} 不会</span>
            <span className="ml-1 text-fg-subtle/50">{todayKnow + todayUnknown} 张</span>
          </span>
          <span className="text-fg-subtle/40">总体 →</span>
        </>
      ) : (
        <>
          <span className="font-medium text-fg-subtle">总体</span>
          <span>
            {totalStats ? (
              <>
                <span className="text-green-600 font-semibold">掌握 {totalStats.total.mastery_pct}%</span>
                <span className="mx-1">·</span>
                <span className="text-fg-subtle">学习中 {totalStats.distribution.box1 + totalStats.distribution.box2}</span>
              </>
            ) : (
              <span className="text-fg-subtle/40">加载中...</span>
            )}
          </span>
          <span className="text-fg-subtle/40">← 今日</span>
        </>
      )}
    </button>
  )
}
