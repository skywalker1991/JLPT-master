import { createContext, useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Send, Loader2, Plus, Check, ExternalLink, MessageCircleQuestion } from 'lucide-react'
import type { AskEntry, AskKind, AskNewItem } from '../../types'
import { ask, createAtom } from '../../services/api'
import { useToast } from '../../context/ToastContext'

/** What the Q&A panels need about the analysis being shown. */
interface AskContextValue {
  analysisId: string | null
  sentenceIndex: number | null
  asks: AskEntry[]
  addAsk: (entry: AskEntry) => void
  /** The analysis is still running: its record can't be updated yet */
  busy: boolean
}

export const AskContext = createContext<AskContextValue | null>(null)

interface Props {
  kind: AskKind
  /** Vocab surface or grammar pattern; omitted for the whole sentence */
  target?: string
  placeholder?: string
}

/**
 * Free questions about the current sentence or one of its vocab / grammar
 * items. The AI answers with the sentence as context (and earlier Q&A about
 * the same thing), and lists new words / grammar its answer introduced so
 * they can be added to the knowledge base. Q&A is saved with the analysis.
 */
export default function AskPanel({ kind, target, placeholder }: Props) {
  const ctx = useContext(AskContext)
  const { toast } = useToast()
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)

  if (!ctx || ctx.analysisId === null || ctx.sentenceIndex === null) return null
  const { analysisId, sentenceIndex, asks, addAsk, busy } = ctx

  const thread = asks.filter(a =>
    a.params.sentence_index === sentenceIndex && a.params.kind === kind
    && (kind === 'sentence' || a.params.target === target))

  const send = async () => {
    const q = question.trim()
    if (!q || sending || busy) return
    setSending(true)
    const params = { sentence_index: sentenceIndex, kind, ...(target ? { target } : {}), question: q }
    try {
      const result = await ask(analysisId, params)
      addAsk({ template: 'ask', params, result })
      setQuestion('')
    } catch {
      toast('提问失败，请重试', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3" onClick={e => e.stopPropagation()}>
      {thread.map((entry, i) => (
        <div key={i} className="space-y-2">
          <p className="text-sm font-semibold text-fg">问：{entry.params.question}</p>
          <p className="text-sm text-fg-muted leading-relaxed whitespace-pre-wrap">{entry.result.response}</p>
          {entry.result.new_items && entry.result.new_items.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {entry.result.new_items.map(item => <NewItemChip key={`${item.kind}-${item.key}`} item={item} />)}
            </div>
          )}
        </div>
      ))}

      <div className="flex items-end gap-2">
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          rows={1}
          disabled={busy}
          placeholder={busy ? '分析完成后就可以提问' : placeholder ?? (thread.length ? '继续追问…' : '想问什么都可以，回车发送')}
          aria-label="提问"
          className="input resize-none text-sm min-h-[2.5rem]"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!question.trim() || sending || busy}
          className="btn-primary h-10 px-3 shrink-0"
          aria-label="发送"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
      {sending && <p className="text-xs text-fg-subtle">思考中…</p>}
    </div>
  )
}

/** A word / grammar point the answer introduced; one tap adds it to the knowledge base. */
function NewItemChip({ item }: { item: AskNewItem }) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [atomId, setAtomId] = useState<string | null>(null)

  const add = async () => {
    if (state === 'done') {
      if (atomId) navigate(`/kb/${atomId}`)
      return
    }
    if (state === 'loading') return
    setState('loading')
    try {
      const res = await createAtom({
        type: item.kind === 'vocab' ? 'vocabulary' : 'grammar',
        key: item.key,
        properties: [
          ...(item.reading ? [{ kind: 'reading', value: item.reading, source_type: 'ai' }] : []),
          { kind: 'meaning', value: item.meaning, source_type: 'ai' },
        ],
      })
      setAtomId(res.atom_id)
      setState('done')
      toast(
        res.status === 'created' ? `「${item.key}」已加入知识库`
          : res.status === 'exists' ? `「${item.key}」已在知识库中`
          : `知识库里已有和「${item.key}」相似的语法`,
        res.status === 'created' ? 'success' : 'info',
      )
    } catch {
      setState('idle')
      toast('加入失败，请重试', 'error')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void add()}
      title={state === 'done' ? '在知识库中查看' : '加入知识库'}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-left transition-colors',
        state === 'done' ? 'border-success/40 bg-success-light' : 'border-border bg-surface hover:border-accent/50',
      )}
    >
      <span className="text-sm font-semibold text-fg">{item.key}</span>
      {item.reading && <span className="text-2xs text-fg-subtle">{item.reading}</span>}
      <span className="text-xs text-fg-muted">{item.meaning}</span>
      {state === 'loading' && <Loader2 className="w-3 h-3 animate-spin text-fg-subtle" />}
      {state === 'idle' && <Plus className="w-3 h-3 text-accent" />}
      {state === 'done' && (atomId ? <ExternalLink className="w-3 h-3 text-success-fg" /> : <Check className="w-3 h-3 text-success-fg" />)}
    </button>
  )
}

/** "问一问" entry: a button that opens the Q&A panel. */
export function AskSection({ kind, target, label = '问一问', defaultOpen }: {
  kind: AskKind
  target?: string
  label?: string
  /** Open initially; defaults to "when there is saved Q&A" */
  defaultOpen?: boolean
}) {
  const ctx = useContext(AskContext)
  const count = ctx?.asks.filter(a =>
    a.params.sentence_index === ctx.sentenceIndex && a.params.kind === kind
    && (kind === 'sentence' || a.params.target === target)).length ?? 0
  const [open, setOpen] = useState(defaultOpen ?? count > 0)
  if (!ctx || ctx.analysisId === null) return null

  return (
    <div className="space-y-3" onClick={e => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className={clsx(
          'btn text-xs gap-1.5 py-1 px-2.5 rounded-full ring-1',
          open ? 'bg-accent-light text-accent-fg ring-accent-border' : 'text-fg-muted ring-border hover:text-fg',
        )}
      >
        <MessageCircleQuestion className="w-3.5 h-3.5" />
        {label}{count > 0 && <span className="tabular-nums">· {count}</span>}
      </button>
      {open && <AskPanel kind={kind} target={target} />}
    </div>
  )
}
