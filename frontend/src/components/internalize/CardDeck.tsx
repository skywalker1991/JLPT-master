// frontend/src/components/internalize/CardDeck.tsx
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import FlashCard from './FlashCard'
import { getInternalizeQueue, postInternalizeTrace } from '../../services/api'
import type { InternalizeCard, SwipeResult, SessionConfig } from '../../types'

type Phase = 'loading' | 'shuffle' | 'playing' | 'done'

interface Props {
  config: SessionConfig
  onDone: (results: { know: number; unknown: number }) => void
}

// 洗牌动画：4 张占位卡片扇开再合拢
function ShuffleAnimation({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute w-32 h-44 rounded-xl bg-surface border border-border shadow-card"
          initial={{ rotate: 0, x: 0, y: 0 }}
          animate={{
            rotate: [0, (i - 1.5) * 18, 0],
            x: [0, (i - 1.5) * 30, 0],
            y: [0, -10, 0],
          }}
          transition={{ duration: 0.6, times: [0, 0.5, 1], ease: 'easeInOut', delay: 0.1 }}
          onAnimationComplete={i === 3 ? onComplete : undefined}
        />
      ))}
    </div>
  )
}

export default function CardDeck({ config, onDone }: Props) {
  const [cards, setCards] = useState<InternalizeCard[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [results, setResults] = useState({ know: 0, unknown: 0 })

  useEffect(() => {
    getInternalizeQueue({
      limit: config.limit,
      prompt: config.promptType,
      tag: config.tag || undefined,
    })
      .then((res) => {
        setCards(res.cards)
        setPhase('shuffle')
      })
      .catch(() => setPhase('done'))
  }, [config])

  const handleSwipe = useCallback(
    (result: SwipeResult, cardId: string) => {
      setCurrentIndex((prev) => prev + 1)
      setResults((prev) => ({
        know: result === 'know' ? prev.know + 1 : prev.know,
        unknown: result === 'unknown' ? prev.unknown + 1 : prev.unknown,
      }))
      postInternalizeTrace(cardId, result, config.promptType).catch(console.error)
    },
    [config.promptType],
  )

  useEffect(() => {
    if (phase === 'playing' && cards.length > 0 && currentIndex >= cards.length) {
      setPhase('done')
      onDone(results)
    }
  }, [currentIndex, cards.length, phase, results, onDone])

  const visibleCards = cards.slice(currentIndex, currentIndex + 3)

  return (
    <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
      {phase === 'loading' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-fg-muted text-sm">加载中...</p>
        </div>
      )}

      {phase === 'shuffle' && (
        <ShuffleAnimation onComplete={() => setPhase('playing')} />
      )}

      {phase === 'playing' && (
        <>
          {/* 进度条 */}
          <div className="px-6 pt-4 pb-2">
            <div className="flex items-center justify-between text-xs text-fg-subtle mb-1">
              <span>{currentIndex} / {cards.length}</span>
              <span>
                <span className="text-green-600 font-medium">{results.know} 会</span>
                {' · '}
                <span className="text-red-500 font-medium">{results.unknown} 不会</span>
              </span>
            </div>
            <div className="h-1 bg-border rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-accent rounded-full"
                animate={{ width: `${(currentIndex / cards.length) * 100}%` }}
                transition={{ type: 'spring', stiffness: 200, damping: 30 }}
              />
            </div>
          </div>

          {/* 卡堆区域 */}
          <div className="relative flex-1">
            <AnimatePresence>
              {[...visibleCards].reverse().map((card, reverseIdx) => {
                const stackIndex = visibleCards.length - 1 - reverseIdx
                return (
                  <FlashCard
                    key={card.id}
                    card={card}
                    stackIndex={stackIndex}
                    promptType={config.promptType}
                    onSwipe={(result) => handleSwipe(result, card.id)}
                  />
                )
              })}
            </AnimatePresence>
          </div>

          {/* 操作提示 */}
          <div className="flex items-center justify-center gap-8 py-4 text-xs text-fg-subtle">
            <span>← 不会</span>
            <span>点击翻转</span>
            <span>会 →</span>
          </div>
        </>
      )}

      {phase === 'playing' && cards.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-fg-muted">知识库暂无原子，先去分析一些内容吧</p>
        </div>
      )}
    </div>
  )
}
