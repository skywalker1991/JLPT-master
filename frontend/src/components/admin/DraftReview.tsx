import { useState } from 'react'
import { AlertTriangle, HelpCircle, Check, ChevronRight, Loader2 } from 'lucide-react'
import ItemByItem from './ItemByItem'
import clsx from 'clsx'
import type { DraftDetail } from '../../types'

/**
 * Deciding whether an imported paper is fit to keep.
 *
 * The checks exist so that a paper does not have to be read question by
 * question — so this leads with what they flagged and keeps the paper itself
 * folded away underneath. A sitting with nothing flagged should take one
 * glance and a click; only the flagged questions are worth opening.
 */
export default function DraftReview({
  draft, onConfirm, confirming, onUpdated,
}: {
  draft: DraftDetail
  onConfirm: () => void
  confirming?: boolean
  onUpdated: (d: DraftDetail) => void
}) {
  // A clean paper should take one glance; an unfamiliar one is worth reading
  // properly. Neither mode is the right default for both.
  const [mode, setMode] = useState<'summary' | 'items'>('summary')
  const report = draft.report
  const paper = draft.canonical
  if (!report || !paper) return null

  if (mode === 'items') {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <ModeTabs mode={mode} onChange={setMode} />
        <ItemByItem draft={draft} onUpdated={onUpdated} />
      </div>
    )
  }

  const hard = report.hard ?? []
  const soft = report.soft ?? []
  const invented = report.invented ?? []
  const blocking = hard.length + invented.length
  const answers = report.answers ?? {}

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ModeTabs mode={mode} onChange={setMode} />
      <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto p-5 space-y-5">
        <header className="space-y-1">
          <h1 className="text-lg font-semibold text-fg">{paper.title}</h1>
          <p className="text-xs text-fg-muted">
            {paper.sections.reduce((n, s) => n + s.problems.reduce((m, p) => m + p.items.length, 0), 0)} 题
            {' · '}答案 {answers.answered ?? 0}
            {answers.unanswered ? ` · ${answers.unanswered} 题无答案` : ''}
            {answers.method === 'image' && ' · 答案由图片读出'}
          </p>
        </header>

        {/* What the sources could not supply. Not a defect — a limit. */}
        {(report.gaps ?? []).length > 0 && (
          <section className="rounded-xl border border-border bg-bg p-4 space-y-1.5">
            <h2 className="section-label">这套文件的限制</h2>
            {report.gaps.map((g, i) => (
              <p key={i} className="text-xs text-fg-muted">· {g}</p>
            ))}
          </section>
        )}

        <Findings
          title="必须处理"
          hint="这些会让题目无法判分或内容不可信"
          tone="danger"
          icon={AlertTriangle}
          items={[
            ...invented.map(m => ({ where: '提取', message: m })),
            ...hard.map(h => ({ where: h.where, message: h.message })),
          ]}
        />

        <Findings
          title="请确认"
          hint="与该级别以往的卷子不同，可能只是本届的差异"
          tone="warn"
          icon={HelpCircle}
          items={soft.map(f => ({ where: f.where, message: f.message }))}
        />

        {(report.notes ?? []).length > 0 && (
          <section className="rounded-xl border border-border bg-bg p-4 space-y-1.5">
            <h2 className="section-label">说明</h2>
            {report.notes.map((n, i) => (
              <p key={i} className="text-xs text-fg-muted leading-relaxed">· {n}</p>
            ))}
          </section>
        )}

        {/* The paper itself, folded. Open a 問題 to spot-check it. */}
        <section className="space-y-2">
          <h2 className="section-label">全卷（抽查用）</h2>
          {paper.sections.map(section => (
            <div key={section.name} className="space-y-1.5">
              <p className="text-xs font-medium text-fg-muted">{section.name}</p>
              {section.problems.map(problem => (
                <ProblemRow key={problem.name + problem.seq} problem={problem} />
              ))}
            </div>
          ))}
        </section>

        <div className="sticky bottom-0 bg-bg/95 backdrop-blur border-t border-border py-3 flex items-center gap-3">
          {blocking > 0 ? (
            <p className="text-xs text-danger flex-1">
              有 {blocking} 处必须处理的问题，确认入库前请先修正
            </p>
          ) : (
            <p className="text-xs text-fg-muted flex-1">没有必须处理的问题</p>
          )}
          <button
            onClick={onConfirm}
            disabled={confirming}
            className={clsx('btn h-9 text-sm gap-1.5',
              blocking > 0 ? 'btn-ghost border border-border' : 'btn-primary')}
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {blocking > 0 ? '仍然入库' : '确认入库'}
          </button>
        </div>
      </div>
      </div>
    </div>
  )
}

function ModeTabs({
  mode, onChange,
}: {
  mode: 'summary' | 'items'
  onChange: (m: 'summary' | 'items') => void
}) {
  return (
    <div className="flex gap-1 px-5 py-2 border-b border-border shrink-0">
      {([['summary', '概览'], ['items', '逐题确认']] as const).map(([value, label]) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={clsx(
            'text-xs px-3 py-1.5 rounded-lg transition-colors',
            mode === value ? 'bg-accent text-on-accent font-medium' : 'text-fg-muted hover:text-fg',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Findings({
  title, hint, tone, icon: Icon, items,
}: {
  title: string
  hint: string
  tone: 'danger' | 'warn'
  icon: typeof AlertTriangle
  items: { where: string; message: string }[]
}) {
  if (items.length === 0) return null
  return (
    <section className={clsx(
      'rounded-xl border p-4 space-y-2',
      tone === 'danger' ? 'border-danger/30 bg-danger-light/40' : 'border-border bg-bg',
    )}>
      <div className="flex items-baseline gap-2">
        <Icon className={clsx('w-4 h-4 shrink-0 translate-y-0.5',
          tone === 'danger' ? 'text-danger' : 'text-fg-muted')} />
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <span className="text-xs text-fg-subtle">{items.length}</span>
      </div>
      <p className="text-xs text-fg-subtle">{hint}</p>
      <ul className="space-y-1.5 pt-1">
        {items.map((f, i) => (
          <li key={i} className="text-xs text-fg leading-relaxed flex gap-2">
            <span className="text-fg-subtle shrink-0 font-mono">{f.where}</span>
            <span>{f.message}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ProblemRow({ problem }: { problem: DraftDetail['canonical']['sections'][0]['problems'][0] }) {
  const [open, setOpen] = useState(false)
  const unanswered = problem.items.filter(i => !i.correct_answer).length

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent-light/30 transition-colors"
      >
        <ChevronRight className={clsx('w-3.5 h-3.5 text-fg-subtle transition-transform', open && 'rotate-90')} />
        <span className="text-sm font-medium text-fg">{problem.name}</span>
        <span className="text-xs text-fg-subtle">{problem.type}</span>
        <span className="text-xs text-fg-muted ml-auto">{problem.items.length} 题</span>
        {unanswered > 0 && (
          <span className="badge bg-danger-light text-danger-fg">{unanswered} 无答案</span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
          {problem.passage && (
            <p className="text-xs text-fg-muted leading-relaxed whitespace-pre-wrap bg-bg rounded-lg p-2.5 max-h-48 overflow-y-auto">
              {problem.passage}
            </p>
          )}
          {problem.items.map(item => (
            <div key={`${item.num}-${item.seq}`} className="space-y-1">
              <p className="text-sm text-fg">
                <span className="text-xs text-fg-subtle mr-1.5">{item.num ?? item.seq}.</span>
                {item.stem || <span className="text-fg-subtle italic">（试卷上未印内容）</span>}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 pl-5">
                {Object.entries(item.options).map(([k, v]) => (
                  <span key={k} className={clsx(
                    'text-xs',
                    k === item.correct_answer ? 'text-success font-medium' : 'text-fg-muted',
                  )}>
                    {k} {v}
                  </span>
                ))}
              </div>
              {item.answer_order && (
                <p className="text-xs text-fg-subtle pl-5">正确语序 {item.answer_order}</p>
              )}
              {!item.correct_answer && (
                <p className="text-xs text-danger pl-5">没有答案，这题无法判分</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
