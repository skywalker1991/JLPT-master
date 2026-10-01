import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import type { Recitation, ReviewSettings, ReviewToday } from '../types'
import { getRecitations, getReviewSettings, getReviewToday, updateReviewSettings } from '../services/api'
import { useToast } from '../context/ToastContext'
import ReviewSession from '../components/review/ReviewSession'
import ReciteView from '../components/recite/ReciteView'
import Logo from '../components/shared/Logo'

const SECONDS_PER_CARD = 10

/**
 * 内化学习: today's work, which ends. What is due, plus a few new cards;
 * when it is done, it is done (with the option of a few more new ones).
 */
export default function InternalizePage() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const active = pathname === '/internalize'
  const [reciting, setReciting] = useState(false)
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
  const [settings, setSettings] = useState<ReviewSettings | null>(null)
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
    getReviewSettings().then(setSettings).catch(() => {})
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

  const save = async (patch: Partial<ReviewSettings>) => {
    try {
      setSettings(await updateReviewSettings(patch))
      void load()
    } catch {
      toast('设置没存上，请再试一次', 'error')
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

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-xl mx-auto px-4 md:px-0 py-5 md:py-10 flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-fg">内化学习</h1>
          <p className="text-xs text-fg-muted">{dateLabel()} · 今天要做的，做完就结束</p>
        </header>

        {today.library === 0 && !recite?.queue.length && !recite?.done.length ? (
          <Empty />
        ) : left === 0 ? (
          <section className="rounded-2xl border border-border bg-surface p-6 flex flex-col items-center gap-4 text-center">
            <motion.div initial={justFinished ? { scale: 0.6, opacity: 0, rotate: -20 } : false}
                        animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 14 }}>
              <Logo className="w-12 h-12 text-fg" />
            </motion.div>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-bold text-fg">{today.done_today > 0 ? '今天完成' : '今天没有要复习的'}</h2>
              <p className="text-sm text-fg-muted">
                {today.done_today > 0 ? `复习了 ${today.done_today} 张。明天再来。` : '新入库的词第二天开始出现在这里。'}
              </p>
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

        {recite && (recite.queue.length > 0 || recite.done.length > 0) && (
          <ReciteCard queue={recite.queue} doneCount={recite.done.length} onOpen={() => setReciting(true)} />
        )}

        {settings && today.library > 0 && (
          <section className="rounded-2xl border border-border bg-surface p-5 flex flex-col gap-4">
            <h2 className="text-xs font-semibold text-fg-subtle">设置</h2>
            <label htmlFor="new-per-day" className="flex items-center gap-3 text-sm text-fg">
              每天新卡上限
              <input id="new-per-day" type="number" min={0} max={200} defaultValue={settings.new_cards_per_day}
                     key={settings.new_cards_per_day}
                     onBlur={e => {
                       const v = Number(e.target.value)
                       if (Number.isFinite(v) && v !== settings.new_cards_per_day) void save({ new_cards_per_day: v })
                     }}
                     className="input ml-auto w-24 text-right tabular-nums" />
            </label>
            <label htmlFor="retention" className="flex items-center gap-3 text-sm text-fg">
              目标记住率
              <select id="retention" value={String(settings.desired_retention)}
                      onChange={e => void save({ desired_retention: Number(e.target.value) })}
                      className="input ml-auto w-24">
                {[0.8, 0.85, 0.9, 0.95].map(r => <option key={r} value={String(r)}>{Math.round(r * 100)}%</option>)}
              </select>
            </label>
            <p className="text-xs text-fg-subtle leading-relaxed">
              复习时间由算法（FSRS）按每个词单独计算，只看卡片上的「会 / 不会」。记住率越高，复习越频繁。
            </p>
          </section>
        )}
      </div>
    </div>
  )
}

function Empty() {
  return (
    <section className="flex flex-col gap-4 py-10">
      <Logo className="w-10 h-10 text-fg" />
      <h2 className="text-xl font-bold text-fg">今天没有要复习的</h2>
      <p className="text-sm text-fg-muted leading-relaxed">新入库的词第二天开始出现在这里，每天有限量，做完就结束。</p>
      <Link to="/" className="btn-primary h-12 justify-center text-base font-semibold">去读一段语料</Link>
    </section>
  )
}

function dateLabel() {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function ReciteCard({ queue, doneCount, onOpen }: { queue: Recitation[]; doneCount: number; onOpen: () => void }) {
  const first = queue[0]
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 flex flex-col gap-3">
      <div className="flex items-baseline">
        <h2 className="text-base font-bold text-fg">背诵</h2>
        <span className="ml-auto text-sm text-fg-muted">{queue.length ? `队列 ${queue.length} 段 · 一次一段` : `已背完 ${doneCount} 段`}</span>
      </div>
      {first ? (
        <>
          <p className="font-jp text-[0.9375rem] text-fg truncate">{first.sentences.map(s => s.text).join('')}</p>
          <p className="text-xs text-fg-subtle">正在背 · 已背出 {first.progress} / {first.sentences.length} 句 · 背完才出现下一段</p>
        </>
      ) : (
        <p className="text-sm text-fg-muted">队列是空的。在语料分析里读完一段，点「要背」。</p>
      )}
      <button type="button" onClick={onOpen} className="btn h-11 justify-center border border-border text-fg">
        {first ? (first.progress > 0 ? '继续背' : '开始背') : '看已背完的'}
      </button>
    </section>
  )
}
