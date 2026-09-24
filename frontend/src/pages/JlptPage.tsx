import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen, AlignLeft, FileText, Headphones, Clock,
  ChevronLeft, Loader2, Trash2,
} from 'lucide-react'
import {
  listExams, getExam, startAttempt, getAccuracyStats,
  listPaperAttempts, getAttemptReview, deleteAttempt,
} from '../services/api'
import { useSettings } from '../context/SettingsContext'
import ExamSession from '../components/exam/ExamSession'
import MistakeList from '../components/exam/MistakeList'
import type {
  ExamPaperList, ExamPaperDetail, AccuracyStats, AttemptSummary,
} from '../types'

// ─── JLPT exam schedule ───────────────────────────────────────────────────────

function nextJlptDate(): { label: string; daysLeft: number } {
  const now = new Date()
  const y = now.getFullYear()
  function firstSunday(yr: number, mo: number) {
    const d = new Date(yr, mo - 1, 1)
    d.setDate(1 + ((7 - d.getDay()) % 7))
    return d
  }
  const candidates = [firstSunday(y, 7), firstSunday(y, 12), firstSunday(y + 1, 7)]
  const next = candidates.find(d => d > now) ?? candidates[2]
  return {
    daysLeft: Math.ceil((next.getTime() - now.getTime()) / 86400000),
    label: `${next.getFullYear()}年${next.getMonth() + 1}月`,
  }
}

// ─── Stats sidebar ────────────────────────────────────────────────────────────

const STAT_CATS = [
  { key: 'vocab',     label: '単語', icon: BookOpen,   color: '#2563EB' },
  { key: 'grammar',   label: '文法', icon: AlignLeft,  color: '#7C3AED' },
  { key: 'reading',   label: '読解', icon: FileText,   color: '#059669' },
  { key: 'listening', label: '聴解', icon: Headphones, color: '#D97706' },
] as const

function StatsSidebar({ stats }: { stats: AccuracyStats | null }) {
  const { label, daysLeft } = useMemo(() => nextJlptDate(), [])
  return (
    <>
      {/* Countdown */}
      <div className="px-4 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-fg-muted text-xs mb-2">
          <Clock className="w-3.5 h-3.5" />距下次考试
        </div>
        <p className="text-3xl font-bold text-fg leading-none">
          {daysLeft}<span className="text-base font-normal text-fg-muted ml-1">天</span>
        </p>
        <p className="text-xs text-fg-muted mt-1">{label}</p>
      </div>

      {/* Accuracy */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p className="section-label">正解率</p>
        {STAT_CATS.map(({ key, label: l, icon: Icon, color }) => {
          const cat = stats?.[key]
          const pct = cat && cat.total > 0 ? Math.round(cat.correct / cat.total * 100) : null
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" style={{ color }} />
                  <span className="text-sm font-medium text-fg">{l}</span>
                </div>
                <span className="text-xs text-fg-muted">
                  {pct !== null ? `${pct}%` : '—'}
                  {cat && cat.total > 0 && (
                    <span className="text-fg-subtle ml-1">({cat.correct}/{cat.total})</span>
                  )}
                </span>
              </div>
              <div className="h-1.5 bg-border rounded-full overflow-hidden">
                {pct !== null && (
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ─── Level badge ──────────────────────────────────────────────────────────────

/** The countdown and accuracy on a phone: one line, not a column that would
 *  take the screen the papers need — but not gone, which is what hiding the
 *  sidebar did. */
function StatsStrip({ stats }: { stats: AccuracyStats | null }) {
  const { daysLeft } = useMemo(() => nextJlptDate(), [])
  return (
    <div className="md:hidden shrink-0 flex items-center gap-3 px-5 py-2 border-b border-border
                    overflow-x-auto">
      <span className="shrink-0 text-xs text-fg-muted">
        <span className="font-bold text-fg">{daysLeft}</span> 天
      </span>
      {STAT_CATS.map(({ key, label, color }) => {
        const cat = stats?.[key]
        const pct = cat && cat.total > 0 ? Math.round(cat.correct / cat.total * 100) : null
        return (
          <span key={key} className="shrink-0 text-xs text-fg-muted flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            {label}
            <span className="text-fg font-medium">{pct !== null ? `${pct}%` : '—'}</span>
          </span>
        )
      })}
    </div>
  )
}

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

function ExamBank({ papers, onSelect }: { papers: ExamPaperList[]; onSelect: (p: ExamPaperList) => void }) {
  const { settings } = useSettings()
  const filtered = useMemo(() =>
    settings.levelFilter.length === 0 ? papers : papers.filter(p => settings.levelFilter.includes(p.level)),
    [papers, settings.levelFilter],
  )
  const grouped = useMemo(() => {
    const order = ['N1', 'N2', 'N3', 'N4', 'N5']
    const byLevel = new Map<string, Map<string, ExamPaperList[]>>()
    for (const p of filtered) {
      if (!byLevel.has(p.level)) byLevel.set(p.level, new Map())
      const year = p.source?.match(/(\d{4})年/)?.[1] ?? '未知年份'
      const m = byLevel.get(p.level)!
      if (!m.has(year)) m.set(year, [])
      m.get(year)!.push(p)
    }
    return order.filter(l => byLevel.has(l)).map(l => ({
      level: l,
      years: [...byLevel.get(l)!.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([year, items]) => ({ year, items })),
    }))
  }, [filtered])

  if (grouped.length === 0) return (
    <div className="flex items-center justify-center h-32 text-fg-muted text-sm">
      {settings.levelFilter.length > 0 ? '当前等级筛选下暂无试卷' : '暂无试卷，使用 seed_exam.py 导入'}
    </div>
  )

  return (
    <div className="space-y-5">
      {grouped.map(({ level, years }) => (
        <div key={level}>
          <div className="flex items-center gap-2 mb-2">
            <LevelBadge level={level} />
            <div className="flex-1 h-px bg-border" />
          </div>
          {years.map(({ year, items }) => (
            <div key={year} className="mb-3">
              <p className="text-xs text-fg-muted font-medium mb-1.5 ml-1">{year}</p>
              <div className="space-y-2">
                {items.map(p => (
                  <div key={p.id}
                    className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3 shadow-card hover:shadow-card-md cursor-pointer group transition-shadow"
                    onClick={() => onSelect(p)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-fg text-sm truncate">{p.title}</p>
                      <p className="text-xs text-fg-muted mt-0.5">{p.source} · {p.section_count} 节 · {p.item_count} 题</p>
                    </div>
                    <span className="text-accent text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      进入 →
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

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

export default function JlptPage() {
  const [selected, setSelected] = useState<ExamPaperList | null>(null)
  const [papers, setPapers] = useState<ExamPaperList[]>([])
  const [stats, setStats] = useState<AccuracyStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'papers' | 'mistakes'>('papers')

  useEffect(() => {
    Promise.all([listExams(), getAccuracyStats()])
      .then(([p, s]) => { setPapers(p); setStats(s) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // ── Detail view ──
  if (selected) {
    return (
      <div className="flex flex-col md:flex-row flex-1 min-h-0 p-4 gap-4 overflow-hidden">
        <ExamDetailView paper={selected} onBack={() => setSelected(null)} />
      </div>
    )
  }

  // ── List view ──
  return (
    <div className="flex flex-col md:flex-row flex-1 min-h-0 p-4 gap-4 overflow-hidden">

      {/* Left: title + stats. The countdown and accuracy bars are context, not
          the task; on a phone they would take the screen the papers need. */}
      <div className="card w-52 shrink-0 hidden md:flex flex-col overflow-hidden">
        <div className="px-4 py-4 border-b border-border shrink-0">
          <h1 className="text-base font-bold text-fg">JLPT 真题练习</h1>
          <p className="text-xs text-fg-muted mt-0.5">选择试卷开始作答</p>
        </div>
        <StatsSidebar stats={stats} />
      </div>

      {/* Right: exam bank, or the mistakes gathered across every record */}
      <div className="card flex-1 flex flex-col min-h-0 overflow-hidden">
        <StatsStrip stats={stats} />
        <div className="shrink-0 flex gap-1 px-5 pt-4">
          {([['papers', '试卷'], ['mistakes', '错题']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                tab === k ? 'bg-fg/10 text-fg font-semibold' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'mistakes' && <MistakeList />}
        {tab === 'papers' && loading && (
          <div className="flex items-center justify-center flex-1 gap-2 text-fg-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}
        {tab === 'papers' && error && (
          <div className="flex items-center justify-center flex-1 text-danger text-sm">{error}</div>
        )}
        {tab === 'papers' && !loading && !error && (
          <div className="flex-1 overflow-y-auto p-5">
            <ExamBank papers={papers} onSelect={setSelected} />
          </div>
        )}
      </div>

    </div>
  )
}
