import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import type { SubtitleState } from './types'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

interface Props {
  subtitles: SubtitleState[]
  currentIdx: number
  selectedIdx: number | null
  onSelect: (idx: number) => void
}

export default function SubtitleList({ subtitles, currentIdx, selectedIdx, onSelect }: Props) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (currentIdx < 0) return
    itemRefs.current[currentIdx]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentIdx])

  return (
    <div className="card flex-1 min-h-0 overflow-y-auto py-2">
      {subtitles.length === 0 && (
        <div className="flex items-center justify-center h-full text-fg-subtle text-sm px-4 text-center">
          加载视频后字幕将在这里显示
        </div>
      )}
      {subtitles.map((s, i) => {
        const isCurrent  = currentIdx === i
        const isSelected = selectedIdx === i
        return (
          <button
            key={i}
            ref={el => { itemRefs.current[i] = el }}
            onClick={() => onSelect(i)}
            className={clsx(
              'w-full text-left px-3 py-2 transition-colors border-l-2 flex items-start gap-2',
              isSelected
                ? 'bg-accent/10 border-accent'
                : isCurrent
                  ? 'bg-yellow-50 border-yellow-400'
                  : 'border-transparent hover:bg-gray-50',
            )}
          >
            <span className="text-[10px] text-fg-subtle font-mono mt-0.5 shrink-0 w-9">
              {formatTime(s.entry.start)}
            </span>
            <div className="flex-1 min-w-0 leading-snug">
              <div className="flex items-center gap-1.5">
                <span className={clsx(
                  'text-sm',
                  isSelected || isCurrent ? 'text-fg font-medium' : 'text-fg-muted'
                )}>
                  {s.entry.text}
                </span>
                {s.isAnalyzing && <Loader2 className="w-3 h-3 animate-spin text-accent shrink-0" />}
                {s.analysis && !s.isAnalyzing && (
                  <span className="px-1 py-px text-[9px] font-medium rounded bg-green-100 text-green-700 leading-none shrink-0">
                    AI
                  </span>
                )}
              </div>
              {s.entry.zh && (
                <p className="text-[11px] text-fg-subtle mt-0.5 truncate">{s.entry.zh}</p>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
