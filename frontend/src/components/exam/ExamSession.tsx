import { useEffect, useMemo, useState } from 'react'
import { Brain, CheckCircle, ChevronLeft, ChevronRight, Loader2, X, XCircle } from 'lucide-react'
import { submitAnswer, submitSection, completeAttempt } from '../../services/api'
import type { ExamPaperDetail, QuestionItem, SectionDetail } from '../../types'
import AnalysisPanel from './AnalysisPanel'

// ─── Quiz unit ────────────────────────────────────────────────────────────────

interface QuizUnit {
  sectionId: string
  sectionName: string
  passage: string | null
  questions: QuestionItem[]
}

function buildUnits(sections: SectionDetail[], sectionIds: string[]): QuizUnit[] {
  const units: QuizUnit[] = []
  for (const sec of sections) {
    if (!sectionIds.includes(sec.id)) continue
    const passageMap = new Map<string, number>()
    for (const q of sec.questions) {
      const key = q.meta?.passage_group as string | undefined
      const isPassage = q.type === 'passage_fill' || q.type === 'reading_comp'
      if (isPassage && key && passageMap.has(key)) {
        units[passageMap.get(key)!].questions.push(q)
      } else if (isPassage && key) {
        passageMap.set(key, units.length)
        units.push({ sectionId: sec.id, sectionName: sec.name, passage: q.passage ?? null, questions: [q] })
      } else {
        units.push({ sectionId: sec.id, sectionName: sec.name, passage: null, questions: [q] })
      }
    }
  }
  return units
}

function formatTime(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ─── Question navigation grid ─────────────────────────────────────────────────

function QuestionNav({
  units, unitIdx, answers, submitted, onSelect, reviewMode, isCorrectMap,
}: {
  units: QuizUnit[]
  unitIdx: number
  answers: Record<string, string>
  submitted: Set<string>
  onSelect: (idx: number) => void
  reviewMode?: boolean
  isCorrectMap?: Record<string, boolean | null>
}) {
  const sections: { name: string; indices: number[] }[] = []
  for (let i = 0; i < units.length; i++) {
    const u = units[i]
    if (sections.length === 0 || sections[sections.length - 1].name !== u.sectionName) {
      sections.push({ name: u.sectionName, indices: [i] })
    } else {
      sections[sections.length - 1].indices.push(i)
    }
  }

  return (
    <div className="shrink-0 border-b border-border bg-bg overflow-y-auto" style={{ maxHeight: 140 }}>
      {sections.map(sec => (
        <div key={sec.name} className="px-4 pt-2 pb-2">
          <p className="text-[10px] font-semibold text-fg-muted uppercase tracking-wide mb-1.5">{sec.name}</p>
          <div className="flex flex-wrap gap-1">
            {sec.indices.map(idx => {
              const u = units[idx]
              const isCurrent = idx === unitIdx
              let colorClass: string
              if (reviewMode) {
                const gradedQs = u.questions.filter(q => Object.keys(q.options).length > 0)
                const answered = gradedQs.every(q => answers[q.id])
                const allCorrect = answered && gradedQs.every(q => isCorrectMap?.[q.id] === true)
                const anyWrong = gradedQs.some(q => isCorrectMap?.[q.id] === false)
                colorClass = isCurrent
                  ? 'bg-accent text-white shadow-sm ring-2 ring-accent/30'
                  : !answered
                  ? 'bg-border/50 text-fg-muted'
                  : anyWrong
                  ? 'bg-danger/15 text-danger-fg border border-danger/30'
                  : allCorrect
                  ? 'bg-success/15 text-success-fg border border-success/30'
                  : 'bg-border/50 text-fg-muted'
              } else {
                const isAnswered = u.questions.every(q => Object.keys(q.options).length === 0 || answers[q.id])
                const isDone = submitted.has(u.sectionId)
                colorClass = isCurrent
                  ? 'bg-accent text-white shadow-sm ring-2 ring-accent/30'
                  : isDone && isAnswered
                  ? 'bg-success/15 text-success-fg border border-success/30'
                  : isDone
                  ? 'bg-border/60 text-fg-muted'
                  : isAnswered
                  ? 'bg-accent/15 text-accent'
                  : 'border border-border text-fg-muted hover:border-accent/50 hover:text-fg'
              }
              return (
                <button
                  key={idx}
                  onClick={() => onSelect(idx)}
                  className={`w-8 h-8 text-xs font-semibold rounded-lg transition-all ${colorClass}`}
                >
                  {idx + 1}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Single question display ──────────────────────────────────────────────────

const OPTS = ['1', '2', '3', '4'] as const

function QuestionDisplay({
  q, selected, onSelect, reviewMode, correctAnswer, isCorrect,
}: {
  q: QuestionItem
  selected: string | null
  onSelect: (a: string) => void
  reviewMode?: boolean
  correctAnswer?: string
  isCorrect?: boolean | null
}) {
  return (
    <div className="space-y-3">
      {q.stem && (
        <p className="text-base text-fg leading-relaxed">
          <span className="text-xs text-fg-muted mr-1">Q{q.seq}.</span>
          {q.stem}
        </p>
      )}
      {Object.keys(q.options).length > 0 ? (
        <div className="space-y-2">
          {OPTS.filter(k => k in q.options).map(k => {
            const isCorrectOpt = reviewMode && k === correctAnswer
            const isWrongUser = reviewMode && k === selected && isCorrect === false
            const isSelected = !reviewMode && selected === k
            return (
              <button
                key={k}
                onClick={() => !reviewMode && onSelect(k)}
                disabled={reviewMode}
                className={[
                  'w-full flex items-start gap-3 px-4 py-3 rounded-xl border text-sm text-left transition-all disabled:cursor-default',
                  isCorrectOpt
                    ? 'border-success bg-success-light text-success-fg font-medium'
                    : isWrongUser
                    ? 'border-danger bg-danger-light text-danger-fg'
                    : isSelected
                    ? 'border-accent bg-accent-light text-accent-fg font-medium shadow-sm'
                    : 'border-border hover:border-accent/40 hover:bg-accent-light/30',
                ].join(' ')}
              >
                <span className="shrink-0 font-bold text-xs mt-0.5 w-4">{k}</span>
                <span>{q.options[k]}</span>
                {isCorrectOpt && <CheckCircle className="w-4 h-4 ml-auto shrink-0 mt-0.5 text-success" />}
                {isWrongUser && <XCircle className="w-4 h-4 ml-auto shrink-0 mt-0.5 text-danger" />}
                {isSelected && <CheckCircle className="w-4 h-4 ml-auto shrink-0 mt-0.5 text-accent" />}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-fg-muted italic">（音声のみ）</p>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExamSession({
  detail,
  attemptId,
  sectionIds,
  initialAnswers,
  initialSubmitted,
  onComplete,
  onCancel,
  reviewMode,
  correctAnswers,
  isCorrectMap,
}: {
  detail: ExamPaperDetail
  attemptId: string
  sectionIds: string[]
  initialAnswers?: Record<string, string>
  initialSubmitted?: string[]
  onComplete: () => void
  onCancel: () => void
  reviewMode?: boolean
  correctAnswers?: Record<string, string>
  isCorrectMap?: Record<string, boolean | null>
}) {
  const units = useMemo(() => buildUnits(detail.sections, sectionIds), [detail, sectionIds])

  const startIdx = useMemo(() => {
    if (reviewMode || !initialAnswers) return 0
    const firstUnanswered = units.findIndex(u =>
      u.questions.some(q => Object.keys(q.options).length > 0 && !initialAnswers[q.id]),
    )
    return firstUnanswered >= 0 ? firstUnanswered : 0
  }, [units, initialAnswers, reviewMode])

  const [unitIdx, setUnitIdx] = useState(startIdx)
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers ?? {})
  const [submitted, setSubmitted] = useState<Set<string>>(
    reviewMode ? new Set(sectionIds) : new Set(initialSubmitted ?? []),
  )
  const [elapsed, setElapsed] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [analysisQid, setAnalysisQid] = useState<string | null>(null)

  useEffect(() => {
    if (reviewMode) return
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [reviewMode])

  const unit = units[unitIdx]

  const currentSectionUnits = useMemo(
    () => units.filter(u => u.sectionId === unit.sectionId),
    [units, unit.sectionId],
  )
  const currentSectionAnswered = currentSectionUnits.every(u =>
    u.questions.every(q => Object.keys(q.options).length === 0 || answers[q.id]),
  )
  const answeredInSection = currentSectionUnits.reduce(
    (n, u) => n + u.questions.filter(q => Object.keys(q.options).length > 0 && answers[q.id]).length, 0,
  )
  const totalInSection = currentSectionUnits.reduce(
    (n, u) => n + u.questions.filter(q => Object.keys(q.options).length > 0).length, 0,
  )

  const sectionAlreadySubmitted = submitted.has(unit.sectionId)

  async function handleSelect(questionId: string, answer: string) {
    if (sectionAlreadySubmitted || reviewMode) return
    setAnswers(prev => ({ ...prev, [questionId]: answer }))
    await submitAnswer(attemptId, questionId, answer).catch(() => {})
  }

  async function handleSubmitSection() {
    if (sectionAlreadySubmitted || submitting || reviewMode) return
    const unanswered = totalInSection - answeredInSection
    if (unanswered > 0 && !confirm(`还有 ${unanswered} 题未作答，确认提交本节？`)) return
    setSubmitting(true)
    try {
      await submitSection(attemptId, unit.sectionId)
      const newSubmitted = new Set([...submitted, unit.sectionId])
      setSubmitted(newSubmitted)

      if (sectionIds.every(id => newSubmitted.has(id))) {
        await completeAttempt(attemptId)
        onComplete()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border bg-surface">
        <button onClick={onCancel} className="text-fg-muted hover:text-fg transition-colors">
          <X className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-fg truncate">{unit.sectionName}</p>
          <p className="text-xs text-fg-muted">
            {reviewMode ? '查看结果' : `${answeredInSection}/${totalInSection} 已作答`}
          </p>
        </div>

        {!reviewMode && (
          <span className="text-sm font-mono text-fg-muted shrink-0">{formatTime(elapsed)}</span>
        )}

        {!reviewMode && !sectionAlreadySubmitted && (
          <button
            onClick={handleSubmitSection}
            disabled={submitting}
            className={[
              'shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
              currentSectionAnswered
                ? 'bg-accent text-white hover:bg-accent-hover'
                : 'bg-surface border border-border text-fg-muted hover:border-accent/50',
            ].join(' ')}
          >
            {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
            提交本节
          </button>
        )}
        {!reviewMode && sectionAlreadySubmitted && (
          <span className="shrink-0 text-xs text-success font-medium">✓ 已提交</span>
        )}
      </div>

      {/* Question navigation */}
      <QuestionNav
        units={units}
        unitIdx={unitIdx}
        answers={answers}
        submitted={submitted}
        onSelect={setUnitIdx}
        reviewMode={reviewMode}
        isCorrectMap={isCorrectMap}
      />

      {/* Unit content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {unit.passage && (
          <div className="bg-bg border border-border rounded-xl p-4 text-sm text-fg leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto">
            {unit.passage}
          </div>
        )}

        {unit.questions.map(q => (
          <div key={q.id} className="space-y-2">
            <QuestionDisplay
              q={q}
              selected={answers[q.id] ?? null}
              onSelect={ans => handleSelect(q.id, ans)}
              reviewMode={reviewMode}
              correctAnswer={correctAnswers?.[q.id]}
              isCorrect={isCorrectMap?.[q.id]}
            />
            {reviewMode && Object.keys(q.options).length > 0 && (
              <button
                onClick={() => setAnalysisQid(analysisQid === q.id ? null : q.id)}
                className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
              >
                <Brain className="w-3.5 h-3.5" />
                {analysisQid === q.id ? '收起解析' : 'AI 解析'}
              </button>
            )}
            {reviewMode && analysisQid === q.id && (
              <AnalysisPanel questionId={q.id} />
            )}
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t border-border bg-surface">
        <button
          onClick={() => setUnitIdx(i => Math.max(0, i - 1))}
          disabled={unitIdx === 0}
          className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          上一题
        </button>

        <span className="text-xs text-fg-muted">
          {unitIdx + 1} / {units.length}
        </span>

        <button
          onClick={() => setUnitIdx(i => Math.min(units.length - 1, i + 1))}
          disabled={unitIdx === units.length - 1}
          className="flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg disabled:opacity-30 transition-colors"
        >
          下一题
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
