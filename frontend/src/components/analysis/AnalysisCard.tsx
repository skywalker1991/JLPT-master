import clsx from 'clsx'
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
