import { createContext, useContext, useState, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Send, Loader2, Plus, Check, ExternalLink, X, MessageCircleQuestion } from 'lucide-react'
import type { AskEntry, AskNewItem, AskTarget, SentenceAnalysis } from '../../types'
import { askTargets } from '../../types'
import { ask, createAtom } from '../../services/api'
import { useToast } from '../../context/ToastContext'

/** Follow-up state for the sentence being shown. Provided by AnalysisPage. */
interface AskContextValue {
  analysisId: string | null
  sentenceIndex: number | null
  asks: AskEntry[]
  addAsk: (entry: AskEntry) => void
  /** The analysis is still running: its record can't be updated yet */
  busy: boolean
  /** Items referenced by the question being written */
  attached: AskTarget[]
  setAttached: (targets: AskTarget[]) => void
  composerRef: RefObject<HTMLTextAreaElement>
}

export const AskContext = createContext<AskContextValue | null>(null)

const sameTarget = (a: AskTarget, b: AskTarget) => a.kind === b.kind && a.key === b.key
const label = (t: AskTarget) => `${t.kind === 'vocab' ? '单词' : '语法'}「${t.key}」`

/**
 * "追问" under a sentence: one follow-up thread per sentence. A question can
 * reference some of the sentence's vocab / grammar cards (none = about the
 * sentence as a whole); the sentence is always the context. The AI sees the
 * thread so far, and lists new words / grammar its answer introduced so they
 * can be added to the knowledge base. Q&A is saved with the analysis.
 */
export default function FollowUp({ analysis }: { analysis: SentenceAnalysis | null }) {
  const ctx = useContext(AskContext)
  const { toast } = useToast()
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [picking, setPicking] = useState(false)

  if (!ctx || ctx.analysisId === null || ctx.sentenceIndex === null || !analysis) return null
  const { analysisId, sentenceIndex, asks, addAsk, busy, attached, setAttached, composerRef } = ctx

  const thread = asks.filter(a => a.params.sentence_index === sentenceIndex)
  const options: AskTarget[] = [
    ...analysis.vocab.map(v => ({ kind: 'vocab' as const, key: v.surface })),
    ...analysis.grammar.map(g => ({ kind: 'grammar' as const, key: g.pattern })),
  ]
  const toggle = (t: AskTarget) =>
    setAttached(attached.some(a => sameTarget(a, t)) ? attached.filter(a => !sameTarget(a, t)) : [...attached, t])

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
      setPicking(false)
    } catch {
      toast('提问失败，请重试', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="space-y-3 pt-6">
      <p className="section-label flex items-center gap-1.5">
        <MessageCircleQuestion className="w-3.5 h-3.5" />追问{thread.length > 0 && ` · ${thread.length}`}
      </p>

      {thread.map((entry, i) => {
        const refs = askTargets(entry)
        return (
          <div key={i} className="space-y-2 rounded-xl border border-border bg-surface px-3.5 py-3">
            {refs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {refs.map(t => (
                  <span key={`${t.kind}-${t.key}`} className="text-2xs font-medium rounded-md px-1.5 py-0.5 bg-accent-light text-accent-fg">
                    {label(t)}
                  </span>
                ))}
              </div>
            )}
            <p className="text-sm font-semibold text-fg">{entry.params.question}</p>
            <p className="text-sm text-fg-muted leading-relaxed whitespace-pre-wrap">{entry.result.response}</p>
            {entry.result.new_items && entry.result.new_items.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {entry.result.new_items.map(item => <NewItemChip key={`${item.kind}-${item.key}`} item={item} />)}
              </div>
            )}
          </div>
        )
      })}

      {/* Composer */}
      <div className="rounded-xl border border-border bg-surface p-2.5 space-y-2 focus-within:border-accent/50">
        <div className="flex flex-wrap items-center gap-1.5">
          {attached.map(t => (
            <span key={`${t.kind}-${t.key}`} className="inline-flex items-center gap-1 text-xs font-medium rounded-md pl-2 pr-1 py-0.5 bg-accent-light text-accent-fg">
              {label(t)}
              <button type="button" onClick={() => toggle(t)} aria-label={`取消引用${label(t)}`} className="rounded hover:bg-accent/15 p-0.5">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {options.length > 0 && (
            <button
              type="button"
              onClick={() => setPicking(p => !p)}
              aria-expanded={picking}
              className="inline-flex items-center gap-1 text-xs text-fg-muted rounded-md px-2 py-0.5 ring-1 ring-border hover:text-fg"
            >
              <Plus className="w-3 h-3" />引用单词 / 语法
            </button>
          )}
          {attached.length === 0 && <span className="text-xs text-fg-subtle">不引用就是问这句或整段</span>}
        </div>

        {picking && (
          <div className="flex flex-wrap gap-1.5 border-t border-border pt-2">
            {options.map(t => {
              const on = attached.some(a => sameTarget(a, t))
              return (
                <button
                  key={`${t.kind}-${t.key}`}
                  type="button"
                  onClick={() => toggle(t)}
                  aria-pressed={on}
                  className={clsx(
                    'text-xs rounded-md px-2 py-1 ring-1 transition-colors',
                    on ? 'bg-accent text-on-accent ring-accent' : 'ring-border text-fg-muted hover:text-fg',
                  )}
                >
                  {t.kind === 'grammar' && <span className="opacity-70 mr-1">法</span>}{t.key}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
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
            placeholder={busy ? '分析完成后就可以追问' : thread.length ? '继续追问…' : '这句话、上面的单词语法，或整段内容都可以问，回车发送'}
            aria-label="追问"
            className="flex-1 resize-none bg-transparent text-sm text-fg placeholder:text-fg-subtle outline-none min-h-[2.25rem] py-2 px-1"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!question.trim() || sending || busy}
            className="btn-primary h-9 px-3 shrink-0"
            aria-label="发送"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {sending && <p className="text-xs text-fg-subtle">思考中…</p>}
    </section>
  )
}

/** "追问" button on a vocab / grammar card: reference it in the follow-up and jump there. */
export function AttachButton({ target }: { target: AskTarget }) {
  const ctx = useContext(AskContext)
  if (!ctx || ctx.analysisId === null) return null
  const on = ctx.attached.some(a => sameTarget(a, target))
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation()
        if (!on) ctx.setAttached([...ctx.attached, target])
        const box = ctx.composerRef.current
        box?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        box?.focus({ preventScroll: true })
      }}
      className={clsx('btn text-xs h-7 mt-1 gap-1', on ? 'text-accent-fg' : 'btn-ghost')}
    >
      <MessageCircleQuestion className="w-3 h-3" />{on ? '已引用到追问' : '追问'}
    </button>
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
        state === 'done' ? 'border-success/40 bg-success-light' : 'border-border bg-bg hover:border-accent/50',
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
