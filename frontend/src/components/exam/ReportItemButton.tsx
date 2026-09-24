import { useState } from 'react'
import { Flag, Check, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { reportExamItem } from '../../services/api'

/** What tends to be wrong with an imported question, in the order it gets
 *  noticed while answering one. */
const KINDS = [
  { key: 'wrong_answer', label: '答案不对' },
  { key: 'typo',         label: '文字有误' },
  { key: 'missing',      label: '内容缺失' },
  { key: 'other',        label: '其他' },
] as const

/**
 * Flag a question from inside the paper.
 *
 * A defect is noticed while answering, not while reviewing an import — asking
 * someone to remember it until they next open the admin page means it is never
 * fixed. The flag goes to a queue; the correction happens later.
 */
export default function ReportItemButton({
  itemId, attemptId,
}: {
  itemId: string
  attemptId?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const send = async (kind: string) => {
    setSending(kind)
    try {
      await reportExamItem(itemId, { kind, attempt_id: attemptId ?? null })
      setSent(true)
      setOpen(false)
    } finally {
      setSending(null)
    }
  }

  if (sent) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle">
        <Check className="w-3 h-3" />已标记
      </span>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg transition-colors"
      >
        <Flag className="w-3 h-3" />这题有问题
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {KINDS.map(k => (
        <button
          key={k.key}
          onClick={() => send(k.key)}
          disabled={sending !== null}
          className={clsx(
            'text-[11px] px-2 py-1 rounded-lg border border-border',
            'hover:border-accent/40 hover:bg-accent-light/30 transition-colors',
            sending === k.key && 'opacity-60',
          )}
        >
          {sending === k.key && <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />}
          {k.label}
        </button>
      ))}
      <button
        onClick={() => setOpen(false)}
        className="text-[11px] text-fg-subtle hover:text-fg px-1"
      >
        取消
      </button>
    </div>
  )
}
