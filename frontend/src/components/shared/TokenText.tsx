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
    const blurred = hidden && !revealed?.has(0)
    return (
      <span className={className}>
        <span
          {...(blurred ? revealProps(() => onReveal?.(0)) : {})}
          className={clsx(BLUR_TRANSITION, blurred && BLURRED)}
        >
          {fallback}
        </span>
      </span>
    )
  }

  return (
    <span className={`flex flex-wrap items-baseline gap-x-[0.75em] ${className}`}>
      {toChunks(tokens).map((chunk, i) => {
        const mark = marks?.[i]
        // Hidden chunks are the same element, just blurred, so revealing
        // animates in place instead of re-laying out the line.
        const blurred = hidden && !marks && !revealed?.has(i)
        return (
          <span
            key={i}
            {...(blurred ? revealProps(() => onReveal?.(i)) : {})}
            className={clsx(
              'inline-flex items-baseline',
              BLUR_TRANSITION,
              blurred && BLURRED,
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

const BLUR_TRANSITION = 'transition-[filter,opacity] duration-500 ease-out motion-reduce:transition-none'
const BLURRED = 'blur-[0.4em] opacity-60 cursor-pointer select-none'

/** Make a blurred chunk tappable / keyboard-activatable to reveal it. */
function revealProps(reveal: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    title: '点击显示',
    'aria-label': '隐藏的文节，点击显示',
    onClick: reveal,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal() }
    },
  }
}
