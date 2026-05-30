import { useEffect, useMemo, useState } from 'react'
import { Brain, CheckCircle, ChevronLeft, ChevronRight, Loader2, X, XCircle } from 'lucide-react'
import { submitAnswer, submitSection, completeAttempt } from '../../services/api'
import type { ExamPaperDetail, ProblemDetail, ItemSchema, SectionDetail } from '../../types'
import AnalysisPanel from './AnalysisPanel'

// ─── Quiz unit (one per Item) ─────────────────────────────────────────────────

interface QuizUnit {
  sectionId: string
  sectionName: string
  problem: ProblemDetail
  item: ItemSchema
}

function buildUnits(sections: SectionDetail[], sectionIds: string[]): QuizUnit[] {
  const units: QuizUnit[] = []
  for (const sec of sections) {
    if (!sectionIds.includes(sec.id)) continue
    for (const prob of sec.problems) {
      for (const item of prob.items) {
        units.push({ sectionId: sec.id, sectionName: sec.name, problem: prob, item })
      }
    }
  }
  return units
}

function formatTime(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '00')}`
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
  const sections: { name: string; entries: { idx: number; u: QuizUnit }[] }[] = []
  for (let i = 0; i < units.length; i++) {
    const u = units[i]
    if (sections.length === 0 || sections[sections.length - 1].name !== u.sectionName) {
      sections.push({ name: u.sectionName, entries: [] })
    }
    sections[sections.length - 1].entries.push({ idx: i, u })
  }

  return (
    <div className="shrink-0 border-b border-border bg-bg overflow-y-auto" style={{ maxHeight: 140 }}>
      {sections.map(sec => (
        <div key={sec.name} className="px-4 pt-2 pb-2">
          <p className="text-[10px] font-semibold text-fg-muted uppercase tracking-wide mb-1.5">{sec.name}</p>
          <div className="flex flex-wrap gap-1">
            {sec.entries.map(({ idx, u }) => {
              const { item } = u
              const hasOptions = Object.keys(item.options).length > 0
              const isCurrent = idx === unitIdx
              const label = item.num != null ? String(item.num) : String(item.seq)
              let colorClass: string
              if (reviewMode) {
                const answered = hasOptions && !!answers[item.id]
                const correct = isCorrectMap?.[item.id]
                colorClass = isCurrent
                  ? 'bg-accent text-white shadow-sm ring-2 ring-accent/30'
                  : !hasOptions
                  ? 'border border-border text-fg-muted'
                  : !answered
                  ? 'bg-border/50 text-fg-muted'
                  : correct === false
                  ? 'bg-danger/15 text-danger-fg border border-danger/30'
                  : correct === true
                  ? 'bg-success/15 text-success-fg border border-success/30'
                  : 'bg-border/50 text-fg-muted'
              } else {
                const isAnswered = !!answers[item.id]
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
                  key={item.id}
                  onClick={() => onSelect(idx)}
                  className={`w-8 h-8 text-xs font-semibold rounded-lg transition-all ${colorClass}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Single item display ──────────────────────────────────────────────────────

const OPTS = ['1', '2', '3', '4'] as const

// Render sentence_order stem: replace [_N_] / [_N★_] with visual chips
function SentenceOrderStem({ stem }: { stem: string }) {
  const parts = stem.split(/(\[_\d+★?_\])/g)
  return (
    <p className="text-base text-fg leading-relaxed">
      {parts.map((part, i) => {
        const star = /\[_(\d+)★_\]/.exec(part)
        const plain = /\[_(\d+)_\]/.exec(part)
        if (star) return (
          <span key={i} className="inline-flex items-center justify-center w-8 h-8 mx-0.5 rounded-lg bg-accent text-white text-xs font-bold align-middle">★</span>
        )
        if (plain) return (
          <span key={i} className="inline-flex items-center justify-center w-8 h-8 mx-0.5 rounded-lg bg-border/60 text-fg-muted text-xs font-bold align-middle">{plain[1]}</span>
        )
        return <span key={i}>{part}</span>
      })}
    </p>
  )
}

function ItemDisplay({
  item, selected, onSelect, reviewMode, correctAnswer, problemType,
}: {
  item: ItemSchema
  selected: string | null
  onSelect: (a: string) => void
  reviewMode?: boolean
  correctAnswer?: string
  isCorrect?: boolean | null
  problemType?: string
}) {
  const isSentenceOrder = problemType === 'sentence_order'

  return (
    <div className="space-y-3">
      {item.stem && (
        isSentenceOrder
          ? <><span className="text-xs text-fg-muted">{item.num != null ? `Q${item.num}. ` : ''}</span><SentenceOrderStem stem={item.stem} /></>
          : <p className="text-base text-fg leading-relaxed">
              {item.num != null && <span className="text-xs text-fg-muted mr-1">Q{item.num}.</span>}
              {item.stem}
            </p>
      )}
      {isSentenceOrder && (
        <p className="text-xs text-fg-muted">选择填入 <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-accent text-white text-[10px] font-bold align-middle">★</span> 处的词语：</p>
      )}
      {item.transcript && (
        <div className="bg-bg border border-border rounded-xl p-3 text-sm text-fg leading-relaxed whitespace-pre-wrap">
          <p className="text-[10px] font-semibold text-fg-muted mb-1.5 uppercase tracking-wide">聴解原文</p>
          {item.transcript}
        </div>
      )}
      {Object.keys(item.options).length > 0 ? (
        <div className="space-y-2">
          {OPTS.filter(k => k in item.options).map(k => {
            const isCorrectOpt = reviewMode && k === correctAnswer
            // Mark red only when we know the correct answer and this isn't it
            const isWrongUser = reviewMode && k === selected && correctAnswer != null && k !== correctAnswer
            // User's selection when correct answer is unknown (no DB answer)
            const isNeutralPick = reviewMode && k === selected && !isCorrectOpt && !isWrongUser
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
                    : isNeutralPick
                    ? 'border-accent/50 bg-accent-light/40 text-fg'
                    : isSelected
                    ? 'border-accent bg-accent-light text-accent-fg font-medium shadow-sm'
                    : 'border-border hover:border-accent/40 hover:bg-accent-light/30',
                ].join(' ')}
              >
                <span className="shrink-0 font-bold text-xs mt-0.5 w-4">{k}</span>
                <span>{item.options[k]}</span>
                {isCorrectOpt && <CheckCircle className="w-4 h-4 ml-auto shrink-0 mt-0.5 text-success" />}
                {isWrongUser && <XCircle className="w-4 h-4 ml-auto shrink-0 mt-0.5 text-danger" />}
                {isNeutralPick && <CheckCircle className="w-4 h-4 ml-auto shrink-0 mt-0.5 text-accent/60" />}
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
      Object.keys(u.item.options).length > 0 && !initialAnswers[u.item.id],
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
  const [analysisItemId, setAnalysisItemId] = useState<string | null>(null)
  const [analysisProblemId, setAnalysisProblemId] = useState<string | null>(null)

  useEffect(() => {
    if (reviewMode) return
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [reviewMode])

  const unit = units[unitIdx]
  const prob = unit.problem
  const item = unit.item

  const currentSectionUnits = useMemo(
    () => units.filter(u => u.sectionId === unit.sectionId),
    [units, unit.sectionId],
  )
  const answeredInSection = currentSectionUnits.filter(
    u => Object.keys(u.item.options).length > 0 && answers[u.item.id],
  ).length
  const totalInSection = currentSectionUnits.filter(
    u => Object.keys(u.item.options).length > 0,
  ).length
  const currentSectionAnswered = answeredInSection === totalInSection

  const sectionAlreadySubmitted = submitted.has(unit.sectionId)

  async function handleSelect(itemId: string, answer: string) {
    if (sectionAlreadySubmitted || reviewMode) return
    setAnswers(prev => ({ ...prev, [itemId]: answer }))
    await submitAnswer(attemptId, itemId, answer).catch(() => {})
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
        {reviewMode && correctAnswers && (() => {
          const allItems = units.flatMap(u => u.item)
          const knowable = allItems.filter(i => correctAnswers[i.id])
          const correct = knowable.filter(i => answers[i.id] === correctAnswers[i.id]).length
          const total = knowable.length
          const pct = total > 0 ? Math.round(correct / total * 100) : null
          return pct !== null ? (
            <span className={`shrink-0 text-sm font-bold ${pct >= 80 ? 'text-success-fg' : pct >= 60 ? 'text-accent' : 'text-danger-fg'}`}>
              {pct}% <span className="text-xs font-normal text-fg-muted">({correct}/{total})</span>
            </span>
          ) : null
        })()}
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

      {/* Problem navigation */}
      <QuestionNav
        units={units}
        unitIdx={unitIdx}
        answers={answers}
        submitted={submitted}
        onSelect={setUnitIdx}
        reviewMode={reviewMode}
        isCorrectMap={isCorrectMap}
      />

      {/* Item content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {/* Problem header */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-fg-muted bg-border/40 px-2 py-0.5 rounded">
            {prob.name}
          </span>
          {prob.instruction && (
            <p className="text-xs text-fg-muted">{prob.instruction}</p>
          )}
        </div>

        {/* Passage (reading) */}
        {prob.passage && (
          <div className="bg-bg border border-border rounded-xl p-4 text-sm text-fg leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto">
            {prob.passage}
          </div>
        )}

        {/* Media images */}
        {prob.media.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {prob.media.map(m => (
              <img key={m.id} src={m.url} alt={m.caption ?? ''} className="max-h-48 rounded-lg border border-border" />
            ))}
          </div>
        )}

        {/* Single item */}
        <div className="space-y-2">
          <ItemDisplay
            item={item}
            selected={answers[item.id] ?? null}
            onSelect={ans => handleSelect(item.id, ans)}
            reviewMode={reviewMode}
            correctAnswer={correctAnswers?.[item.id]}
            isCorrect={isCorrectMap?.[item.id]}
            problemType={prob.type}
          />
          {reviewMode && Object.keys(item.options).length > 0 && prob.type !== 'passage_fill' && (
            <button
              onClick={() => setAnalysisItemId(analysisItemId === item.id ? null : item.id)}
              className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
            >
              <Brain className="w-3.5 h-3.5" />
              {analysisItemId === item.id ? '收起解析' : 'AI 解析'}
            </button>
          )}
          {reviewMode && analysisItemId === item.id && prob.type !== 'passage_fill' && (
            <AnalysisPanel itemId={item.id} />
          )}
        </div>

        {/* Problem-level analysis for passage_fill (shown once per problem) */}
        {reviewMode && prob.type === 'passage_fill' && (
          <div className="space-y-2">
            <button
              onClick={() => setAnalysisProblemId(analysisProblemId === prob.id ? null : prob.id)}
              className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
            >
              <Brain className="w-3.5 h-3.5" />
              {analysisProblemId === prob.id ? '收起解析' : 'AI 解析（全文）'}
            </button>
            {analysisProblemId === prob.id && (
              <AnalysisPanel problem={{ id: prob.id, type: prob.type }} />
            )}
          </div>
        )}
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
        <span className="text-xs text-fg-muted">{unitIdx + 1} / {units.length}</span>
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
