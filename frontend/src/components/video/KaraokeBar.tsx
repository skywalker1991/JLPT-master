import { useState, useCallback } from 'react'
import clsx from 'clsx'
import type { TokenInfo } from '../../types'
import type { TokenTiming } from './types'
import TokenPopover from './TokenPopover'

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

function needsReading(token: TokenInfo): boolean {
  return !!token.reading && token.reading !== token.surface
}

interface PopoverState {
  token: TokenInfo
  x: number
  y: number
}

interface KaraokeTokenProps {
  tt: TokenTiming
  currentTime: number
  onClickToken: (token: TokenInfo, x: number, y: number) => void
}

function KaraokeToken({ tt, currentTime, onClickToken }: KaraokeTokenProps) {
  const active  = currentTime >= tt.start && currentTime < tt.end
  const past    = currentTime >= tt.end
  const reading = needsReading(tt.token) ? tt.token.reading : null

  const handleClick = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    onClickToken(tt.token, rect.left + rect.width / 2, rect.top)
  }

  return (
    <ruby
      onClick={handleClick}
      className={clsx(
        'transition-colors duration-100 cursor-pointer hover:opacity-70',
        active ? 'text-accent font-bold'
          : past ? posColor(tt.token.pos)
          : 'text-fg/30',
      )}
    >
      {tt.token.surface}
      {reading && <rt className="text-[0.45em] font-normal tracking-wide">{reading}</rt>}
    </ruby>
  )
}

interface Props {
  timings: TokenTiming[]
  text: string
  zh?: string
  en?: string
  currentTime: number
}

export default function KaraokeBar({ timings, text, zh, en, currentTime }: Props) {
  const [popover, setPopover] = useState<PopoverState | null>(null)

  const handleClickToken = useCallback((token: TokenInfo, x: number, y: number) => {
    setPopover(prev =>
      prev?.token === token ? null : { token, x, y }
    )
  }, [])

  const handleClose = useCallback(() => setPopover(null), [])

  return (
    <div className="card px-6 py-4 flex flex-col gap-2">
      <div className="flex items-center min-h-[2.5rem]">
        {text ? (
          timings.length > 0 ? (
            <span className="flex flex-wrap gap-x-1 text-2xl leading-loose">
              {timings.map((tt, i) => (
                <KaraokeToken
                  key={i}
                  tt={tt}
                  currentTime={currentTime}
                  onClickToken={handleClickToken}
                />
              ))}
            </span>
          ) : (
            <span className="text-2xl text-fg leading-loose">{text}</span>
          )
        ) : (
          <span className="text-sm text-fg-subtle">—</span>
        )}
      </div>

      {(zh || en) && (
        <div className="flex flex-col gap-0.5 border-t border-border/50 pt-2">
          {zh && <p className="text-sm text-fg-muted leading-snug">{zh}</p>}
          {en && <p className="text-xs text-fg-subtle leading-snug">{en}</p>}
        </div>
      )}

      {popover && (
        <TokenPopover
          token={popover.token}
          anchorX={popover.x}
          anchorY={popover.y}
          onClose={handleClose}
        />
      )}
    </div>
  )
}
