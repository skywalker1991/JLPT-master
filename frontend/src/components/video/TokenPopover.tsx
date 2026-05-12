import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'
import type { TokenInfo } from '../../types'
import { lookupWord, type DictEntry } from '../../services/api'

const SKIP_POS = new Set(['助詞', '助動詞', '記号', 'フィラー', '感動詞'])

function shouldLookup(pos: string): boolean {
  return !SKIP_POS.has(pos)
}

interface Props {
  token: TokenInfo
  anchorX: number  // center of clicked token (fixed coords)
  anchorY: number  // top of clicked token (fixed coords)
  onClose: () => void
}

export default function TokenPopover({ token, anchorX, anchorY, onClose }: Props) {
  const [entry, setEntry]   = useState<DictEntry | null | 'loading'>('loading')
  const popoverRef          = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!shouldLookup(token.pos)) { setEntry(null); return }
    setEntry('loading')
    const word = token.base && token.base !== '*' ? token.base : token.surface
    lookupWord(word).then(result => setEntry(result))
  }, [token.base, token.surface, token.pos])

  // Dismiss on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const POPOVER_W = 260
  const left = Math.min(
    Math.max(anchorX - POPOVER_W / 2, 8),
    window.innerWidth - POPOVER_W - 8,
  )

  return createPortal(
    <div
      ref={popoverRef}
      style={{ position: 'fixed', left, top: anchorY - 8, transform: 'translateY(-100%)', zIndex: 9999, width: POPOVER_W }}
      className="card shadow-xl p-3 flex flex-col gap-2"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="text-lg font-bold text-fg">{token.surface}</span>
          {token.reading && token.reading !== token.surface && (
            <span className="ml-2 text-sm text-fg-subtle">{token.reading}</span>
          )}
        </div>
        <button onClick={onClose} className="btn-ghost h-6 w-6 p-0 justify-center shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      {entry === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-fg-subtle">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />查询中…
        </div>
      )}

      {entry === null && (
        <p className="text-xs text-fg-subtle">未找到词典释义</p>
      )}

      {entry && entry !== 'loading' && (
        <>
          {entry.kanji_forms.length > 0 && entry.kanji_forms[0] !== token.surface && (
            <p className="text-xs text-fg-subtle">词典形：{entry.kanji_forms[0]}</p>
          )}
          <ol className="flex flex-col gap-1.5 list-decimal list-inside">
            {entry.senses.slice(0, 3).map((s, i) => (
              <li key={i} className="text-sm text-fg leading-snug">
                {s.pos.length > 0 && (
                  <span className="text-[10px] text-accent font-medium mr-1">
                    {s.pos[0].replace(/\[.+?\]/g, '').trim()}
                  </span>
                )}
                {s.gloss.slice(0, 3).join('；')}
              </li>
            ))}
          </ol>
          {entry.jlpt_level && (
            <span className={`badge badge-${entry.jlpt_level.toLowerCase()} self-start`}>
              {entry.jlpt_level}
            </span>
          )}
        </>
      )}
    </div>,
    document.body,
  )
}
