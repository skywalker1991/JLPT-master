import clsx from 'clsx'
import { Check, X } from 'lucide-react'
import type { ItemSchema } from '../../types'
import QuestionText from '../exam/QuestionText'
import SentenceOrderStem from '../exam/SentenceOrderStem'
import Stem from '../exam/Stem'
import { Connected } from '../shared/Motion'

const BLANK = /（\s*）|\(\s*\)|（　+）/

/** The stem with the right answer written into its （　）, once it is known. */
function FilledStem({ stem, answer }: { stem: string; answer: string }) {
  const [before, after] = stem.split(BLANK)
  return (
    <>
      {before}
      <span className="mx-0.5 px-1.5 py-0.5 rounded-md bg-success-light text-success-fg border border-success/30">{answer}</span>
      {after}
    </>
  )
}

/**
 * One question: its stem and four options. Before the answer is known it is
 * a choice; once `correct` is given it shows the right one and, if different,
 * the one chosen.
 */
export default function QuestionBlock({
  item, type, selected, correct, onSelect, size = 'lg',
}: {
  item: ItemSchema
  type: string
  selected: string | null
  /** The right option, once it may be shown */
  correct?: string | null
  onSelect?: (option: string) => void
  size?: 'lg' | 'md'
}) {
  const revealed = correct != null
  const options = Object.entries(item.options).sort(([a], [b]) => a.localeCompare(b))
  const short = options.every(([, v]) => v.length <= 14)
  const fill = revealed && correct && item.stem && BLANK.test(item.stem) ? item.options[correct] : null

  return (
    <div className="flex flex-col gap-4">
      <div className={clsx('font-jp text-fg leading-[1.9]', size === 'lg' ? 'text-xl md:text-2xl' : 'text-lg')}>
        {item.num != null && <span className="font-sans font-bold text-fg mr-3 tabular-nums">{item.num}</span>}
        {type === 'sentence_order' && item.stem
          ? <SentenceOrderStem stem={item.stem} />
          : fill ? <FilledStem stem={item.stem} answer={fill} />
          : <QuestionText stem={item.stem} type={type} num={item.num} transcript={item.transcript} />}
      </div>

      <div role="radiogroup" aria-label={`第 ${item.num ?? ''} 题的选项`}
           className={clsx('grid gap-2.5', short ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1')}>
        {options.map(([key, text]) => {
          const isCorrect = revealed && key === correct
          const isWrongPick = revealed && key === selected && key !== correct
          const isPicked = !revealed && key === selected
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={key === selected}
              disabled={revealed || !onSelect}
              onClick={() => onSelect?.(key)}
              className={clsx(
                'flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors min-h-[3.25rem]',
                isCorrect && 'border-fg border-[1.5px]',
                isCorrect && key === selected && 'animate-yes',
                isWrongPick && 'border-danger/40 bg-danger-light animate-nope',
                isPicked && 'border-fg border-[1.5px] bg-accent-light',
                !isCorrect && !isWrongPick && !isPicked && 'border-border bg-surface',
                !revealed && onSelect && !isPicked && 'hover:border-fg-subtle',
                revealed && !isCorrect && !isWrongPick && 'text-fg-muted',
              )}
            >
              <span className="text-sm font-semibold tabular-nums text-fg-muted w-4 shrink-0">{key}</span>
              <span className="font-jp text-base md:text-lg flex-1"><Stem text={text} /></span>
              {isCorrect && <span className="flex items-center gap-1 text-xs text-success-fg shrink-0">{key === selected ? <Connected className="w-4 h-4" /> : <Check className="w-3.5 h-3.5" />}正解</span>}
              {isWrongPick && <span className="flex items-center gap-1 text-xs text-danger-fg shrink-0"><X className="w-3.5 h-3.5" />你选的</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
