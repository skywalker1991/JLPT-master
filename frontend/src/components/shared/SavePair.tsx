import { useState } from 'react'
import clsx from 'clsx'
import { Check, Loader2 } from 'lucide-react'
import type { ComparedPair } from '../../types'
import { savePair } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { RELATION_LABEL } from '../review/ReviewCard'

/** The pair glyph: two entries joined by an arc. */
export function PairMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 14" className={clsx('w-7 h-3.5 shrink-0', className)} fill="none" aria-hidden="true">
      <path d="M5 11 C 10 2, 22 2, 27 11" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="4" cy="11" r="2.4" fill="currentColor" />
      <circle cx="28" cy="11" r="2.4" fill="currentColor" />
    </svg>
  )
}

/**
 * 「存成关系」 under a 差在哪: keeps the two entries as a pair in the library
 * (adding either one that isn't kept yet), with the difference as its note.
 */
export default function SavePair({ pair, source, analysisId, sentenceIndex, itemId }: {
  pair: ComparedPair
  source: 'ask' | 'jlpt'
  analysisId?: string | null
  sentenceIndex?: number | null
  itemId?: string | null
}) {
  const { toast } = useToast()
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')

  const save = async () => {
    if (state !== 'idle') return
    setState('saving')
    try {
      await savePair({ ...pair, source, analysis_id: analysisId, sentence_index: sentenceIndex, item_id: itemId })
      setState('saved')
      toast(`已存成关系：${pair.a.key} ⌒ ${pair.b.key}`, 'success')
    } catch {
      setState('idle')
      toast('没存上，请再试一次', 'error')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <button type="button" onClick={() => void save()} disabled={state !== 'idle'}
              className={clsx('inline-flex items-center gap-2 h-9 pl-3 pr-3.5 rounded-full border text-sm',
                state === 'saved' ? 'border-success/40 text-success-fg' : 'border-border bg-surface text-fg hover:border-fg-subtle')}>
        {state === 'saving' ? <Loader2 className="w-4 h-4 animate-spin" /> : state === 'saved' ? <Check className="w-4 h-4" /> : <PairMark />}
        {state === 'saved' ? '已存成关系' : '存成关系'}：
        <span className="font-jp">{pair.a.key}</span><span className="text-fg-subtle">⌒</span><span className="font-jp">{pair.b.key}</span>
        <span className="text-xs rounded-full bg-accent-light px-2 py-0.5 text-fg-muted">{RELATION_LABEL[pair.type] ?? pair.type}</span>
      </button>
      <span className="text-xs text-fg-subtle">两个都会入库，这句「差在哪」就是关系的说明</span>
    </div>
  )
}
