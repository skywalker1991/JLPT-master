import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { ComparedPair, ItemAnalysis, KnowledgePoint } from '../../types'
import { getItemAnalysis } from '../../services/api'
import SavePair, { PairMark } from '../shared/SavePair'
import { RELATION_LABEL } from '../review/ReviewCard'
import { Thinking } from '../shared/Motion'

const WORD_TYPES = new Set(['vocab_fill', 'synonym', 'usage', 'kanji_reading', 'kanji_writing', 'word_formation', 'grammar_fill'])

/** Options keyed by their number, even where the model wrote 「1. 示された…」. */
function normalize(a: ItemAnalysis): ItemAnalysis {
  const options = a.options_analysis?.map(o => {
    const m = /^\s*([1-4１-４])/.exec(String(o.option))
    return m ? { ...o, option: String('１２３４'.indexOf(m[1]) + 1 || m[1]) } : o
  })
  return options ? { ...a, options_analysis: options } : a
}

/** Load an item's explanation (made once, shared, possibly still on its way). */
export function useItemAnalysis(itemId: string, enabled = true) {
  const [analysis, setAnalysis] = useState<ItemAnalysis | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retrying = useRef(false)
  useEffect(() => {
    if (!enabled) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setFailed(false)
    // Still being made: ask again, less often as time goes on; give up after
    // about three minutes (the retry button starts over)
    const ask = (n: number) => {
      const again = n === 0 && retrying.current
      retrying.current = false
      getItemAnalysis(itemId, again)
        .then(r => {
          if (!live) return
          if (r.failed) { setFailed(true); return }
          if (r.pending) {
            if (n >= 40) setFailed(true)
            else timer = setTimeout(() => ask(n + 1), Math.min(2000 + n * 500, 6000))
            return
          }
          setAnalysis(normalize((r.session_data as ItemAnalysis) ?? {}))
        })
        .catch(() => { if (live) setFailed(true) })
    }
    ask(0)
    return () => { live = false; clearTimeout(timer) }
  }, [itemId, enabled, attempt])
  return { analysis, failed, retry: () => { retrying.current = true; setAttempt(a => a + 1) } }
}

/** Two options as a pair to keep, when both are words / grammar points the analysis named. */
export function pairOf(analysis: ItemAnalysis, a: string, b: string, difference: string, type: string | null | undefined): ComparedPair | null {
  const k = (o: string) => (analysis.knowledge ?? []).find((x: KnowledgePoint) => x.from === 'option' && x.option === o)
  const ka = k(a), kb = k(b)
  if (!ka || !kb || !type || !(type in RELATION_LABEL) || ka.key === kb.key) return null
  const side = (x: KnowledgePoint) => ({ kind: x.kind, key: x.key, reading: x.reading, meaning: x.meaning })
  return { a: side(ka), b: side(kb), type: type as ComparedPair['type'], difference }
}

/**
 * 差在哪: what tells the right option from the one chosen — or, when the
 * answer was right, from the one most easily mistaken for it. For word and
 * grammar questions the two can be kept as a relation.
 */
export default function DiffBox({ itemId, type, chosen, correct }: {
  itemId: string
  type: string
  chosen: string | null
  correct: string
}) {
  const { analysis, failed, retry } = useItemAnalysis(itemId)

  if (failed) {
    return (
      <div className="rounded-xl bg-accent-light px-5 py-4 flex items-center gap-3 text-sm text-fg-muted">
        解析没取到
        <button type="button" onClick={retry} className="btn h-8 text-xs border border-border bg-surface"><RotateCcw className="w-3.5 h-3.5" />重试</button>
      </div>
    )
  }
  if (!analysis) {
    return (
      <div className="rounded-xl bg-accent-light px-5 py-4 flex items-center gap-3 text-sm text-fg-muted">
        <Thinking className="w-5 h-5" />正在想差在哪……
      </div>
    )
  }

  const options = analysis.options_analysis ?? []
  const wrongPick = chosen && chosen !== correct ? chosen : null
  const other = wrongPick ?? options.find(o => o.most_confusable && !o.is_correct)?.option ?? null
  const row = options.find(o => o.option === other)
  const text = row?.vs_correct || row?.violation || row?.explanation || analysis.summary
  if (!text) return null
  const pair = other && WORD_TYPES.has(type) ? pairOf(analysis, correct, other, row?.vs_correct ?? '', row?.relation_type) : null

  return (
    <div className="rounded-xl bg-accent-light px-5 py-4 flex flex-col gap-2.5 animate-rise-in">
      <p className="flex items-center gap-2 text-sm">
        <PairMark className="text-fg" />
        <span className="font-semibold text-fg">差在哪</span>
        <span className="text-xs rounded-full bg-surface px-2 py-0.5 text-fg-muted">
          {wrongPick ? `你选的 ${wrongPick} vs 正解 ${correct}` : other ? `正解 ${correct} vs 最易混 ${other}` : '本题'}
          {row?.relation_type && RELATION_LABEL[row.relation_type] ? ` · ${RELATION_LABEL[row.relation_type]}` : ''}
        </span>
      </p>
      <p className="text-[0.9375rem] text-fg leading-relaxed">{text}</p>
      {pair && <SavePair pair={pair} source="jlpt" itemId={itemId} />}
    </div>
  )
}
