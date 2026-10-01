import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import JlptHome from '../components/jlpt/JlptHome'
import PracticeSession from '../components/jlpt/PracticeSession'
import {
  ChevronLeft, Loader2, Trash2,
} from 'lucide-react'
import {
  listExams, getExam, startAttempt, getJlptOverview,
  listPaperAttempts, getAttemptReview, deleteAttempt,
} from '../services/api'
import ExamSession from '../components/exam/ExamSession'
import MistakeList from '../components/exam/MistakeList'
import type {
  JlptCategory, JlptOverview,
  ExamPaperList, ExamPaperDetail, AttemptSummary,
} from '../types'

// ─── Level badge ──────────────────────────────────────────────────────────────

function LevelBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    N1: 'bg-red-100 text-red-700', N2: 'bg-orange-100 text-orange-700',
    N3: 'bg-yellow-100 text-yellow-700', N4: 'bg-emerald-100 text-emerald-700',
    N5: 'bg-blue-100 text-blue-700',
  }
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colors[level] ?? 'bg-fg/10 text-fg'}`}>
      {level}
    </span>
  )
}

// ─── Exam bank ────────────────────────────────────────────────────────────────

// ─── Attempt list sidebar ─────────────────────────────────────────────────────

const SEC_SHORT: Record<string, string> = {
  '言語知識（文字・語彙）': '語彙',
  '言語知識（文法）': '文法',
  '読解': '読解',
  '聴解': '聴解',
}

function AttemptListPanel({
  paperId, refreshKey, activeAttemptId,
  onViewResult, onContinue, onDelete,
}: {
  paperId: string
  refreshKey: number
  activeAttemptId: string | null
  onViewResult: (id: string) => void
  onContinue: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [attempts, setAttempts] = useState<AttemptSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    listPaperAttempts(paperId)
      .then(setAttempts)
      .finally(() => setLoading(false))
  }, [paperId, refreshKey])

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <p className="section-label">考试记录</p>
      </div>

      <div className="flex-1 md:flex-1 overflow-y-auto py-2">
        {loading && (
          <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-fg-muted" /></div>
        )}
        {!loading && attempts.length === 0 && (
          <p className="text-xs text-fg-muted text-center py-3">暂无记录</p>
        )}
        {attempts.map(a => {
          const total = a.score?.total
          const pct = total && total.total > 0 ? Math.round(total.correct / total.total * 100) : null
          const date = new Date(a.started_at)
          const isActive = a.attempt_id === activeAttemptId
          const inProgress = a.status === 'in_progress'
          return (
            <div
              key={a.attempt_id}
              className={['border-b border-border', isActive ? 'bg-accent-light' : ''].join(' ')}
            >
              <div className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-1 mb-1">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-fg-muted">
                      {date.getMonth() + 1}/{date.getDate()} {String(date.getHours()).padStart(2, '0')}:{String(date.getMinutes()).padStart(2, '0')}
                    </p>
                    {/* Which parts, and how far in. A run is usually one part
                        picked up in a gap, so both belong on the row. */}
                    {(a.section_names ?? []).length > 0 && (
                      <p className="text-[11px] text-fg truncate mt-0.5">
                        {a.section_names.map(n => SEC_SHORT[n] ?? n).join(' · ')}
                      </p>
                    )}
                    {inProgress && a.in_scope != null && (
                      <p className="text-[11px] text-fg-muted mt-0.5">
                        进度 {a.answered}/{a.in_scope}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {pct !== null && (
                      <span className={`text-xs font-bold ${pct >= 80 ? 'text-success-fg' : pct >= 60 ? 'text-accent' : 'text-danger-fg'}`}>
                        {pct}%
                      </span>
                    )}
                    <button
                      onClick={() => onDelete(a.attempt_id)}
                      className="text-fg-muted hover:text-danger transition-colors p-0.5"
                      title="删除记录"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  inProgress ? 'bg-orange-100 text-orange-700' : 'bg-success-light text-success-fg'
                }`}>
                  {inProgress ? '进行中' : '完成'}
                </span>
                {inProgress && a.in_scope ? (
                  <div className="h-1 bg-border rounded-full overflow-hidden mt-1.5">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{ width: `${Math.round(a.answered / a.in_scope * 100)}%` }}
                    />
                  </div>
                ) : null}
              </div>

              <div className="px-4 pb-2.5">
                {inProgress ? (
                  <button
                    onClick={() => onContinue(a.attempt_id)}
                    className="w-full text-xs text-accent border border-accent/40 rounded-lg py-1 hover:bg-accent-light transition-colors font-medium"
                  >
                    继续作答 →
                  </button>
                ) : (
                  <button
                    onClick={() => onViewResult(a.attempt_id)}
                    className="w-full text-xs text-fg-muted border border-border rounded-lg py-1 hover:bg-bg hover:border-accent/40 hover:text-accent transition-colors font-medium"
                  >
                    查看结果 →
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Exam config panel ────────────────────────────────────────────────────────

/** What a part is in the middle of, or what it came to last time. */
interface PartState {
  running?: AttemptSummary            // left unfinished
  score?: { correct: number; total: number; at: string }
}

/**
 * The four parts a paper is practised in, each carrying its own state.
 *
 * There used to be a separate history panel beside this, which said the same
 * things twice: the part rows already knew what had been scored, and the
 * history knew which run was unfinished. Two views of one fact, a 継続 button
 * in each, and on a phone the history sat above the thing you opened the page
 * to do. A part is the object here, so its state belongs on it.
 */
function ExamConfigPanel({
  detail, onStart, onContinue, onShowHistory,
}: {
  detail: ExamPaperDetail
  onStart: (sectionIds: string[], attemptId: string) => void
  onContinue: (attemptId: string) => void
  onShowHistory: () => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [starting, setStarting] = useState(false)
  const [parts, setParts] = useState<Record<string, PartState>>({})
  // Until the records are in there is no honest row to draw: showing a part as
  // untouched and correcting it a moment later is how a quick hand starts a
  // second run over one already going.
  const [looked, setLooked] = useState(false)

  useEffect(() => {
    listPaperAttempts(detail.id)
      .then(list => {
        const state: Record<string, PartState> = {}
        // Newest first from the server, so the first of each is the latest.
        for (const a of list) {
          for (const name of a.section_names ?? []) {
            const part = (state[name] ??= {})
            if (a.status === 'in_progress' && !part.running) part.running = a
          }
          for (const [name, sc] of Object.entries(a.score ?? {})) {
            if (name === 'total' || sc.total === 0) continue
            const part = (state[name] ??= {})
            if (!part.score) part.score = { ...sc, at: a.completed_at ?? a.started_at }
          }
        }
        setParts(state)
        // Start on what is left. The whole paper is 170 minutes, and a part
        // already scored is the least useful thing to offer.
        const fresh = detail.sections.filter(s => !state[s.name]?.score).map(s => s.id)
        setSelected(fresh.length > 0 ? fresh : detail.sections.map(s => s.id))
      })
      .catch(() => setSelected(detail.sections.map(s => s.id)))
      .finally(() => setLooked(true))
  }, [detail.id, detail.sections])

  function toggle(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleStart() {
    if (selected.length === 0) return
    setStarting(true)
    try {
      // The run records what it set out to cover, so a record left untouched
      // still says what it was for.
      const problemIds = detail.sections
        .filter(s => selected.includes(s.id))
        .flatMap(s => s.problems.map(p => p.id))
      const attempt = await startAttempt(detail.id, problemIds)
      onStart(selected, attempt.attempt_id)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 md:px-8">
      <div className="w-full max-w-md mx-auto space-y-5">
        <div className="flex items-baseline gap-3">
          <h3 className="text-lg font-bold text-fg">选择范围</h3>
          <button
            onClick={onShowHistory}
            className="ml-auto text-xs text-fg-muted hover:text-fg transition-colors"
          >
            全部记录 →
          </button>
        </div>

        <div className="space-y-2">
          {detail.sections.map(s => {
            const state = parts[s.name]
            const count = s.problems.reduce((n, p) => n + p.items.length, 0)
            const pct = state?.score
              ? Math.round(state.score.correct / state.score.total * 100)
              : null
            return (
              <div
                key={s.id}
                className={[
                  'flex items-center gap-3 px-4 py-3 rounded-xl border transition-all',
                  selected.includes(s.id)
                    ? 'border-accent bg-accent-light' : 'border-border',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={() => toggle(s.id)}
                  className="accent-accent w-4 h-4 shrink-0"
                />
                <label className="flex-1 min-w-0 cursor-pointer" onClick={() => toggle(s.id)}>
                  <p className="text-sm font-medium text-fg">{s.name}</p>
                  <p className="text-xs text-fg-muted">
                    {count} 题
                    {state?.running && (
                      <span className="text-accent"> · 进度 {state.running.answered}/
                        {state.running.in_scope ?? count}</span>
                    )}
                    {pct !== null && !state?.running && (
                      <span className={pct >= 80 ? 'text-success-fg' : pct >= 60 ? 'text-accent' : 'text-danger-fg'}>
                        {' '}· {pct}% ({state!.score!.correct}/{state!.score!.total}) ·{' '}
                        {new Date(state!.score!.at).getMonth() + 1}/{new Date(state!.score!.at).getDate()}
                      </span>
                    )}
                  </p>
                </label>
                {/* The one run worth resuming lives on the part it belongs to,
                    not in a list of every run ever made. */}
                {state?.running && (
                  <button
                    onClick={() => onContinue(state.running!.attempt_id)}
                    className="shrink-0 text-xs text-accent font-medium hover:underline"
                  >
                    继续 →
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {!looked ? (
          <div className="w-full py-3 flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin text-fg-muted" />
          </div>
        ) : (
          <button
            onClick={handleStart}
            disabled={starting || selected.length === 0}
            className="w-full py-3 bg-accent text-on-accent rounded-xl font-semibold hover:bg-accent-hover disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            {starting && <Loader2 className="w-4 h-4 animate-spin" />}
            开始{selected.length > 0 && selected.length < detail.sections.length
              ? `（${selected.length} 个部分）` : ''}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Exam detail view ─────────────────────────────────────────────────────────

type DetailMode =
  | { type: 'config' }
  | {
      type: 'session'
      attemptId: string
      sectionIds: string[]
      initialAnswers?: Record<string, string>
      initialSubmitted?: string[]
      reviewMode?: boolean
      correctAnswers?: Record<string, string>
      isCorrectMap?: Record<string, boolean | null>
    }

function ExamDetailView({ paper, onBack }: { paper: ExamPaperList; onBack: () => void }) {
  const [detail, setDetail] = useState<ExamPaperDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [mode, setMode] = useState<DetailMode>({ type: 'config' })
  const [refreshKey, setRefreshKey] = useState(0)
  // Every run ever made, behind one tap. Which run to resume lives on the part
  // it belongs to; this is for looking back over several.
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    getExam(paper.id)
      .then(setDetail)
      .finally(() => setDetailLoading(false))
  }, [paper.id])

  const activeAttemptId = mode.type === 'session' ? mode.attemptId : null

  const handleSessionStart = useCallback((sectionIds: string[], attemptId: string) => {
    setMode({ type: 'session', attemptId, sectionIds })
    setRefreshKey(k => k + 1)
  }, [])

  const handleSessionComplete = useCallback(() => {
    setMode(prev => {
      if (prev.type !== 'session') return prev
      return { type: 'config' }
    })
    setRefreshKey(k => k + 1)
  }, [])

  const handleDelete = useCallback(async (attemptId: string) => {
    if (!confirm('确认删除此考试记录？')) return
    await deleteAttempt(attemptId)
    if (mode.type === 'session' && mode.attemptId === attemptId) setMode({ type: 'config' })
    setRefreshKey(k => k + 1)
  }, [mode])

  const handleViewResult = useCallback(async (attemptId: string) => {
    const review = await getAttemptReview(attemptId)
    const nameToDetailId = new Map(detail?.sections.map(s => [s.name, s.id]) ?? [])
    const scoreNames = new Set(Object.keys(review.score ?? {}).filter(k => k !== 'total'))
    const sectionIds = [...scoreNames]
      .map(name => nameToDetailId.get(name))
      .filter(Boolean) as string[]

    const initialAnswers: Record<string, string> = {}
    const correctAnswers: Record<string, string> = {}
    const isCorrectMap: Record<string, boolean | null> = {}
    for (const sec of review.sections) {
      for (const prob of sec.problems) {
        for (const item of prob.items) {
          if (item.user_answer) initialAnswers[item.id] = item.user_answer
          if (item.correct_answer) correctAnswers[item.id] = item.correct_answer
          isCorrectMap[item.id] = item.is_correct
        }
      }
    }
    setMode({ type: 'session', attemptId, sectionIds, initialAnswers, reviewMode: true, correctAnswers, isCorrectMap })
  }, [detail])

  const handleContinue = useCallback(async (attemptId: string) => {
    const review = await getAttemptReview(attemptId)
    const nameToDetailId = new Map(detail?.sections.map(s => [s.name, s.id]) ?? [])
    const answeredNames = review.sections
      .filter(s => s.problems.some(p => p.items.some(i => i.user_answer !== null)))
      .map(s => s.name)
    let sectionIds = answeredNames
      .map(name => nameToDetailId.get(name))
      .filter(Boolean) as string[]
    if (sectionIds.length === 0) {
      sectionIds = detail?.sections.map(s => s.id) ?? []
    }
    const initialAnswers: Record<string, string> = {}
    for (const sec of review.sections) {
      for (const prob of sec.problems) {
        for (const item of prob.items) {
          if (item.user_answer) initialAnswers[item.id] = item.user_answer
        }
      }
    }
    const scoreNames = Object.keys(review.score ?? {}).filter(k => k !== 'total')
    const initialSubmitted = scoreNames
      .map(name => nameToDetailId.get(name))
      .filter(Boolean) as string[]
    setMode({ type: 'session', attemptId, sectionIds, initialAnswers, initialSubmitted })
    setRefreshKey(k => k + 1)
  }, [detail])

  return (
    <>
      {/* One card. Two of them was a desktop shape stacked onto a phone, and
          the second one repeated what the first already said. */}
      <div className="card flex-1 flex flex-col min-h-0 overflow-hidden">
        {mode.type !== 'session' && (
          <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border">
            <button
              onClick={showHistory ? () => setShowHistory(false) : onBack}
              className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg transition-colors shrink-0"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {showHistory ? '返回' : '返回列表'}
            </button>
            <p className="text-xs font-semibold text-fg truncate">{paper.title}</p>
            <LevelBadge level={paper.level} />
          </div>
        )}
        {detailLoading && (
          <div className="flex items-center justify-center flex-1 gap-2 text-fg-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {!detailLoading && detail && mode.type === 'config' && (
          showHistory ? (
            <AttemptListPanel
              paperId={paper.id}
              refreshKey={refreshKey}
              activeAttemptId={activeAttemptId}
              onViewResult={handleViewResult}
              onContinue={handleContinue}
              onDelete={handleDelete}
            />
          ) : (
            <ExamConfigPanel
              detail={detail}
              onStart={handleSessionStart}
              onContinue={handleContinue}
              onShowHistory={() => setShowHistory(true)}
            />
          )
        )}
        {!detailLoading && detail && mode.type === 'session' && (
          <ExamSession
            key={mode.attemptId}
            detail={detail}
            attemptId={mode.attemptId}
            sectionIds={mode.sectionIds}
            initialAnswers={mode.initialAnswers}
            initialSubmitted={mode.initialSubmitted}
            onComplete={handleSessionComplete}
            onCancel={() => setMode({ type: 'config' })}
            reviewMode={mode.reviewMode}
            correctAnswers={mode.correctAnswers}
            isCorrectMap={mode.isCorrectMap}
          />
        )}
      </div>

    </>
  )
}

// ─── Page root ────────────────────────────────────────────────────────────────

type View =
  | { kind: 'home' }
  | { kind: 'practice'; category: JlptCategory }
  | { kind: 'paper'; paper: ExamPaperList }
  | { kind: 'mistakes' }

export default function JlptPage() {
  const { pathname } = useLocation()
  const active = pathname === '/jlpt'
  const [view, setView] = useState<View>({ kind: 'home' })
  const [overview, setOverview] = useState<JlptOverview | null>(null)
  const [papers, setPapers] = useState<ExamPaperList[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active || view.kind !== 'home') return
    getJlptOverview().then(setOverview).catch(e => setError(e.message))
    if (papers.length === 0) listExams().then(setPapers).catch(() => {})
  }, [active, view.kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const home = () => setView({ kind: 'home' })

  if (view.kind === 'practice') {
    return <PracticeSession category={view.category.id} label={view.category.label} onExit={home} />
  }

  if (view.kind === 'paper') {
    return (
      <div className="flex flex-col md:flex-row flex-1 min-h-0 p-4 gap-4 overflow-hidden">
        <ExamDetailView paper={view.paper} onBack={home} />
      </div>
    )
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
      onPaper={row => {
        const paper = papers.find(p => p.id === row.id)
        if (paper) setView({ kind: 'paper', paper })
      }}
      onMistakes={() => setView({ kind: 'mistakes' })}
    />
  )
}
