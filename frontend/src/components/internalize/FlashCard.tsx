// frontend/src/components/internalize/FlashCard.tsx
import { useRef, useState } from 'react'
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
} from 'framer-motion'
import clsx from 'clsx'
import type { InternalizeCard, SwipeResult } from '../../types'

interface Props {
  card: InternalizeCard
  stackIndex: number      // 0=顶部可交互, 1=第二张, 2=第三张
  promptType: string
  onSwipe: (result: SwipeResult) => void
}

// 按 JLPT 等级返回卡牌样式配置
function getCardStyle(level: string | null, type: string) {
  const typeGradient =
    type === 'vocabulary'
      ? 'from-blue-50 to-blue-100'
      : 'from-violet-50 to-violet-100'

  switch (level) {
    case 'N1':
      return {
        border: 'border-yellow-400',
        bg: `bg-gradient-to-br ${typeGradient}`,
        glow: 'shadow-[0_0_20px_4px_rgba(234,179,8,0.3)]',
        particle: true,
        label: 'text-yellow-700',
      }
    case 'N2':
      return {
        border: 'border-slate-400',
        bg: `bg-gradient-to-br ${typeGradient}`,
        glow: 'shadow-[0_0_12px_2px_rgba(148,163,184,0.3)]',
        particle: false,
        label: 'text-slate-700',
      }
    case 'N3':
      return {
        border: 'border-amber-500',
        bg: `bg-gradient-to-br ${typeGradient}`,
        glow: '',
        particle: false,
        label: 'text-amber-700',
      }
    case 'N4':
      return {
        border: 'border-amber-300',
        bg: `bg-gradient-to-br from-amber-50 ${type === 'vocabulary' ? 'to-blue-50' : 'to-violet-50'}`,
        glow: '',
        particle: false,
        label: 'text-amber-600',
      }
    default: // N5 或无等级
      return {
        border: 'border-gray-200',
        bg: 'bg-white',
        glow: '',
        particle: false,
        label: 'text-gray-500',
      }
  }
}

// N2 扫光动画
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

// N1 粒子边框效果
function GoldParticles() {
  const particles = Array.from({ length: 8 })
  return (
    <div className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden">
      {particles.map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-yellow-400"
          style={{
            top: `${(i * 13 + 5) % 100}%`,
            left: `${(i * 17 + 10) % 100}%`,
          }}
          animate={{
            opacity: [0, 1, 0],
            scale: [0, 1.5, 0],
            y: [0, -20],
          }}
          transition={{
            duration: 1.5 + (i % 3) * 0.4,
            repeat: Infinity,
            delay: i * 0.3,
          }}
        />
      ))}
    </div>
  )
}

// 卡牌面（正面/背面共用外壳，通过 rotateY 翻转）
function CardFace({
  children,
  backface,
}: {
  children: React.ReactNode
  backface: boolean
}) {
  return (
    <div
      className="absolute inset-0 rounded-2xl p-6 flex flex-col"
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

export default function FlashCard({ card, stackIndex, promptType, onSwipe }: Props) {
  const [isFlipped, setIsFlipped] = useState(false)
  const swipeDirRef = useRef<'left' | 'right' | null>(null)
  const isTop = stackIndex === 0

  const x = useMotionValue(0)
  const rotate = useTransform(x, [-220, 0, 220], [-18, 0, 18])
  const leftOverlayOpacity = useTransform(x, [-220, -60, 0], [1, 0.8, 0])
  const rightOverlayOpacity = useTransform(x, [0, 60, 220], [0, 0.8, 1])

  const style = getCardStyle(card.jlpt_level, card.type)

  // 堆叠层偏移动画
  const stackVariants: Record<number, object> = {
    0: { scale: 1, y: 0, opacity: 1 },
    1: { scale: 0.95, y: 10, opacity: 1 },
    2: { scale: 0.90, y: 20, opacity: 0.7 },
  }
  const stackAnim = stackVariants[stackIndex] ?? stackVariants[2]

  // N1 传说降临动画：顶牌首次出现时特殊进入
  const isN1 = card.jlpt_level === 'N1'
  const initialAnim = isTop && isN1
    ? { y: -120, scale: 1.2, opacity: 0 }
    : { opacity: 1 }
  const enterTransition = isTop && isN1
    ? { type: 'spring' as const, stiffness: 200, damping: 18, duration: 0.6 }
    : { type: 'spring' as const, stiffness: 300, damping: 28 }

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const { offset, velocity } = info
    if (offset.x > 80 || velocity.x > 500) {
      swipeDirRef.current = 'right'
      onSwipe('know')
    } else if (offset.x < -80 || velocity.x < -500) {
      swipeDirRef.current = 'left'
      // 短震动后触发划出
      ;(animate(x, [x.get(), x.get() - 10, x.get() + 7, x.get() - 4, 0], {
        duration: 0.22,
      }) as unknown as Promise<void>).then(() => onSwipe('unknown'))
    } else {
      animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 })
    }
  }

  function handleTap() {
    if (isTop && Math.abs(x.get()) < 5) {
      setIsFlipped((f) => !f)
    }
  }

  const propertyGroups = card.properties.reduce<Record<string, string[]>>((acc, p) => {
    acc[p.kind] = acc[p.kind] ?? []
    acc[p.kind].push(p.value)
    return acc
  }, {})

  return (
    <>
      {/* N1 暗场光环（顶牌且为N1时） */}
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
        className="absolute inset-x-4 top-4 bottom-4"
        style={{ x: isTop ? x : 0, rotate: isTop ? rotate : 0, zIndex: 30 - stackIndex * 10 }}
        initial={initialAnim}
        animate={stackAnim}
        transition={enterTransition}
        drag={isTop ? 'x' : false}
        dragConstraints={{ left: -300, right: 300 }}
        dragElastic={0.15}
        onDragEnd={isTop ? handleDragEnd : undefined}
        onTap={handleTap}
        custom={swipeDirRef.current}
        variants={{
          exit: (dir: 'left' | 'right' | null) => ({
            x: dir === 'right' ? 600 : dir === 'left' ? -600 : 0,
            rotate: dir === 'right' ? 20 : -20,
            opacity: 0,
            transition: { duration: 0.28, ease: 'easeIn' },
          }),
        }}
        exit="exit"
      >
        {/* 卡牌主体（3D 翻转容器） */}
        <div
          className="relative w-full h-full"
          style={{ perspective: '1000px' }}
        >
          <motion.div
            className="relative w-full h-full"
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            style={{ transformStyle: 'preserve-3d' }}
          >
            {/* 正面 */}
            <CardFace backface={false}>
              <div
                className={clsx(
                  'absolute inset-0 rounded-2xl border-2',
                  style.border,
                  style.bg,
                  style.glow,
                )}
              />
              {style.particle && <GoldParticles />}
              {card.jlpt_level === 'N2' && <ShimmerOverlay />}

              {/* 内容层 */}
              <div className="relative flex flex-col h-full">
                {/* 顶部标签行 */}
                <div className="flex items-center justify-between mb-4">
                  <span className={clsx(
                    'text-xs font-semibold px-2 py-0.5 rounded-md',
                    card.type === 'vocabulary'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-violet-100 text-violet-700',
                  )}>
                    {card.type === 'vocabulary' ? '词汇' : '语法'}
                  </span>
                  {card.jlpt_level && (
                    <span className={clsx('text-xs font-bold', style.label)}>
                      {card.jlpt_level}
                    </span>
                  )}
                </div>

                {/* 提示内容（居中大字） */}
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                  <p className="text-4xl font-bold text-fg leading-tight">
                    {card.prompt_value ?? card.key}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {promptType === 'meaning' ? '中文释义' : promptType === 'reading' ? '读音' : '例句'}
                  </p>
                </div>

                {/* 底部提示 */}
                <p className="text-center text-xs text-fg-subtle">点击翻转查看</p>
              </div>
            </CardFace>

            {/* 背面 */}
            <CardFace backface={true}>
              <div className={clsx('absolute inset-0 rounded-2xl border-2', style.border, style.bg)} />
              <div className="relative flex flex-col h-full gap-3 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <p className="text-lg font-bold text-fg">{card.key}</p>
                  {card.jlpt_level && (
                    <span className={clsx('text-xs font-bold', style.label)}>
                      {card.jlpt_level}
                    </span>
                  )}
                </div>

                {Object.entries(propertyGroups).map(([kind, values]) => (
                  <div key={kind} className="space-y-1">
                    <p className="text-2xs font-semibold text-fg-subtle uppercase tracking-wide">
                      {kind}
                    </p>
                    {values.map((v, i) => (
                      <p key={i} className="text-sm text-fg">{v}</p>
                    ))}
                  </div>
                ))}
              </div>
            </CardFace>
          </motion.div>
        </div>

        {/* 左划遮罩（不会） */}
        {isTop && (
          <motion.div
            className="absolute inset-0 rounded-2xl flex items-center justify-center pointer-events-none"
            style={{ opacity: leftOverlayOpacity }}
          >
            <div className="absolute inset-0 rounded-2xl bg-red-400/30" />
            <span className="relative text-4xl font-black text-red-600 rotate-[-15deg]">不会</span>
          </motion.div>
        )}

        {/* 右划遮罩（会） */}
        {isTop && (
          <motion.div
            className="absolute inset-0 rounded-2xl flex items-center justify-center pointer-events-none"
            style={{ opacity: rightOverlayOpacity }}
          >
            <div className="absolute inset-0 rounded-2xl bg-green-400/30" />
            <span className="relative text-4xl font-black text-green-600 rotate-[15deg]">会</span>
          </motion.div>
        )}
      </motion.div>
    </>
  )
}
