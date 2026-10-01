import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronLeft, ChevronRight, Flag, LayoutGrid, Loader2, X } from 'lucide-react'
import type { ItemSchema, MockState, ProblemDetail } from '../../types'
import { answerMock, flagMock, getMock, handInMock } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import Passage from '../exam/Passage'
import PlayAudio from '../exam/PlayAudio'
import QuestionBlock from './QuestionBlock'

interface Slot { item: ItemSchema; problem: ProblemDetail; section: string }

function clock(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const STAGE_LABEL = { written: '言語知識・読解', listening: '聴解', done: '' }

/**
 * A mock exam: the paper under the real clock, one question at a time (the
 * text it belongs to beside it), nothing marked and no answers shown. An
 * answer sheet jumps anywhere; questions can be flagged 不确定. When the
 * time runs out the part is handed in by itself.
 */
export default function MockExam({ attemptId, onExit, onDone }: {
  attemptId: string
  onExit: () => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [state, setState] = useState<MockState | null>(null)
  const [at, setAt] = useState(0)
  const [left, setLeft] = useState(0)
  const [sheet, setSheet] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [passageOpen, setPassageOpen] = useState(false)
  const handing = useRef(false)

  const load = useCallback(async () => {
    const s = await getMock(attemptId)
    if (s.status === 'completed') { onDone(); return }
    setState(s)
    setLeft(s.remaining)
    setAt(0)
  }, [attemptId, onDone])

  useEffect(() => { load().catch(() => toast('试卷没取到，稍后再试', 'error')) }, [load, toast])

  const handIn = useCallback(async () => {
    if (handing.current) return
    handing.current = true
    setConfirm(false)
    try {
      const r = await handInMock(attemptId)
      if (r.stage === 'done') onDone()
      else { toast('言語知識・読解已交，聴解开始计时', 'info'); await load() }
    } catch {
      toast('没交上，请再试一次', 'error')
    } finally {
      handing.current = false
    }
  }, [attemptId, load, onDone, toast])

  useEffect(() => {
    if (!state) return
    const t = setInterval(() => setLeft(l => Math.max(0, l - 1)), 1000)
    return () => clearInterval(t)
  }, [state])

  useEffect(() => {
    if (state && left === 0) void handIn()
  }, [left, state, handIn])

  const slots: Slot[] = useMemo(() => (state?.sections ?? []).flatMap(sec =>
    sec.problems.flatMap(p => p.items.map(item => ({ item, problem: p, section: sec.name })))), [state])

  if (!state || slots.length === 0) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>
  }

  const slot = slots[Math.min(at, slots.length - 1)]
  const { item, problem } = slot
  const answered = slots.filter(s => state.answers[s.item.id]).length
  const flagged = state.flags.includes(item.id)
  const listening = problem.type === 'listening'
  const passage = !listening ? (item.passage || problem.passage) : null
  const pages = problem.media.filter(m => m.caption?.includes('試験用紙'))
  const banStart = listening ? slots.findIndex(s => s.problem.id === problem.id && (s.item.meta?.ban ?? s.item.id) === (item.meta?.ban ?? item.id)) : -1
  const side = !!passage || pages.length > 0

  const choose = async (opt: string) => {
    setState(s => s && { ...s, answers: { ...s.answers, [item.id]: opt } })
    try { await answerMock(attemptId, item.id, opt) } catch (e) {
      toast(e instanceof Error ? e.message : '这题没记上，请再选一次', 'error')
    }
  }

  const toggleFlag = async () => {
    try {
      const r = await flagMock(attemptId, item.id, !flagged)
      setState(s => s && { ...s, flags: r.flags })
    } catch { toast('没标上，请再试一次', 'error') }
  }

  const go = (i: number) => { setAt(Math.max(0, Math.min(slots.length - 1, i))); setPassageOpen(false) }
  const last = at >= slots.length - 1
  const unanswered = slots.length - answered

  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col md:static md:z-auto md:flex-1 md:min-h-0"
         style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <header className="h-14 shrink-0 flex items-center gap-3 px-2 md:px-6 border-b border-border">
        <button type="button" onClick={onExit} aria-label="离开（计时继续）" className="w-10 h-10 flex items-center justify-center text-fg md:hidden">
          <X className="w-5 h-5" />
        </button>
        <span className="hidden md:inline text-xs font-semibold rounded-full bg-fg text-bg px-2.5 py-0.5">模拟考</span>
        <span className="hidden md:inline font-bold text-fg">{state.label} {state.level}</span>
        <span className="text-sm text-fg-muted truncate">
          <span className="md:hidden font-semibold text-fg">{problem.name} {item.num}</span>
          <span className="hidden md:inline">{STAGE_LABEL[state.stage]} · {problem.name}</span>
        </span>
        <span className="ml-auto hidden md:inline text-sm text-fg-muted tabular-nums">已答 {answered} / {slots.length}</span>
        <span className={clsx('text-lg md:text-xl font-bold tabular-nums', left < 300 ? 'text-danger-fg' : 'text-fg', 'ml-auto md:ml-0')}>{clock(left)}</span>
        <button type="button" onClick={() => setSheet(true)} aria-label="答题卡"
                className="btn h-9 border border-border text-fg"><LayoutGrid className="w-4 h-4" /><span className="hidden md:inline">答题卡</span></button>
        <button type="button" onClick={() => setConfirm(true)} className="hidden md:inline-flex btn-primary h-9">
          {state.stage === 'written' ? '交这一部分' : '交卷'}
        </button>
      </header>

      <div className={clsx('flex-1 min-h-0 flex', side ? 'flex-col md:flex-row' : 'flex-col')}>
        {side && (
          <section className={clsx('md:w-1/2 md:border-r border-border md:bg-accent-light/50 md:overflow-y-auto md:px-10 md:py-8',
            'mx-3 mt-3 md:m-0 rounded-xl md:rounded-none bg-accent-light/60 px-4 py-4')}>
            <p className="flex items-center text-xs text-fg-subtle mb-2">
              文章
              <button type="button" onClick={() => setPassageOpen(o => !o)} className="ml-auto md:hidden flex items-center gap-0.5 text-fg-muted">
                {passageOpen ? '收起' : '展开全文'}<ChevronDown className={clsx('w-3.5 h-3.5', passageOpen && 'rotate-180')} />
              </button>
            </p>
            <div className={clsx('font-jp text-[1.0625rem] md:text-lg leading-[2] text-fg', !passageOpen && 'max-h-40 overflow-hidden md:max-h-none')}>
              {pages.length > 0
                ? pages.map(m => <img key={m.id} src={m.url} alt={m.caption ?? '试卷页面'} className="max-w-full rounded-lg border border-border mb-3" />)
                : <Passage text={passage!} active={item.num} />}
            </div>
          </section>
        )}

        <main className={clsx('flex-1 min-h-0 overflow-y-auto px-4 md:px-12 py-5 md:py-8 flex flex-col gap-5', !side && 'md:items-center')}>
          <div className={clsx('w-full flex flex-col gap-5', !side && 'max-w-3xl')}>
            {!side && <p className="text-xs text-fg-subtle">{problem.name}{problem.instruction ? ` · ${problem.instruction}` : ''}</p>}
            {listening && <PlayAudio itemId={slots[banStart >= 0 ? banStart : at].item.id} />}
            <QuestionBlock item={item} type={problem.type} selected={state.answers[item.id] ?? null} onSelect={opt => void choose(opt)} size="md" />
          </div>
          <div className={clsx('w-full mt-auto flex items-center gap-3 pt-4', !side && 'max-w-3xl')}>
            <button type="button" onClick={() => void toggleFlag()} aria-pressed={flagged}
                    className={clsx('btn h-11 border', flagged ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-border text-fg')}>
              <Flag className="w-4 h-4" />{flagged ? '已标记不确定' : '标记不确定'}
            </button>
            <button type="button" onClick={() => go(at - 1)} disabled={at === 0} aria-label="上一题"
                    className="ml-auto btn h-11 border border-border text-fg disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
            {last ? (
              <button type="button" onClick={() => setConfirm(true)} className="btn-primary h-11 px-5 font-semibold">
                {state.stage === 'written' ? '交这一部分' : '交卷'}
              </button>
            ) : (
              <button type="button" onClick={() => go(at + 1)} className="btn-primary h-11 px-5 font-semibold">
                下一题 {slots[at + 1]?.item.num ?? ''}<ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </main>
      </div>

      {sheet && (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSheet(false)} />
          <div className="relative w-full md:w-[40rem] max-h-[80dvh] overflow-y-auto bg-surface rounded-t-2xl md:rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center">
              <h2 className="font-bold text-fg">答题卡</h2>
              <span className="ml-3 text-xs text-fg-muted">已答 {answered} / {slots.length} · 不确定 {state.flags.length}</span>
              <button type="button" onClick={() => setSheet(false)} aria-label="关闭" className="ml-auto p-2 text-fg-muted"><X className="w-4 h-4" /></button>
            </div>
            {groupBy(slots).map(([name, group]) => (
              <section key={name} className="flex flex-col gap-2">
                <h3 className="text-xs text-fg-subtle">{name}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {group.map(({ s, i }) => (
                    <button key={s.item.id} type="button" onClick={() => { go(i); setSheet(false) }}
                            className={clsx('relative w-10 h-10 rounded-lg text-sm tabular-nums border',
                              state.answers[s.item.id] ? 'bg-fg text-bg border-fg' : 'border-border text-fg',
                              i === at && 'ring-2 ring-offset-2 ring-fg ring-offset-surface')}>
                      {s.item.num}
                      {state.flags.includes(s.item.id) && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400" />}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <button type="button" onClick={() => { setSheet(false); setConfirm(true) }} className="md:hidden btn-primary h-11 justify-center">
              {state.stage === 'written' ? '交这一部分' : '交卷'}
            </button>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirm(false)} />
          <div role="dialog" aria-modal="true" className="relative w-full max-w-sm bg-surface rounded-2xl p-6 flex flex-col gap-4">
            <h2 className="text-lg font-bold text-fg">{state.stage === 'written' ? '交言語知識・読解？' : '交卷？'}</h2>
            <p className="text-sm text-fg-muted leading-relaxed">
              {unanswered > 0 ? `还有 ${unanswered} 题没答` : '都答完了'}
              {state.flags.length > 0 ? `，${state.flags.length} 题标了不确定` : ''}。
              {state.stage === 'written' ? '交了以后不能再改，聴解随即开始计时。' : '交了以后看成绩和错题。'}
            </p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setConfirm(false)} className="btn h-10 border border-border text-fg">再看看</button>
              <button type="button" onClick={() => void handIn()} className="btn-primary h-10">交</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function groupBy(slots: Slot[]): [string, { s: Slot; i: number }[]][] {
  const out = new Map<string, { s: Slot; i: number }[]>()
  slots.forEach((s, i) => {
    const key = `${s.section.includes('聴解') ? '聴解 ' : ''}${s.problem.name}`
    out.set(key, [...(out.get(key) ?? []), { s, i }])
  })
  return [...out.entries()]
}
