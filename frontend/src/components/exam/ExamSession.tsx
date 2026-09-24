import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Brain, CheckCircle, ChevronLeft, ChevronRight, Loader2, X, XCircle } from 'lucide-react'
import { submitAnswer, submitSection, completeAttempt } from '../../services/api'
import type { ExamPaperDetail, ProblemDetail, ItemSchema, SectionDetail } from '../../types'
import AnalysisPanel from './AnalysisPanel'
import ReportItemButton from './ReportItemButton'
import Passage from './Passage'
import Stem from './Stem'

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

// ─── Question navigation grid ─────────────────────────────────────────────────

function QuestionNav({
  units, unitIdx, answers, submitted, onSelect, reviewMode, isCorrectMap, onClose,
}: {
  units: QuizUnit[]
  unitIdx: number
  answers: Record<string, string>
  submitted: Set<string>
  onSelect: (idx: number) => void
  reviewMode?: boolean
  isCorrectMap?: Record<string, boolean | null>
  onClose: () => void
}) {
  const current = units[unitIdx]
  // Which section's numbers are on show. Defaults to the one being answered
  // and follows it, but the whole paper stays reachable.
  const [showing, setShowing] = useState(current.sectionId)
  useEffect(() => setShowing(current.sectionId), [current.sectionId])

  const sections: { id: string; name: string }[] = []
  for (const u of units) {
    if (!sections.some(x => x.id === u.sectionId)) {
      sections.push({ id: u.sectionId, name: u.sectionName })
    }
  }

  // One section at a time. All 106 numbers cost two rows and a scrollbar,
  // permanently, to show numbers that are rarely wanted.
  const entries = units
    .map((u, idx) => ({ idx, u }))
    .filter(({ u }) => u.sectionId === showing)

  function colour(idx: number, u: QuizUnit) {
    const { item } = u
    const hasOptions = Object.keys(item.options).length > 0
    if (idx === unitIdx) return 'bg-accent text-on-accent shadow-sm ring-2 ring-accent/30'
    if (reviewMode) {
      if (!hasOptions) return 'border border-border text-fg-muted'
      if (!answers[item.id]) return 'bg-border/50 text-fg-muted'
      const correct = isCorrectMap?.[item.id]
      if (correct === false) return 'bg-danger/15 text-danger-fg border border-danger/30'
      if (correct === true) return 'bg-success/15 text-success-fg border border-success/30'
      return 'bg-border/50 text-fg-muted'
    }
    const done = submitted.has(u.sectionId)
    if (done && answers[item.id]) return 'bg-success/15 text-success-fg border border-success/30'
    if (done) return 'bg-border/60 text-fg-muted'
    if (answers[item.id]) return 'bg-accent/15 text-accent'
    return 'border border-border text-fg-muted hover:border-accent/50 hover:text-fg'
  }

  return (
    <div className="shrink-0 border-t border-border bg-bg px-4 py-2 space-y-2">
      {sections.length > 1 && (
        <div className="flex gap-1">
          {sections.map(sec => (
            <button
              key={sec.id}
              onClick={() => setShowing(sec.id)}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                sec.id === showing ? 'bg-fg/10 text-fg font-medium' : 'text-fg-subtle hover:text-fg'
              }`}
            >
              {sec.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1 max-h-44 overflow-y-auto">
        {entries.map(({ idx, u }) => (
          <button
            key={u.item.id}
            onClick={() => { onSelect(idx); onClose() }}
            className={`w-8 h-8 text-xs font-semibold rounded-lg transition-all ${colour(idx, u)}`}
          >
            {u.item.num ?? u.item.seq}
          </button>
        ))}
      </div>
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
          <span key={i} className="inline-flex items-center justify-center w-8 h-8 mx-0.5 rounded-lg bg-accent text-on-accent text-xs font-bold align-middle">★</span>
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
  item, selected, onSelect, reviewMode, correctAnswer, problemType, attemptId,
}: {
  item: ItemSchema
  selected: string | null
  onSelect: (a: string) => void
  reviewMode?: boolean
  correctAnswer?: string
  isCorrect?: boolean | null
  problemType?: string
  attemptId?: string | null
}) {
  const isSentenceOrder = problemType === 'sentence_order'

  return (
    <div className="space-y-3">
      {item.stem && (
        isSentenceOrder
          ? <><span className="text-xs text-fg-muted">{item.num != null ? `Q${item.num}. ` : ''}</span><SentenceOrderStem stem={item.stem} /></>
          : <p className="font-jp text-base text-fg leading-loose">
              {item.num != null && (
                // The paper prints the number reversed out of a filled square.
                <span className="inline-flex items-center justify-center w-6 h-6 mr-2 rounded-sm
                                 bg-fg text-bg text-xs font-sans font-bold align-middle">
                  {item.num}
                </span>
              )}
              <Stem text={item.stem} />
            </p>
      )}
      {isSentenceOrder && (
        <p className="text-xs text-fg-muted">选择填入 <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-accent text-on-accent text-[10px] font-bold align-middle">★</span> 处的词语：</p>
      )}
      {/* Only once the section is answered. 聴解 is answered from the audio;
          printing the dialogue beside the choices turns every listening
          question into a reading one — which is what it did the moment the
          transcripts started arriving from the 解析 booklet. */}
      {reviewMode && item.transcript && (
        <div className="font-jp bg-bg border border-border rounded-lg px-4 py-3 text-sm text-fg
                        leading-loose whitespace-pre-wrap">
          <p className="font-sans text-[10px] font-semibold text-fg-muted mb-1.5 tracking-wide">聴解原文</p>
          {item.transcript}
        </div>
      )}
      {Object.keys(item.options).length > 0 ? (
        // The paper sets the four choices on one line where they are short —
        // readings, particles — and stacks them where they are sentences.
        <div className={
          OPTS.filter(k => k in item.options).every(k => (item.options[k] ?? '').length <= 14)
            ? 'flex flex-wrap gap-x-6 gap-y-2'
            : 'space-y-2'
        }>
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
                  'flex items-start gap-2 px-2.5 py-2 rounded-lg font-jp text-[15px] leading-relaxed',
                  'text-left transition-colors disabled:cursor-default',
                  isCorrectOpt
                    ? 'bg-success-light text-success-fg font-semibold'
                    : isWrongUser
                    ? 'bg-danger-light text-danger-fg'
                    : isNeutralPick
                    ? 'bg-accent-light/40 text-fg'
                    : isSelected
                    ? 'bg-accent-light text-accent-fg font-semibold'
                    : 'hover:bg-accent-light/30',
                ].join(' ')}
              >
                {/* The paper prints the choice number in a thin circle. */}
                <span className={[
                  'shrink-0 w-5 h-5 mt-0.5 rounded-full border text-[11px] font-sans font-bold',
                  'inline-flex items-center justify-center',
                  isSelected || isCorrectOpt ? 'border-current' : 'border-fg-subtle text-fg-muted',
                ].join(' ')}>{k}</span>
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
      {/* Defects surface while answering; the flag has to be here to be used. */}
      <div className="pt-1">
        <ReportItemButton itemId={item.id} attemptId={attemptId} />
      </div>
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
  const [submitting, setSubmitting] = useState(false)
  const [analysisItemId, setAnalysisItemId] = useState<string | null>(null)
  const [analysisProblemId, setAnalysisProblemId] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)


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
        {!reviewMode && !sectionAlreadySubmitted && (
          <button
            onClick={handleSubmitSection}
            disabled={submitting}
            className={[
              'shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5',
              currentSectionAnswered
                ? 'bg-accent text-on-accent hover:bg-accent-hover'
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

      {/* Item content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {/* Problem header */}
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-fg-muted
                           bg-border/40 px-2 py-0.5 rounded">
            {prob.name}
          </span>
          {prob.instruction && (
            <p className="font-jp text-xs text-fg-muted leading-relaxed">{prob.instruction}</p>
          )}
        </div>

        {/* Passage (reading). For 短文填空 the passage carries the question
            itself, so the blank being answered is marked in it. */}
        {(item.passage ?? prob.passage) && (
          <Passage
            text={item.passage ?? prob.passage!}
            active={prob.type === 'passage_fill' ? item.num : null}
            className="font-jp bg-bg border border-border rounded-lg px-5 py-4 text-[15px] text-fg
                       leading-[2] whitespace-pre-wrap max-h-72 overflow-y-auto"
          />
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
            attemptId={attemptId}
          />
          {reviewMode && Object.keys(item.options).length > 0 && !['passage_fill','reading_comp'].includes(prob.type) && (
            <button
              onClick={() => setAnalysisItemId(analysisItemId === item.id ? null : item.id)}
              className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
            >
              <Brain className="w-3.5 h-3.5" />
              {analysisItemId === item.id ? '收起解析' : 'AI 解析'}
            </button>
          )}
          {reviewMode && analysisItemId === item.id && !['passage_fill','reading_comp'].includes(prob.type) && (
            <AnalysisPanel itemId={item.id} />
          )}
        </div>

        {/* Problem-level analysis for passage_fill / reading_comp */}
        {reviewMode && ['passage_fill','reading_comp'].includes(prob.type) && (
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

      {/* Jumping to a question belongs next to stepping through them, within
          reach of the thumb rather than at the top of the screen. */}
      {navOpen && (
        <QuestionNav
          units={units}
          unitIdx={unitIdx}
          answers={answers}
          submitted={submitted}
          onSelect={setUnitIdx}
          reviewMode={reviewMode}
          isCorrectMap={isCorrectMap}
          onClose={() => setNavOpen(false)}
        />
      )}

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
        {/* Scoped to the section, like the header — one counter said 41/106
            while the other said 0/45, and neither was wrong. */}
        <button
          onClick={() => setNavOpen(o => !o)}
          className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg transition-colors"
        >
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${navOpen ? '' : 'rotate-180'}`} />
          第 {currentSectionUnits.findIndex(u => u.item.id === item.id) + 1} 题
          <span className="text-fg-subtle">
            / 本节 {currentSectionUnits.length} · 已答 {answeredInSection}
          </span>
        </button>
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
