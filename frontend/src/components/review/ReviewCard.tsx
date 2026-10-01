import clsx from 'clsx'
import type { ReviewCard as Card } from '../../types'
import { grammarPieces } from '../../utils/marks'

const LEVEL_CLASS: Record<string, string> = {
  N1: 'badge-n1', N2: 'badge-n2', N3: 'badge-n3', N4: 'badge-n4', N5: 'badge-n5',
}

export const RELATION_LABEL: Record<string, string> = {
  synonym: '近义', nuance: '近义', formal_casual: '近义',
  derivative: '同源', confusable: '形音易混', contrast: '反义', collocation: '搭配',
}

/** Where in the sentence the card's word / grammar sits: [start, end) ranges. */
export function targetRanges(card: Card): [number, number][] {
  const s = card.sentence
  if (!s) return []
  if (card.type === 'grammar') {
    const out: [number, number][] = []
    let from = 0
    for (const piece of grammarPieces(card.key)) {
      const at = s.text.indexOf(piece, from)
      if (at >= 0) { out.push([at, at + piece.length]); from = at + piece.length }
    }
    return out
  }
  const needle = s.surface && s.text.includes(s.surface) ? s.surface : card.key
  const at = s.text.indexOf(needle)
  return at >= 0 ? [[at, at + needle.length]] : []
}

function Sentence({ text, ranges, as }: { text: string; ranges: [number, number][]; as: 'mark' | 'blank' | 'underline' }) {
  const out: React.ReactNode[] = []
  let pos = 0
  ranges.forEach(([a, b], i) => {
    out.push(<span key={`t${i}`}>{text.slice(pos, a)}</span>)
    const piece = text.slice(a, b)
    out.push(as === 'blank' ? (
      <span key={`b${i}`} aria-label="空格" className="inline-block align-baseline border-b-2 border-fg mx-0.5"
            style={{ width: `${Math.max(2.5, piece.length * 1.05)}em` }}>&nbsp;</span>
    ) : (
      <span key={`m${i}`} className={clsx(
        'underline decoration-fg decoration-2 underline-offset-[0.3em]',
        as === 'mark' && 'bg-accent-light rounded-[0.2em] px-0.5',
      )}>{piece}</span>
    ))
    pos = b
  })
  out.push(<span key="end">{text.slice(pos)}</span>)
  return <>{out}</>
}

/** The question on the front of a card. */
export function cardPrompt(card: Card): string {
  const ranges = targetRanges(card)
  if (card.mode === 'cloze' && ranges.length > 0) return card.type === 'grammar' ? '空格里是什么语法？' : '空格里是哪个词？'
  return card.type === 'grammar' ? '这个语法是什么意思？' : '这个词是什么意思？'
}

/**
 * One review card. The front asks with a sentence you met (the word marked,
 * or — once it is familiar, and for grammar always — blanked out with the
 * translation as the clue). The back shows the sentence whole, then the word.
 */
export default function ReviewCard({ card, flipped }: { card: Card; flipped: boolean }) {
  const s = card.sentence
  const ranges = targetRanges(card)
  const cloze = card.mode === 'cloze' && ranges.length > 0
  const level = card.level?.toUpperCase()

  if (!flipped) {
    return (
      <div className="flex-1 flex flex-col">
        <p className="text-xs text-fg-subtle">{cardPrompt(card)}</p>
        <div className="flex-1 flex flex-col justify-center gap-5 py-6">
          {s && ranges.length > 0 ? (
            <>
              {cloze && s.translation && <p className="text-[0.9375rem] text-fg-muted leading-relaxed">{s.translation}</p>}
              <p className="font-jp text-2xl leading-[2] text-fg">
                <Sentence text={s.text} ranges={ranges} as={cloze ? 'blank' : 'mark'} />
              </p>
            </>
          ) : (
            <p className="font-jp text-4xl text-fg text-center">{card.key}</p>
          )}
        </div>
        <p className="text-center text-xs text-fg-subtle">点卡片翻面</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col gap-4">
      {s && (
        <div className="flex flex-col gap-2 pb-4 border-b border-border">
          <p className="font-jp text-xl leading-[1.9] text-fg-muted">
            <Sentence text={s.text} ranges={ranges} as="underline" />
          </p>
          {s.translation && <p className="text-xs text-fg-muted leading-relaxed">{s.translation}</p>}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <p className="flex items-baseline gap-3 flex-wrap">
          <span className="font-jp text-4xl text-fg">{card.key}</span>
          {card.reading && card.reading !== card.key && <span className="text-base text-fg-muted">{card.reading}</span>}
          {level && <span className={LEVEL_CLASS[level] ?? 'badge'}>{level}</span>}
        </p>
        {s?.meaning_here && s.meaning_here !== card.meaning && (
          <p className="text-sm text-fg-muted">这句里：{s.meaning_here}</p>
        )}
        {card.meaning && <p className="text-lg text-fg leading-relaxed">{card.meaning}</p>}
        {card.type === 'grammar' && card.connection && (
          <p className="text-sm text-fg-muted"><span className="text-fg-subtle mr-2">接续</span>{card.connection}</p>
        )}
        {card.relations.length > 0 && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted pt-1">
            {card.relations.map(r => (
              <span key={`${r.type}-${r.key}`} className="flex items-center gap-1.5">
                <span aria-hidden="true">↔</span><span className="font-jp text-fg">{r.key}</span>
                <span className="text-xs rounded-full bg-accent-light px-2 py-0.5">{RELATION_LABEL[r.type] ?? r.type}</span>
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="mt-auto text-xs text-fg-subtle">
        {s ? `${fmt(s.met_at)} · ${s.source}` : '还没有遇到过的原句：在语料分析或 JLPT 里再遇到它时会记下'}
      </div>
    </div>
  )
}

export function fmt(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
