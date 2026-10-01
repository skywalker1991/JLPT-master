import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, Loader2 } from 'lucide-react'
import type { MockResult } from '../../types'
import { getMockResult } from '../../services/api'

const WEAK = 0.6

/**
 * After a mock exam: the estimated total against the pass line, each scored
 * part against its minimum, accuracy by question type — then straight into
 * the questions got wrong, weakest type first.
 */
export default function MockResultView({ attemptId, onBack, onReview }: {
  attemptId: string
  onBack: () => void
  onReview: (itemIds: string[]) => void
}) {
  const [r, setR] = useState<MockResult | null>(null)
  useEffect(() => { getMockResult(attemptId).then(setR).catch(() => {}) }, [attemptId])
  if (!r) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>

  const rated = r.categories.filter(c => c.total > 0).map(c => ({ ...c, rate: c.correct / c.total }))
  const weakest = [...rated].sort((a, b) => a.rate - b.rate).slice(0, 2)
  const date = r.date ? new Date(r.date) : null

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-5 md:py-10 flex flex-col gap-5">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={onBack} aria-label="回到 JLPT" className="-ml-2 p-2 text-fg-muted hover:text-fg"><ChevronLeft className="w-5 h-5" /></button>
          <h1 className="text-xl md:text-2xl font-bold text-fg">{r.label} {r.level} · 模拟考成绩</h1>
          <span className="text-xs text-fg-subtle">
            用时 {Math.floor(r.minutes / 60)}:{String(r.minutes % 60).padStart(2, '0')}{date ? ` · ${date.getMonth() + 1}月${date.getDate()}日` : ''}
          </span>
        </header>

        <div className={clsx('grid grid-cols-1 gap-3', r.parts.length === 3 ? 'md:grid-cols-4' : 'md:grid-cols-3')}>
          <div className="rounded-2xl bg-fg text-bg p-5 flex flex-col gap-1.5">
            <span className="text-xs opacity-70">综合（估算）</span>
            <span><b className="text-4xl tabular-nums">{r.total}</b><span className="opacity-70"> / {r.max_total}</span></span>
            <span className="text-xs opacity-80">合格线 {r.pass_line} · 按正确率估算，不是官方换算</span>
          </div>
          {r.parts.map(p => (
            <div key={p.part} className="rounded-2xl border border-border bg-surface p-5 flex flex-col gap-2">
              <span className="flex items-baseline text-sm font-semibold text-fg">
                {p.part}
                <span className={clsx('ml-auto text-xs font-normal', p.passed_min ? 'text-success-fg' : 'text-danger-fg')}>
                  {p.passed_min ? '过' : '未过'}基准点 {p.min}
                </span>
              </span>
              <span><b className="text-2xl text-fg tabular-nums">{p.score}</b><span className="text-sm text-fg-muted"> / {p.max}</span></span>
              <span className="relative h-1.5 rounded-full bg-border">
                <span className="absolute inset-y-0 left-0 rounded-full bg-fg" style={{ width: `${(p.score / p.max) * 100}%` }} />
                <span className="absolute -top-1 -bottom-1 w-0.5 bg-danger" style={{ left: `${(p.min / p.max) * 100}%` }} />
              </span>
              <span className="text-xs text-fg-muted">错 {p.wrong} 题</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_20rem] gap-5 items-start">
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold text-fg-subtle">按题型</h2>
            {rated.map(c => (
              <div key={c.id} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-3 text-sm">
                <span className="font-jp text-fg truncate">{c.label}</span>
                <span className="h-1.5 rounded-full bg-border overflow-hidden">
                  <span className={clsx('block h-full', c.rate < WEAK ? 'bg-danger' : 'bg-fg')} style={{ width: `${c.rate * 100}%` }} />
                </span>
                <span className="text-right text-fg-muted tabular-nums">{c.correct}/{c.total}</span>
              </div>
            ))}
          </section>

          <section className="rounded-2xl border-[1.5px] border-fg p-5 flex flex-col gap-3">
            <h2 className="text-lg font-bold text-fg">错了 {r.wrong} 题</h2>
            {weakest.length > 0 && (
              <p className="text-sm text-fg-muted leading-relaxed">
                从题型正确率最低的开始：{weakest.map(c => c.label).join('、')}。每题都有原题、「你选的 vs 正解」和本题知识点。
              </p>
            )}
            <button type="button" disabled={r.wrong === 0} onClick={() => onReview(r.wrong_items)}
                    className="btn-primary h-12 justify-center text-base font-semibold">开始看错题</button>
          </section>
        </div>
      </div>
    </div>
  )
}
