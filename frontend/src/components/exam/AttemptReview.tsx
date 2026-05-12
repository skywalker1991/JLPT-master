import { useEffect, useMemo, useState } from 'react'
import { Brain, CheckCircle, ChevronDown, Loader2, XCircle } from 'lucide-react'
import { getAttemptReview } from '../../services/api'
import type { AttemptReviewData, ReviewQuestion, ReviewSection } from '../../types'
import AnalysisPanel from './AnalysisPanel'

// ─── Score summary ────────────────────────────────────────────────────────────

function ScoreSummary({ score }: { score: AttemptReviewData['score'] }) {
  if (!score) return null
  const total = score['total']
  const sections = Object.entries(score).filter(([k]) => k !== 'total')

  return (
    <div className="bg-surface border border-border rounded-xl p-5 space-y-4 shadow-card">
      {total && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-fg">总分</span>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold text-accent">
              {total.total > 0 ? Math.round(total.correct / total.total * 100) : 0}%
            </span>
            <span className="text-sm text-fg-muted">{total.correct} / {total.total}</span>
          </div>
        </div>
      )}
      {sections.map(([name, s]) => {
        const pct = s.total > 0 ? s.correct / s.total : 0
        return (
          <div key={name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-fg-muted">{name}</span>
              <span className="text-xs text-fg-muted">{s.correct}/{s.total}</span>
            </div>
            <div className="h-1.5 bg-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${pct * 100}%`,
                  backgroundColor: pct >= 0.8 ? '#10B981' : pct >= 0.6 ? '#2563EB' : '#EF4444',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Question review card ─────────────────────────────────────────────────────

function groupByPassage(questions: ReviewQuestion[]) {
  const groups: { passage: string | null; questions: ReviewQuestion[] }[] = []
  const seen = new Map<string, number>()
  for (const q of questions) {
    const key = q.meta?.passage_group as string | undefined
    if (key && seen.has(key)) {
      groups[seen.get(key)!].questions.push(q)
    } else {
      const idx = groups.length
      groups.push({ passage: q.passage ?? null, questions: [q] })
      if (key) seen.set(key, idx)
    }
  }
  return groups
}

const OPTS = ['1', '2', '3', '4'] as const

function QuestionReviewCard({
  q, onAnalyze,
}: {
  q: ReviewQuestion
  onAnalyze: () => void
}) {
  const [open, setOpen] = useState(false)

  function optClass(k: string) {
    const base = 'flex items-start gap-2 px-3 py-2 rounded-lg border text-sm transition-colors'
    if (k === q.correct_answer) return `${base} border-success bg-success-light text-success-fg font-medium`
    if (k === q.user_answer && !q.is_correct) return `${base} border-danger bg-danger-light text-danger-fg`
    return `${base} border-border text-fg-muted`
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header — always visible */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        {q.is_correct === true && <CheckCircle className="w-4 h-4 text-success shrink-0" />}
        {q.is_correct === false && <XCircle className="w-4 h-4 text-danger shrink-0" />}
        {q.is_correct === null && <div className="w-4 h-4 rounded-full border-2 border-border shrink-0" />}
        <span className="text-xs text-fg-muted shrink-0">Q{q.seq}</span>
        <p className="text-sm text-fg truncate flex-1">{q.stem || '（无题干）'}</p>
        {q.user_answer && (
          <span className={`text-xs font-bold shrink-0 ${q.is_correct ? 'text-success-fg' : 'text-danger-fg'}`}>
            选 {q.user_answer}
          </span>
        )}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 bg-bg space-y-3">
          {Object.keys(q.options).length > 0 && (
            <div className="space-y-1.5">
              {OPTS.filter(k => k in q.options).map(k => (
                <div key={k} className={optClass(k)}>
                  <span className="shrink-0 font-semibold text-xs mt-0.5 w-4">{k}</span>
                  <span className="flex-1">{q.options[k]}</span>
                  {k === q.correct_answer && <CheckCircle className="w-4 h-4 shrink-0 text-success" />}
                  {k === q.user_answer && !q.is_correct && <XCircle className="w-4 h-4 shrink-0 text-danger" />}
                </div>
              ))}
            </div>
          )}

          {!q.user_answer && (
            <p className="text-xs text-fg-muted italic">未作答</p>
          )}

          {q.type === 'grammar_fill' && (
            <button
              onClick={onAnalyze}
              className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover font-medium transition-colors"
            >
              <Brain className="w-3.5 h-3.5" />
              请求 AI 解析
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Section block ────────────────────────────────────────────────────────────

function SectionReview({
  section, onAnalyze,
}: {
  section: ReviewSection
  onAnalyze: (qid: string) => void
}) {
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => groupByPassage(section.questions), [section.questions])

  const answered = section.questions.filter(q => q.user_answer !== null).length
  const submitted = section.questions.some(q => q.is_correct !== null)
  const correct = section.questions.filter(q => q.is_correct === true).length
  const total = section.questions.filter(q => q.correct_answer !== null).length
  const pct = total > 0 ? correct / total : null

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Section header — always visible */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-fg">{section.name}</span>
            {submitted && total > 0 && (
              <span className={`text-xs font-bold ${pct! >= 0.8 ? 'text-success-fg' : pct! >= 0.6 ? 'text-accent' : 'text-danger-fg'}`}>
                {Math.round(pct! * 100)}%
              </span>
            )}
            {!submitted && (
              <span className="text-xs text-fg-muted">{answered}/{section.questions.length} 已作答</span>
            )}
          </div>
          {submitted && total > 0 && (
            <div className="h-1 bg-border rounded-full overflow-hidden w-full">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct! * 100}%`,
                  backgroundColor: pct! >= 0.8 ? '#10B981' : pct! >= 0.6 ? '#2563EB' : '#EF4444',
                }}
              />
            </div>
          )}
        </div>
        <span className="text-xs text-fg-muted shrink-0">
          {submitted ? `${correct}/${total}` : '未提交'}
        </span>
        <ChevronDown className={`w-4 h-4 text-fg-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Questions — only when expanded */}
      {open && (
        <div className="border-t border-border px-4 py-3 bg-bg space-y-3">
          {groups.map((g, gi) => (
            <div key={gi} className="space-y-2">
              {g.passage && (
                <div className="bg-surface border border-border rounded-xl p-4 text-sm text-fg leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {g.passage}
                </div>
              )}
              {g.questions.map(q => (
                <QuestionReviewCard key={q.id} q={q} onAnalyze={() => onAnalyze(q.id)} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AttemptReview({
  attemptId,
}: {
  attemptId: string
}) {
  const [review, setReview] = useState<AttemptReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [analysisQid, setAnalysisQid] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setReview(null)
    getAttemptReview(attemptId)
      .then(setReview)
      .finally(() => setLoading(false))
  }, [attemptId])

  if (loading) return (
    <div className="flex items-center justify-center h-full text-fg-muted gap-2">
      <Loader2 className="w-5 h-5 animate-spin" />
      <span className="text-sm">加载复习数据…</span>
    </div>
  )

  if (!review) return (
    <div className="flex items-center justify-center h-full text-danger text-sm">加载失败</div>
  )

  const answeredCount = review.sections
    .flatMap(s => s.questions)
    .filter(q => q.user_answer !== null).length

  return (
    <div className="h-full overflow-y-auto px-6 py-5 space-y-6">
      {/* Status tag */}
      <div className="flex items-center gap-2">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
          review.status === 'completed'
            ? 'bg-success-light text-success-fg'
            : 'bg-orange-100 text-orange-700'
        }`}>
          {review.status === 'completed' ? '已完成' : '进行中'}
        </span>
        <span className="text-xs text-fg-muted">
          {new Date(review.started_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="text-xs text-fg-muted">· {answeredCount} 题已作答</span>
      </div>

      <ScoreSummary score={review.score} />

      {review.sections.map(sec => (
        <SectionReview key={sec.id} section={sec} onAnalyze={setAnalysisQid} />
      ))}

      {analysisQid && (
        <AnalysisPanel questionId={analysisQid} onClose={() => setAnalysisQid(null)} />
      )}
    </div>
  )
}
