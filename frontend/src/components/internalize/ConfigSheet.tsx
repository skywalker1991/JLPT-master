// frontend/src/components/internalize/ConfigSheet.tsx
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import type { InfiniteConfig } from '../../types'

interface Props {
  config: InfiniteConfig
  onChange: (config: InfiniteConfig) => void
  onClose: () => void
}

const JLPT_LEVELS = ['N1', 'N2', 'N3', 'N4', 'N5']

export default function ConfigSheet({ config, onChange, onClose }: Props) {
  function setPromptMode(mode: InfiniteConfig['promptMode']) {
    onChange({ ...config, promptMode: mode })
  }

  function toggleLevel(level: string) {
    const next = config.levels.includes(level)
      ? config.levels.filter(l => l !== level)
      : [...config.levels, level]
    onChange({ ...config, levels: next })
  }

  function selectAllLevels() {
    onChange({ ...config, levels: [] })
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex flex-col justify-end"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/40" />

        <motion.div
          className="relative bg-surface rounded-t-2xl p-6 pb-10 space-y-6 shadow-xl"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Handle */}
          <div className="w-10 h-1 rounded-full bg-border mx-auto -mt-1" />

          {/* Prompt mode */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-fg">复习模式</p>
            <div className="flex gap-2">
              {(['meaning', 'reading'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setPromptMode(mode)}
                  className={clsx(
                    'btn flex-1 text-sm',
                    config.promptMode === mode ? 'btn-primary' : 'btn-ghost border border-border',
                  )}
                >
                  {mode === 'meaning' ? '词义模式' : '读音模式'}
                </button>
              ))}
            </div>
          </div>

          {/* JLPT level filter */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-fg">
              级别筛选 <span className="font-normal text-fg-subtle">（可多选）</span>
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={selectAllLevels}
                className={clsx(
                  'btn text-sm',
                  config.levels.length === 0 ? 'btn-primary' : 'btn-ghost border border-border',
                )}
              >
                全部
              </button>
              {JLPT_LEVELS.map(l => (
                <button
                  key={l}
                  onClick={() => toggleLevel(l)}
                  className={clsx(
                    'btn text-sm',
                    config.levels.includes(l) ? 'btn-primary' : 'btn-ghost border border-border',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
