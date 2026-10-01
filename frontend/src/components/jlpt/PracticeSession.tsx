import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { ItemSchema, PracticeUnit } from '../../types'
import PaperPage from './PaperPage'
import { useIsDesktop } from '../../hooks/useIsDesktop'
import { answerPractice, getPractice } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import Passage from '../exam/Passage'
import PlayAudio from '../exam/PlayAudio'
import QuestionBlock from './QuestionBlock'
import DiffBox from './DiffBox'
import { Connected } from '../shared/Motion'

interface Result { chosen: string; correct: string; right: boolean }

/**
 * Practice one question type across papers: no clock, and each answer is
 * told at once — the right option, the one chosen, and 差在哪.
 */
export default function PracticeSession({ category, level, paperId, label, onExit, onOpenAnalysis }: {
  category: string
  level: string
  /** One paper's questions of this kind, as printed (otherwise a mixed set) */
  paperId?: string | null
  label: string
  onExit: () => void
  onOpenAnalysis?: (unit: PracticeUnit, itemId: string) => void
}) {
  const { toast } = useToast()
  const [units, setUnits] = useState<PracticeUnit[] | null>(null)
  const [at, setAt] = useState(0)
  const [results, setResults] = useState<Record<string, Result>>({})
  const [round, setRound] = useState(0)
  const desktop = useIsDesktop()

  // Drawing a set also starts its explanations on the server, so draw each
  // set once (React may run this effect twice in development).
  const drawn = useRef<string | null>(null)
  useEffect(() => {
    const key = `${category}#${round}`
    if (drawn.current === key) return
    drawn.current = key
    setUnits(null)
    setAt(0)
    getPractice(category, level, paperId).then(r => setUnits(r.units)).catch(() => toast('题目没取到，稍后再试', 'error'))
  }, [category, round, toast])

  const all = Object.values(results)
  const right = all.filter(r => r.right).length

  const answer = async (itemId: string, option: string) => {
    if (results[itemId]) return
    try {
      const r = await answerPractice(itemId, option)
      setResults(prev => ({ ...prev, [itemId]: { chosen: option, correct: r.correct_answer ?? '', right: r.is_correct } }))
    } catch {
      toast('没记上，请再选一次', 'error')
    }
  }

  const header = (
    <header className="h-14 shrink-0 flex items-center gap-3 px-3 md:px-6 border-b border-border">
      <button type="button" onClick={onExit} className="flex items-center gap-0.5 text-sm text-fg-muted hover:text-fg h-10 pr-2">
        <ChevronLeft className="w-4 h-4" />{paperId ? '回到试卷' : '结束练习'}
      </button>
      <span className="text-xs font-semibold rounded-full border border-fg px-2.5 py-0.5 text-fg">练习 · {label}</span>
      {units && units.length > 0 && (
        <span className="ml-auto flex items-center gap-3 text-xs text-fg-muted tabular-nums">
          <span>{desktop && paperId
            ? `已答 ${all.length} / ${units.reduce((n, u) => n + u.problem.items.length, 0)}`
            : `${Math.min(at + 1, units.length)} / ${units.length}`}</span>
          <span className="hidden sm:block w-40 h-1.5 rounded-full bg-border overflow-hidden">
            <span className="block h-full bg-fg" style={{ width: `${(desktop && paperId
              ? all.length / Math.max(1, units.reduce((n, u) => n + u.problem.items.length, 0))
              : Math.min(at, units.length) / units.length) * 100}%` }} />
          </span>
          <span>对 {right} · 错 {all.length - right}</span>
        </span>
      )}
    </header>
  )

  if (!units) {
    return <div className="flex-1 flex flex-col">{header}<div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div></div>
  }

  if (at >= units.length) {
    return (
      <div className="flex-1 flex flex-col">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
          <Connected className="w-12 h-12" />
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold text-fg">{paperId ? '这一类做完了' : '这组练完了'}</h2>
            <p className="text-sm text-fg-muted">对 {right} 题，错 {all.length - right} 题。错的会在之后的练习里再出现。</p>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onExit} className="btn h-11 px-5 border border-border text-fg">{paperId ? '回到试卷' : '回到 JLPT'}</button>
            <button type="button" onClick={() => { setResults({}); setRound(r => r + 1) }} className="btn-primary h-11 px-5">{paperId ? '再做一遍' : '再练一组'}</button>
          </div>
        </div>
      </div>
    )
  }

  // Desktop, one paper: its 問題 as printed pages, right / wrong under each answer
  if (desktop && paperId) {
    const pages: { paper: string; problem: PracticeUnit['problem'] }[] = []
    for (const u of units) {
      const last = pages[pages.length - 1]
      if (last && last.problem.id === u.problem.id) last.problem = { ...last.problem, items: [...last.problem.items, ...u.problem.items] }
      else pages.push({ paper: u.paper, problem: u.problem })
    }
    const page = pages[Math.min(at, pages.length - 1)]
    const chosen = Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.chosen]))
    const correct = Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.correct]))
    const firstOfBan = (it: ItemSchema) => page.problem.items.find(x => (x.meta?.ban ?? x.id) === (it.meta?.ban ?? it.id))?.id === it.id
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {header}
        <div className="flex-1 min-h-0 overflow-y-auto bg-accent-light/50 px-8 py-8">
          <div key={page.problem.id} className="max-w-3xl mx-auto flex flex-col gap-5 animate-fade-in">
            <PaperPage problem={page.problem} answers={chosen} correct={correct} listeningFirstOf={firstOfBan}
                       onChoose={(id, o) => void answer(id, o)}
                       after={it => results[it.id] && (
                         <div className="flex flex-col gap-2 pt-1">
                           <DiffBox itemId={it.id} type={page.problem.type} chosen={results[it.id].chosen} correct={results[it.id].correct} />
                           {onOpenAnalysis && (
                             <button type="button" onClick={() => onOpenAnalysis({ paper: page.paper, section: '', problem: page.problem }, it.id)}
                                     className="self-start text-sm text-fg underline underline-offset-4">看完整解析 ›</button>
                           )}
                         </div>
                       )} />
            <div className="flex items-center gap-3">
              <button type="button" disabled={at === 0} onClick={() => setAt(a => a - 1)}
                      className="btn h-10 border border-border bg-surface text-fg disabled:opacity-30"><ChevronLeft className="w-4 h-4" />上一个大题</button>
              <button type="button" onClick={() => setAt(a => (a + 1 >= pages.length ? units.length : a + 1))} className="ml-auto btn-primary h-10 px-5">
                {at + 1 < pages.length ? <>下一个大题（{pages[at + 1].problem.name}）<ChevronRight className="w-4 h-4" /></> : '做完了'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const unit = units[at]
  const prob = unit.problem
  const listening = prob.type === 'listening'
  const passage = prob.items[0]?.passage || prob.passage
  const pages = prob.media.filter(m => m.caption?.includes('試験用紙'))
  const done = prob.items.every(i => results[i.id])

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {header}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div key={at} className="max-w-3xl mx-auto px-5 md:px-8 py-6 md:py-10 flex flex-col gap-6 animate-rise-in">
          <p className="text-xs text-fg-subtle">{unit.paper} · {prob.name}{prob.instruction ? ` · ${prob.instruction}` : ''}</p>

          {listening && prob.items[0] && <PlayAudio itemId={prob.items[0].id} />}
          {pages.length > 0 ? pages.map(m => (
            <img key={m.id} src={m.url} alt={m.caption ?? '试卷页面'} className="max-w-full rounded-lg border border-border" />
          )) : passage && !listening && (
            <div className="rounded-2xl bg-accent-light/60 px-5 py-5 font-jp text-lg leading-[2] text-fg">
              <Passage text={passage} />
            </div>
          )}

          {prob.items.map(item => {
            const r = results[item.id]
            return (
              <section key={item.id} className="flex flex-col gap-4">
                <QuestionBlock item={item} type={prob.type} selected={r?.chosen ?? null} correct={r?.correct}
                               onSelect={opt => void answer(item.id, opt)} size={prob.items.length > 1 ? 'md' : 'lg'} />
                {r && <DiffBox itemId={item.id} type={prob.type} chosen={r.chosen} correct={r.correct} />}
                {r && onOpenAnalysis && (
                  <button type="button" onClick={() => onOpenAnalysis(unit, item.id)}
                          className="self-start text-sm text-fg underline underline-offset-4">
                    看完整解析 ›
                  </button>
                )}
              </section>
            )
          })}

          {listening && done && prob.items[0]?.transcript && (
            <details className="rounded-xl border border-border px-4 py-3">
              <summary className="text-sm text-fg-muted cursor-pointer">听力原文</summary>
              <p className="mt-3 font-jp text-base leading-[1.9] text-fg whitespace-pre-wrap">{prob.items[0].transcript}</p>
            </details>
          )}

          <div className="flex justify-end pt-2">
            <button type="button" disabled={!done} onClick={() => setAt(a => a + 1)}
                    className={clsx('btn-primary h-12 px-6 text-base font-semibold', !done && 'opacity-40')}>
              {at + 1 < units.length ? (prob.items.length > 1 ? '下一篇' : '下一题') : '看结果'}<ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
