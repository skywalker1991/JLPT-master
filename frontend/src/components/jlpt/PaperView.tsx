import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, Loader2 } from 'lucide-react'
import type { PaperOverview } from '../../types'
import { getPaperOverview } from '../../services/api'
import { mockUnderway } from './mockStatus'

const WEAK = 60

/**
 * One paper, two ways in: practise it by kind (as printed, no clock, the
 * explanation after each answer), or sit it whole as a mock exam.
 */
export default function PaperView({ paperId, onBack, onPractice, onMock, onResult }: {
  paperId: string
  onBack: () => void
  onPractice: (kind: string, label: string) => void
  onMock: () => void
  onResult: (attemptId: string) => void
}) {
  const [p, setP] = useState<PaperOverview | null>(null)
  useEffect(() => { getPaperOverview(paperId).then(setP).catch(() => {}) }, [paperId])
  if (!p) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>

  const mock = p.mock
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-5 md:py-8 flex flex-col gap-6">
        <header className="flex items-center gap-2">
          <button type="button" onClick={onBack} aria-label="回到试卷列表" className="-ml-2 p-2 text-fg-muted hover:text-fg"><ChevronLeft className="w-5 h-5" /></button>
          <h1 className="text-2xl font-bold text-fg">{p.label} {p.level}</h1>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-fg-muted">分类练习</h2>
          <div className="grid grid-cols-2 gap-3">
            {p.kinds.map(k => {
              const acc = k.answered ? Math.round((k.right / k.answered) * 100) : null
              const weak = acc != null && acc < WEAK
              return (
                <button key={k.id} type="button" onClick={() => onPractice(k.id, k.label)}
                        className="text-left rounded-2xl border border-border bg-surface px-5 py-4 flex flex-col gap-3 hover:border-fg-subtle hover:-translate-y-0.5 transition-[border-color,transform] duration-150">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-jp text-lg md:text-xl text-fg whitespace-nowrap">{k.label}</span>
                    <span className="ml-auto text-xs text-fg-subtle tabular-nums whitespace-nowrap">{k.answered} / {k.total} 题</span>
                  </span>
                  <span className="h-1.5 rounded-full bg-border overflow-hidden">
                    <span className={clsx('block h-full', weak ? 'bg-danger' : 'bg-fg')} style={{ width: `${(k.answered / Math.max(1, k.total)) * 100}%` }} />
                  </span>
                  <span className="text-sm text-fg-muted">
                    {acc == null ? '还没做' : <>正确率 <b className={clsx('ml-1', weak ? 'text-danger-fg' : 'text-fg')}>{acc}%</b></>}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-fg-muted">模拟考</h2>
          <div className="rounded-2xl border-[1.5px] border-fg bg-surface px-5 py-5 flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
              <span className="text-lg font-bold text-fg">
                {mock?.status === 'completed' && mock.total != null ? `上次 ${mock.total} / ${mock.max_total} 分`
                  : mock?.status === 'in_progress' ? mockUnderway(mock.stage, mock.remaining) : '整套，按真实时间'}
              </span>
              <span className="text-xs text-fg-subtle">言語知識・読解 {p.written_minutes} 分钟　聴解 {p.listening_minutes} 分钟　交卷前不给答案</span>
            </div>
            {mock?.status === 'completed' && (
              <button type="button" onClick={() => onResult(mock.attempt_id)} className="btn h-11 px-5 border border-border text-fg">看成绩</button>
            )}
            <button type="button" onClick={onMock} className="btn-primary h-11 px-6 font-semibold">
              {mock?.status === 'in_progress' ? '继续' : mock?.status === 'completed' ? '再考一次' : '开始'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
