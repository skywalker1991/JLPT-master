import { useEffect, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import type { ComparedPair, ItemAnalysis, KnowledgePoint } from '../../types'
import { getItemAnalysis } from '../../services/api'
import SavePair, { PairMark } from '../shared/SavePair'
import { RELATION_LABEL } from '../review/ReviewCard'

const WORD_TYPES = new Set(['vocab_fill', 'synonym', 'usage', 'kanji_reading', 'kanji_writing', 'word_formation', 'grammar_fill'])

/** Load an item's explanation (made once, shared, possibly still on its way). */
export function useItemAnalysis(itemId: string, enabled = true) {
  const [analysis, setAnalysis] = useState<ItemAnalysis | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let live = true
    setFailed(false)
    getItemAnalysis(itemId)
      .then(r => { if (live) setAnalysis((r.session_data as ItemAnalysis) ?? {}) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [itemId, enabled, attempt])
  return { analysis, failed, retry: () => setAttempt(a => a + 1) }
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
        <Loader2 className="w-4 h-4 animate-spin" />正在想差在哪……
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
    <div className="rounded-xl bg-accent-light px-5 py-4 flex flex-col gap-2.5">
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
