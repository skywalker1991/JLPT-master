import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { ItemSchema, PracticeUnit } from '../../types'
import PaperPage from './PaperPage'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import { answerPractice, getPractice, getRunAnalyses, retryRunAnalyses, submitRun, type AnalysisState } from '../../services/api'
import { Connected, Thinking } from '../shared/Motion'
import { useToast } from '../../context/ToastContext'
import Passage from '../exam/Passage'
import PlayAudio from '../exam/PlayAudio'
import QuestionBlock from './QuestionBlock'

/**
 * One pass through a paper's questions of one kind, as printed, no clock.
 * Answers can be changed until the pass is handed in (提交); then every
 * question shows right or wrong, and its explanation is one tap away.
 */
export default function PracticeSession({ category, level, runId, label, onExit, onAgain, onOpenAnalysis }: {
  category: string
  level: string
  runId: string
  label: string
  onExit: () => void
  /** Start a fresh pass */
  onAgain: () => void
  onOpenAnalysis?: (unit: PracticeUnit, itemId: string) => void
}) {
  const { toast } = useToast()
  const desktop = useIsDesktop()
  const [units, setUnits] = useState<PracticeUnit[] | null>(null)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [correct, setCorrect] = useState<Record<string, string> | null>(null)
  const [at, setAt] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [sending, setSending] = useState(false)
  const [states, setStates] = useState<Record<string, AnalysisState> | null>(null)
  const [poll, setPoll] = useState(0)

  // Once handed in, the explanations are made in the background: follow
  // them until each is ready or has failed
  useEffect(() => {
    if (!correct) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => getRunAnalyses(runId).then(r => {
      if (!live) return
      setStates(r.items)
      if (Object.values(r.items).some(v => v === 'pending')) timer = setTimeout(() => void check(), 3000)
    }).catch(() => { if (live) timer = setTimeout(() => void check(), 6000) })
    void check()
    return () => { live = false; clearTimeout(timer) }
  }, [correct, runId, poll])

  // Fetching a pass also starts its explanations on the server; fetch once
  // (React may run this effect twice in development)
  const fetched = useRef(false)
  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    getPractice(category, level, runId).then(r => {
      setUnits(r.units)
      setChosen(r.chosen)
      if (r.submitted) { setCorrect(r.correct); return }
      // A pass left halfway opens where it stopped
      const open = (items: ItemSchema[]) => items.some(i => !r.chosen[i.id])
      const i = desktop ? pagesOf(r.units).findIndex(pg => open(pg.problem.items)) : r.units.findIndex(u => open(u.problem.items))
      setAt(Math.max(0, i))
    }).catch(() => toast('题目没取到，稍后再试', 'error'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const items = units?.flatMap(u => u.problem.items) ?? []
  const answered = items.filter(i => chosen[i.id]).length
  const right = correct ? items.filter(i => chosen[i.id] && chosen[i.id] === correct[i.id]).length : 0

  const choose = async (itemId: string, option: string) => {
    if (correct) return
    const before = chosen[itemId]
    setChosen(c => ({ ...c, [itemId]: option }))
    try { await answerPractice(itemId, option, runId) } catch {
      setChosen(c => { const n = { ...c }; if (before) n[itemId] = before; else delete n[itemId]; return n })
      toast('没记上，请再选一次', 'error')
    }
  }

  const submit = async () => {
    setSending(true)
    try {
      await submitRun(runId)
      const r = await getPractice(category, level, runId)
      setCorrect(r.correct)
      setConfirm(false)
      setAt(0)
      document.getElementById('practice-scroll')?.scrollTo({ top: 0 })
    } catch {
      toast('没提交上，请再试一次', 'error')
    } finally {
      setSending(false)
    }
  }

  const header = (
    <header className="h-14 shrink-0 flex items-center gap-3 px-3 md:px-6 border-b border-border">
      <button type="button" onClick={onExit} className="flex items-center gap-0.5 text-sm text-fg-muted hover:text-fg h-10 pr-2">
        <ChevronLeft className="w-4 h-4" />回到试卷
      </button>
      <span className="text-xs font-semibold rounded-full border border-fg px-2.5 py-0.5 text-fg">练习 · {label}</span>
      {units && (
        <span className="ml-auto flex items-center gap-3 text-xs text-fg-muted tabular-nums">
          {correct
            ? <span className="text-sm">对 <b className="text-fg">{right}</b> / {items.length}</span>
            : <>
                <span>已答 {answered} / {items.length}</span>
                <span className="hidden sm:block w-32 h-1.5 rounded-full bg-border overflow-hidden">
                  <span className="block h-full bg-fg" style={{ width: `${(answered / Math.max(1, items.length)) * 100}%` }} />
                </span>
                <button type="button" onClick={() => setConfirm(true)} className="btn-primary h-9">提交</button>
              </>}
        </span>
      )}
    </header>
  )

  if (!units) {
    return <div className="flex-1 flex flex-col">{header}<div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div></div>
  }

  const ready = states ? Object.values(states).filter(v => v === 'ready').length : 0
  const failedN = states ? Object.values(states).filter(v => v === 'failed').length : 0
  const pendingN = states ? Object.values(states).filter(v => v === 'pending').length : items.length
  const analysesLine = correct && (
    <span className="flex items-center gap-2 text-sm">
      {pendingN > 0 ? (
        <><Thinking className="w-4 h-4" /><span className="text-fg-muted tabular-nums">解析生成中 {ready} / {items.length}</span></>
      ) : failedN > 0 ? (
        <><span className="text-danger-fg tabular-nums">{failedN} 题解析没生成出来</span>
          <button type="button" onClick={() => { void retryRunAnalyses(runId).then(() => setPoll(p => p + 1)) }}
                  className="btn h-7 text-xs border border-border text-fg">重试</button></>
      ) : (
        <><Connected className="w-4 h-4" /><span className="text-success-fg">解析已全部生成</span></>
      )}
    </span>
  )

  const summary = correct && (
    <div className="rounded-2xl border-[1.5px] border-fg bg-surface px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-sans animate-pop-in">
      <span className="text-lg font-bold text-fg">对 {right} / {items.length}</span>
      {answered < items.length && <span className="text-sm text-fg-muted">{items.length - answered} 题没答</span>}
      {analysesLine}
      <span className="ml-auto flex gap-2">
        <button type="button" onClick={onExit} className="btn h-10 border border-border text-fg">回到试卷</button>
        <button type="button" onClick={onAgain} className="btn-primary h-10">再做一遍</button>
      </span>
    </div>
  )

  const confirmDialog = confirm && (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setConfirm(false)} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-sm bg-surface rounded-2xl p-6 flex flex-col gap-4 animate-pop-in">
        <h2 className="text-lg font-bold text-fg">提交？</h2>
        <p className="text-sm text-fg-muted">{answered < items.length ? `还有 ${items.length - answered} 题没答。` : '都答完了。'}提交后不能再改。</p>
        <div className="flex gap-3 justify-end">
          <button type="button" onClick={() => setConfirm(false)} className="btn h-10 border border-border text-fg">再看看</button>
          <button type="button" disabled={sending} onClick={() => void submit()} className="btn-primary h-10">提交</button>
        </div>
      </div>
    </div>
  )

  const after = (unit: { paper: string; problem: PracticeUnit['problem'] }) => (it: ItemSchema) => correct && onOpenAnalysis && (
    <button type="button" onClick={() => onOpenAnalysis({ paper: unit.paper, section: '', problem: unit.problem }, it.id)}
            className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
      <span className="underline underline-offset-4">看完整解析 ›</span>
      {states?.[it.id] === 'ready' ? <Check className="w-3.5 h-3.5 text-success-fg" aria-label="解析已生成" />
        : states?.[it.id] === 'failed' ? <span className="text-xs text-danger-fg">没生成出来</span>
        : <span className="inline-flex items-center gap-1 text-xs text-fg-subtle"><Loader2 className="w-3 h-3 animate-spin" />生成中</span>}
    </button>
  )

  // Desktop: the paper's 問題 as printed pages
  if (desktop) {
    const pages = pagesOf(units)
    const page = pages[Math.min(at, pages.length - 1)]
    const firstOfBan = (it: ItemSchema) => page.problem.items.find(x => (x.meta?.ban ?? x.id) === (it.meta?.ban ?? it.id))?.id === it.id
    const last = at + 1 >= pages.length
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {header}
        <div id="practice-scroll" className="flex-1 min-h-0 overflow-y-auto bg-accent-light/50 px-8 py-8">
          <div className="max-w-3xl mx-auto flex flex-col gap-5">
            {summary}
            <div key={page.problem.id} className="animate-fade-in">
              <PaperPage problem={page.problem} answers={chosen} correct={correct ?? undefined} listeningFirstOf={firstOfBan}
                         onChoose={(id, o) => void choose(id, o)} after={after(page)} />
            </div>
            <div className="flex items-center gap-3">
              <button type="button" disabled={at === 0} onClick={() => setAt(a => a - 1)}
                      className="btn h-10 border border-border bg-surface text-fg disabled:opacity-30"><ChevronLeft className="w-4 h-4" />上一个大题</button>
              {!last ? (
                <button type="button" onClick={() => { setAt(a => a + 1); document.getElementById('practice-scroll')?.scrollTo({ top: 0 }) }}
                        className="ml-auto btn-primary h-10 px-5">下一个大题（{pages[at + 1].problem.name}）<ChevronRight className="w-4 h-4" /></button>
              ) : !correct && (
                <button type="button" onClick={() => setConfirm(true)} className="ml-auto btn-primary h-10 px-5">提交</button>
              )}
            </div>
          </div>
        </div>
        {confirmDialog}
      </div>
    )
  }

  // Phone: one question (or one passage with its questions) to a screen
  const unit = units[Math.min(at, units.length - 1)]
  const prob = unit.problem
  const listening = prob.type === 'listening'
  const passage = prob.items[0]?.passage || prob.passage
  const pageImgs = prob.media.filter(m => m.caption?.includes('試験用紙'))
  const lastUnit = at + 1 >= units.length

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {header}
      <div id="practice-scroll" className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6 flex flex-col gap-6">
          {at === 0 && summary}
          <div key={at} className="flex flex-col gap-6 animate-rise-in">
            <p className="text-xs text-fg-subtle">{prob.name} · {at + 1} / {units.length}</p>
            {listening && prob.items[0] && <PlayAudio itemId={prob.items[0].id} />}
            {pageImgs.length > 0 ? pageImgs.map(m => (
              <img key={m.id} src={m.url} alt={m.caption ?? '试卷页面'} className="max-w-full rounded-lg border border-border" />
            )) : passage && !listening && (
              <div className="rounded-2xl bg-accent-light/60 px-5 py-5 font-jp text-lg leading-[2] text-fg"><Passage text={passage} /></div>
            )}
            {prob.items.map(item => (
              <section key={item.id} className="flex flex-col gap-4">
                <QuestionBlock item={item} type={prob.type} selected={chosen[item.id] ?? null} correct={correct ? correct[item.id] : null}
                               onSelect={correct ? undefined : opt => void choose(item.id, opt)} size={prob.items.length > 1 ? 'md' : 'lg'} />
                {after(unit)(item)}
              </section>
            ))}
            {listening && correct && prob.items[0]?.transcript && (
              <details className="rounded-xl border border-border px-4 py-3">
                <summary className="text-sm text-fg-muted cursor-pointer">听力原文</summary>
                <p className="mt-3 font-jp text-base leading-[1.9] text-fg whitespace-pre-wrap">{prob.items[0].transcript}</p>
              </details>
            )}
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button type="button" disabled={at === 0} onClick={() => setAt(a => a - 1)}
                    className="btn h-12 px-4 border border-border text-fg disabled:opacity-30"><ChevronLeft className="w-4 h-4" />上一题</button>
            {!lastUnit ? (
              <button type="button" onClick={() => setAt(a => a + 1)} className="ml-auto btn-primary h-12 px-6 text-base font-semibold">
                下一题<ChevronRight className="w-4 h-4" />
              </button>
            ) : correct ? (
              <button type="button" onClick={onExit} className="ml-auto btn h-12 px-6 border border-border text-fg">回到试卷</button>
            ) : (
              <button type="button" onClick={() => setConfirm(true)} className={clsx('ml-auto btn-primary h-12 px-6 text-base font-semibold')}>提交</button>
            )}
          </div>
        </div>
      </div>
      {confirmDialog}
    </div>
  )
}

/** One paper's units as its printed pages: a 問題 split into passages joins up again. */
function pagesOf(units: PracticeUnit[]): { paper: string; problem: PracticeUnit['problem'] }[] {
  const pages: { paper: string; problem: PracticeUnit['problem'] }[] = []
  for (const u of units) {
    const last = pages[pages.length - 1]
    if (last && last.problem.id === u.problem.id) last.problem = { ...last.problem, items: [...last.problem.items, ...u.problem.items] }
    else pages.push({ paper: u.paper, problem: u.problem })
  }
  return pages
}
