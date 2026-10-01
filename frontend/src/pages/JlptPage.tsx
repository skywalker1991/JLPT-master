import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import JlptHome from '../components/jlpt/JlptHome'
import PracticeSession from '../components/jlpt/PracticeSession'
import MockExam from '../components/jlpt/MockExam'
import MockResultView from '../components/jlpt/MockResultView'
import ReviewView from '../components/jlpt/ReviewView'
import MistakesView from '../components/jlpt/MistakesView'
import { getJlptOverview, startMock, startRun } from '../services/api'
import { useSettings } from '../context/SettingsContext'
import type { JlptOverview } from '../types'
import PaperView from '../components/jlpt/PaperView'

// ─── Page root ────────────────────────────────────────────────────────────────

type View =
  | { kind: 'home' }
  | { kind: 'paper'; paperId: string }
  | { kind: 'practice'; paperId: string; runId: string; category: string; label: string }
  | { kind: 'mock'; attemptId: string; paperId: string }
  | { kind: 'result'; attemptId: string; paperId: string }
  | { kind: 'review'; itemIds: string[]; attemptId: string | null; runId?: string; back: View; backLabel: string; startAt?: number }
  | { kind: 'mistakes' }

export default function JlptPage() {
  const { pathname } = useLocation()
  const active = pathname === '/jlpt'
  const [view, setView] = useState<View>({ kind: 'home' })
  const [overview, setOverview] = useState<JlptOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { settings, updateSettings } = useSettings()
  const level = settings.jlptLevel || 'N1'

  useEffect(() => {
    if (!active || view.kind !== 'home') return
    getJlptOverview(level).then(setOverview).catch(e => setError(e.message))
  }, [active, view.kind, level]) // eslint-disable-line react-hooks/exhaustive-deps

  const home = () => setView({ kind: 'home' })

  const practise = async (paperId: string, category: string, label: string, runId: string | null) => {
    try {
      const id = runId ?? (await startRun(paperId, category)).run_id
      setView({ kind: 'practice', paperId, runId: id, category, label })
    } catch (e) {
      setError(e instanceof Error ? e.message : '开始不了练习')
    }
  }
  const mock = async (paperId: string) => {
    try {
      const { attempt_id } = await startMock(paperId)
      setView({ kind: 'mock', attemptId: attempt_id, paperId })
    } catch (e) {
      setError(e instanceof Error ? e.message : '开始不了这套卷子')
    }
  }

  // Practice stays mounted while one of its questions is looked at in full,
  // so coming back finds the set where it was.
  const practice = view.kind === 'practice' ? view
    : view.kind === 'review' && view.back.kind === 'practice' ? view.back : null
  if (practice) {
    return (
      <>
        <div className={view.kind === 'practice' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
          <PracticeSession key={practice.runId} category={practice.category} level={level} runId={practice.runId} label={practice.label}
                           onExit={() => setView({ kind: 'paper', paperId: practice.paperId })}
                           onAgain={() => practise(practice.paperId, practice.category, practice.label, null)}
                           onOpenAnalysis={(_, itemId) => setView({ kind: 'review', itemIds: [itemId], attemptId: null, runId: practice.runId, back: practice, backLabel: '练习' })} />
        </div>
        {view.kind === 'review' && (
          <ReviewView itemIds={view.itemIds} attemptId={view.attemptId} runId={view.runId} backLabel={view.backLabel} onBack={() => setView(view.back)} />
        )}
      </>
    )
  }

  if (view.kind === 'mock') {
    return <MockExam attemptId={view.attemptId} onExit={() => setView({ kind: 'paper', paperId: view.paperId })}
                     onDone={() => setView({ kind: 'result', attemptId: view.attemptId, paperId: view.paperId })} />
  }

  if (view.kind === 'result') {
    return <MockResultView attemptId={view.attemptId} onBack={() => setView({ kind: 'paper', paperId: view.paperId })}
                           onReview={ids => setView({ kind: 'review', itemIds: ids, attemptId: view.attemptId, back: view, backLabel: '成绩' })} />
  }

  if (view.kind === 'review') {
    return <ReviewView key={view.itemIds.join()} itemIds={view.itemIds} attemptId={view.attemptId} backLabel={view.backLabel}
                       startAt={view.startAt} onBack={() => setView(view.back)} />
  }

  if (view.kind === 'paper') {
    const paperId = view.paperId
    return (
      <PaperView paperId={paperId} onBack={home}
                 onPractice={(category, label, runId) => practise(paperId, category, label, runId)}
                 onMock={() => mock(paperId)}
                 onRecord={r => {
                   if (r.type === 'mock') {
                     setView(r.status === 'completed' ? { kind: 'result', attemptId: r.id, paperId } : { kind: 'mock', attemptId: r.id, paperId })
                   } else {
                     setView({ kind: 'practice', paperId, runId: r.id, category: r.kind, label: r.label })
                   }
                 }} />
    )
  }

  if (view.kind === 'mistakes') {
    return <MistakesView level={level} onBack={home}
                         onOpen={(ids, startAt) => setView({ kind: 'review', itemIds: ids, attemptId: null, back: view, backLabel: '错题', startAt })} />
  }

  if (error) return <div className="flex-1 flex items-center justify-center text-danger text-sm">{error}</div>
  if (!overview) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>

  return (
    <JlptHome
      data={overview}
      onPaper={row => setView({ kind: 'paper', paperId: row.id })}
      onMistakes={() => setView({ kind: 'mistakes' })}
      onLevel={l => { setOverview(null); updateSettings({ jlptLevel: l }) }}
    />
  )
}
