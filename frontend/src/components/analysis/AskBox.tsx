import { useContext, useState, type RefObject } from 'react'
import { Loader2, X } from 'lucide-react'
import { askTargets, type AskTarget } from '../../types'
import { ask } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { AskContext, NewItemChip } from './AskPanel'
import SavePair from '../shared/SavePair'

const sameTarget = (a: AskTarget, b: AskTarget) => a.kind === b.kind && a.key === b.key

/** The questions already asked about the selected sentence, with their answers. */
export function AskThread() {
  const ctx = useContext(AskContext)
  if (!ctx || ctx.sentenceIndex === null) return null
  const thread = ctx.asks.filter(a => a.params.sentence_index === ctx.sentenceIndex)
  if (thread.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      {thread.map((entry, i) => (
        <article key={i} className="rounded-xl bg-accent-light px-4 py-3.5 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded-md bg-surface px-2 py-0.5 text-fg-muted">第 {(entry.params.sentence_index ?? 0) + 1} 句</span>
            {askTargets(entry).map(t => (
              <span key={`${t.kind}-${t.key}`} className="rounded-md bg-surface px-2 py-0.5 text-fg-muted font-jp">{t.key}</span>
            ))}
            <span className="text-sm text-fg-muted ml-1">{entry.params.question}</span>
          </div>
          <p className="text-[0.9375rem] text-fg leading-relaxed whitespace-pre-wrap">{entry.result.response}</p>
          {entry.result.pair && (
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-sm text-fg-muted"><span className="text-fg font-semibold mr-2">差在哪</span>{entry.result.pair.difference}</p>
              <SavePair pair={entry.result.pair} source="ask" analysisId={ctx.analysisId} sentenceIndex={entry.params.sentence_index} />
            </div>
          )}
          {entry.result.new_items && entry.result.new_items.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {entry.result.new_items.map(item => <NewItemChip key={`${item.kind}-${item.key}`} item={item} />)}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}

/**
 * The small box for a follow-up question. Its 「关于」 line holds what the
 * question is about: always the selected sentence, plus any word or grammar
 * point added with a card's 「追问」.
 */
export function AskComposer() {
  const ctx = useContext(AskContext)
  const { toast } = useToast()
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)

  if (!ctx || ctx.analysisId === null || ctx.sentenceIndex === null) return null
  const { analysisId, sentenceIndex, addAsk, busy, attached, setAttached, composerRef } = ctx

  const send = async () => {
    const q = question.trim()
    if (!q || sending || busy) return
    setSending(true)
    const params = { sentence_index: sentenceIndex, question: q, targets: attached }
    try {
      const result = await ask(analysisId, params)
      addAsk({ template: 'ask', params, result })
      setQuestion('')
      setAttached([])
    } catch {
      toast('没问成，请再试一次', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); void send() }}
      className="rounded-2xl border border-border bg-surface px-3.5 py-2.5 flex flex-col gap-1.5 focus-within:border-fg-subtle"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-fg-subtle mr-0.5">关于</span>
        <span className="rounded-md bg-accent-light px-2 py-0.5 text-fg">第 {sentenceIndex + 1} 句</span>
        {attached.map(t => (
          <span key={`${t.kind}-${t.key}`} className="inline-flex items-center gap-1 rounded-md bg-accent-light pl-2 pr-1 py-0.5 text-fg font-jp">
            {t.key}
            <button type="button" aria-label={`不再关于「${t.key}」`} onClick={() => setAttached(attached.filter(a => !sameTarget(a, t)))}
                    className="rounded p-0.5 text-fg-subtle hover:text-fg">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="ask-input" className="sr-only">追问</label>
        <input
          id="ask-input"
          ref={composerRef as RefObject<HTMLInputElement>}
          value={question}
          onChange={e => setQuestion(e.target.value)}
          disabled={busy}
          placeholder={busy ? '分析完成后就可以追问' : '接着问，或问这句、这个词、这个语法……'}
          className="flex-1 min-w-0 bg-transparent text-[0.9375rem] text-fg placeholder:text-fg-subtle outline-none py-1.5"
        />
        <button type="submit" disabled={!question.trim() || sending || busy}
                className="btn-primary h-9 px-4 shrink-0">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : '问'}
        </button>
      </div>
      {sending && <p className="text-xs text-fg-subtle">思考中…</p>}
    </form>
  )
}
