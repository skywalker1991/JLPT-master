import { useState } from 'react'
import clsx from 'clsx'
import { Loader2, RotateCcw, Volume2 } from 'lucide-react'
import type { SentenceAnalysis } from '../../types'
import type { MarkLevel } from '../../context/SettingsContext'
import { grammarKey, isShown, vocabKey, type Known, type Mark } from '../../utils/marks'
import { speak } from '../../utils/speech'
import ItemRow from './ItemRow'
import { Thinking } from '../shared/Motion'

interface Props {
  index: number
  text: string
  analysis: SentenceAnalysis | null
  streaming: boolean
  threshold: MarkLevel
  known: Known
  remember: (type: 'vocab' | 'grammar', key: string, atomId: string) => void
  picked: Mark['item'] | null
  retrying: boolean
  onRetry: () => void
  /** Phone: words and grammar as two tabs instead of one column */
  tabs?: boolean
}

/**
 * The selected sentence: its translation, then its words and grammar as
 * one-line cards. Items below the chosen level fold away behind one line,
 * unless they are already in the library.
 */
export default function SentencePanel({
  index, text, analysis, streaming, threshold, known, remember, picked, retrying, onRetry, tabs,
}: Props) {
  const [showAll, setShowAll] = useState(false)
  const [tab, setTab] = useState<'vocab' | 'grammar'>(picked?.type ?? 'vocab')
  const [speaking, setSpeaking] = useState(false)

  const vocab = (analysis?.vocab ?? []).map((item, i) => ({ item, i }))
  const grammar = (analysis?.grammar ?? []).map((item, i) => ({ item, i }))
  const shownVocab = vocab.filter(v => showAll || isShown(v.item, 'vocab', threshold, known))
  const foldedVocab = vocab.filter(v => !isShown(v.item, 'vocab', threshold, known))
  const shownGrammar = grammar.filter(g => showAll || isShown(g.item, 'grammar', threshold, known))
  const foldedGrammar = grammar.filter(g => !isShown(g.item, 'grammar', threshold, known))
  const levelLabel = threshold === 'all' ? '' : `${threshold} 以上`

  const say = async () => {
    if (speaking) return
    setSpeaking(true)
    try { await speak(text) } finally { setSpeaking(false) }
  }

  const vocabList = (
    <section className="flex flex-col gap-2">
      {!tabs && (
        <h3 className="text-sm font-semibold text-fg">
          词汇{levelLabel && <span className="ml-2 font-normal text-xs text-fg-subtle">
            {levelLabel} {vocab.length - foldedVocab.length} 个
            {foldedVocab.length > 0 && !showAll && ` · 其余 ${foldedVocab.length} 个已折叠`}
          </span>}
        </h3>
      )}
      {shownVocab.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {shownVocab.map(({ item, i }) => (
            <ItemRow key={`v${i}`} kind="vocab" item={item}
                     atomId={known.vocab[vocabKey(item)]}
                     onAdded={(k, id) => remember('vocab', k, id)}
                     picked={picked?.type === 'vocab' && picked.index === i} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-subtle">{foldedVocab.length > 0 ? `没有 ${levelLabel}的生词` : '这句没有要特别注意的词'}</p>
      )}
      {foldedVocab.length > 0 && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="self-start text-sm text-fg-muted hover:text-fg py-1">
          展开其余 {foldedVocab.length} 个（<span className="font-jp">{foldedVocab.map(v => vocabKey(v.item)).join(' · ')}</span>）
        </button>
      )}
    </section>
  )

  const grammarList = (
    <section className="flex flex-col gap-2">
      {!tabs && <h3 className="text-sm font-semibold text-fg">语法</h3>}
      {shownGrammar.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {shownGrammar.map(({ item, i }) => (
            <ItemRow key={`g${i}`} kind="grammar" item={item}
                     atomId={known.grammar[grammarKey(item)]}
                     onAdded={(k, id) => remember('grammar', k, id)}
                     picked={picked?.type === 'grammar' && picked.index === i} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-subtle">这句没有要特别注意的语法</p>
      )}
      {foldedGrammar.length > 0 && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="self-start text-sm text-fg-muted hover:text-fg py-1">
          展开其余 {foldedGrammar.length} 个
        </button>
      )}
    </section>
  )

  return (
    <div className="flex flex-col gap-5 animate-rise-in">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-fg-subtle">
          {!tabs && <span>第 {index + 1} 句</span>}
          <button type="button" onClick={say} disabled={speaking} aria-label="朗读这句"
                  className="ml-auto p-1.5 rounded-lg hover:bg-accent-light hover:text-fg disabled:opacity-50">
            {speaking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
        <p className="font-jp text-xl leading-[1.8] text-fg">{text}</p>
        {analysis?.translation && <p className="text-sm text-fg-muted leading-relaxed">{analysis.translation}</p>}
      </div>

      {analysis?.failed ? (
        <div className="rounded-xl border border-dashed border-danger/40 p-5 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-fg-muted">这句没分析出来，其他句子不受影响</p>
          <button type="button" onClick={onRetry} disabled={retrying} className="btn h-9 border border-border text-fg">
            {retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}重试这一句
          </button>
        </div>
      ) : !analysis ? (
        <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center gap-3 text-center">
          <Thinking className="w-8 h-8" />
          <p className="text-sm text-fg-muted">{streaming ? '这句还在分析，先读读别的句子' : '这句没有结果'}</p>
        </div>
      ) : tabs ? (
        <div className="flex flex-col gap-3">
          <div role="tablist" className="flex gap-1 border-b border-border">
            {(['vocab', 'grammar'] as const).map(t => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                      className={clsx('px-3 py-2 text-sm -mb-px border-b-2',
                        tab === t ? 'border-fg text-fg font-semibold' : 'border-transparent text-fg-muted')}>
                {t === 'vocab' ? `词汇 ${vocab.length - foldedVocab.length}` : `语法 ${grammar.length - foldedGrammar.length}`}
              </button>
            ))}
          </div>
          {tab === 'vocab' ? vocabList : grammarList}
        </div>
      ) : (
        <>
          {vocabList}
          {grammarList}
        </>
      )}
    </div>
  )
}
