import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import type { SentenceState } from '../../hooks/useAnalysis'

interface Props {
  sentences: SentenceState[]
  selectedIndex: number | null
  isStreaming: boolean
  onSelect: (index: number) => void
}

const MAX_DOTS = 10  // beyond this, dots get too small to read or tap

export default function SentenceList({ sentences, selectedIndex, isStreaming, onSelect }: Props) {
  if (sentences.length === 0 && !isStreaming) return null

  const current = selectedIndex ?? 0
  const selectable = (s: SentenceState) => s.preprocessed.text.trim().length > 0

  return (
    <>
      {/* Phone: dots, or a counter + progress bar for long texts; swipe to move */}
      <div className="md:hidden flex items-center justify-center h-10 px-4">
        {sentences.length <= MAX_DOTS ? (
          <div className="flex items-center">
            {sentences.map((s, i) => {
              const selected = i === current
              return (
                <button
                  key={i}
                  disabled={!selectable(s)}
                  onClick={() => onSelect(i)}
                  aria-label={`第 ${i + 1} 句`}
                  aria-current={selected ? 'true' : undefined}
                  className="p-1.5 disabled:opacity-30"
                >
                  <span
                    className={clsx(
                      'block h-2 rounded-full transition-all duration-200',
                      selected ? 'w-5 bg-accent' : 'w-2',
                      !selected && s.analysis && 'bg-accent-border',
                      !selected && !s.analysis && 'ring-[1.5px] ring-inset ring-fg-subtle animate-pulse',
                    )}
                  />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex items-center gap-3 w-full">
            <span className="text-xs font-semibold text-fg-muted tabular-nums min-w-[3.25rem]">
              <span className="text-fg">{current + 1}</span> / {sentences.length}
            </span>
            <div className="flex-1 h-1 rounded-full bg-border overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${((current + 1) / sentences.length) * 100}%` }}
              />
            </div>
          </div>
        )}
        {isStreaming && <Loader2 className="w-3.5 h-3.5 ml-2 shrink-0 animate-spin text-accent/70" />}
      </div>

      {/* Desktop: numbered buttons */}
      <div className="hidden md:flex items-center gap-1.5 px-4 py-2.5 flex-wrap">
        {sentences.map((s, i) => {
          const analyzed  = s.analysis !== null
          const hasTokens = s.preprocessed.tokens.length > 0
          const selected  = selectedIndex === i
          const clickable = selectable(s)

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
    </>
  )
}
