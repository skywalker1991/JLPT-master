import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Check, Loader2, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { editDraftItem } from '../../services/api'
import type { CanonicalPaper, DraftDetail } from '../../types'

const OPTS = ['1', '2', '3', '4']

interface Flat {
  section: string
  problem: string
  type: string
  passage: string | null
  num: number | null
  seq: number
  stem: string
  options: Record<string, string>
  correct_answer: string | null
  answer_order: string | null
}

function flatten(paper: CanonicalPaper): Flat[] {
  return paper.sections.flatMap(section =>
    section.problems.flatMap(problem =>
      problem.items.map(item => ({
        section: section.name, problem: problem.name, type: problem.type,
        passage: problem.passage,
        num: item.num, seq: item.seq, stem: item.stem,
        options: item.options, correct_answer: item.correct_answer,
        answer_order: item.answer_order,
      })),
    ),
  )
}

/**
 * Going through a paper one question at a time.
 *
 * The summary exists so that a clean paper takes one glance, but a paper from
 * an unfamiliar source — or a 問題 the checks flagged — is worth reading
 * properly, and a correction made here never becomes an attempt answered
 * against a wrong key.
 *
 * Which questions have been looked at is kept per draft in this browser: the
 * point is being able to stop after twenty and pick up where you left off.
 */
export default function ItemByItem({
  draft, onUpdated, startAt = 0,
}: {
  draft: DraftDetail
  onUpdated: (d: DraftDetail) => void
  startAt?: number
}) {
  const items = useMemo(() => flatten(draft.canonical!), [draft.canonical])
  const [index, setIndex] = useState(Math.min(startAt, Math.max(items.length - 1, 0)))
  const [checked, setChecked] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(`draft-checked-${draft.id}`) || '[]'))
    } catch { return new Set() }
  })
  const [saving, setSaving] = useState(false)

  const item = items[index]
  const key = `${item?.problem}-${item?.seq}`

  const [stem, setStem] = useState(item?.stem ?? '')
  const [answer, setAnswer] = useState(item?.correct_answer ?? '')
  const [order, setOrder] = useState(item?.answer_order ?? '')
  const [editingKey, setEditingKey] = useState(key)

  // Moving to another question loads its values; keeping them in state lets
  // the fields be edited without a save on every keystroke.
  if (key !== editingKey && item) {
    setEditingKey(key)
    setStem(item.stem)
    setAnswer(item.correct_answer ?? '')
    setOrder(item.answer_order ?? '')
  }

  if (!item) return <p className="p-6 text-sm text-fg-subtle">这份草稿没有题目</p>

  const dirty =
    stem !== item.stem ||
    answer !== (item.correct_answer ?? '') ||
    order !== (item.answer_order ?? '')

  const markChecked = (k: string) => {
    const next = new Set(checked)
    next.add(k)
    setChecked(next)
    try {
      localStorage.setItem(`draft-checked-${draft.id}`, JSON.stringify([...next]))
    } catch { /* private window, or storage blocked */ }
  }

  const go = (delta: number) => {
    markChecked(key)
    setIndex(i => Math.min(items.length - 1, Math.max(0, i + delta)))
  }

  const save = async () => {
    setSaving(true)
    try {
      const updated = await editDraftItem(draft.id, {
        problem: item.problem, seq: item.seq,
        ...(stem !== item.stem ? { stem } : {}),
        ...(answer !== (item.correct_answer ?? '') ? { correct_answer: answer || null } : {}),
        ...(order !== (item.answer_order ?? '') ? { answer_order: order || null } : {}),
      })
      onUpdated(updated)
      markChecked(key)
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 py-2.5 border-b border-border flex items-center gap-3 text-xs shrink-0">
        <span className="text-fg-muted">{item.section} · {item.problem}</span>
        <span className="text-fg-subtle">{item.type}</span>
        <span className="ml-auto text-fg-muted tabular-nums">
          {index + 1} / {items.length} · 已看 {checked.size}
        </span>
      </div>

      <div className="h-1 bg-border shrink-0">
        <div
          className="h-full bg-accent transition-[width]"
          style={{ width: `${(checked.size / items.length) * 100}%` }}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="max-w-2xl mx-auto space-y-4">
          {item.passage && (
            <details className="rounded-lg border border-border">
              <summary className="px-3 py-2 text-xs text-fg-muted cursor-pointer">本题组的文章</summary>
              <p className="px-3 pb-3 text-xs text-fg-muted leading-relaxed whitespace-pre-wrap">
                {item.passage}
              </p>
            </details>
          )}

          <div className="space-y-1.5">
            <label className="section-label">
              第 {item.num ?? item.seq} 题
              {!item.stem && <span className="text-danger ml-2">（试卷上未印内容）</span>}
            </label>
            <textarea
              value={stem}
              onChange={e => setStem(e.target.value)}
              rows={3}
              className="w-full text-sm bg-bg border border-border rounded-lg px-3 py-2 resize-y
                         text-fg leading-relaxed outline-none focus:border-accent/50"
            />
          </div>

          <div className="space-y-1.5">
            <p className="section-label">选项</p>
            {OPTS.filter(k => k in item.options).map(k => (
              <div key={k} className={clsx(
                'flex items-start gap-2 px-3 py-2 rounded-lg border text-sm',
                k === answer ? 'border-success bg-success-light text-success-fg' : 'border-border',
              )}>
                <button
                  onClick={() => setAnswer(k)}
                  className="shrink-0 font-bold text-xs w-4 text-left hover:text-accent"
                  title="设为正确答案"
                >
                  {k}
                </button>
                <span className="flex-1">{item.options[k]}</span>
              </div>
            ))}
            {Object.keys(item.options).length === 0 && (
              <p className="text-xs text-fg-subtle italic">（音声のみ，试卷上没有印选项）</p>
            )}
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <label className="text-xs text-fg-muted flex items-center gap-1.5">
              正确答案
              <select
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                className="bg-bg border border-border rounded-lg px-2 py-1 text-sm text-fg"
              >
                <option value="">—</option>
                {OPTS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>

            {item.type === 'sentence_order' && (
              <label className="text-xs text-fg-muted flex items-center gap-1.5">
                完整语序
                <input
                  value={order}
                  onChange={e => setOrder(e.target.value)}
                  placeholder="3412" maxLength={8}
                  className="w-20 bg-bg border border-border rounded-lg px-2 py-1 text-sm font-mono text-fg"
                />
              </label>
            )}

            {!item.correct_answer && (
              <span className="text-xs text-danger flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />没有答案，这题无法判分
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-border px-5 py-3 flex items-center gap-2 shrink-0">
        <button onClick={() => go(-1)} disabled={index === 0}
                className="btn btn-ghost h-9 text-sm gap-1 disabled:opacity-30">
          <ChevronLeft className="w-4 h-4" />上一题
        </button>
        <button onClick={save} disabled={!dirty || saving}
                className={clsx('btn h-9 text-sm gap-1.5', dirty ? 'btn-primary' : 'btn-ghost opacity-40')}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          保存修改
        </button>
        <button onClick={() => go(1)} disabled={index === items.length - 1}
                className="btn btn-ghost h-9 text-sm gap-1 ml-auto disabled:opacity-30">
          {checked.has(key) ? '下一题' : '确认无误，下一题'}<ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
