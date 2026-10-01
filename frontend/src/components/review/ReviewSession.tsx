import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion'
import clsx from 'clsx'
import { Check, X } from 'lucide-react'
import type { ReviewCard as Card } from '../../types'
import { postReview } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import ReviewCard, { fmt } from './ReviewCard'

interface Props {
  cards: Card[]
  onClose: () => void
  onFinished: () => void
}

type Item = Card & { again?: boolean }

const SWIPE = 90

/**
 * Today's cards, one at a time: look, think, flip, then swipe — right for
 * 会, left for 不会 (or the buttons, or ← → on a keyboard). A card answered
 * 不会 comes back once at the end of the session.
 */
export default function ReviewSession({ cards, onClose, onFinished }: Props) {
  const { toast } = useToast()
  const [queue, setQueue] = useState<Item[]>(cards)
  const [at, setAt] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [leaving, setLeaving] = useState<0 | 1 | -1>(0)
  const card = queue[at]

  const rate = useCallback((know: boolean) => {
    if (!card || !flipped) return
    postReview(card.atom_id, know ? 'know' : 'unknown').catch(() => toast('这张没记上，网络恢复后再试', 'error'))
    if (!know && !card.again) setQueue(q => [...q, { ...card, again: true }])
    setLeaving(know ? 1 : -1)
    setFlipped(false)
    setAt(i => i + 1)
  }, [card, flipped, toast])

  useEffect(() => {
    if (at >= queue.length && queue.length > 0) onFinished()
  }, [at, queue.length, onFinished])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped(f => !f) }
      else if (e.key === 'ArrowRight') rate(true)
      else if (e.key === 'ArrowLeft') rate(false)
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rate, onClose])

  if (!card) return null
  const progress = Math.min(at, queue.length) / queue.length

  return (
    <div className="fixed inset-0 z-50 bg-bg flex flex-col md:static md:z-auto md:flex-1 md:min-h-0"
         style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <header className="h-14 shrink-0 flex items-center gap-3 px-3 md:px-8 md:border-b md:border-border">
        <button type="button" onClick={onClose} aria-label="结束复习" className="w-10 h-10 flex items-center justify-center text-fg md:hidden">
          <X className="w-5 h-5" />
        </button>
        <span className="hidden md:inline text-sm text-fg-muted">单词和语法</span>
        <div className="flex-1 md:flex-none md:w-56 h-1.5 rounded-full bg-border overflow-hidden md:ml-auto" role="progressbar"
             aria-valuenow={at} aria-valuemax={queue.length} aria-label="今天的进度">
          <div className="h-full bg-fg transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="text-xs text-fg-muted tabular-nums w-12 text-right">{Math.min(at + 1, queue.length)} / {queue.length}</span>
        <button type="button" onClick={onClose} className="hidden md:inline-flex btn h-9 border border-border text-fg">结束</button>
      </header>

      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 flex flex-col items-center justify-center px-5 py-4 md:py-10 gap-6">
          <div className="relative w-full max-w-md md:max-w-2xl flex-1 md:flex-none md:h-[32rem] max-h-[40rem]">
            {/* the next card peeking from below */}
            {queue[at + 1] && (
              <div aria-hidden="true" className="absolute inset-x-3 -bottom-2 top-3 rounded-[1.75rem] border border-border bg-surface" />
            )}
            <AnimatePresence initial={false} custom={leaving}>
              <SwipeCard key={`${card.atom_id}-${at}`} leaving={leaving} flipped={flipped}
                         onFlip={() => setFlipped(f => !f)} onRate={rate}>
                <ReviewCard card={card} flipped={flipped} />
              </SwipeCard>
            </AnimatePresence>
          </div>

          <div className="w-full max-w-md md:max-w-2xl flex items-center justify-between">
            <button type="button" onClick={() => (flipped ? rate(false) : setFlipped(true))} aria-label="不会"
                    className="w-16 h-16 rounded-full border border-danger/40 text-danger flex items-center justify-center bg-surface md:hidden">
              <X className="w-6 h-6" />
            </button>
            <p className="text-xs text-fg-subtle text-center md:hidden">
              {flipped ? <>自己判断<br />← 不会　会 →</> : '← 不会　会 →'}
            </p>
            <div className="hidden md:flex items-center gap-6 mx-auto text-sm text-fg-muted">
              <span className="flex items-center gap-2"><kbd className="kbd">空格</kbd>翻面</span>
              <span className="flex items-center gap-2"><kbd className="kbd">←</kbd>不会</span>
              <span className="flex items-center gap-2"><kbd className="kbd">→</kbd>会</span>
            </div>
            <button type="button" onClick={() => (flipped ? rate(true) : setFlipped(true))} aria-label="会"
                    className="w-16 h-16 rounded-full bg-fg text-bg flex items-center justify-center md:hidden">
              <Check className="w-6 h-6" />
            </button>
          </div>
        </main>

        {/* Desktop: the sentences met, once the card is turned */}
        <aside className="hidden md:flex w-[24rem] shrink-0 border-l border-border flex-col gap-3 px-6 py-8 overflow-y-auto">
          <h2 className="flex items-baseline gap-2 text-sm font-semibold text-fg">
            遇到过的句子<span className="text-xs font-normal text-fg-subtle">翻面后显示；每次复习换一句</span>
          </h2>
          {flipped ? (card.sentences.length > 0 ? card.sentences.map((s, i) => (
            <div key={i} className={clsx('rounded-xl px-3.5 py-3 flex flex-col gap-1', s.current ? 'bg-accent-light' : '')}>
              <p className="font-jp text-[0.9375rem] leading-relaxed text-fg">{s.text}</p>
              <p className="text-[11px] text-fg-subtle">{fmt(s.met_at)} · {s.source}{s.current ? ' · 这次' : ''}</p>
            </div>
          )) : <p className="text-sm text-fg-subtle">还没有遇到过的句子</p>) : (
            <p className="text-sm text-fg-subtle">先想一想，再翻面</p>
          )}
          <p className="text-xs text-fg-subtle leading-relaxed pt-2">熟了以后，正面会从「划出词」变成「挖空＋中文」，操作不变。</p>
        </aside>
      </div>
    </div>
  )
}

function SwipeCard({ children, leaving, flipped, onFlip, onRate }: {
  children: React.ReactNode
  leaving: 0 | 1 | -1
  flipped: boolean
  onFlip: () => void
  onRate: (know: boolean) => void
}) {
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 200], [-8, 8])
  return (
    <motion.div
      role="button"
      tabIndex={0}
      aria-label={flipped ? '卡片背面，左右滑动评分' : '卡片正面，点击翻面'}
      onClick={onFlip}
      drag={flipped ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.8}
      onDragEnd={(_, info) => {
        if (info.offset.x > SWIPE) onRate(true)
        else if (info.offset.x < -SWIPE) onRate(false)
      }}
      style={{ x, rotate }}
      custom={leaving}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      variants={{ out: (dir: number) => ({ x: dir * 420, opacity: 0, rotate: dir * 10, transition: { duration: 0.25 } }) }}
      exit="out"
      transition={{ duration: 0.2 }}
      className="absolute inset-0 rounded-[1.75rem] border border-border bg-surface shadow-card px-6 py-7 md:px-12 md:py-10
                 flex flex-col cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40
                 overflow-y-auto"
    >
      {children}
    </motion.div>
  )
}
