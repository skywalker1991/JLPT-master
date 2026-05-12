import { useState } from 'react'
import SessionSetup from '../components/internalize/SessionSetup'
import CardDeck from '../components/internalize/CardDeck'
import SessionResult from '../components/internalize/SessionResult'
import type { SessionConfig } from '../types'

type PagePhase = 'setup' | 'playing' | 'result'

export default function InternalizePage() {
  const [phase, setPhase] = useState<PagePhase>('setup')
  const [config, setConfig] = useState<SessionConfig>({ limit: 20, promptType: 'meaning', tag: '' })
  const [results, setResults] = useState({ know: 0, unknown: 0 })

  function handleStart(cfg: SessionConfig) {
    setConfig(cfg)
    setResults({ know: 0, unknown: 0 })
    setPhase('playing')
  }

  function handleDone(res: { know: number; unknown: number }) {
    setResults(res)
    setPhase('result')
  }

  function handleRestart() {
    setPhase('playing')
    setResults({ know: 0, unknown: 0 })
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {phase === 'setup' && <SessionSetup onStart={handleStart} />}
      {phase === 'playing' && (
        <CardDeck key={JSON.stringify(config)} config={config} onDone={handleDone} />
      )}
      {phase === 'result' && (
        <SessionResult results={results} onRestart={handleRestart} onExit={() => setPhase('setup')} />
      )}
    </div>
  )
}
