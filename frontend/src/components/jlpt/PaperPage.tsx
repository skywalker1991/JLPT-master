import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Flag } from 'lucide-react'
import type { ItemSchema, ProblemDetail } from '../../types'
import Passage from '../exam/Passage'
import Stem from '../exam/Stem'
import SentenceOrderStem from '../exam/SentenceOrderStem'
import PlayAudio from '../exam/PlayAudio'

const FW = ['１', '２', '３', '４']

/** How the booklet lays options out: four across when short, two when
 *  middling, one per line when they are sentences. */
function columns(options: string[]): string {
  const longest = Math.max(...options.map(o => o.replace(/__/g, '').length))
  if (longest <= 6) return 'grid-cols-4'
  if (longest <= 16) return 'grid-cols-2'
  return 'grid-cols-1'
}

/**
 * One 問題 laid out the way the printed paper is: the 問題 number boxed with
 * its instruction, the passage if there is one, then each question with its
 * number and its four options in the booklet's columns. Choosing marks the
 * option's number with a circle, as a pencil would.
 *
 * `after` puts something under a question once it is answered (practice's
 * right / wrong and 差在哪); a mock exam passes nothing.
 */
export default function PaperPage({ problem, answers, onChoose, flags, onFlag, correct, after, listeningFirstOf }: {
  problem: ProblemDetail
  answers: Record<string, string>
  onChoose?: (itemId: string, option: string) => void
  flags?: string[]
  onFlag?: (itemId: string) => void
  /** Right answers, once they may be shown (practice) */
  correct?: Record<string, string>
  after?: (item: ItemSchema) => ReactNode
  /** 聴解: which item starts each 番 (one player per 番) */
  listeningFirstOf?: (item: ItemSchema) => boolean
}) {
  const listening = problem.type === 'listening'
  const pages = problem.media.filter(m => m.caption?.includes('試験用紙'))
  // A 問題 with several texts gives each its own passage; print each once, before its questions
  let lastPassage: string | null = null

  return (
    <article className="bg-surface text-fg font-jp shadow-[0_1px_3px_rgba(0,0,0,.08),0_8px_24px_rgba(0,0,0,.06)] border border-border px-14 py-12 flex flex-col gap-8 leading-[1.9]">
      <header className="flex items-start gap-4">
        <span className="shrink-0 border-2 border-fg rounded-md px-2.5 py-0.5 text-lg font-bold tracking-wide">{problem.name}</span>
        {problem.instruction && (
          <p className="text-[1.0625rem] pt-0.5">{problem.instruction.replace(/^\s*問題\s*[0-9０-９]+\s*/, '')}</p>
        )}
      </header>

      {pages.length > 0 && pages.map(m => <img key={m.id} src={m.url} alt={m.caption ?? '试卷页面'} className="max-w-full border border-border" />)}
      {!pages.length && problem.passage && !listening && (
        <div className="text-[1.0625rem] leading-[2.1] whitespace-pre-wrap indent-[1em]"><Passage text={problem.passage} /></div>
      )}

      {problem.items.map(item => {
        const chosen = answers[item.id] ?? null
        const right = correct?.[item.id]
        const opts = Object.entries(item.options).sort(([a], [b]) => a.localeCompare(b))
        const showPassage = !problem.passage && item.passage && item.passage !== lastPassage
        if (item.passage) lastPassage = item.passage
        const flagged = flags?.includes(item.id)
        return (
          <section key={item.id} id={`q-${item.id}`} className="flex flex-col gap-3 scroll-mt-6">
            {showPassage && (
              <div className="text-[1.0625rem] leading-[2.1] whitespace-pre-wrap indent-[1em] border-t border-border pt-6 mb-2">
                <Passage text={item.passage!} />
              </div>
            )}
            {listening && listeningFirstOf?.(item) && <div className="font-sans"><PlayAudio itemId={item.id} /></div>}
            <div className="flex items-start gap-3 text-[1.0625rem]">
              <span className="shrink-0 min-w-[2rem] font-bold tabular-nums">{item.num}</span>
              <div className="flex-1 min-w-0">
                {problem.type === 'sentence_order' && item.stem ? <SentenceOrderStem stem={item.stem} />
                  : item.stem ? <Stem text={item.stem} /> : <span className="text-fg-subtle font-sans text-sm">{listening ? '（音声）' : ''}</span>}
              </div>
              {onFlag && (
                <button type="button" onClick={() => onFlag(item.id)} aria-pressed={flagged} title="标记不确定"
                        className={clsx('shrink-0 p-1 rounded font-sans', flagged ? 'text-amber-600' : 'text-fg-subtle/50 hover:text-fg-subtle')}>
                  <Flag className="w-4 h-4" fill={flagged ? 'currentColor' : 'none'} />
                </button>
              )}
            </div>
            <div className={clsx('grid gap-x-6 gap-y-1.5 pl-[2.75rem] text-[1.0625rem]', columns(opts.map(([, v]) => v)))}>
              {opts.map(([k, v], i) => {
                const picked = chosen === k
                const isRight = right != null && k === right
                const isWrong = right != null && picked && k !== right
                return (
                  <button key={k} type="button" disabled={!onChoose || right != null} onClick={() => onChoose?.(item.id, k)}
                          className={clsx('group flex items-start gap-2 text-left rounded px-1 -mx-1 py-0.5',
                            onChoose && right == null && 'hover:bg-accent-light',
                            isWrong && 'animate-nope')}>
                    <span className={clsx('shrink-0 w-7 h-7 rounded-full flex items-center justify-center tabular-nums transition-colors',
                      picked && right == null && 'ring-2 ring-fg',
                      isRight && 'ring-2 ring-success-fg text-success-fg',
                      isWrong && 'ring-2 ring-danger-fg text-danger-fg line-through')}>
                      {FW[i] ?? k}
                    </span>
                    <span className={clsx('pt-0.5', isRight && 'text-success-fg')}><Stem text={v} /></span>
                  </button>
                )
              })}
            </div>
            {(() => { const below = after?.(item); return below ? <div className="pl-[2.75rem] font-sans">{below}</div> : null })()}
          </section>
        )
      })}
    </article>
  )
}

/**
 * The answer sheet (解答用紙) beside the paper: every question's ①②③④,
 * filled in as answered; tap a bubble to answer, the number to go there.
 */
export function AnswerSheet({ groups, answers, flags, onChoose, onJump, current }: {
  groups: { name: string; items: { id: string; num: number | null }[] }[]
  answers: Record<string, string>
  flags: string[]
  onChoose?: (itemId: string, option: string) => void
  onJump: (itemId: string) => void
  current?: string
}) {
  return (
    <div className="flex flex-col gap-4 text-xs">
      {groups.map(g => (
        <section key={g.name} className="flex flex-col gap-1">
          <h3 className={clsx('font-semibold', g.items.some(i => i.id === current) ? 'text-fg' : 'text-fg-subtle')}>{g.name}</h3>
          {g.items.map(it => (
            <div key={it.id} className="flex items-center gap-1.5">
              <button type="button" onClick={() => onJump(it.id)}
                      className={clsx('w-7 text-right tabular-nums hover:text-fg', flags.includes(it.id) ? 'text-amber-600 font-bold' : 'text-fg-muted')}>
                {it.num}
              </button>
              {['1', '2', '3', '4'].map(o => {
                const on = answers[it.id] === o
                return (
                  <button key={o} type="button" disabled={!onChoose} onClick={() => onChoose?.(it.id, o)}
                          aria-label={`第 ${it.num} 题选 ${o}`}
                          className={clsx('w-5 h-5 rounded-full border text-[10px] leading-none flex items-center justify-center transition-colors',
                            on ? 'bg-fg border-fg text-bg' : 'border-fg-subtle/60 text-fg-subtle hover:border-fg')}>
                    {o}
                  </button>
                )
              })}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
