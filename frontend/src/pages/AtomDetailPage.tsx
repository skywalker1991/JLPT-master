import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import type { KbEntry, KbEntryRow } from '../types'
import { deleteAtom, editKbEntry, getKbEntries, getKbEntry, mergeKbEntry, removeKbSentence } from '../services/api'
import { useToast } from '../context/ToastContext'
import { useUndo } from '../components/shared/useUndo'
import { PairMark } from '../components/shared/SavePair'
import { RELATION_LABEL } from '../components/review/ReviewCard'
import { FamChip } from './KnowledgeBasePage'
import { grammarPieces } from '../utils/marks'

const LEVEL_CLASS: Record<string, string> = { N1: 'badge-n1', N2: 'badge-n2', N3: 'badge-n3', N4: 'badge-n4', N5: 'badge-n5' }
const TYPE_ORDER = ['synonym', 'derivative', 'confusable', 'antonym', 'collocation']
const TYPE_HINT: Record<string, string> = {
  synonym: '意思接近，容易用混；差别写在说明里', derivative: '同一个词根或语法核心变出来的',
  confusable: '长得像或读音像，意思无关', antonym: '意思相反', collocation: '经常一起用',
}
const day = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日` }

/**
 * One entry of the library. The sentences it was met in come first —
 * they are what it is remembered by — then its relations as pairs, and
 * the few ways to tidy it: edit (marked 「你改的」), remove a sentence that
 * isn't this word, merge into another entry, delete (each undoable for 10 s).
 */
export default function AtomDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { schedule, toast: undoToast } = useUndo()
  const [e, setE] = useState<KbEntry | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [gone, setGone] = useState(false)
  const [tab, setTab] = useState<'sentences' | 'relations' | 'info'>('sentences')
  const [merging, setMerging] = useState(false)

  useEffect(() => {
    if (!id) return
    setE(null); setHidden(new Set()); setGone(false)
    getKbEntry(id).then(setE).catch(() => toast('没有这个词条', 'error'))
  }, [id, toast])

  if (!e) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>

  const level = e.fields.jlpt_level.value?.toUpperCase()
  const sentences = e.sentences.filter(s => !hidden.has(s.id))

  const removeSentence = (sid: string) => {
    setHidden(h => new Set(h).add(sid))
    schedule({
      label: `已从「${e.key}」移除一句`,
      commit: () => removeKbSentence(sid),
      undo: () => setHidden(h => { const x = new Set(h); x.delete(sid); return x }),
    })
  }

  const removeEntry = () => {
    setGone(true)
    schedule({
      label: `已删除「${e.key}」（连同句子和关系）`,
      commit: async () => { await deleteAtom(e.id); navigate('/kb') },
      undo: () => setGone(false),
    })
  }

  const header = (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-baseline gap-3">
        <span className="font-jp text-4xl md:text-5xl text-fg">{e.key}</span>
        {e.fields.reading.value && e.fields.reading.value !== e.key && <span className="text-lg text-fg-muted">{e.fields.reading.value}</span>}
        {level && <span className={LEVEL_CLASS[level] ?? 'badge'}>{level}</span>}
      </p>
      {e.fields.meaning.value && <p className="text-lg text-fg">{e.meanings.length > 1 && !e.fields.meaning.edited ? e.meanings.slice(0, 2).join('；') : e.fields.meaning.value}</p>}
    </div>
  )

  const sentenceList = (
    <section className="flex flex-col gap-2.5">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold text-fg">
        遇到过的句子<span className="text-xs font-normal text-fg-subtle">自动记下的句子如果配错了，点「这句不是这个词」</span>
      </h2>
      {sentences.length === 0 && <p className="text-sm text-fg-subtle">还没有句子：在语料分析或 JLPT 里再遇到它时会记下</p>}
      {sentences.map(s => (
        <div key={s.id} className="group rounded-xl border border-border bg-surface px-4 py-3 flex flex-col gap-1">
          <p className="font-jp text-[1.0625rem] leading-relaxed text-fg">
            <Underlined text={s.text} pieces={s.surface ? [s.surface] : e.type === 'grammar' ? grammarPieces(e.key) : [e.key]} />
          </p>
          {s.translation && <p className="text-xs text-fg-muted">{s.translation}</p>}
          <p className="flex items-center gap-2 text-[11px] text-fg-subtle">
            {day(s.date)} · {s.source}
            {s.analysis_id && <Link to={`/?analysis=${s.analysis_id}`} className="hover:text-fg">回到原文 ›</Link>}
            <button type="button" onClick={() => removeSentence(s.id)}
                    className="ml-auto text-fg-muted hover:text-danger-fg md:opacity-0 md:group-hover:opacity-100 focus:opacity-100">
              这句不是这个词
            </button>
          </p>
        </div>
      ))}
    </section>
  )

  const review = (
    <section className="flex flex-col gap-1.5 text-sm">
      <h2 className="text-xs font-semibold text-fg-subtle">复习</h2>
      <p className="flex items-center gap-2 text-fg-muted">
        <FamChip fam={e.review.familiarity} />
        {e.review.stability != null ? `稳定度 ${e.review.stability} 天` : '还没复习过'}
        {e.review.due && ` · 下次 ${day(e.review.due)}`}
        {e.review.lapses > 0 && ` · 忘过 ${e.review.lapses} 次`}
      </p>
      <p className="text-xs text-fg-subtle">
        正面：{e.review.familiarity === 'familiar' || e.type === 'grammar' ? '挖空 + 中文' : `划出词（稳定度到 7 天换成挖空）`}
      </p>
    </section>
  )

  const actions = (
    <div className="flex gap-2">
      <button type="button" onClick={() => setMerging(m => !m)} className="btn h-9 border border-border text-fg">合并到…</button>
      <button type="button" onClick={removeEntry} className="btn h-9 border border-danger/40 text-danger-fg hover:bg-danger-light">删除词条</button>
    </div>
  )

  if (gone) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-fg-muted">
        「{e.key}」已删除
        {undoToast}
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      <div className="md:w-[30rem] shrink-0 md:border-r border-border md:bg-accent-light/30 md:overflow-y-auto px-4 md:px-8 py-4 md:py-8 flex flex-col gap-6">
        <button type="button" onClick={() => navigate('/kb')} className="self-start -ml-1 flex items-center gap-0.5 text-sm text-fg-muted hover:text-fg">
          <ChevronLeft className="w-4 h-4" />知识库
        </button>
        {header}
        <div className="hidden md:flex flex-col gap-6">
          {sentenceList}
          {review}
          <EditPanel entry={e} onSaved={setE} />
          {actions}
          {merging && <MergeBox entry={e} onDone={to => navigate(`/kb/${to}`, { replace: true })} onCancel={() => setMerging(false)} />}
        </div>

        {/* Phone: tabs */}
        <div className="md:hidden flex flex-col gap-4">
          <div role="tablist" className="flex gap-1 border-b border-border">
            {([['sentences', `句子 ${sentences.length}`], ['relations', `关系 ${e.relations.length}`], ['info', '复习与整理']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                      className={clsx('px-3 py-2 text-sm -mb-px border-b-2', tab === k ? 'border-fg text-fg font-semibold' : 'border-transparent text-fg-muted')}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'sentences' && sentenceList}
          {tab === 'relations' && <Relations entry={e} />}
          {tab === 'info' && (
            <div className="flex flex-col gap-6">
              {review}
              <EditPanel entry={e} onSaved={setE} />
              {actions}
              {merging && <MergeBox entry={e} onDone={to => navigate(`/kb/${to}`, { replace: true })} onCancel={() => setMerging(false)} />}
            </div>
          )}
        </div>
      </div>

      <main className="hidden md:block flex-1 min-w-0 overflow-y-auto px-10 py-8">
        <Relations entry={e} />
      </main>
      {undoToast}
    </div>
  )
}

function Underlined({ text, pieces }: { text: string; pieces: string[] }) {
  const ranges: [number, number][] = []
  let from = 0
  for (const p of pieces) {
    const at = p ? text.indexOf(p, from) : -1
    if (at >= 0) { ranges.push([at, at + p.length]); from = at + p.length }
  }
  if (ranges.length === 0) return <>{text}</>
  const out: React.ReactNode[] = []
  let pos = 0
  ranges.forEach(([a, b], i) => {
    out.push(<span key={`t${i}`}>{text.slice(pos, a)}</span>)
    out.push(<span key={`u${i}`} className="underline decoration-fg decoration-2 underline-offset-[0.3em]">{text.slice(a, b)}</span>)
    pos = b
  })
  out.push(<span key="end">{text.slice(pos)}</span>)
  return <>{out}</>
}

/** Relations as pairs, grouped by why they belong together. Mostly there are none. */
function Relations({ entry: e }: { entry: KbEntry }) {
  const [open, setOpen] = useState<string | null>(null)
  const groups = useMemo(() => TYPE_ORDER.map(t => [t, e.relations.filter(r => r.type === t)] as const).filter(([, rs]) => rs.length), [e])
  if (e.relations.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold text-fg">关系</h2>
        <p className="text-sm text-fg-muted leading-relaxed">还没有。追问回答或 JLPT 错题解析里的「差在哪」下面点「存成关系」，就会出现在这里。</p>
      </section>
    )
  }
  return (
    <section className="flex flex-col gap-5">
      <h2 className="flex items-baseline gap-3">
        <span className="text-lg font-bold text-fg">关系</span>
        <span className="text-xs text-fg-subtle">{e.relations.length} 条 · 按「为什么相关」分组，点一条展开成配对</span>
      </h2>
      {groups.map(([type, rs]) => (
        <div key={type} className="flex flex-col gap-2">
          <h3 className="flex items-baseline gap-2 text-sm font-semibold text-fg">
            {RELATION_LABEL[type] ?? type}<span className="text-xs font-normal text-fg-subtle">{TYPE_HINT[type]}</span>
          </h3>
          {rs.map(r => open === r.id ? (
            <div key={r.id} className="rounded-2xl border-[1.5px] border-fg bg-surface p-5 flex flex-col gap-4">
              <div className="flex items-center">
                <span className="text-xs rounded-full bg-accent-light px-2.5 py-0.5 text-fg-muted">{RELATION_LABEL[r.type] ?? r.type}</span>
                <button type="button" onClick={() => setOpen(null)} aria-label="收起" className="ml-auto p-1 text-fg-subtle hover:text-fg"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-start">
                <Side keyText={e.key} reading={e.fields.reading.value} meaning={e.fields.meaning.value}
                      sentence={e.sentences[0] ? { text: e.sentences[0].text, date: e.sentences[0].date, source: e.sentences[0].source } : null} />
                <PairMark className="text-fg w-10 h-5 self-center hidden md:block" />
                <Link to={`/kb/${r.other.id}`} className="hover:opacity-80">
                  <Side keyText={r.other.key} reading={r.other.reading} meaning={r.other.meaning} sentence={r.other.sentence} />
                </Link>
              </div>
              {r.note && <p className="rounded-xl bg-accent-light px-4 py-3 text-sm text-fg leading-relaxed"><b className="mr-2">差在哪</b>{r.note}</p>}
            </div>
          ) : (
            <button key={r.id} type="button" onClick={() => setOpen(r.id)}
                    className="rounded-2xl border border-border bg-surface px-4 py-3 flex items-center gap-3 text-left hover:border-fg-subtle">
              <PairMark className="text-fg" />
              <span className="font-jp text-lg text-fg shrink-0">{r.other.key}</span>
              {r.other.reading && <span className="text-xs text-fg-subtle shrink-0">{r.other.reading}</span>}
              <span className="text-sm text-fg-muted truncate flex-1">{r.note ?? r.other.meaning}</span>
              <ChevronRight className="w-4 h-4 text-fg-subtle shrink-0" />
            </button>
          ))}
        </div>
      ))}
    </section>
  )
}

function Side({ keyText, reading, meaning, sentence }: {
  keyText: string; reading: string | null; meaning: string | null; sentence: { text: string; date: string; source: string } | null
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex items-baseline gap-2"><span className="font-jp text-2xl text-fg">{keyText}</span>{reading && <span className="text-sm text-fg-subtle">{reading}</span>}</p>
      {meaning && <p className="text-sm text-fg">{meaning}</p>}
      {sentence && <p className="font-jp text-sm text-fg-muted leading-relaxed">{sentence.text}</p>}
      {sentence && <p className="text-[11px] text-fg-subtle">{day(sentence.date)} · {sentence.source}</p>}
    </div>
  )
}

/** 词条信息: the fields, each editable in place; what the person wrote is marked 「你改的」. */
function EditPanel({ entry: e, onSaved }: { entry: KbEntry; onSaved: (e: KbEntry) => void }) {
  const { toast } = useToast()
  const [editing, setEditing] = useState<'reading' | 'meaning' | 'level' | null>(null)
  const [value, setValue] = useState('')
  const rows: { k: 'reading' | 'meaning' | 'level'; label: string; field: KbEntry['fields']['reading'] }[] = [
    ...(e.type === 'vocabulary' ? [{ k: 'reading' as const, label: '读音', field: e.fields.reading }] : []),
    { k: 'meaning', label: '意思', field: e.fields.meaning },
    { k: 'level', label: '等级', field: e.fields.jlpt_level },
  ]
  const save = async () => {
    if (!editing || !value.trim()) return
    try {
      onSaved(await editKbEntry(e.id, { [editing]: editing === 'level' ? value.trim().toUpperCase() : value.trim() }))
      setEditing(null)
    } catch {
      toast(editing === 'level' ? '等级要写成 N1–N5' : '没存上，请再试一次', 'error')
    }
  }
  return (
    <section className="flex flex-col">
      <h2 className="text-xs font-semibold text-fg-subtle pb-1">词条信息 · 点「改」直接改</h2>
      {rows.map(r => (
        <div key={r.k} className="flex items-center gap-3 py-2.5 border-b border-border text-sm">
          <span className="w-10 text-fg-subtle shrink-0">{r.label}</span>
          {editing === r.k ? (
            <>
              <input autoFocus value={value} onChange={ev => setValue(ev.target.value)} onKeyDown={ev => { if (ev.key === 'Enter') void save() }}
                     className="input flex-1 h-9 py-1" aria-label={r.label} />
              <button type="button" onClick={() => void save()} className="btn-primary h-9">保存</button>
              <button type="button" onClick={() => setEditing(null)} className="btn h-9 border border-border">取消</button>
            </>
          ) : (
            <>
              <span className={clsx('flex-1 min-w-0', r.k === 'reading' && 'font-jp')}>{r.field.value ?? '—'}</span>
              <span className={clsx('text-[10px] rounded px-1.5 py-0.5 shrink-0', r.field.edited ? 'bg-fg text-bg' : 'bg-accent-light text-fg-subtle')}>
                {r.field.edited ? '你改的' : 'AI'}
              </span>
              <button type="button" onClick={() => { setEditing(r.k); setValue(r.field.value ?? '') }} className="text-fg-muted hover:text-fg shrink-0 px-1">改</button>
            </>
          )}
        </div>
      ))}
      <p className="text-[11px] text-fg-subtle leading-relaxed pt-2">改过的地方标「你改的」，AI 以后不会覆盖它。删除词条会连同句子和关系一起删，10 秒内可以撤销，不做回收站。</p>
    </section>
  )
}

function MergeBox({ entry: e, onDone, onCancel }: { entry: KbEntry; onDone: (id: string) => void; onCancel: () => void }) {
  const { toast } = useToast()
  const [q, setQ] = useState(e.fields.reading.value ?? '')
  const [hits, setHits] = useState<KbEntryRow[]>([])
  const [pick, setPick] = useState<KbEntryRow | null>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      if (!q.trim()) { setHits([]); return }
      getKbEntries({ q: q.trim(), type: e.type }).then(r => setHits(r.items.filter(x => x.id !== e.id).slice(0, 5))).catch(() => {})
    }, 200)
    return () => clearTimeout(t)
  }, [q, e.id, e.type])
  const merge = async () => {
    if (!pick) return
    try {
      const r = await mergeKbEntry(e.id, pick.id)
      toast(`已合并到「${pick.key}」`, 'success')
      onDone(r.id)
    } catch {
      toast('没合并成，请再试一次', 'error')
    }
  }
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 flex flex-col gap-3 shadow-card">
      <h3 className="text-sm font-semibold text-fg">合并到另一个词条</h3>
      <input value={q} onChange={ev => { setQ(ev.target.value); setPick(null) }} placeholder="搜写法或读音" className="input h-10" aria-label="搜要合并到的词条" />
      {hits.map(h => (
        <button key={h.id} type="button" onClick={() => setPick(h)}
                className={clsx('rounded-xl px-3 py-2 text-left flex items-baseline gap-2', pick?.id === h.id ? 'bg-fg text-bg' : 'bg-accent-light text-fg')}>
          <span className="font-jp">{h.key}</span><span className="text-xs opacity-70">{h.reading} · {h.sentences} 句 · {day(h.created_at)}</span>
        </button>
      ))}
      <p className="text-xs text-fg-muted leading-relaxed">合并后：两边的句子和关系合在一起；保留{pick ? `「${pick.key}」` : '目标词条'}的写法，复习进度取较熟的那个。</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn h-9 border border-border">取消</button>
        <button type="button" disabled={!pick} onClick={() => void merge()} className="btn-primary h-9 disabled:opacity-40">合并</button>
      </div>
    </div>
  )
}
