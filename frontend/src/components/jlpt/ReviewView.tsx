import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import type { ItemAskEntry, ItemReview, KnowledgePoint, OptionAnalysis } from '../../types'
import { askItem, getItemReview } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import Passage from '../exam/Passage'
import PlayAudio from '../exam/PlayAudio'
import Stem from '../exam/Stem'
import SentenceOrderStem from '../exam/SentenceOrderStem'
import QuestionBlock from './QuestionBlock'
import DiffBox, { useItemAnalysis } from './DiffBox'
import KnowledgeList from './KnowledgeList'
import ReportItemButton from '../exam/ReportItemButton'
import ReadingReview from './ReadingReview'
import SavePair from '../shared/SavePair'
import { NewItemChip } from '../analysis/AskPanel'
import { Thinking } from '../shared/Motion'

const WORD_TYPES = new Set(['vocab_fill', 'synonym', 'usage', 'kanji_reading', 'kanji_writing', 'word_formation', 'grammar_fill'])
/** Questions understood by reading: reviewed with the 語料分析 reader. */
const READING_TYPES = new Set(['reading_comp', 'passage_fill', 'listening', 'sentence_order'])

/**
 * Looking back at questions — the wrong ones after a mock exam, or one from
 * practice. The original question first, then what was chosen against the
 * right answer and 差在哪, the question's words and grammar to keep, and a
 * box to ask about it.
 */
export default function ReviewView({ itemIds, attemptId, runId, backLabel, onBack, startAt = 0 }: {
  itemIds: string[]
  attemptId?: string | null
  /** A practice pass: show its answers */
  runId?: string | null
  backLabel: string
  onBack: () => void
  startAt?: number
}) {
  const { toast } = useToast()
  const [at, setAt] = useState(startAt)
  const [current, setCurrent] = useState(itemIds[startAt])
  const [data, setData] = useState<ItemReview | null>(null)

  useEffect(() => {
    setData(null)
    getItemReview(current, attemptId, runId).then(setData).catch(() => toast('这道题没取到', 'error'))
  }, [current, attemptId, runId, toast])

  const goList = (i: number) => { setAt(i); setCurrent(itemIds[i]) }

  if (!data) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>

  const prob = data.problem
  const item = prob.items.find(i => i.id === current) ?? prob.items[0]
  const ans = data.answers[item.id]
  const correct = item.correct_answer ?? ''

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="h-14 shrink-0 flex items-center gap-3 px-2 md:px-6 border-b border-border">
        <button type="button" onClick={onBack} className="flex items-center gap-0.5 text-sm text-fg-muted hover:text-fg h-10 pr-1">
          <ChevronLeft className="w-4 h-4" />{backLabel}
        </button>
        <span className="font-bold text-fg">{data.paper}</span>
        <span className="hidden md:inline text-sm text-fg-muted truncate">{data.section} · {prob.name}{data.category ? ` ${data.category.label}` : ''}</span>
        <div className="ml-auto flex items-center gap-1 overflow-x-auto max-w-[55%]">
          {prob.items.map(i => {
            const a = data.answers[i.id]
            return (
              <button key={i.id} type="button" onClick={() => setCurrent(i.id)}
                      className={clsx('shrink-0 h-9 min-w-[3rem] px-2 rounded-lg border text-sm tabular-nums flex items-center justify-center gap-1',
                        i.id === item.id ? 'border-fg' : 'border-border',
                        a && !a.right ? 'text-danger-fg' : 'text-fg-muted')}>
                {i.num}{a ? (a.right ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />) : attemptId ? <span className="text-danger-fg">–</span> : null}
              </button>
            )
          })}
        </div>
      </header>

      {READING_TYPES.has(prob.type) ? (
        <ReadingReview key={item.id} data={data} itemId={item.id} chosen={ans?.chosen ?? null} correct={correct}
                       ask={<ItemAsk itemId={item.id} chosen={ans?.chosen ?? null} initial={data.asks} targets={[]} />} />
      ) : (
        <Body key={item.id} data={data} itemId={item.id} chosen={ans?.chosen ?? null} correct={correct} skipped={!!attemptId && !ans} />
      )}

      <footer className="shrink-0 h-14 flex items-center gap-3 px-4 md:px-6 border-t border-border">
        <ReportItemButton itemId={item.id} attemptId={attemptId} />
        {itemIds.length > 1 && <>
          <span className="text-xs text-fg-subtle tabular-nums">错题 {at + 1} / {itemIds.length}</span>
          <button type="button" disabled={at === 0} onClick={() => goList(at - 1)}
                  className="ml-auto btn h-10 border border-border text-fg disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
          <button type="button" disabled={at >= itemIds.length - 1} onClick={() => goList(at + 1)}
                  className="btn-primary h-10 px-5 disabled:opacity-40">下一错题<ChevronRight className="w-4 h-4" /></button>
        </>}
      </footer>
    </div>
  )
}

function Body({ data, itemId, chosen, correct, skipped }: {
  data: ItemReview; itemId: string; chosen: string | null; correct: string; skipped: boolean
}) {
  const prob = data.problem
  const item = prob.items.find(i => i.id === itemId)!
  const { analysis } = useItemAnalysis(itemId)
  const type = prob.type
  const word = WORD_TYPES.has(type)
  const listening = type === 'listening'
  const passage = item.passage || prob.passage
  const options = analysis?.options_analysis ?? []
  const wrong = chosen && chosen !== correct ? chosen : null
  const other = wrong ?? options.find(o => o.most_confusable && !o.is_correct)?.option ?? null

  const knowledge: KnowledgePoint[] = useMemo(() => {
    if (!analysis) return []
    if (analysis.knowledge?.length) return analysis.knowledge
    // 文の組み立て gives its words and grammar in its own lists
    const vocab = (analysis.vocabulary as { word: string; reading?: string; meaning: string }[] | undefined) ?? []
    const grammar = (analysis.grammar as { pattern: string; meaning: string }[] | undefined) ?? []
    return [
      ...vocab.map(v => ({ kind: 'vocab' as const, key: v.word, reading: v.reading ?? null, meaning: v.meaning, level: null, from: 'sentence' as const, option: null })),
      ...grammar.map(g => ({ kind: 'grammar' as const, key: g.pattern, reading: null, meaning: g.meaning, level: null, from: 'sentence' as const, option: null })),
    ]
  }, [analysis])
  const filled = analysis?.filled_sentence ?? (analysis?.correct_order as string | undefined) ?? null
  const filledZh = analysis?.filled_translation ?? (analysis?.translation as string | undefined) ?? null

  const question = (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-fg-subtle">
        <span className="text-2xl font-bold text-fg mr-2 tabular-nums">{item.num}</span>原题 · {prob.instruction}
        {skipped && <span className="ml-2 rounded-full bg-danger-light text-danger-fg px-2 py-0.5">这题没答</span>}
      </p>
      {type === 'sentence_order' && item.stem ? (
        <>
          <div className="font-jp text-xl leading-[1.9] text-fg"><SentenceOrderStem stem={item.stem} /></div>
          <QuestionBlock item={{ ...item, stem: '', num: null }} type={type} selected={chosen} correct={correct} size="md" />
        </>
      ) : (
        <QuestionBlock item={{ ...item, num: null }} type={type} selected={chosen} correct={correct} size="lg" />
      )}
      {filled && (
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xs text-fg-subtle">{type === 'sentence_order' ? '正确顺序' : '填入正解'}</span>
          <span className="font-jp text-lg text-fg">{filled}</span>
          {filledZh && <span className="text-sm text-fg-muted">{filledZh}</span>}
        </p>
      )}
    </div>
  )

  const compare = other && options.length > 0 && word && (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <OptionCard row={options.find(o => o.option === other)} text={item.options[other]} label={wrong ? `你选 · ${other}` : `最易混 · ${other}`} tone="wrong" knowledge={knowledge} />
      <OptionCard row={options.find(o => o.option === correct)} text={item.options[correct]} label={`正解 · ${correct}`} tone="right" knowledge={knowledge} />
    </div>
  )

  const optionNotes = !word && options.length > 0 && (
    <ul className="flex flex-col gap-2">
      {options.map(o => (
        <li key={o.option} className={clsx('rounded-xl border px-4 py-3 flex flex-col gap-1',
          o.option === correct ? 'border-fg' : o.option === chosen ? 'border-danger/40 bg-danger-light/50' : 'border-border')}>
          <p className="flex items-baseline gap-2 text-sm">
            <span className="font-semibold tabular-nums">{o.option}</span>
            {o.option === correct ? <Check className="w-3.5 h-3.5 text-success-fg" /> : o.option === chosen ? <X className="w-3.5 h-3.5 text-danger-fg" /> : null}
            <span className="font-jp text-fg flex-1"><Stem text={item.options[o.option] ?? ''} /></span>
          </p>
          {o.explanation && <p className="text-xs text-fg-muted leading-relaxed">{o.explanation}</p>}
        </li>
      ))}
    </ul>
  )

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-10 py-5 md:py-8 flex flex-col gap-5">
          {listening && <PlayAudio itemId={item.id} />}
          {(passage || (listening && item.transcript)) && (
            <div className="rounded-2xl bg-accent-light/60 px-5 py-4 flex flex-col gap-2">
              <p className="text-xs text-fg-subtle">{listening ? '听力原文' : '文章'}</p>
              <div className="font-jp text-[1.0625rem] leading-[2] text-fg whitespace-pre-wrap">
                {listening ? item.transcript : <Passage text={passage!} active={item.num} />}
              </div>
              {prob.passage_translation && !listening && <p className="text-sm text-fg-muted leading-relaxed">{prob.passage_translation}</p>}
            </div>
          )}
          {question}
          {compare}
          {optionNotes}
          {analysis ? <DiffBox itemId={item.id} type={type} chosen={chosen} correct={correct} /> : (
            <div className="rounded-xl bg-accent-light px-5 py-4 flex items-center gap-3 text-sm text-fg-muted">
              <Thinking className="w-5 h-5" />正在准备这道题的解析……
            </div>
          )}
          <div className="md:hidden">
            {knowledge.length > 0 && <KnowledgeList points={knowledge} sentence={filled} translation={filledZh} />}
          </div>
          <ItemAsk itemId={item.id} chosen={chosen} initial={data.asks}
                   targets={[correct, wrong].filter((o): o is string => !!o).map(o => item.options[o]).filter(t => t && t.length <= 12)} />
        </div>
      </main>
      {knowledge.length > 0 && (
        <aside className="hidden md:block w-[24rem] shrink-0 border-l border-border overflow-y-auto px-6 py-8">
          <KnowledgeList points={knowledge} sentence={filled} translation={filledZh} />
        </aside>
      )}
    </div>
  )
}

function OptionCard({ row, text, label, tone, knowledge }: {
  row?: OptionAnalysis
  text: string
  label: string
  tone: 'wrong' | 'right'
  knowledge: KnowledgePoint[]
}) {
  const k = knowledge.find(p => p.from === 'option' && p.option === row?.option)
  const reading = row?.word?.reading ?? k?.reading
  const meaning = row?.word?.meaning ?? row?.grammar?.meaning ?? k?.meaning
  const condition = row?.word?.usage_condition ?? row?.grammar?.connection ?? row?.word?.synonym_note
  return (
    <div className={clsx('rounded-2xl border p-5 flex flex-col gap-2.5', tone === 'right' ? 'border-fg border-[1.5px]' : 'border-border')}>
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <span className={clsx('w-2 h-2 rounded-full', tone === 'right' ? 'bg-success' : 'bg-danger')} />{label}
      </p>
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="font-jp text-2xl text-fg"><Stem text={text} /></span>
        {reading && <span className="text-sm text-fg-subtle">{reading}</span>}
        {k?.level && <span className="badge bg-accent-light text-fg-muted">{k.level}</span>}
        {meaning && <span className="text-sm text-fg">{meaning}</span>}
      </p>
      {condition && <p className="text-sm text-fg-muted leading-relaxed"><span className="text-fg-subtle mr-2">使用条件</span>{condition}</p>}
      {tone === 'wrong' && row?.vs_correct && <p className="text-sm text-danger-fg leading-relaxed">{row.vs_correct}</p>}
    </div>
  )
}

function ItemAsk({ itemId, chosen, initial, targets: initialTargets }: {
  itemId: string
  chosen: string | null
  initial: ItemAskEntry[]
  targets: string[]
}) {
  const { toast } = useToast()
  const [thread, setThread] = useState(initial)
  const [targets, setTargets] = useState(initialTargets)
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)

  const send = async () => {
    const q = question.trim()
    if (!q || sending) return
    setSending(true)
    try {
      const entry = await askItem(itemId, { question: q, targets, chosen })
      setThread(t => [...t, entry])
      setQuestion('')
    } catch {
      toast('没问成，请再试一次', 'error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      {thread.map((e, i) => (
        <article key={i} className="rounded-xl bg-accent-light px-4 py-3.5 flex flex-col gap-2 animate-rise-in">
          <p className="text-sm text-fg-muted">{e.question}</p>
          <p className="text-[0.9375rem] text-fg leading-relaxed whitespace-pre-wrap">{e.result.response}</p>
          {e.result.pair && (
            <div className="flex flex-col gap-2 pt-1">
              <p className="text-sm text-fg-muted"><span className="text-fg font-semibold mr-2">差在哪</span>{e.result.pair.difference}</p>
              <SavePair pair={e.result.pair} source="jlpt" itemId={itemId} />
            </div>
          )}
          {e.result.new_items && e.result.new_items.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{e.result.new_items.map(n => <NewItemChip key={`${n.kind}-${n.key}`} item={n} />)}</div>
          )}
        </article>
      ))}
      <form onSubmit={ev => { ev.preventDefault(); void send() }}
            className="rounded-2xl border border-border bg-surface px-3.5 py-2.5 flex flex-col gap-1.5 focus-within:border-fg-subtle">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-fg-subtle mr-0.5">关于</span>
          <span className="rounded-md bg-accent-light px-2 py-0.5 text-fg">这道题</span>
          {targets.map(t => (
            <span key={t} className="inline-flex items-center gap-1 rounded-md bg-accent-light pl-2 pr-1 py-0.5 text-fg font-jp">
              {t}
              <button type="button" aria-label={`不再关于「${t}」`} onClick={() => setTargets(ts => ts.filter(x => x !== t))}
                      className="rounded p-0.5 text-fg-subtle hover:text-fg"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={`ask-${itemId}`} className="sr-only">追问这道题</label>
          <input id={`ask-${itemId}`} value={question} onChange={e => setQuestion(e.target.value)}
                 placeholder="追问这道题、这个词或这个语法……"
                 className="flex-1 min-w-0 bg-transparent text-[0.9375rem] text-fg placeholder:text-fg-subtle outline-none py-1.5" />
          <button type="submit" disabled={!question.trim() || sending} className="btn-primary h-9 px-4 shrink-0">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : '问'}
          </button>
        </div>
      </form>
    </div>
  )
}
