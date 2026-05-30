// frontend/src/pages/InternalizePage.tsx
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Settings, Keyboard, Languages, Volume2, GitCompare, FileText } from 'lucide-react'
import InfiniteCardDeck from '../components/internalize/InfiniteCardDeck'
import StatsBar from '../components/internalize/StatsBar'
import ConfigSheet from '../components/internalize/ConfigSheet'
import type { InfiniteConfig, SwipeResult } from '../types'

type PagePhase = 'home' | 'playing'

function CardStackIcon() {
  return (
    <div className="relative w-20 h-28">
      {[2, 1, 0].map((i) => (
        <div
          key={i}
          className="absolute inset-0 rounded-xl border border-border bg-surface shadow-card"
          style={{ transform: `translateY(${i * 5}px) scale(${1 - i * 0.04})`, zIndex: 3 - i }}
        />
      ))}
      <div className="absolute inset-0 z-10 rounded-xl border border-border bg-gradient-to-br from-blue-50 to-violet-50 flex flex-col items-center justify-center gap-1 shadow-card">
        <span className="text-2xl font-bold text-fg">あ</span>
        <div className="w-8 h-0.5 rounded-full bg-border" />
        <span className="text-xs text-fg-subtle">意味</span>
      </div>
    </div>
  )
}

function CardModeIcon({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-surface border border-border hover:border-accent/50 hover:shadow-lg transition-shadow cursor-pointer w-full sm:w-44"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
    >
      <CardStackIcon />
      <div className="text-center">
        <p className="text-sm font-semibold text-fg">卡牌记忆</p>
        <p className="text-xs text-fg-subtle mt-0.5">主动召回练习</p>
      </div>
    </motion.button>
  )
}

function ComingSoonIcon({ icon, label, desc }: { icon: React.ReactNode; label: string; desc: string }) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-surface/50 border border-dashed border-border w-full sm:w-44 cursor-not-allowed">
      <div className="w-20 h-28 rounded-xl border border-dashed border-border/60 bg-surface flex items-center justify-center text-fg-subtle/40">
        {icon}
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-fg-subtle">{label}</p>
        <p className="text-xs text-fg-subtle/60 mt-0.5">{desc}</p>
        <p className="text-[10px] text-fg-subtle/40 mt-1">即将推出</p>
      </div>
    </div>
  )
}

export default function InternalizePage() {
  const [phase, setPhase] = useState<PagePhase>('home')
  const [config, setConfig] = useState<InfiniteConfig>({ promptMode: 'meaning', levels: [] })
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [todayKnow, setTodayKnow] = useState(0)
  const [todayUnknown, setTodayUnknown] = useState(0)

  function handleSwipe(result: SwipeResult) {
    if (result === 'know') setTodayKnow(n => n + 1)
    else setTodayUnknown(n => n + 1)
  }

  function handleConfigChange(next: InfiniteConfig) {
    setConfig(next)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {phase === 'home' && (
        <div className="flex-1 flex flex-col p-6 gap-6 overflow-y-auto">
          <div>
            <h1 className="text-base font-bold text-fg">内化学习</h1>
            <p className="text-xs text-fg-muted mt-0.5">选择练习模式开始</p>
          </div>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-4">
            <CardModeIcon onClick={() => setPhase('playing')} />
            <ComingSoonIcon icon={<Volume2 className="w-8 h-8" />}   label="读音练习" desc="汉字→假名" />
            <ComingSoonIcon icon={<GitCompare className="w-8 h-8" />} label="辨析练习" desc="近义词辨别" />
            <ComingSoonIcon icon={<FileText className="w-8 h-8" />}   label="情景填空" desc="语境还原" />
            <ComingSoonIcon icon={<Keyboard className="w-8 h-8" />}   label="打字练习" desc="默写输入" />
            <ComingSoonIcon icon={<Languages className="w-8 h-8" />}  label="翻译练习" desc="双向翻译" />
          </div>
        </div>
      )}

      {phase === 'playing' && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <button
              onClick={() => setPhase('home')}
              className="text-sm text-fg-subtle hover:text-fg transition-colors"
            >
              ← 返回
            </button>
            <span className="text-sm font-semibold text-fg">卡牌复习</span>
            <button
              onClick={() => setIsConfigOpen(true)}
              className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
            >
              <Settings className="w-4 h-4 text-fg-subtle" />
            </button>
          </div>

          {/* Stats bar */}
          <StatsBar todayKnow={todayKnow} todayUnknown={todayUnknown} />

          {/* Infinite deck */}
          <InfiniteCardDeck config={config} onSwipe={handleSwipe} />

          {/* Config sheet */}
          {isConfigOpen && (
            <ConfigSheet
              config={config}
              onChange={handleConfigChange}
              onClose={() => setIsConfigOpen(false)}
            />
          )}
        </>
      )}
    </div>
  )
}
