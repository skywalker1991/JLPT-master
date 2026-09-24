import { useEffect, useState } from 'react'
import { Flag, Check, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { listExamReports, editExamItem, resolveExamReport, type ExamReport } from '../../services/api'

const KIND_LABEL: Record<string, string> = {
  wrong_answer: '答案不对',
  typo: '文字有误',
  missing: '内容缺失',
  other: '其他',
}

const OPTS = ['1', '2', '3', '4']

/**
 * Questions flagged while answering, and the fields needed to fix them.
 *
 * Importing used to be one-way, so the only repair was deleting the paper and
 * losing its attempts. Edits here are scoped to the single question, and every
 * change is versioned — a past attempt was answered against the old wording.
 */
export default function ReportQueue() {
  const [reports, setReports] = useState<ExamReport[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    listExamReports()
      .then(setReports)
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const save = async (report: ExamReport, changes: Record<string, unknown>) => {
    setBusy(report.id)
    try {
      await editExamItem(report.item.id, { ...changes, note: `修正报错：${KIND_LABEL[report.kind]}` })
      await resolveExamReport(report.id)
      setReports(prev => prev.filter(r => r.id !== report.id))
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>
  }

  if (reports.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-fg-subtle">
        <Flag className="w-8 h-8 mx-auto mb-2 opacity-30" />
        没有待处理的报错
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {reports.map(report => (
        <ReportRow
          key={report.id}
          report={report}
          busy={busy === report.id}
          onSave={changes => save(report, changes)}
          onDismiss={async () => {
            setBusy(report.id)
            try {
              await resolveExamReport(report.id)
              setReports(prev => prev.filter(r => r.id !== report.id))
            } finally { setBusy(null) }
          }}
        />
      ))}
    </div>
  )
}

function ReportRow({
  report, busy, onSave, onDismiss,
}: {
  report: ExamReport
  busy: boolean
  onSave: (changes: Record<string, unknown>) => void
  onDismiss: () => void
}) {
  const { item, problem, paper } = report
  const [stem, setStem] = useState(item.stem)
  const [answer, setAnswer] = useState(item.correct_answer ?? '')
  const [order, setOrder] = useState(item.answer_order ?? '')

  const changed: Record<string, unknown> = {}
  if (stem !== item.stem) changed.stem = stem
  if (answer !== (item.correct_answer ?? '')) changed.correct_answer = answer
  if (order !== (item.answer_order ?? '')) changed.answer_order = order || null
  const dirty = Object.keys(changed).length > 0

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="badge bg-danger-light text-danger-fg">{KIND_LABEL[report.kind] ?? report.kind}</span>
        <span className="text-fg-muted">{paper.title}</span>
        <span className="text-fg-subtle">{problem.name} · 第{item.num}题</span>
      </div>
      {report.note && <p className="text-xs text-fg-muted">{report.note}</p>}

      <textarea
        value={stem}
        onChange={e => setStem(e.target.value)}
        rows={2}
        className="w-full text-sm bg-bg border border-border rounded-lg px-3 py-2 resize-y
                   text-fg outline-none focus:border-accent/50"
      />

      <div className="grid grid-cols-2 gap-2">
        {OPTS.filter(k => k in item.options).map(k => (
          <div key={k} className="text-xs text-fg-muted flex gap-1.5">
            <span className="font-bold shrink-0">{k}</span>
            <span className="truncate">{item.options[k]}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
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

        {problem.type === 'sentence_order' && (
          <label className="text-xs text-fg-muted flex items-center gap-1.5">
            完整语序
            <input
              value={order}
              onChange={e => setOrder(e.target.value)}
              placeholder="3412"
              maxLength={8}
              className="w-20 bg-bg border border-border rounded-lg px-2 py-1 text-sm font-mono text-fg"
            />
          </label>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={onDismiss} disabled={busy} className="btn btn-ghost text-xs h-8">
            无需修改
          </button>
          <button
            onClick={() => onSave(changed)}
            disabled={busy || !dirty}
            className={clsx('btn btn-primary text-xs h-8 gap-1', !dirty && 'opacity-40')}
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            保存并关闭
          </button>
        </div>
      </div>
    </div>
  )
}
