// frontend/src/components/internalize/InfiniteCardDeck.tsx
import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import FlashCard from './FlashCard'
import { getInternalizeQueue, postInternalizeTrace } from '../../services/api'
import type { InternalizeCard, SwipeResult, InfiniteConfig } from '../../types'

interface Props {
  config: InfiniteConfig
  onSwipe: (result: SwipeResult) => void
}

function ShuffleAnimation({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute w-40 h-56 rounded-xl bg-surface border border-border shadow-card"
          initial={{ rotate: 0, x: 0, y: 0 }}
          animate={{ rotate: [0, (i - 1.5) * 18, 0], x: [0, (i - 1.5) * 30, 0], y: [0, -10, 0] }}
          transition={{ duration: 0.6, times: [0, 0.5, 1], ease: 'easeInOut', delay: 0.1 }}
          onAnimationComplete={i === 3 ? onComplete : undefined}
        />
      ))}
    </div>
  )
}

export default function InfiniteCardDeck({ config, onSwipe }: Props) {
  const [queue, setQueue] = useState<InternalizeCard[]>([])
  const [head, setHead] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'shuffle' | 'playing'>('loading')
  const fetchingRef = useRef(false)

  const fetchBatch = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const res = await getInternalizeQueue({
        limit: 20,
        prompt: config.promptMode,
        levels: config.levels.length > 0 ? config.levels : undefined,
      })
      if (res.cards.length > 0) {
        setQueue(prev => [...prev, ...res.cards])
      }
    } catch {
      // silently ignore fetch errors; user can keep swiping existing cards
    } finally {
      fetchingRef.current = false
    }
  }, [config])

  // Reset when config changes
  useEffect(() => {
    setQueue([])
    setHead(0)
    setPhase('loading')
    fetchingRef.current = false
    getInternalizeQueue({
      limit: 20,
      prompt: config.promptMode,
      levels: config.levels.length > 0 ? config.levels : undefined,
    }).then(res => {
      setQueue(res.cards)
      setPhase(res.cards.length > 0 ? 'shuffle' : 'playing')
    }).catch(() => setPhase('playing'))
  }, [config])

  // Pre-fetch when queue runs low
  useEffect(() => {
    if (phase === 'playing' && queue.length - head < 5) {
      fetchBatch()
    }
  }, [head, queue.length, phase, fetchBatch])

  function handleSwipe(result: SwipeResult, cardId: string) {
    setHead(h => h + 1)
    onSwipe(result)
    postInternalizeTrace(cardId, result, config.promptMode).catch(console.error)
  }

  const visibleCards = queue.slice(head, head + 3)

  return (
    <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
      {phase === 'loading' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-fg-muted">加载中...</p>
        </div>
      )}

      {phase === 'shuffle' && (
        <ShuffleAnimation onComplete={() => setPhase('playing')} />
      )}

      {phase === 'playing' && (
        queue.length - head === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-fg-muted text-sm">知识库暂无原子，先去分析一些内容吧</p>
          </div>
        ) : (
          <div className="relative flex-1">
            <AnimatePresence mode="popLayout">
              {[...visibleCards].reverse().map((card, reverseIdx) => {
                const stackIndex = visibleCards.length - 1 - reverseIdx
                return (
                  <FlashCard
                    key={card.id}
                    card={card}
                    stackIndex={stackIndex}
                    onSwipe={(result) => handleSwipe(result, card.id)}
                  />
                )
              })}
            </AnimatePresence>
          </div>
        )
      )}
    </div>
  )
}
