import { useEffect, useState } from 'react'
import { Brain, CheckCircle, ChevronDown, Loader2, XCircle } from 'lucide-react'
import { getAttemptReview } from '../../services/api'
import type { AttemptReviewData, ReviewItem, ReviewProblem, ReviewSection } from '../../types'
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

// ─── Item review card ─────────────────────────────────────────────────────────

const OPTS = ['1', '2', '3', '4'] as const

function ItemReviewCard({
  item, onAnalyze, hideAnalyzeButton,
}: {
  item: ReviewItem
  onAnalyze: () => void
  hideAnalyzeButton?: boolean
}) {
  const [open, setOpen] = useState(false)

  function optClass(k: string) {
    const base = 'flex items-start gap-2 px-3 py-2 rounded-lg border text-sm transition-colors'
    if (k === item.correct_answer) return `${base} border-success bg-success-light text-success-fg font-medium`
    if (k === item.user_answer && !item.is_correct) return `${base} border-danger bg-danger-light text-danger-fg`
    return `${base} border-border text-fg-muted`
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Header — always visible */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        {item.is_correct === true && <CheckCircle className="w-4 h-4 text-success shrink-0" />}
        {item.is_correct === false && <XCircle className="w-4 h-4 text-danger shrink-0" />}
        {item.is_correct === null && <div className="w-4 h-4 rounded-full border-2 border-border shrink-0" />}
        <span className="text-xs text-fg-muted shrink-0">Q{item.seq}</span>
        <p className="text-sm text-fg truncate flex-1">{item.stem || '（无题干）'}</p>
        {item.user_answer && (
          <span className={`text-xs font-bold shrink-0 ${item.is_correct ? 'text-success-fg' : 'text-danger-fg'}`}>
            选 {item.user_answer}
          </span>
        )}
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 bg-bg space-y-3">
          {Object.keys(item.options).length > 0 && (
            <div className="space-y-1.5">
              {OPTS.filter(k => k in item.options).map(k => (
                <div key={k} className={optClass(k)}>
                  <span className="shrink-0 font-semibold text-xs mt-0.5 w-4">{k}</span>
                  <span className="flex-1">{item.options[k]}</span>
                  {k === item.correct_answer && <CheckCircle className="w-4 h-4 shrink-0 text-success" />}
                  {k === item.user_answer && !item.is_correct && <XCircle className="w-4 h-4 shrink-0 text-danger" />}
                </div>
              ))}
            </div>
          )}

          {!item.user_answer && (
            <p className="text-xs text-fg-muted italic">未作答</p>
          )}

          {Object.keys(item.options).length > 0 && !hideAnalyzeButton && (
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
  section, onAnalyze, onAnalyzeProblem,
}: {
  section: ReviewSection
  onAnalyze: (itemId: string) => void
  onAnalyzeProblem: (problemId: string) => void
}) {
  const [open, setOpen] = useState(false)

  const allItems = section.problems.flatMap(p => p.items)
  const answered = allItems.filter(i => i.user_answer !== null).length
  const submitted = allItems.some(i => i.is_correct !== null)
  const correct = allItems.filter(i => i.is_correct === true).length
  const total = allItems.filter(i => i.correct_answer !== null).length
  const pct = total > 0 ? correct / total : null

  return (
    <div className="border border-border rounded-xl overflow-hidden">
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
              <span className="text-xs text-fg-muted">{answered}/{allItems.length} 已作答</span>
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

      {open && (
        <div className="border-t border-border px-4 py-3 bg-bg space-y-4">
          {section.problems.map(prob => (
            <div key={prob.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-fg-muted bg-border/40 px-2 py-0.5 rounded">
                  {prob.name}
                </span>
                {prob.instruction && (
                  <span className="text-xs text-fg-muted truncate">{prob.instruction}</span>
                )}
              </div>
              {prob.passage && (
                <div className="bg-surface border border-border rounded-xl p-4 text-sm text-fg leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {prob.passage}
                </div>
              )}
              {prob.transcript && (
                <div className="bg-surface border border-border rounded-xl p-3 text-sm text-fg leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto">
                  <p className="text-[10px] font-semibold text-fg-muted mb-1 uppercase">聴解原文</p>
                  {prob.transcript}
                </div>
              )}
              {prob.items.map(item => (
                <ItemReviewCard
                  key={item.id}
                  item={item}
                  onAnalyze={prob.type === 'passage_fill' ? () => {} : () => onAnalyze(item.id)}
                  hideAnalyzeButton={prob.type === 'passage_fill'}
                />
              ))}
              {prob.type === 'passage_fill' && prob.items.some(i => Object.keys(i.options).length > 0) && (
                <button
                  onClick={() => onAnalyzeProblem(prob.id)}
                  className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover font-medium transition-colors"
                >
                  <Brain className="w-3.5 h-3.5" />
                  请求 AI 解析（全文）
                </button>
              )}
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
  const [analysisItemId, setAnalysisItemId] = useState<string | null>(null)
  const [analysisProblemId, setAnalysisProblemId] = useState<string | null>(null)

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
    .flatMap(s => s.problems.flatMap((p: ReviewProblem) => p.items))
    .filter(i => i.user_answer !== null).length

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
        <SectionReview
          key={sec.id}
          section={sec}
          onAnalyze={id => { setAnalysisItemId(id); setAnalysisProblemId(null) }}
          onAnalyzeProblem={id => { setAnalysisProblemId(analysisProblemId === id ? null : id); setAnalysisItemId(null) }}
        />
      ))}

      {analysisItemId && (
        <AnalysisPanel itemId={analysisItemId} />
      )}

      {analysisProblemId && (
        <AnalysisPanel problem={{ id: analysisProblemId, type: 'passage_fill' }} />
      )}
    </div>
  )
}
