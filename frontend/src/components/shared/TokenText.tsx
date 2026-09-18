import type { TokenInfo } from '../../types'
import { toChunks, isFunctionToken } from '../../utils/tokens'

interface Props {
  tokens: TokenInfo[]
  fallback?: string
  className?: string
}

/**
 * A sentence split into 文節 with furigana: content words in full ink,
 * particles / auxiliaries / punctuation de-emphasised, a gap between
 * chunks — so the sentence's skeleton (〜は … 〜を … 述語) reads at a glance.
 */
export default function TokenText({ tokens, fallback = '', className = '' }: Props) {
  if (tokens.length === 0) {
    return <span className={className}>{fallback}</span>
  }

  return (
    <span className={`flex flex-wrap items-baseline gap-x-[0.75em] ${className}`}>
      {toChunks(tokens).map((chunk, i) => (
        <span key={i} className="inline-flex items-baseline">
          {chunk.map((token, j) => {
            const fn = isFunctionToken(token)
            const hasReading = token.reading && token.reading !== token.surface
            return (
              <ruby key={j} className={fn ? 'text-fg-subtle font-medium' : 'text-fg'}>
                {token.surface}
                {hasReading && (
                  <rt className="text-[0.5em] font-normal tracking-wide text-fg-muted">{token.reading}</rt>
                )}
              </ruby>
            )
          })}
        </span>
      ))}
    </span>
  )
}
