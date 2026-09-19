import clsx from 'clsx'
import type { TokenInfo } from '../../types'
import { toChunks, isFunctionToken } from '../../utils/tokens'

interface Props {
  tokens: TokenInfo[]
  fallback?: string
  className?: string
  /** Hide chunks behind blocks (recall practice); tap a block to reveal it */
  hidden?: boolean
  revealed?: ReadonlySet<number>
  onReveal?: (chunkIndex: number) => void
  /** Per-chunk result of a typing check: true = right, false = wrong */
  marks?: boolean[] | null
}

/**
 * A sentence split into 文節 with furigana: content words in full ink,
 * particles / auxiliaries / punctuation de-emphasised, a gap between
 * chunks — so the sentence's skeleton (〜は … 〜を … 述語) reads at a glance.
 */
export default function TokenText({
  tokens, fallback = '', className = '', hidden = false, revealed, onReveal, marks,
}: Props) {
  if (tokens.length === 0) {
    if (hidden && !revealed?.has(0)) {
      return (
        <span className={className}>
          <MaskButton length={fallback.length} onClick={() => onReveal?.(0)} />
        </span>
      )
    }
    return <span className={className}>{fallback}</span>
  }

  return (
    <span className={`flex flex-wrap items-baseline gap-x-[0.75em] ${className}`}>
      {toChunks(tokens).map((chunk, i) => {
        const mark = marks?.[i]
        if (hidden && !marks && !revealed?.has(i)) {
          const length = chunk.reduce((n, t) => n + t.surface.length, 0)
          return <MaskButton key={i} length={length} onClick={() => onReveal?.(i)} />
        }
        return (
          <span
            key={i}
            className={clsx(
              'inline-flex items-baseline',
              mark === false && 'bg-danger-light rounded px-0.5 -mx-0.5',
            )}
          >
            {chunk.map((token, j) => {
              const fn = isFunctionToken(token)
              const hasReading = token.reading && token.reading !== token.surface
              return (
                <ruby
                  key={j}
                  className={clsx(
                    mark === true ? 'text-success-fg' : mark === false ? 'text-danger-fg' : fn ? 'text-fg-subtle' : 'text-fg',
                    fn && 'font-medium',
                  )}
                >
                  {token.surface}
                  {hasReading && (
                    <rt className="text-[0.5em] font-normal tracking-wide text-fg-muted">{token.reading}</rt>
                  )}
                </ruby>
              )
            })}
          </span>
        )
      })}
    </span>
  )
}

function MaskButton({ length, onClick }: { length: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="点击显示"
      aria-label="隐藏的文节，点击显示"
      className="inline-block h-[1.05em] rounded-md bg-border hover:bg-accent-border/70 transition-colors align-[-0.15em]"
      style={{ width: `${Math.max(1, length) * 1.05}em` }}
    />
  )
}
