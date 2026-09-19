import { useState } from 'react'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import type { SentenceAnalysis, PreprocessedSentence } from '../../types'
import { useSettings } from '../../context/SettingsContext'
import VocabChip from './VocabChip'
import GrammarCard from './GrammarCard'

interface Props {
  preprocessed: PreprocessedSentence | null
  analysis: SentenceAnalysis | null
}

function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse bg-gray-100 rounded-xl', className)} />
}

export default function AnalysisCard({ preprocessed, analysis }: Props) {
  const { settings } = useSettings()
  const levelFilter = settings.levelFilter

  const passes = (level: string | null): boolean => {
    if (levelFilter.length === 0) return true
    if (!level) return true
    return levelFilter.includes(level.toUpperCase())
  }

  const filteredVocab   = analysis?.vocab.filter(v => passes(v.jlpt_level ?? null)) ?? []
  const filteredGrammar = analysis?.grammar.filter(g => passes(g.jlpt_level ?? null)) ?? []
  const isFiltered      = levelFilter.length > 0

  // While practising recall (Japanese hidden) the word/grammar cards would
  // give the answer away, so keep them folded until asked for as a hint.
  // Resets per sentence (the card is remounted on sentence change).
  const [peek, setPeek] = useState(false)
  if (settings.hideJa && analysis && !peek) {
    return (
      <button
        type="button"
        onClick={() => setPeek(true)}
        className="w-full flex items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-fg-muted hover:text-fg hover:border-accent/40 transition-colors"
      >
        <span>单词 {filteredVocab.length} · 语法 {filteredGrammar.length} 已折叠，需要提示时点开</span>
        <ChevronDown className="w-4 h-4 shrink-0" />
      </button>
    )
  }

  return (
    <div className="space-y-6">

      {/* Vocab */}
      <div className="space-y-3">
        <p className="section-label">
          词汇{analysis
            ? ` · ${filteredVocab.length}${isFiltered && filteredVocab.length !== analysis.vocab.length ? `/${analysis.vocab.length}` : ''}`
            : ''}
        </p>
        {analysis ? (
          filteredVocab.length > 0
            ? <div className="flex flex-wrap gap-2">
                {filteredVocab.map((v, i) => <VocabChip key={`${v.surface}-${i}`} item={v} />)}
              </div>
            : <p className="text-sm text-fg-subtle">
                {isFiltered ? '当前等级筛选下无词汇' : '本句无特别词汇'}
              </p>
        ) : preprocessed ? (
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-16 w-20" />
            <Skeleton className="h-16 w-24" />
            <Skeleton className="h-16 w-16" />
            <Skeleton className="h-16 w-28" />
          </div>
        ) : null}
      </div>

      {/* Grammar */}
      <div className="space-y-3">
        <p className="section-label">
          语法{analysis
            ? ` · ${filteredGrammar.length}${isFiltered && filteredGrammar.length !== analysis.grammar.length ? `/${analysis.grammar.length}` : ''}`
            : ''}
        </p>
        {analysis ? (
          filteredGrammar.length > 0
            ? <div className="space-y-2">
                {filteredGrammar.map((g, i) => <GrammarCard key={`${g.pattern}-${i}`} item={g} />)}
              </div>
            : <p className="text-sm text-fg-subtle">
                {isFiltered ? '当前等级筛选下无语法点' : '本句无特别语法点'}
              </p>
        ) : preprocessed ? (
          <div className="space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12 w-5/6" />
          </div>
        ) : null}
      </div>

    </div>
  )
}
