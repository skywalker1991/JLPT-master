import { useState } from 'react'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import type { JlptCategory, JlptOverview, JlptPaperRow } from '../../types'

const WEAK = 60

/**
 * The JLPT home: practise by question type on the left (no clock, feedback
 * after each answer), mock exams on the right (a whole paper, timed, no
 * answers until it is handed in), and the mistakes gathered from both.
 */
export default function JlptHome({ data, onPractice, onPaper, onMistakes, onLevel }: {
  data: JlptOverview
  onLevel: (level: string) => void
  onPractice: (c: JlptCategory) => void
  onPaper: (p: JlptPaperRow) => void
  onMistakes: () => void
}) {
  const [allPapers, setAllPapers] = useState(false)
  const papers = allPapers ? data.papers : data.papers.slice(0, 5)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden flex flex-col md:flex-row">
      <section className="md:flex-1 md:min-w-0 md:overflow-y-auto px-4 md:px-10 py-5 md:py-8 flex flex-col gap-4">
        <div role="tablist" aria-label="等级" className="flex gap-1.5">
          {data.levels.map(l => (
            <button key={l.level} type="button" role="tab" aria-selected={l.level === data.level}
                    disabled={l.papers === 0 && l.level !== data.level} onClick={() => onLevel(l.level)}
                    title={l.papers === 0 ? '这个等级还没有真题' : `${l.papers} 套真题`}
                    className={clsx('h-9 px-4 rounded-full text-sm font-semibold border transition-colors',
                      l.level === data.level ? 'bg-fg text-bg border-fg' : 'border-border text-fg hover:border-fg-subtle',
                      'disabled:opacity-35 disabled:hover:border-border')}>
              {l.level}
            </button>
          ))}
        </div>
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold text-fg">练习</h1>
        </header>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {data.categories.map(c => {
            const weak = c.accuracy != null && c.accuracy < WEAK
            return (
              <button key={c.id} type="button" onClick={() => onPractice(c)}
                      className="text-left rounded-xl border border-border bg-surface px-4 py-3.5 flex flex-col gap-2.5 hover:border-fg-subtle hover:-translate-y-0.5 transition-[border-color,transform] duration-150">
                <span className="flex items-baseline gap-2">
                  <span className="font-jp text-base text-fg">{c.label}</span>
                  <span className="ml-auto text-[11px] text-fg-subtle">{c.listening ? `聴解 ${c.number}` : `問題${c.number}`}</span>
                </span>
                <span className="h-1 rounded-full bg-border overflow-hidden">
                  <span className={clsx('block h-full', weak ? 'bg-danger' : 'bg-fg')} style={{ width: `${c.accuracy ?? 0}%` }} />
                </span>
                <span className="flex items-baseline text-xs text-fg-muted">
                  {c.accuracy == null ? '还没练过' : <>正确率 <b className={clsx('ml-1', weak ? 'text-danger-fg' : 'text-fg')}>{c.accuracy}%</b></>}
                  <span className="ml-auto">每套 {c.per_paper} 题</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <aside className="md:w-[30rem] shrink-0 md:border-l border-border md:bg-accent-light/40 md:overflow-y-auto px-4 md:px-8 py-5 md:py-8 flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-xl font-bold text-fg">模拟考</span>
          </p>
          <p className="text-xs text-fg-subtle">{data.level === 'N1' || data.level === 'N2' ? '言語知識・読解' : '言語知識・読解（两节）'} {data.written_minutes} 分钟　聴解 {data.listening_minutes} 分钟</p>
        </header>
        <ul className="rounded-xl border border-border bg-surface divide-y divide-border">
          {papers.map(p => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <span className="font-semibold text-fg w-28 shrink-0">{p.label}</span>
              <span className="text-sm text-fg-muted flex-1">
                {p.status === 'new' ? '未做' : p.status === 'in_progress' ? `做到 ${p.stage === 'listening' ? '聴解' : '言語知識・読解'}` : '已完成'}
              </span>
              {p.status === 'completed' && p.total != null && (
                <span className="text-sm text-fg-subtle tabular-nums">{p.total} / 180</span>
              )}
              <button type="button" onClick={() => onPaper(p)} className="btn h-9 border border-border text-fg">
                {p.status === 'new' ? '开始' : p.status === 'in_progress' ? '继续' : '成绩'}
              </button>
            </li>
          ))}
          {data.papers.length > 5 && (
            <li>
              <button type="button" onClick={() => setAllPapers(a => !a)} className="w-full text-left px-4 py-2.5 text-xs text-fg-muted hover:text-fg">
                {allPapers ? '收起' : `还有 ${data.papers.length - 5} 套 ›`}
              </button>
            </li>
          )}
        </ul>
        <button type="button" onClick={onMistakes}
                className="rounded-xl border border-border bg-surface px-4 py-3.5 flex items-center gap-3 text-left hover:border-fg-subtle">
          <span className="font-semibold text-fg">错题</span>
          <span className="text-sm text-fg-muted">{data.mistakes} 题 · 按题型看</span>
          <ChevronRight className="w-4 h-4 ml-auto text-fg-subtle" />
        </button>
      </aside>
    </div>
  )
}
