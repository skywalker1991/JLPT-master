import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { editDraftItem } from '../../services/api'
import type { CanonicalItem, DraftDetail } from '../../types'
import Passage from '../exam/Passage'

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
                  {problem.passage && (
                    // 短文填空's passage IS the questions, so it is open; a
                    // 読解 passage is context and stays folded away.
                    <details className="rounded-lg border border-border"
                             open={problem.type === 'passage_fill'}>
                      <summary className="px-3 py-1.5 text-xs text-fg-muted cursor-pointer">文章</summary>
                      <Passage
                        text={problem.passage}
                        className="px-3 pb-2.5 text-xs text-fg-muted leading-relaxed whitespace-pre-wrap"
                      />
                    </details>
                  )}
                  {problem.items.length === 0 && (
                    <p data-flagged="1"
                       className="text-xs text-danger pl-3 border-l-2 border-danger py-1 scroll-mt-16">
                      这个题组没有提取到任何小题——试卷上未印内容，题目和原文只能从解析文件补齐
                    </p>
                  )}
                  {problem.items.map(item => (
                    <ItemRow
                      key={`${item.num}-${item.seq}`}
                      draftId={draft.id}
                      problem={problem.name}
                      type={problem.type}
                      item={item}
                      findings={findingsFor(problem.name, item)}
                      onUpdated={onUpdated}
                    />
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

/** The paper underlines the word a question is about; `__…__` carries that
 *  through extraction, and here it goes back to being an underline. */
function Stem({ text }: { text: string }) {
  const parts = text.split(/__(.+?)__/g)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <span key={i} className="underline decoration-2 underline-offset-2 font-medium">{part}</span>
          : <span key={i}>{part}</span>,
      )}
    </>
  )
}


function ItemRow({
  draftId, problem, type, item, findings, onUpdated,
}: {
  draftId: string
  problem: string
  type: string
  item: CanonicalItem
  findings: string[]
  onUpdated: (d: DraftDetail) => void
}) {
  const [answer, setAnswer] = useState(item.correct_answer ?? '')
  const [order, setOrder] = useState(item.answer_order ?? '')
  const [saving, setSaving] = useState(false)

  const flagged = findings.length > 0 || !item.correct_answer
  const dirty = answer !== (item.correct_answer ?? '') || order !== (item.answer_order ?? '')

  const save = async () => {
    setSaving(true)
    try {
      onUpdated(await editDraftItem(draftId, {
        problem, seq: item.seq,
        ...(answer !== (item.correct_answer ?? '') ? { correct_answer: answer || null } : {}),
        ...(order !== (item.answer_order ?? '') ? { answer_order: order || null } : {}),
      }))
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
        {item.stem
          ? <Stem text={item.stem} />
          : type === 'passage_fill' && item.num != null
            // The question is the gap in the passage above, not a missing stem.
            ? <span className="text-fg-subtle">文章中的第 {item.num} 个空</span>
            : <span className="text-fg-subtle italic">（试卷上未印内容）</span>}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-5">
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
      </div>

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
            <button onClick={save} disabled={saving}
                    className="text-xs text-accent hover:underline flex items-center gap-1">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              保存
            </button>
          )}
        </div>
      )}
    </div>
  )
}
