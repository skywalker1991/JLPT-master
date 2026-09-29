import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import Passage from '../exam/Passage'

/**
 * A text the paper prints, shown folded, and correctable in place.
 *
 * The passage is where extraction goes wrong most quietly — a page read out
 * of order, a character misread, an option left stranded at the end of a
 * dialogue — and it is only ever checked by someone reading it against the
 * page. So it can be put right where it is read, and what is put right is
 * kept as a ruling with its reason, since the draft it is typed into is
 * thrown away at the next re-import.
 */
export default function RuledText({
  label, text, open, onSave,
}: {
  label: string
  text: string
  open?: boolean
  onSave: (next: string, reason: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const changed = draft !== text

  const save = async () => {
    setSaving(true)
    try {
      await onSave(draft, reason.trim())
      setEditing(false)
      setReason('')
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="rounded-lg border border-border" open={open || editing}>
      <summary className="px-3 py-1.5 text-xs text-fg-muted cursor-pointer flex items-center gap-2">
        <span>{label}</span>
        <button
          onClick={e => { e.preventDefault(); setDraft(text); setEditing(!editing) }}
          className="ml-auto text-fg-subtle hover:text-accent transition-colors"
        >
          {editing ? '收起' : '改文字'}
        </button>
      </summary>
      {editing ? (
        <div className="px-3 pb-2.5 space-y-1.5">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={Math.min(24, Math.max(4, draft.split('\n').length + 1))}
            className="w-full bg-bg border border-border rounded px-2 py-1 text-xs font-jp
                       text-fg leading-relaxed"
          />
          {changed && (
            <div className="flex items-center gap-2">
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="依据（例：第 12 页原文是「…」，抽取读错了）"
                className="flex-1 bg-bg border border-border rounded px-2 py-0.5 text-xs text-fg"
              />
              <button onClick={save} disabled={saving}
                      className="text-xs text-accent hover:underline flex items-center gap-1">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                判定
              </button>
            </div>
          )}
        </div>
      ) : (
        <Passage
          text={text}
          className="px-3 pb-2.5 text-xs text-fg-muted leading-relaxed whitespace-pre-wrap"
        />
      )}
    </details>
  )
}
