import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import type { JlptOverview, JlptPaperRow } from '../../types'
import { mockUnderway } from './mockStatus'

/**
 * The JLPT home: the papers of the chosen level. Open one to practise it by
 * kind or sit it as a mock exam. Mistakes from all of them sit apart.
 */
export default function JlptHome({ data, onPaper, onMistakes, onLevel }: {
  data: JlptOverview
  onPaper: (p: JlptPaperRow) => void
  onMistakes: () => void
  onLevel: (level: string) => void
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-5 md:py-8 flex flex-col gap-5">
        <div className="flex items-center gap-3">
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
          <button type="button" onClick={onMistakes}
                  className="ml-auto btn h-9 shrink-0 whitespace-nowrap border border-border text-fg">
            错题{data.mistakes > 0 && <span className="text-danger-fg tabular-nums">{data.mistakes}</span>}
            <ChevronRight className="w-4 h-4 text-fg-subtle" />
          </button>
        </div>

        <h1 className="text-2xl font-bold text-fg">{data.level} 真题</h1>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.papers.map(p => {
            const pct = p.questions ? Math.round((p.done / p.questions) * 100) : 0
            return (
              <li key={p.id}>
                <button type="button" onClick={() => onPaper(p)}
                        className="w-full text-left rounded-2xl border border-border bg-surface px-5 py-4 flex flex-col gap-3 hover:border-fg-subtle transition-colors">
                  <span className="flex items-baseline gap-3">
                    <span className="text-lg font-bold text-fg">{p.label}</span>
                    {p.status === 'completed' && p.total != null && <span className="text-sm text-fg-muted">模拟考 {p.total} 分</span>}
                    {!p.is_open && <span className="ml-auto text-xs text-fg-subtle">未开放</span>}
                  </span>
                  <span className="h-1.5 rounded-full bg-border overflow-hidden">
                    <span className="block h-full bg-fg" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="text-xs text-fg-muted tabular-nums">
                    {p.status === 'in_progress' ? <span className="text-fg">{mockUnderway(p.stage, p.remaining, true)}</span>
                      : p.done === 0 ? `${p.questions} 题` : `做了 ${p.done} / ${p.questions} 题`}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
