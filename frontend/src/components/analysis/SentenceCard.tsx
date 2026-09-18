import { useState } from 'react'
import { Volume2, Loader2 } from 'lucide-react'
import type { SentenceAnalysis, PreprocessedSentence } from '../../types'
import TokenText from '../shared/TokenText'
import { speak } from '../../utils/speech'

interface Props {
  preprocessed: PreprocessedSentence
  analysis: SentenceAnalysis | null
}

export default function SentenceCard({ preprocessed, analysis }: Props) {
  const [speaking, setSpeaking] = useState(false)

  const handleSpeak = async () => {
    if (speaking) return
    setSpeaking(true)
    try { await speak(preprocessed.text) } finally { setSpeaking(false) }
  }

  return (
    <div className="rounded-xl bg-accent-light/40 border border-accent-border/50 px-4 py-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <TokenText
            tokens={preprocessed.tokens}
            fallback={preprocessed.text}
            className="text-lg md:text-xl font-semibold leading-loose tracking-wide"
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
