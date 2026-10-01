import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Loader2, Trash2 } from 'lucide-react'
import type { PaperOverview, PaperRecord } from '../../types'
import { deleteRecord, getPaperOverview } from '../../services/api'
import { useUndo } from '../shared/useUndo'

const WEAK = 60
const SHOWN = 5

/**
 * One paper, two ways in: practise it by kind (as printed, no clock, the
 * explanation after each answer), or sit it whole as a mock exam. Every
 * pass and every mock exam is kept, under the time it was started.
 */
export default function PaperView({ paperId, onBack, onPractice, onMock, onRecord }: {
  paperId: string
  onBack: () => void
  /** Practise a kind: continue its unfinished pass (runId), or start one */
  onPractice: (kind: string, label: string, runId: string | null) => void
  onMock: () => void
  onRecord: (r: PaperRecord) => void
}) {
  const [p, setP] = useState<PaperOverview | null>(null)
  const [all, setAll] = useState(false)
  const [hidden, setHidden] = useState<string[]>([])
  const { schedule, toast } = useUndo()
  const load = () => getPaperOverview(paperId).then(setP).catch(() => {})
  useEffect(() => { void load() }, [paperId]) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (r: PaperRecord) => {
    setHidden(h => [...h, r.id])
    schedule({
      label: `已删除 ${when(r.at)} 的${r.type === 'mock' ? '模拟考' : r.label}`,
      commit: async () => { await deleteRecord(r.type, r.id); await load() },
      undo: () => setHidden(h => h.filter(x => x !== r.id)),
    })
  }
  if (!p) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>

  const kept = p.records.filter(r => !hidden.includes(r.id))
  const records = all ? kept : kept.slice(0, SHOWN)
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-5 md:py-8 flex flex-col gap-6">
        <header className="flex items-center gap-2">
          <button type="button" onClick={onBack} aria-label="回到试卷列表" className="-ml-2 p-2 text-fg-muted hover:text-fg"><ChevronLeft className="w-5 h-5" /></button>
          <h1 className="text-2xl font-bold text-fg">{p.label} {p.level}</h1>
          <button type="button" onClick={onMock} className="ml-auto btn-primary h-10 px-5 font-semibold">模拟考</button>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-fg-muted">分类练习</h2>
          <div className="grid grid-cols-2 gap-3">
            {p.kinds.map(k => {
              // Accuracy of the last pass handed in: right out of answered
              const acc = k.right != null && k.answered ? Math.round((k.right / k.answered) * 100) : null
              const weak = acc != null && acc < WEAK
              const shown = k.open_answered ?? k.answered
              return (
                <button key={k.id} type="button" onClick={() => onPractice(k.id, k.label, k.run_id && !hidden.includes(k.run_id) ? k.run_id : null)}
                        className="text-left rounded-2xl border border-border bg-surface px-5 py-4 flex flex-col gap-3 hover:border-fg-subtle hover:-translate-y-0.5 transition-[border-color,transform] duration-150">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-jp text-lg md:text-xl text-fg whitespace-nowrap">{k.label}</span>
                    <span className="ml-auto text-xs text-fg-subtle tabular-nums whitespace-nowrap">{shown} / {k.total} 题</span>
                  </span>
                  <span className="h-1.5 rounded-full bg-border overflow-hidden">
                    <span className={clsx('block h-full', k.open_answered == null && weak ? 'bg-danger' : 'bg-fg')} style={{ width: `${(shown / Math.max(1, k.total)) * 100}%` }} />
                  </span>
                  {(acc != null || k.open_answered != null) && (
                    <span className="flex flex-col gap-0.5 text-sm text-fg-muted">
                      {k.open_answered != null && <span className="text-fg">进行中 · 已答 {k.open_answered} / {k.total}</span>}
                      {acc != null && <span>{k.open_answered != null ? '上次' : ''}正确率 <b className={clsx('ml-1', weak ? 'text-danger-fg' : 'text-fg')}>{acc}%</b></span>}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </section>

        {kept.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-fg-muted">记录</h2>
            <ul className="rounded-2xl border border-border bg-surface divide-y divide-border">
              {records.map(r => (
                <li key={r.id} className="group flex items-center hover:bg-accent-light/60 transition-colors first:rounded-t-2xl last:rounded-b-2xl">
                  <button type="button" onClick={() => onRecord(r)}
                          className="flex-1 min-w-0 flex items-center gap-3 sm:gap-4 pl-4 sm:pl-5 pr-1 py-3 text-left">
                    <span className="sm:w-32 shrink-0 text-sm text-fg-muted tabular-nums whitespace-nowrap">{when(r.at)}</span>
                    <span className={clsx('w-14 sm:w-24 shrink-0 text-sm whitespace-nowrap', r.type === 'mock' ? 'font-semibold text-fg' : 'font-jp text-fg')}>
                      {r.type === 'mock' ? '模拟考' : r.label}
                    </span>
                    <span className="flex-1 min-w-0 text-sm tabular-nums text-right leading-snug">{outcome(r)}</span>
                    <ChevronRight className="w-4 h-4 shrink-0 text-fg-subtle" />
                  </button>
                  <button type="button" onClick={() => remove(r)} aria-label="删除这条记录" title="删除"
                          className="shrink-0 w-10 h-10 mr-1 sm:mr-2 flex items-center justify-center rounded-lg text-fg-subtle hover:text-danger-fg md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
            {kept.length > SHOWN && (
              <button type="button" onClick={() => setAll(a => !a)} className="self-start text-sm text-fg-muted hover:text-fg">
                {all ? '收起' : `全部 ${kept.length} 条`}
              </button>
            )}
          </section>
        )}
      </div>
      {toast}
    </div>
  )
}

function when(iso: string): string {
  const d = new Date(iso)
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  const day = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date().getFullYear() ? `${day} ${time}` : `${d.getFullYear()}年${day}`
}

function outcome(r: PaperRecord) {
  if (r.type === 'mock') {
    if (r.status === 'in_progress') {
      const left = r.remaining == null ? '' : r.remaining <= 0 ? '时间已到'
        : `还剩 ${Math.floor(r.remaining / 3600)}:${String(Math.ceil((r.remaining % 3600) / 60)).padStart(2, '0')}`
      return (
        <span className="text-fg inline-flex flex-wrap justify-end gap-x-1.5">
          <span className="whitespace-nowrap">考试中 · {r.stage === 'listening' ? '聴解' : '言語知識・読解'}</span>
          <span className="whitespace-nowrap">{left}</span>
        </span>
      )
    }
    return <span className="text-fg"><b>{r.score ?? '—'}</b><span className="text-fg-muted"> / {r.max_total} 分</span></span>
  }
  if (!r.finished || r.right == null) return <span className="text-fg-muted">进行中 · 已答 {r.answered} / {r.total}</span>
  if (r.answered === 0) return <span className="text-fg-muted">答 0 / {r.total}</span>
  const acc = Math.round((r.right / r.answered) * 100)
  return (
    <span className="text-fg-muted">答 {r.answered} / {r.total} · 正确率 <b className={acc < WEAK ? 'text-danger-fg' : 'text-fg'}>{acc}%</b></span>
  )
}
