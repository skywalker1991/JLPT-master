import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

interface Props {
  results: { know: number; unknown: number }
  onRestart: () => void
  onExit: () => void
}

function CountUp({ target, className }: { target: number; className?: string }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (target === 0) return
    let current = 0
    const step = Math.max(1, Math.ceil(target / 30))
    const timer = setInterval(() => {
      current = Math.min(current + step, target)
      setDisplay(current)
      if (current >= target) clearInterval(timer)
    }, 30)
    return () => clearInterval(timer)
  }, [target])

  return <span className={className}>{display}</span>
}

export default function SessionResult({ results, onRestart, onExit }: Props) {
  const total = results.know + results.unknown
  const knowPct = total > 0 ? Math.round((results.know / total) * 100) : 0

  return (
    <motion.div
      className="flex flex-col items-center justify-center h-full px-6 gap-8"
      initial={{ y: 60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 24 }}
    >
      <h2 className="text-2xl font-bold text-fg">本轮完成</h2>

      <div className="flex gap-8">
        <div className="text-center">
          <CountUp
            target={results.know}
            className="text-5xl font-black text-green-500"
          />
          <p className="text-sm text-fg-muted mt-1">会</p>
        </div>
        <div className="text-4xl font-light text-fg-subtle flex items-center">/</div>
        <div className="text-center">
          <CountUp
            target={results.unknown}
            className="text-5xl font-black text-red-400"
          />
          <p className="text-sm text-fg-muted mt-1">不会</p>
        </div>
      </div>

      {total > 0 && (
        <div className="w-full max-w-xs space-y-1">
          <div className="flex justify-between text-xs text-fg-subtle">
            <span>掌握率</span>
            <span>{knowPct}%</span>
          </div>
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-green-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${knowPct}%` }}
              transition={{ delay: 0.4, duration: 0.8, ease: 'easeOut' }}
            />
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={onRestart} className="btn-primary">
          再来一轮
        </button>
        <button onClick={onExit} className="btn-ghost border border-border">
          完成
        </button>
      </div>
    </motion.div>
  )
}
