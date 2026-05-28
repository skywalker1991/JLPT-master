// frontend/src/components/internalize/FlashCard.tsx
import { useRef, useState } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import clsx from 'clsx'
import type { InternalizeCard, SwipeResult } from '../../types'

interface Props {
  card: InternalizeCard
  stackIndex: number   // 0=top (interactive), 1=second, 2=third
  onSwipe: (result: SwipeResult) => void
}

function getCardStyle(level: string | null, type: string) {
  const typeGradient =
    type === 'vocabulary' ? 'from-blue-50 to-blue-100' : 'from-violet-50 to-violet-100'
  switch (level) {
    case 'N1': return { border: 'border-yellow-400', bg: `bg-gradient-to-br ${typeGradient}`, glow: 'shadow-[0_0_20px_4px_rgba(234,179,8,0.3)]', particle: true,  label: 'text-yellow-700' }
    case 'N2': return { border: 'border-slate-400',  bg: `bg-gradient-to-br ${typeGradient}`, glow: 'shadow-[0_0_12px_2px_rgba(148,163,184,0.3)]', particle: false, label: 'text-slate-700' }
    case 'N3': return { border: 'border-amber-500',  bg: `bg-gradient-to-br ${typeGradient}`, glow: '', particle: false, label: 'text-amber-700' }
    case 'N4': return { border: 'border-amber-300',  bg: `bg-gradient-to-br from-amber-50 ${type === 'vocabulary' ? 'to-blue-50' : 'to-violet-50'}`, glow: '', particle: false, label: 'text-amber-600' }
    default:   return { border: 'border-gray-200',   bg: 'bg-white', glow: '', particle: false, label: 'text-gray-500' }
  }
}

function ShimmerOverlay() {
  return (
    <motion.div
      className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none"
      animate={{ opacity: [0, 0.6, 0] }}
      transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent animate-shimmer" />
    </motion.div>
  )
}

function GoldParticles() {
  return (
    <div className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-yellow-400"
          style={{ top: `${(i * 13 + 5) % 100}%`, left: `${(i * 17 + 10) % 100}%` }}
          animate={{ opacity: [0, 1, 0], scale: [0, 1.5, 0], y: [0, -20] }}
          transition={{ duration: 1.5 + (i % 3) * 0.4, repeat: Infinity, delay: i * 0.3 }}
        />
      ))}
    </div>
  )
}

function CardShell({
  backface,
  children,
}: {
  backface: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className="absolute inset-0 rounded-2xl p-5 flex flex-col"
      style={{
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: backface ? 'rotateY(180deg)' : 'rotateY(0deg)',
      }}
    >
      {children}
    </div>
  )
}

export default function FlashCard({ card, stackIndex, onSwipe }: Props) {
  const [isFlipped, setIsFlipped] = useState(false)
  const swipeDirRef = useRef<'left' | 'right' | null>(null)
  const isTop = stackIndex === 0

  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 0, 200], [-18, 0, 18])
  const leftOpacity  = useTransform(x, [-200, -60, 0], [1, 0.8, 0])
  const rightOpacity = useTransform(x, [0, 60, 200], [0, 0.8, 1])

  const style = getCardStyle(card.jlpt_level, card.type)
  const isN1 = card.jlpt_level === 'N1'

  const stackVariants: Record<number, object> = {
    0: { scale: 1,    y: 0,  opacity: 1   },
    1: { scale: 0.95, y: 12, opacity: 1   },
    2: { scale: 0.90, y: 24, opacity: 0.7 },
  }

  const reading  = card.properties.find(p => p.kind === 'reading')?.value
  const meanings = card.properties.filter(p => p.kind === 'meaning').map(p => p.value)
  const examples = card.properties.filter(p => p.kind === 'example').map(p => p.value)
  const others   = card.properties.filter(
    p => !['reading', 'meaning', 'example'].includes(p.kind)
  )

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    if (!isFlipped) return
    const { offset, velocity } = info
    if (offset.x > 80 || velocity.x > 500) {
      swipeDirRef.current = 'right'
      onSwipe('know')
    } else if (offset.x < -80 || velocity.x < -500) {
      swipeDirRef.current = 'left'
      ;(animate(x, [x.get(), x.get() - 10, x.get() + 7, x.get() - 4, 0], {
        duration: 0.22,
      }) as unknown as Promise<void>).then(() => onSwipe('unknown'))
    } else {
      animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 })
    }
  }

  function handleTap() {
    if (isTop && Math.abs(x.get()) < 5) setIsFlipped(f => !f)
  }

  return (
    <>
      {isTop && isN1 && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.35, 0] }}
          transition={{ duration: 0.8, times: [0, 0.3, 1] }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <motion.div
            className="w-40 h-40 rounded-full bg-yellow-300/60"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 4] }}
            transition={{ duration: 0.6 }}
            style={{ filter: 'blur(20px)' }}
          />
        </motion.div>
      )}

      <motion.div
        className="absolute w-72 h-[420px]"
        style={{
          x: isTop ? x : 0,
          rotate: isTop ? rotate : 0,
          zIndex: 30 - stackIndex * 10,
          top: '50%',
          left: '50%',
          marginTop: -210,
          marginLeft: -144,
        }}
        initial={isTop && isN1 ? { y: -120, scale: 1.2, opacity: 0 } : { opacity: 1 }}
        animate={stackVariants[stackIndex] ?? stackVariants[2]}
        transition={
          isTop && isN1
            ? { type: 'spring', stiffness: 200, damping: 18 }
            : { type: 'spring', stiffness: 300, damping: 28 }
        }
        drag={isTop && isFlipped ? 'x' : false}
        dragConstraints={{ left: -250, right: 250 }}
        dragElastic={0.15}
        onDragEnd={isTop ? handleDragEnd : undefined}
        onTap={handleTap}
        custom={swipeDirRef.current}
        variants={{
          exit: (dir: 'left' | 'right' | null) => ({
            x: dir === 'right' ? 700 : dir === 'left' ? -700 : 0,
            rotate: dir === 'right' ? 20 : -20,
            opacity: 0,
            transition: { duration: 0.28, ease: 'easeIn' },
          }),
        }}
        exit="exit"
      >
        <div className="relative w-full h-full" style={{ perspective: '1000px' }}>
          <motion.div
            className="relative w-full h-full"
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            style={{ transformStyle: 'preserve-3d' }}
          >
            {/* ── FRONT ───────────────────────────────────────────── */}
            <CardShell backface={false}>
              <div className={clsx('absolute inset-0 rounded-2xl border-2', style.border, style.bg, style.glow)} />
              {style.particle && <GoldParticles />}
              {card.jlpt_level === 'N2' && <ShimmerOverlay />}

              <div className="relative flex flex-col h-full">
                <div className="flex items-center justify-between">
                  <span className={clsx(
                    'text-xs font-semibold px-2 py-0.5 rounded-md',
                    card.type === 'vocabulary' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700',
                  )}>
                    {card.type === 'vocabulary' ? '词汇' : '语法'}
                  </span>
                  {card.jlpt_level && (
                    <span className={clsx('text-xs font-bold', style.label)}>{card.jlpt_level}</span>
                  )}
                </div>

                <div className="flex-1 flex items-center justify-center">
                  <p className="text-5xl font-bold text-fg text-center leading-tight">{card.key}</p>
                </div>

                <p className="text-center text-xs text-fg-subtle pb-1">点击翻转</p>
              </div>
            </CardShell>

            {/* ── BACK ────────────────────────────────────────────── */}
            <CardShell backface={true}>
              <div className={clsx('absolute inset-0 rounded-2xl border-2', style.border, style.bg)} />

              <div className="relative flex flex-col h-full">
                <div className="flex items-center justify-between mb-3">
                  <span className={clsx(
                    'text-xs font-semibold px-2 py-0.5 rounded-md',
                    card.type === 'vocabulary' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700',
                  )}>
                    {card.type === 'vocabulary' ? '词汇' : '语法'}
                  </span>
                  {card.jlpt_level && (
                    <span className={clsx('text-xs font-bold', style.label)}>{card.jlpt_level}</span>
                  )}
                </div>

                <div className="flex items-center justify-center py-4">
                  <ruby className="text-5xl font-bold text-fg leading-tight">
                    {card.key}
                    {reading && <rt className="text-sm font-normal text-fg-subtle">{reading}</rt>}
                  </ruby>
                </div>

                <div className="h-px bg-border mx-1 my-2" />

                <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                  {meanings.length > 0 && (
                    <p className="text-base font-medium text-fg leading-snug">
                      {meanings.join('；')}
                    </p>
                  )}

                  {examples.map((ex, i) => (
                    <p key={i} className="text-sm text-fg-subtle leading-snug">{ex}</p>
                  ))}

                  {others.length > 0 && (
                    <p className="text-xs text-fg-subtle/70">
                      {others.map(p => p.value).join(' · ')}
                    </p>
                  )}
                </div>

                <div className="h-px bg-border mx-1 my-2" />

                <div className="flex justify-between text-xs text-fg-subtle pb-1 px-1">
                  <span>← 不会</span>
                  <span>会 →</span>
                </div>
              </div>
            </CardShell>
          </motion.div>
        </div>

        {isTop && isFlipped && (
          <>
            <motion.div
              className="absolute inset-0 rounded-2xl flex items-center justify-center pointer-events-none"
              style={{ opacity: leftOpacity }}
            >
              <div className="absolute inset-0 rounded-2xl bg-red-400/30" />
              <span className="relative text-3xl font-black text-red-600 rotate-[-15deg]">不会</span>
            </motion.div>

            <motion.div
              className="absolute inset-0 rounded-2xl flex items-center justify-center pointer-events-none"
              style={{ opacity: rightOpacity }}
            >
              <div className="absolute inset-0 rounded-2xl bg-green-400/30" />
              <span className="relative text-3xl font-black text-green-600 rotate-[15deg]">会</span>
            </motion.div>
          </>
        )}
      </motion.div>
    </>
  )
}
