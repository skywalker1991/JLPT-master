import { useState } from 'react'
import { Volume2, Loader2 } from 'lucide-react'
import type { SentenceAnalysis, PreprocessedSentence } from '../../types'
import { useSettings } from '../../context/SettingsContext'
import TokenText from '../shared/TokenText'
import { speak } from '../../utils/speech'

interface Props {
  preprocessed: PreprocessedSentence
  analysis: SentenceAnalysis | null
}

function buildHighlightRanges(
  text: string,
  vocab: SentenceAnalysis['vocab'],
  levelFilter: string[],
): Array<[number, number]> {
  const passes = (level: string | null) =>
    levelFilter.length === 0 || !level || levelFilter.includes(level.toUpperCase())

  const filtered = vocab
    .filter(v => v.surface && passes(v.jlpt_level ?? null))
    .sort((a, b) => b.surface.length - a.surface.length)

  const ranges: Array<[number, number]> = []
  for (const v of filtered) {
    let idx = 0
    while (idx < text.length) {
      const pos = text.indexOf(v.surface, idx)
      if (pos === -1) break
      ranges.push([pos, pos + v.surface.length])
      idx = pos + v.surface.length
    }
  }
  return ranges
}

export default function SentenceCard({ preprocessed, analysis }: Props) {
  const { settings } = useSettings()
  const [speaking, setSpeaking] = useState(false)

  const handleSpeak = async () => {
    if (speaking) return
    setSpeaking(true)
    try { await speak(preprocessed.text) } finally { setSpeaking(false) }
  }

  const highlightRanges = analysis
    ? buildHighlightRanges(preprocessed.text, analysis.vocab, settings.levelFilter)
    : []

  return (
    <div className="rounded-xl bg-accent-light/40 border border-accent-border/50 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <TokenText
            tokens={preprocessed.tokens}
            fallback={preprocessed.text}
            className="text-xl font-semibold leading-loose tracking-wide"
            highlightRanges={highlightRanges.length > 0 ? highlightRanges : undefined}
          />
        </div>
        <button
          onClick={handleSpeak}
          disabled={speaking}
          className="btn-ghost p-1.5 rounded-lg shrink-0 text-fg-subtle hover:text-accent mt-1 disabled:opacity-40"
          title={speaking ? '朗读中…' : '朗读'}
        >
          {speaking
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Volume2 className="w-4 h-4" />
          }
        </button>
      </div>
      {analysis?.translation && (
        <p className="text-sm text-fg-muted border-t border-accent-border/40 pt-2 leading-relaxed">
          {analysis.translation}
        </p>
      )}
    </div>
  )
}
