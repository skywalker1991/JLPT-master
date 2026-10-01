import { Fragment } from 'react'
import clsx from 'clsx'
import { RotateCcw, Loader2 } from 'lucide-react'
import type { SentenceAnalysis, TokenInfo } from '../../types'
import type { MarkLevel } from '../../context/SettingsContext'
import { marksFor, type Known, type Mark, type MarkKind } from '../../utils/marks'

export interface ReaderSentence {
  text: string
  tokens: TokenInfo[]
  /** null while it is still being analysed */
  analysis: SentenceAnalysis | null
}

interface Props {
  sentences: ReaderSentence[]
  selectedIndex: number | null
  onSelect: (index: number) => void
  /** A marked word / grammar point was tapped: select its sentence and point at the item */
  onPickItem?: (sentence: number, item: Mark['item']) => void
  threshold: MarkLevel
  known: Known
  furigana: boolean
  translations: boolean
  /** Analysis still running: unanalysed sentences are greyed, not failed */
  streaming: boolean
  retrying?: number | null
  onRetry?: (index: number) => void
}

const MARK_CLASS: Record<MarkKind, string> = {
  new: 'underline decoration-accent decoration-[3px] underline-offset-[0.32em] animate-mark-in transition-[text-decoration-color]',
  known: 'underline decoration-fg-subtle/70 decoration-1 underline-offset-[0.32em] animate-mark-in transition-[text-decoration-color]',
  grammar: 'underline decoration-dashed decoration-fg-muted decoration-1 underline-offset-[0.32em] animate-mark-in',
}

const KANJI = /[一-鿿㐀-䶿々〆]/

/**
 * A passage set as continuous prose, the way it was written, rather than a
 * list of sentence cards. Sentences are picked by tapping; the lines under
 * words say which are gaps (thick), already yours (thin) or grammar (dashed).
 *
 * Shared by 语料分析 and the JLPT reading questions.
 */
export default function PassageReader({
  sentences, selectedIndex, onSelect, onPickItem, threshold, known,
  furigana, translations, streaming, retrying, onRetry,
}: Props) {
  const Wrap = translations ? 'div' : 'span'
  return (
    <div className={clsx(
      'font-jp text-fg text-[1.1875rem] md:text-[1.3125rem]',
      furigana ? 'leading-[2.6]' : 'leading-[2.25]',
      translations ? 'flex flex-col gap-4' : 'indent-[1em]',
    )}>
      {sentences.map((s, i) => {
        const failed = !!s.analysis?.failed
        const pending = !s.analysis && streaming
        const selected = i === selectedIndex
        return (
          <Wrap key={i} className={translations ? 'flex flex-col gap-1' : undefined}>
            <span
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`第 ${i + 1} 句`}
              onClick={() => onSelect(i)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(i) }
              }}
              className={clsx(
                'rounded-[0.3em] cursor-pointer transition-colors duration-150 box-decoration-clone',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                selected && !failed && 'bg-accent-light',
                failed && 'bg-danger-light text-danger-fg',
                pending && 'text-fg-subtle',
                !selected && !failed && 'hover:bg-accent-light/60',
              )}
            >
              <SentenceText
                sentence={s}
                marks={failed ? [] : marksFor(s.text, s.analysis, threshold, known)}
                furigana={furigana}
                onPick={onPickItem ? item => onPickItem(i, item) : undefined}
              />
            </span>
            {failed && onRetry && (
              <button
                type="button"
                onClick={() => onRetry(i)}
                disabled={retrying === i}
                className="indent-0 inline-flex items-center gap-1 align-middle mx-1 font-sans text-xs leading-none
                           px-2 py-1 rounded-full border border-danger/40 text-danger-fg bg-surface
                           hover:bg-danger-light disabled:opacity-60"
              >
                {retrying === i
                  ? <><Loader2 className="w-3 h-3 animate-spin" />重试中</>
                  : <><RotateCcw className="w-3 h-3" />这句没分析出来 · 重试</>}
              </button>
            )}
            {translations && s.analysis?.translation && (
              <span className="font-sans text-sm leading-relaxed text-fg-muted">{s.analysis.translation}</span>
            )}
          </Wrap>
        )
      })}
    </div>
  )
}

/** One sentence: tokens (for furigana) cut further wherever a mark starts or ends. */
function SentenceText({ sentence, marks, furigana, onPick }: {
  sentence: ReaderSentence
  marks: Mark[]
  furigana: boolean
  onPick?: (item: Mark['item']) => void
}) {
  const { text } = sentence
  const tokens = sentence.tokens.length > 0 && sentence.tokens.map(t => t.surface).join('') === text
    ? sentence.tokens
    : [{ surface: text, base: text, pos: '', reading: '' }]

  const markAt = (pos: number) => marks.find(m => m.start <= pos && pos < m.end)
  const cuts = new Set<number>()
  marks.forEach(m => { cuts.add(m.start); cuts.add(m.end) })

  let offset = 0
  return (
    <>
      {tokens.map((token, ti) => {
        const start = offset
        const end = start + token.surface.length
        offset = end
        // Pieces of this token between mark boundaries
        const bounds = [start, ...[...cuts].filter(c => c > start && c < end).sort((a, b) => a - b), end]
        const pieces = bounds.slice(0, -1).map((from, k) => {
          const to = bounds[k + 1]
          const mark = markAt(from)
          const piece = text.slice(from, to)
          return mark ? (
            <span
              key={k}
              className={clsx(MARK_CLASS[mark.kind], onPick && 'cursor-pointer')}
              onClick={onPick ? e => { e.stopPropagation(); onPick(mark.item) } : undefined}
            >
              {piece}
            </span>
          ) : <Fragment key={k}>{piece}</Fragment>
        })
        const reading = furigana && token.reading && token.reading !== token.surface && KANJI.test(token.surface)
          ? toHiragana(token.reading) : null
        return reading ? (
          <ruby key={ti}>
            {pieces}
            <rt className="font-sans text-[0.45em] text-fg-muted tracking-wide">{reading}</rt>
          </ruby>
        ) : <Fragment key={ti}>{pieces}</Fragment>
      })}
    </>
  )
}

const toHiragana = (s: string) =>
  s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
