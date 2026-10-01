import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronLeft, Layers, Loader2, Mic, SlidersHorizontal } from 'lucide-react'
import type { Recitation, ReviewToday } from '../types'
import { getRecitations, getReviewToday } from '../services/api'
import { useToast } from '../context/ToastContext'
import ReviewSession from '../components/review/ReviewSession'
import ReciteView from '../components/recite/ReciteView'
import Logo from '../components/shared/Logo'
import { Connected } from '../components/shared/Motion'

const SECONDS_PER_CARD = 10

/**
 * 提取练习: a hub of practice apps — 卡片 (spaced review of words and
 * grammar: today's work, which ends) and 背诵 — each opened as its own
 * screen. More kinds of practice join as more entries in the hub.
 */
export default function InternalizePage() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const active = pathname === '/internalize'
  const [reciting, setReciting] = useState(false)
  const [app, setApp] = useState<'cards' | null>(null)
  const [recite, setRecite] = useState<{ queue: Recitation[]; done: Recitation[] } | null>(null)

  // 语料分析's 「在背诵队列里」 links here with ?recite=1
  useEffect(() => {
    if (active && new URLSearchParams(search).get('recite')) {
      setReciting(true)
      navigate('/internalize', { replace: true })
    }
  }, [active, search, navigate])
  const { toast } = useToast()
  const [today, setToday] = useState<ReviewToday | null>(null)
  const [playing, setPlaying] = useState(false)
  const [extra, setExtra] = useState(0)
  const [justFinished, setJustFinished] = useState(false)

  const load = useCallback(async (more = extra) => {
    try {
      setToday(await getReviewToday(more))
    } catch {
      toast('今天的卡片没取到，稍后再试', 'error')
    }
  }, [extra, toast])

  useEffect(() => {
    if (!active || playing || reciting) return
    void load()
    getRecitations().then(setRecite).catch(() => {})
  }, [active, reciting]) // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(() => {
    setPlaying(false)
    setJustFinished(true)
    void load()
  }, [load])

  const moreNew = async () => {
    const more = extra + 10
    setExtra(more)
    setJustFinished(false)
    const next = await getReviewToday(more).catch(() => null)
    if (next) {
      setToday(next)
      if (next.cards.length > 0) setPlaying(true)
    }
  }

  if (reciting) return <ReciteView onBack={() => setReciting(false)} />

  if (playing && today && today.cards.length > 0) {
    return <ReviewSession cards={today.cards} onClose={() => { setPlaying(false); void load() }} onFinished={finish} />
  }

  if (!today) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>
  }

  const left = today.cards.length
  const total = today.done_today + left
  const minutes = Math.max(1, Math.round((left * SECONDS_PER_CARD) / 60))

  if (app === 'cards') {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <SubHeader title="卡片" onBack={() => setApp(null)}
                   action={<Link to="/settings#review" aria-label="复习设置" className="w-11 h-11 flex items-center justify-center text-fg-muted hover:text-fg"><SlidersHorizontal className="w-5 h-5" /></Link>} />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="max-w-xl mx-auto px-4 md:px-0 py-6 md:py-10 flex flex-col gap-4 animate-fade-in">
            {left === 0 ? (
              <section className="rounded-2xl border border-border bg-surface p-6 flex flex-col items-center gap-4 text-center">
                {justFinished ? <Connected className="w-12 h-12" /> : <Logo className="w-12 h-12 text-fg" />}
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-bold text-fg">{today.done_today > 0 ? '今天完成' : '今天没有要复习的'}</h2>
                  {today.done_today > 0 && <p className="text-sm text-fg-muted">复习了 {today.done_today} 张。明天再来。</p>}
                </div>
                {today.new_waiting > 0 && (
                  <button type="button" onClick={() => void moreNew()} className="btn h-10 border border-border text-fg">
                    再来 10 张新卡（还有 {today.new_waiting} 张没学）
                  </button>
                )}
              </section>
            ) : (
              <section className="rounded-2xl border border-border bg-surface p-5 flex flex-col gap-4">
                <div className="flex items-baseline">
                  <h2 className="text-base font-bold text-fg">单词和语法</h2>
                  <span className="ml-auto text-sm text-fg-muted">约 {minutes} 分钟</span>
                </div>
                <dl className="flex flex-col gap-3 text-sm">
                  <div className="flex items-baseline">
                    <dt className="text-fg-muted">到期复习</dt>
                    <dd className="ml-auto"><b className="text-lg text-fg tabular-nums">{today.due}</b> 张</dd>
                  </div>
                  <div className="flex items-baseline">
                    <dt className="text-fg-muted">新卡</dt>
                    <dd className="ml-auto"><b className="text-lg text-fg tabular-nums">{today.new}</b> / 上限 {today.new_limit}</dd>
                  </div>
                </dl>
                <div className="flex flex-col gap-1.5">
                  <div className="h-1.5 rounded-full bg-border overflow-hidden">
                    <div className="h-full bg-fg" style={{ width: `${total ? (today.done_today / total) * 100 : 0}%` }} />
                  </div>
                  <span className="text-xs text-fg-subtle tabular-nums">已完成 {today.done_today} / {total}</span>
                </div>
                <button type="button" onClick={() => setPlaying(true)} className="btn-primary h-12 justify-center text-base font-semibold">
                  {today.done_today > 0 ? '继续' : '开始'}
                </button>
              </section>
            )}
          </div>
        </div>
      </div>
    )
  }

  // The hub: each kind of practice is its own app. A new one is one more entry here.
  const first = recite?.queue[0]
  const apps: SubApp[] = [
    {
      id: 'cards', name: '卡片', icon: Layers,
      status: left > 0 ? `${left} 张 · 约 ${minutes} 分钟` : today.done_today > 0 ? '今天完成' : '今天没有要复习的',
      badge: left || null, done: left === 0 && today.done_today > 0,
      open: () => setApp('cards'),
    },
    {
      id: 'recite', name: '背诵', icon: Mic,
      status: first ? `正在背 · ${first.progress} / ${first.sentences.length} 句` : recite?.done.length ? `已背完 ${recite.done.length} 段` : '队列是空的',
      badge: recite?.queue.length || null, done: false,
      open: () => setReciting(true),
    },
  ]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 md:px-0 py-5 md:py-10 flex flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-fg">提取练习</h1>
          <p className="text-xs text-fg-muted">{dateLabel()}</p>
        </header>
        {today.library === 0 && !recite?.queue.length && !recite?.done.length ? <Empty /> : (
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            {apps.map(a => (
              <button key={a.id} type="button" onClick={a.open}
                      className="relative text-left rounded-2xl border border-border bg-surface p-4 md:p-5 flex flex-col gap-4 hover:border-fg-subtle hover:-translate-y-0.5 transition-[border-color,transform] duration-150">
                <span className="w-12 h-12 rounded-xl bg-fg text-bg flex items-center justify-center"><a.icon className="w-6 h-6" /></span>
                {a.badge != null && (
                  <span className="absolute top-3 right-3 min-w-[1.5rem] h-6 px-1.5 rounded-full bg-danger text-white text-xs font-bold tabular-nums flex items-center justify-center">{a.badge}</span>
                )}
                <span className="flex flex-col gap-0.5">
                  <span className="text-base font-bold text-fg">{a.name}</span>
                  <span className={clsx('text-xs truncate', a.done ? 'text-success-fg' : 'text-fg-muted')}>{a.status}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface SubApp {
  id: string
  name: string
  icon: React.ComponentType<{ className?: string }>
  /** One line of where it stands today */
  status: string
  /** What is waiting, if anything */
  badge: number | null
  done: boolean
  open: () => void
}

function SubHeader({ title, onBack, action }: { title: string; onBack: () => void; action?: React.ReactNode }) {
  return (
    <header className="h-14 shrink-0 flex items-center gap-1 px-1 md:px-4 border-b border-border">
      <button type="button" onClick={onBack} className="h-11 flex items-center gap-0.5 px-2 text-sm text-fg-muted hover:text-fg">
        <ChevronLeft className="w-4 h-4" />提取练习
      </button>
      <h1 className="text-base font-bold text-fg">{title}</h1>
      <span className="ml-auto">{action}</span>
    </header>
  )
}

function Empty() {
  return (
    <section className="flex flex-col gap-4 py-10">
      <Logo className="w-10 h-10 text-fg" />
      <h2 className="text-xl font-bold text-fg">今天没有要复习的</h2>
            <Link to="/" className="btn-primary h-12 justify-center text-base font-semibold">去精读一段</Link>
    </section>
  )
}

function dateLabel() {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
