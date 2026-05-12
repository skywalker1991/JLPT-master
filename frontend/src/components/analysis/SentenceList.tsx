import clsx from 'clsx'
import type { SentenceState } from '../../hooks/useAnalysis'

interface Props {
  sentences: SentenceState[]
  selectedIndex: number | null
  isStreaming: boolean
  onSelect: (index: number) => void
}

export default function SentenceList({ sentences, selectedIndex, isStreaming, onSelect }: Props) {
  if (sentences.length === 0 && !isStreaming) return null

  return (
    <div className="flex items-center gap-1.5 px-4 py-2.5 flex-wrap">
      {sentences.map((s, i) => {
        const analyzed  = s.analysis !== null
        const hasTokens = s.preprocessed.tokens.length > 0
        const selected  = selectedIndex === i
        const clickable = s.preprocessed.text.trim().length > 0

        return (
          <button
            key={i}
            disabled={!clickable}
            onClick={() => clickable && onSelect(i)}
            className={clsx(
              'w-7 h-7 rounded-full text-xs font-semibold transition-all duration-150 shrink-0',
              selected && 'bg-accent text-white shadow-sm',
              !selected && analyzed  && 'bg-accent-light text-accent-fg ring-1 ring-accent-border hover:bg-accent/20',
              !selected && !analyzed && hasTokens  && 'border-2 border-accent/40 text-fg-muted animate-pulse',
              !selected && !analyzed && !hasTokens && 'border-2 border-border text-fg-subtle hover:border-accent/40',
              !clickable && 'opacity-30 cursor-default',
            )}
          >
            {i + 1}
          </button>
        )
      })}

      {isStreaming && (
        <span className="flex gap-0.5 items-center ml-1">
          <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-accent/60 animate-bounce [animation-delay:300ms]" />
        </span>
      )}
    </div>
  )
}
