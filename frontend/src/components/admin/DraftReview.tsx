import { Fragment, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { editDraftItem, editDraftProblem } from '../../services/api'
import type { CanonicalItem, DraftDetail } from '../../types'
import QuestionText from '../exam/QuestionText'
import { Confidence, SourcePages } from './Provenance'
import RuledText from './RuledText'

const OPTS = ['1', '2', '3', '4']

/** A finding belongs to a question when it names one. */
function itemKey(problem: string, num: number | null, seq: number) {
  return `${problem}#${num ?? `s${seq}`}`
}

/**
 * Reviewing an imported paper by reading it.
 *
 * The checks are not there to be browsed — they are there so that reading the
 * paper can be a scroll rather than an audit. Everything is on one page in the
 * order it is printed; what needs a decision is marked where it sits, and can
 * be fixed without leaving the line it is on. A correction made here never
 * becomes an attempt answered against a wrong key.
 */
export default function DraftReview({
  draft, onConfirm, confirming, onUpdated,
}: {
  draft: DraftDetail
  onConfirm: () => void
  confirming?: boolean
  onUpdated: (d: DraftDetail) => void
}) {
  const report = draft.report
  const paper = draft.canonical
  const scroller = useRef<HTMLDivElement>(null)

  // Findings, indexed by the question they name, so each one can be shown
  // against its own line instead of in a list to be cross-referenced.
  const byItem = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!report) return map
    const add = (key: string, message: string) => {
      map.set(key, [...(map.get(key) ?? []), message])
    }
    for (const finding of report.hard ?? []) {
      const m = /^(問題\d+)\s*\/\s*第(\d+)题/.exec(finding.where)
      if (m) add(itemKey(m[1], Number(m[2]), 0), finding.message)
    }
    for (const line of report.invented ?? []) {
      const m = /^(問題\d+)/.exec(line) ?? /第(\d+)题/.exec(line)
      if (m) add(itemKey(m[1], null, 0), line)
    }
    for (const conflict of (report.hard ?? []).filter(f => f.where === '答案')) {
      const m = /第(\d+)题/.exec(conflict.message)
      if (m) {
        for (const [key] of map) void key
        add(`ANY#${m[1]}`, conflict.message)
      }
    }
    return map
  }, [report])

  if (!report || !paper) return null

  const findingsFor = (problem: string, item: CanonicalItem) =>
    [
      ...(byItem.get(itemKey(problem, item.num, item.seq)) ?? []),
      ...(item.num != null ? byItem.get(`ANY#${item.num}`) ?? [] : []),
    ]

  const needsAttention = (problem: string, item: CanonicalItem) =>
    findingsFor(problem, item).length > 0 || !item.correct_answer

  const total = paper.sections.reduce(
    (n, s) => n + s.problems.reduce((m, p) => m + p.items.length, 0), 0)
  // A 問題 that produced no items needs a decision as much as a question with
  // no answer does — it is the shape 聴解問題3 and 問題4 take when the paper
  // prints nothing for them.
  const flagged = paper.sections.reduce(
    (n, s) => n + s.problems.reduce(
      (m, p) => m + (p.items.length === 0 ? 1 : 0)
        + p.items.filter(i => needsAttention(p.name, i)).length, 0), 0)

  const jumpToNext = () => {
    const marks = scroller.current?.querySelectorAll('[data-flagged="1"]')
    if (!marks?.length) return
    const top = scroller.current!.scrollTop
    const next = Array.from(marks).find(el => (el as HTMLElement).offsetTop > top + 10)
      ?? marks[0]
    ;(next as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="px-5 py-3 border-b border-border shrink-0 flex items-baseline gap-3 flex-wrap">
        <h1 className="text-base font-semibold text-fg">{paper.title}</h1>
        <span className="text-xs text-fg-muted">
          {total} 题 · 答案 {report.answers?.answered ?? 0}
          {report.answers?.method === 'image' && ' · 答案由图片读出'}
        </span>
        {flagged > 0 && (
          <button
            onClick={jumpToNext}
            className="ml-auto text-xs text-danger hover:underline flex items-center gap-1"
          >
            <ChevronDown className="w-3 h-3" />{flagged} 处需要确认
          </button>
        )}
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-4 space-y-5">
          {(report.gaps ?? []).length > 0 && (
            <section className="rounded-lg border border-border bg-bg px-4 py-3 space-y-1">
              <p className="section-label">这套文件的限制</p>
              {report.gaps.map((g, i) => (
                <p key={i} className="text-xs text-fg-muted">· {g}</p>
              ))}
            </section>
          )}
          {(report.notes ?? []).length > 0 && (
            <section className="rounded-lg border border-border bg-bg px-4 py-3 space-y-1">
              <p className="section-label">说明</p>
              {report.notes.map((n, i) => (
                <p key={i} className="text-xs text-fg-muted leading-relaxed">· {n}</p>
              ))}
            </section>
          )}

          {paper.sections.map(section => (
            <section key={section.name} className="space-y-3">
              <h2 className="text-sm font-semibold text-fg sticky top-0 bg-bg py-1.5 z-10">
                {section.name}
              </h2>
              {section.problems.map(problem => (
                <div key={`${problem.name}-${problem.seq}`} className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-fg">{problem.name}</span>
                    <span className="text-xs text-fg-subtle">{problem.type}</span>
                    <span className="text-xs text-fg-subtle">{problem.items.length} 题</span>
                  </div>
                  {problem.passage && !problem.items.some(i => i.passage) && (
                    // 短文填空's passage IS the questions, so it is open; a
                    // 読解 passage is context and stays folded away.
                    <RuledText
                      label="文章"
                      text={problem.passage}
                      open={problem.type === 'passage_fill'}
                      onSave={async (next, reason) => onUpdated(await editDraftProblem(draft.id, {
                        section: section.name, problem: problem.name, passage: next,
                        ...(reason ? { note: reason } : {}),
                      }))}
                    />
                  )}
                  {problem.items.length === 0 && (
                    <p data-flagged="1"
                       className="text-xs text-danger pl-3 border-l-2 border-danger py-1 scroll-mt-16">
                      这个题组没有提取到任何小题——试卷上未印内容，题目和原文只能从解析文件补齐
                    </p>
                  )}
                  {problem.items.map((item, i) => (
                    <Fragment key={`${item.num}-${item.seq}`}>
                    {/* A 問題 can print several texts, each with its own
                        questions. Showing which one a question is about is the
                        only way to see the split went where it should. */}
                    {item.passage && item.passage !== problem.items[i - 1]?.passage && (
                      <RuledText
                        label={`文章（第 ${item.num} 题起）`}
                        text={item.passage}
                        open
                        onSave={async (next, reason) => onUpdated(await editDraftItem(draft.id, {
                          section: section.name, problem: problem.name, seq: item.seq,
                          passage: next, ...(reason ? { note: reason } : {}),
                        }))}
                      />
                    )}
                    <ItemRow
                      draftId={draft.id}
                      section={section.name}
                      problem={problem.name}
                      type={problem.type}
                      item={item}
                      findings={findingsFor(problem.name, item)}
                      onUpdated={onUpdated}
                    />
                    </Fragment>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>

      <div className="border-t border-border px-5 py-3 flex items-center gap-3 shrink-0">
        <p className="text-xs flex-1">
          {flagged > 0
            ? <span className="text-danger">{flagged} 处需要确认</span>
            : <span className="text-fg-muted">没有需要确认的地方</span>}
        </p>
        <button
          onClick={onConfirm}
          disabled={confirming}
          className={clsx('btn h-9 text-sm gap-1.5',
            flagged > 0 ? 'btn-ghost border border-border' : 'btn-primary')}
        >
          {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {flagged > 0 ? '仍然入库' : '确认入库'}
        </button>
      </div>
    </div>
  )
}


function ItemRow({
  draftId, section, problem, type, item, findings, onUpdated,
}: {
  draftId: string
  /** 問題1 exists in both 言語知識 and 聴解; the 問題 name alone is two
   *  questions, and an edit meant for one changed the other. */
  section: string
  problem: string
  type: string
  item: CanonicalItem
  findings: string[]
  onUpdated: (d: DraftDetail) => void
}) {
  const [answer, setAnswer] = useState(item.correct_answer ?? '')
  const [order, setOrder] = useState(item.answer_order ?? '')
  const [stem, setStem] = useState(item.stem ?? '')
  const [opts, setOpts] = useState<Record<string, string>>(item.options ?? {})
  const [transcript, setTranscript] = useState(item.transcript ?? '')
  const [editing, setEditing] = useState(false)
  // Why. A ruling kept without its reason is a ruling nobody can check when
  // it is looked at again — and it will be, on every re-import.
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const flagged = findings.length > 0 || !item.correct_answer
  const textChanged = stem !== (item.stem ?? '')
    || JSON.stringify(opts) !== JSON.stringify(item.options ?? {})
    || transcript !== (item.transcript ?? '')
  const dirty = answer !== (item.correct_answer ?? '')
    || order !== (item.answer_order ?? '')
    || textChanged

  const save = async () => {
    setSaving(true)
    try {
      onUpdated(await editDraftItem(draftId, {
        section, problem, seq: item.seq,
        ...(answer !== (item.correct_answer ?? '') ? { correct_answer: answer || null } : {}),
        ...(order !== (item.answer_order ?? '') ? { answer_order: order || null } : {}),
        ...(stem !== (item.stem ?? '') ? { stem } : {}),
        ...(JSON.stringify(opts) !== JSON.stringify(item.options ?? {}) ? { options: opts } : {}),
        ...(transcript !== (item.transcript ?? '') ? { transcript } : {}),
        ...(reason.trim() ? { note: reason.trim() } : {}),
      }))
      setEditing(false)
      setReason('')
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      data-flagged={flagged ? '1' : undefined}
      className={clsx(
        'rounded-lg px-3 py-2 space-y-1.5 scroll-mt-16',
        flagged ? 'border-l-2 border-danger bg-danger-light/20' : 'border-l-2 border-transparent',
      )}
    >
      {findings.map((f, i) => (
        <p key={i} className="text-xs text-danger flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{f}
        </p>
      ))}

      <p className="text-sm text-fg leading-relaxed">
        <span className="text-xs text-fg-subtle mr-1.5">{item.num ?? item.seq}.</span>
        <QuestionText stem={item.stem} type={type} num={item.num ?? item.seq}
                      transcript={item.transcript} />
      </p>

      {/* For 聴解 the dialogue is the question — the paper prints nothing.
          Filled in from the 解析 booklet, this is the only place to see it
          landed on the right 番. */}
      {item.transcript && (
        <details className="ml-5 rounded-lg border border-border">
          <summary className="px-2.5 py-1 text-xs text-fg-subtle cursor-pointer">
            聴解原文（{item.transcript.length} 字）
          </summary>
          <p className="px-2.5 pb-2 text-xs text-fg-muted leading-relaxed whitespace-pre-wrap">
            {item.transcript}
          </p>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-5">
        {/* Where the answer came from and how far that goes. Here rather
            than only after the import, because this is the moment the
            question is open: the findings are still on the table and what
            settles them is the page. */}
        <Confidence answer={answer || item.correct_answer} votes={item.votes} />
        {OPTS.filter(k => k in item.options).map(k => (
          <button
            key={k}
            onClick={() => setAnswer(k)}
            className={clsx('text-xs text-left transition-colors',
              k === answer ? 'text-success font-medium' : 'text-fg-muted hover:text-fg')}
          >
            <span className="font-bold mr-1">{k}</span>{item.options[k]}
          </button>
        ))}
        {Object.keys(item.options).length === 0 && (
          <span className="text-xs text-fg-subtle italic">（音声のみ）</span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <button onClick={() => setEditing(!editing)}
                  className="text-xs text-fg-subtle hover:text-accent transition-colors">
            {editing ? '收起' : '改文字'}
          </button>
          <SourcePages file={item.provenance?.source} page={item.provenance?.page}
                       scriptFile={item.script?.source} scriptPage={item.script?.page} />
        </span>
      </div>

      {/* The text as the paper prints it. The page is one click away to
          check against; the verbatim check is what flagged it in the first
          place, so this is where a misread character gets put right. */}
      {editing && (
        <div className="pl-5 space-y-1.5">
          <textarea
            value={stem}
            onChange={e => setStem(e.target.value)}
            rows={Math.max(1, Math.ceil(stem.length / 40))}
            className="w-full bg-bg border border-border rounded px-2 py-1 text-sm font-jp text-fg"
          />
          {/* Every slot the question could have, not only the ones that were
              read — an option the text layer lost has no field to type into
              otherwise. Left blank, a slot is not sent. */}
          {OPTS.filter(k => k in opts || Object.keys(opts).length > 0).map(k => (
            <label key={k} className="flex items-center gap-2 text-xs text-fg-muted">
              <span className="font-bold w-3">{k}</span>
              <input
                value={opts[k] ?? ''}
                placeholder={k in opts ? undefined : '（未读出）'}
                onChange={e => {
                  const next = { ...opts, [k]: e.target.value }
                  if (!e.target.value) delete next[k]
                  setOpts(next)
                }}
                className="flex-1 bg-bg border border-border rounded px-2 py-0.5 text-xs font-jp text-fg"
              />
            </label>
          ))}
          {item.transcript != null && item.transcript !== '' && (
            <label className="block text-xs text-fg-muted space-y-1">
              <span>聴解原文</span>
              <textarea
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                rows={Math.min(20, Math.max(4, transcript.split('\n').length + 1))}
                className="w-full bg-bg border border-border rounded px-2 py-1 text-xs font-jp
                           text-fg leading-relaxed"
              />
            </label>
          )}
        </div>
      )}

      {(flagged || dirty || type === 'sentence_order') && (
        <div className="flex items-center gap-3 pl-5 pt-0.5">
          <label className="text-xs text-fg-muted flex items-center gap-1.5">
            答案
            <select
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              className="bg-bg border border-border rounded px-1.5 py-0.5 text-xs text-fg"
            >
              <option value="">—</option>
              {OPTS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          {type === 'sentence_order' && (
            <label className="text-xs text-fg-muted flex items-center gap-1.5">
              语序
              <input
                value={order}
                onChange={e => setOrder(e.target.value)}
                placeholder="3412" maxLength={8}
                className="w-16 bg-bg border border-border rounded px-1.5 py-0.5 text-xs font-mono text-fg"
              />
            </label>
          )}
          {dirty && (
            <>
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={answer ? '依据（例：答案页 20-25=432131）' : '依据（例：材料本身没印这一题的答案）'}
                className="flex-1 min-w-40 bg-bg border border-border rounded px-2 py-0.5 text-xs text-fg"
              />
              <button onClick={save} disabled={saving}
                      className="text-xs text-accent hover:underline flex items-center gap-1">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                判定
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
