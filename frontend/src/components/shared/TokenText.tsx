import type { TokenInfo } from '../../types'

function posColor(pos: string): string {
  if (pos.startsWith('名詞'))   return 'text-sky-600'
  if (pos.startsWith('動詞'))   return 'text-rose-500'
  if (pos.startsWith('形容'))   return 'text-emerald-600'
  if (pos.startsWith('副詞'))   return 'text-violet-500'
  if (pos.startsWith('助動詞')) return 'text-rose-400'
  if (pos.startsWith('助詞'))   return 'text-zinc-400'
  if (pos.startsWith('記号'))   return 'text-zinc-300'
  return 'text-fg'
}

interface Props {
  tokens: TokenInfo[]
  fallback?: string
  className?: string
  /** AI vocab surface 在原文中的字符偏移范围，token 与任一范围重叠即高亮 */
  highlightRanges?: Array<[number, number]>
}

export default function TokenText({ tokens, fallback = '', className = '', highlightRanges }: Props) {
  if (tokens.length === 0) {
    return <span className={className}>{fallback}</span>
  }

  let charOffset = 0
  return (
    <span className={`flex flex-wrap gap-x-0.5 ${className}`}>
      {tokens.map((token, i) => {
        const start = charOffset
        const end   = charOffset + token.surface.length
        charOffset  = end

        const isHighlighted = highlightRanges
          ? highlightRanges.some(([s, e]) => start < e && end > s)
          : false
        const color = highlightRanges
          ? isHighlighted ? 'text-accent font-semibold' : 'text-fg'
          : posColor(token.pos)

        const hasReading = token.reading && token.reading !== token.surface
        return (
          <ruby key={i} className={color}>
            {token.surface}
            {hasReading && (
              <rt className="text-[0.55em] font-normal tracking-wide">{token.reading}</rt>
            )}
          </ruby>
        )
      })}
    </span>
  )
}
