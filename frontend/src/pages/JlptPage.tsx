import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ChevronLeft, Loader2 } from 'lucide-react'
import JlptHome from '../components/jlpt/JlptHome'
import PracticeSession from '../components/jlpt/PracticeSession'
import MockExam from '../components/jlpt/MockExam'
import MockResultView from '../components/jlpt/MockResultView'
import ReviewView from '../components/jlpt/ReviewView'
import MistakeList from '../components/exam/MistakeList'
import { getJlptOverview, startMock } from '../services/api'
import type { JlptCategory, JlptOverview } from '../types'

// ─── Page root ────────────────────────────────────────────────────────────────

type View =
  | { kind: 'home' }
  | { kind: 'practice'; category: JlptCategory }
  | { kind: 'mock'; attemptId: string }
  | { kind: 'result'; attemptId: string }
  | { kind: 'review'; itemIds: string[]; attemptId: string | null; back: View; backLabel: string }
  | { kind: 'mistakes' }

export default function JlptPage() {
  const { pathname } = useLocation()
  const active = pathname === '/jlpt'
  const [view, setView] = useState<View>({ kind: 'home' })
  const [overview, setOverview] = useState<JlptOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active || view.kind !== 'home') return
    getJlptOverview().then(setOverview).catch(e => setError(e.message))
  }, [active, view.kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const home = () => setView({ kind: 'home' })

  // Practice stays mounted while one of its questions is looked at in full,
  // so coming back finds the set where it was.
  const practice = view.kind === 'practice' ? view
    : view.kind === 'review' && view.back.kind === 'practice' ? view.back : null
  if (practice) {
    return (
      <>
        <div className={view.kind === 'practice' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
          <PracticeSession category={practice.category.id} label={practice.category.label} onExit={home}
                           onOpenAnalysis={(_, itemId) => setView({ kind: 'review', itemIds: [itemId], attemptId: null, back: practice, backLabel: '练习' })} />
        </div>
        {view.kind === 'review' && (
          <ReviewView itemIds={view.itemIds} attemptId={view.attemptId} backLabel={view.backLabel} onBack={() => setView(view.back)} />
        )}
      </>
    )
  }

  if (view.kind === 'mock') {
    return <MockExam attemptId={view.attemptId} onExit={home} onDone={() => setView({ kind: 'result', attemptId: view.attemptId })} />
  }

  if (view.kind === 'result') {
    return <MockResultView attemptId={view.attemptId} onBack={home}
                           onReview={ids => setView({ kind: 'review', itemIds: ids, attemptId: view.attemptId, back: view, backLabel: '成绩' })} />
  }

  if (view.kind === 'review') {
    return <ReviewView itemIds={view.itemIds} attemptId={view.attemptId} backLabel={view.backLabel} onBack={() => setView(view.back)} />
  }

  if (view.kind === 'mistakes') {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 flex items-center gap-2 px-4 h-12 border-b border-border">
          <button type="button" onClick={home} className="flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
            <ChevronLeft className="w-4 h-4" />JLPT
          </button>
          <span className="text-sm font-semibold text-fg">错题</span>
        </div>
        <MistakeList />
      </div>
    )
  }

  if (error) return <div className="flex-1 flex items-center justify-center text-danger text-sm">{error}</div>
  if (!overview) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>

  return (
    <JlptHome
      data={overview}
      onPractice={c => setView({ kind: 'practice', category: c })}
      onPaper={async row => {
        if (row.status === 'completed' && row.attempt_id) { setView({ kind: 'result', attemptId: row.attempt_id }); return }
        try {
          const { attempt_id } = await startMock(row.id)
          setView({ kind: 'mock', attemptId: attempt_id })
        } catch (e) {
          setError(e instanceof Error ? e.message : '开始不了这套卷子')
        }
      }}
      onMistakes={() => setView({ kind: 'mistakes' })}
    />
  )
}
