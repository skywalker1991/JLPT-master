import { useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ChevronRight, Loader2, Plus, RotateCcw } from 'lucide-react'
import type { AtomDetail, CardDetail, GrammarItem, VocabItem } from '../../types'
import { addOccurrence, addProperties, createAtom, createRelation, getAtom, getCardDetail } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { useOccurrence } from './useOccurrence'
import { AskContext, AttachButton } from './AskPanel'
import { grammarKey, grammarPieces, vocabKey } from '../../utils/marks'
import { Connected } from '../shared/Motion'

type Props = {
  /** Already in the library: its atom id */
  atomId?: string
  onAdded: (key: string, atomId: string) => void
  /** Tapped in the passage: scroll to it and open it */
  picked?: boolean
} & ({ kind: 'vocab'; item: VocabItem } | { kind: 'grammar'; item: GrammarItem })

const LEVEL_CLASS: Record<string, string> = {
  N1: 'badge-n1', N2: 'badge-n2', N3: 'badge-n3', N4: 'badge-n4', N5: 'badge-n5',
}

interface Candidate { atom_id: string; key: string; meaning: string | null; reading?: string | null }
type Ask = { kind: 'other_spelling' | 'similar'; candidates: Candidate[] }

function vocabProperties(v: VocabItem) {
  return [
    ...(v.reading ? [{ kind: 'reading', value: v.reading, source_type: 'ai' }] : []),
    { kind: 'meaning', value: v.meaning, source_type: 'ai' },
    ...(v.part_of_speech ? [{ kind: 'part_of_speech', value: v.part_of_speech, source_type: 'ai' }] : []),
    ...(v.jlpt_level ? [{ kind: 'jlpt_level', value: v.jlpt_level, source_type: 'ai' }] : []),
    ...(v.usage ? [{ kind: 'usage', value: v.usage, source_type: 'ai' }] : []),
  ]
}

function grammarProperties(g: GrammarItem) {
  return [
    { kind: 'meaning', value: g.meaning, source_type: 'ai' },
    ...(g.jlpt_level ? [{ kind: 'jlpt_level', value: g.jlpt_level, source_type: 'ai' }] : []),
    ...(g.connection ? [{ kind: 'connection', value: g.connection, source_type: 'ai' }] : []),
    ...(g.usage ? [{ kind: 'usage', value: g.usage, source_type: 'ai' }] : []),
  ]
}

/**
 * A word or grammar point of the current sentence.
 *
 * Closed, it is one line: the entry form as the title (the text's own form
 * noted after it), what it means here, its level, and whether it is in the
 * library. Open, it is the full card: how it is entered, the meaning here
 * against the dictionary's, your own sentence, and three AI examples.
 */
export default function ItemRow(props: Props) {
  const { kind, atomId, onAdded, picked } = props
  const vocab = kind === 'vocab' ? props.item : null
  const grammar = kind === 'grammar' ? props.item : null
  const key = vocab ? vocabKey(vocab) : grammarKey(grammar!)
  const occurrence = useOccurrence(vocab?.surface, vocab?.surface_meaning)
  const { toast } = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!picked) return
    setOpen(true)
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [picked])

  const level = props.item.jlpt_level?.toUpperCase() ?? null
  const meaningHere = vocab ? (vocab.surface_meaning || vocab.meaning) : grammar!.meaning
  const inflected = !!vocab && !!vocab.base && vocab.base !== vocab.surface

  async function add(force = false) {
    if (busy) return
    setBusy(true)
    try {
      const res = await createAtom({
        type: vocab ? 'vocabulary' : 'grammar',
        key,
        ...occurrence,
        properties: vocab ? vocabProperties(vocab) : grammarProperties(grammar!),
        ...(force ? { force_create: true } : {}),
      })
      if (res.status === 'similar' || res.status === 'other_spelling') {
        setAsk({ kind: res.status, candidates: (res.candidates ?? []).map(c => ({ ...c, atom_id: String(c.atom_id) })) })
        setOpen(true)
        return null
      }
      const id = String(res.atom_id)
      setAsk(null)
      setAdded(res.status === 'created')
      onAdded(key, id)
      toast(res.status === 'created' ? `「${key}」已入库，这一句作为例句一起保存` : `「${key}」已在知识库里，这一句已记下`,
        res.status === 'created' ? 'success' : 'info')
      return id
    } catch {
      toast('入库失败，请再试一次', 'error')
      return null
    } finally {
      setBusy(false)
    }
  }

  /** Count it under an entry already there (分かる kept under わかる). */
  async function keepUnder(c: Candidate) {
    setBusy(true)
    try {
      if (occurrence.occurrence) {
        await addOccurrence(c.atom_id, {
          occurrence: occurrence.occurrence, analysis_id: occurrence.analysis_id,
          variant: vocab ? key : null,
        })
      }
      setAsk(null)
      onAdded(key, c.atom_id)
      toast(`这一句记在了「${c.key}」下面`, 'success')
    } catch {
      toast('没存上，请再试一次', 'error')
    } finally {
      setBusy(false)
    }
  }

  /** A grammar point close to one already there, but not the same: keep both, related. */
  async function keepBoth(related: Candidate | null) {
    const id = await add(true)
    if (id && related) {
      await createRelation(id, { target_atom_id: related.atom_id, type: 'derivative' }).catch(() => {})
    }
  }

  const action = atomId ? (
    <button
      type="button"
      onClick={() => navigate(`/kb/${atomId}`)}
      className={clsx('btn h-8 text-xs', added ? 'text-success-fg hover:bg-success/10' : 'bg-accent-light text-fg-muted hover:text-fg')}
    >
      {added ? <><Connected className="w-4 h-4" />已入库</> : '已在库'}
    </button>
  ) : (
    <button type="button" onClick={() => void add()} disabled={busy}
            className="btn h-8 text-xs border border-border text-fg hover:bg-accent-light">
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}入库
    </button>
  )

  return (
    <li ref={ref} className={clsx('rounded-xl border bg-surface transition-colors', picked || open ? 'border-fg' : 'border-border')}>
      <div className="flex items-start gap-3 px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex-1 min-w-0 text-left flex flex-col gap-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md"
        >
          <span className="flex items-baseline gap-2 flex-wrap">
            <span aria-hidden="true" className={clsx(
              'inline-block w-3.5 shrink-0 self-center',
              vocab ? 'h-[3px] bg-fg rounded-full' : 'border-t border-dashed border-fg-muted',
            )} />
            <span className={clsx('font-jp text-fg leading-snug', open ? 'text-2xl' : 'text-lg')}>{key}</span>
            {vocab?.reading && vocab.reading !== key && (
              <span className={clsx('text-fg-subtle', open ? 'text-sm' : 'text-xs')}>{vocab.reading}</span>
            )}
            {level && <span className={LEVEL_CLASS[level] ?? 'badge'}>{level}</span>}
          </span>
          {!open && (
            <span className="text-sm text-fg-muted leading-snug pl-[1.375rem]">
              {meaningHere}
              {inflected && <span className="text-fg-subtle"> · 文中：{vocab!.surface}</span>}
            </span>
          )}
        </button>
        <div className="shrink-0 pt-0.5">{action}</div>
      </div>

      {ask && (
        <div className="mx-3.5 mb-3 rounded-xl border border-dashed border-fg-subtle p-3.5 flex flex-col gap-2.5">
          <p className="text-sm font-semibold text-fg">
            {ask.kind === 'other_spelling' ? '入库时发现写法不同的同一个词' : '入库时发现相似的语法'}
          </p>
          {ask.candidates.map(c => (
            <div key={c.atom_id} className="flex flex-col gap-2">
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="font-jp text-lg text-fg">{key}</span>
                <span className="text-xs text-fg-subtle">↔ 库里已有</span>
                <span className="font-jp text-lg text-fg">{c.key}</span>
              </p>
              <p className="text-xs text-fg-muted">
                {ask.kind === 'other_spelling' ? `读音相同（${c.reading ?? vocab?.reading ?? ''}）` : c.meaning}
              </p>
              <div className="flex flex-wrap gap-2">
                {ask.kind === 'other_spelling' ? (
                  <>
                    <button type="button" disabled={busy} onClick={() => void keepUnder(c)} className="btn-primary h-8 text-xs">是同一个，补充进去</button>
                    <button type="button" disabled={busy} onClick={() => void add(true)} className="btn h-8 text-xs border border-border">分开存</button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={busy} onClick={() => void keepUnder(c)} className="btn h-8 text-xs border border-border">是同一个</button>
                    <button type="button" disabled={busy} onClick={() => void keepBoth(c)} className="btn-primary h-8 text-xs">新建，并存成「同源」</button>
                  </>
                )}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-fg-subtle">
          </p>
        </div>
      )}

      {open && (
        <CardBody {...props} meaningHere={meaningHere} onSupplemented={() => toast('已补充进知识库', 'success')} />
      )}
    </li>
  )
}

/** The full card under the line. */
function CardBody(props: Props & { meaningHere: string; onSupplemented: () => void }) {
  const { kind, atomId, meaningHere } = props
  const vocab = kind === 'vocab' ? props.item : null
  const grammar = kind === 'grammar' ? props.item : null
  const key = vocab ? vocabKey(vocab) : grammarKey(grammar!)
  const ctx = useContext(AskContext)
  const occurrence = useOccurrence(vocab?.surface, vocab?.surface_meaning)
  const [detail, setDetail] = useState<CardDetail | null>(null)
  const [failed, setFailed] = useState(false)
  const [atom, setAtom] = useState<AtomDetail | null>(null)
  const [showExamples, setShowExamples] = useState(!atomId)
  const [supplemented, setSupplemented] = useState(false)

  const load = () => {
    setFailed(false)
    getCardDetail({ type: vocab ? 'vocabulary' : 'grammar', key, reading: vocab?.reading, meaning: props.item.meaning })
      .then(setDetail).catch(() => setFailed(true))
  }
  useEffect(load, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Already in the library: this sentence is kept under it (no tap needed),
  // and the card shows the sentences kept before.
  useEffect(() => {
    if (!atomId) return
    const keep = occurrence.occurrence
      ? addOccurrence(atomId, { occurrence: occurrence.occurrence, analysis_id: occurrence.analysis_id }).catch(() => null)
      : Promise.resolve(null)
    keep.then(() => getAtom(atomId)).then(setAtom).catch(() => {})
  }, [atomId]) // eslint-disable-line react-hooks/exhaustive-deps

  const sentence = ctx?.sentenceText ?? ''
  // A meaning counts as new only if no meaning in the library already says it
  // (「世代」 is in 「世代，一代人」).
  const libraryMeanings = (atom?.properties ?? []).filter(p => p.kind === 'meaning').map(p => p.value.trim())
  const here = meaningHere.trim()
  const covered = libraryMeanings.some(m => m.includes(here) || here.includes(m))
  const newMeaning = atom && here && !covered && !supplemented ? meaningHere : null
  const earlier = (atom?.occurrences ?? []).filter(o => o.sentence_text !== sentence)

  const supplement = async () => {
    if (!atomId || !newMeaning) return
    await addProperties(atomId, { properties: [{ kind: 'meaning', value: newMeaning, source_type: 'ai' }] })
    setSupplemented(true)
    props.onSupplemented()
  }

  const examples = (
    <section className="flex flex-col gap-2">
      <button type="button" onClick={() => setShowExamples(s => !s)} aria-expanded={showExamples}
              className="flex items-baseline gap-2 text-left">
        <span className="text-xs font-semibold text-fg-muted">AI 例句{atomId && detail ? ` ${detail.examples.length} 句` : ''}</span>
        {atomId && <ChevronRight className={clsx('w-3.5 h-3.5 text-fg-subtle self-center transition-transform', showExamples && 'rotate-90')} />}
      </button>
      {showExamples && (failed ? (
        <button type="button" onClick={load} className="self-start btn h-8 text-xs border border-border">
          <RotateCcw className="w-3.5 h-3.5" />例句没生成出来，重试
        </button>
      ) : !detail ? (
        <div className="flex flex-col gap-2" aria-label="例句生成中">
          {[0, 1, 2].map(i => <div key={i} className="h-14 rounded-lg bg-accent-light animate-pulse" />)}
        </div>
      ) : detail.examples.map((e, i) => (
        <div key={i} className="rounded-lg border border-dashed border-border px-3 py-2.5 flex flex-col gap-1">
          <p className="font-jp text-[0.9375rem] text-fg leading-relaxed"><Marked text={e.ja} /></p>
          <p className="text-xs text-fg-muted leading-relaxed">{e.zh}</p>
        </div>
      )))}
    </section>
  )

  return (
    <div className="px-3.5 pb-3.5 flex flex-col gap-4 animate-rise-in">
      {/* What it is */}
      <div className="flex flex-col gap-1.5 text-sm">
        {vocab?.part_of_speech && <p className="text-xs text-fg-subtle">{vocab.part_of_speech}</p>}
        {vocab && vocab.base && vocab.base !== vocab.surface && (
          <p className="text-xs text-fg-muted">文中是「<span className="font-jp">{vocab.surface}</span>」，入库按原形「<span className="font-jp">{key}</span>」</p>
        )}
        {grammar && <p className="text-fg">{grammar.meaning}</p>}
        {grammar && detail?.connection && detail.connection.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs text-fg-subtle mr-1">接续</span>
            {detail.connection.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-fg-subtle">＋</span>}
                <span className={clsx('rounded-md px-2 py-0.5 text-xs', i === detail.connection!.length - 1 ? 'border border-dashed border-fg-muted font-jp' : 'bg-accent-light')}>{c}</span>
              </span>
            ))}
          </div>
        )}
        {grammar && detail?.conjugation && <p className="font-jp text-xs text-fg-muted">{detail.conjugation}</p>}
      </div>

      {/* How it is entered */}
      {!atomId && (
        <div className="rounded-lg bg-accent-light px-3 py-2.5 flex flex-col gap-1 text-xs text-fg-muted">
          <p><span className="font-semibold text-fg mr-2">入库写法</span>
            <span className="font-jp text-sm text-fg">{key}{vocab?.reading && vocab.reading !== key ? `【${vocab.reading}】` : ''}</span></p>
          {vocab && vocab.surface !== key && <p>文中形态「<span className="font-jp">{vocab.surface}</span>」只记出处</p>}
          {detail?.variants && detail.variants.length > 0 && (
            <p>也写作 <span className="font-jp">{detail.variants.join('、')}</span>，按同一个词</p>
          )}
        </div>
      )}

      {/* Meaning here vs the dictionary's */}
      {vocab && (
        <dl className="grid grid-cols-[3rem_1fr] gap-x-2 gap-y-1.5 text-sm">
          <dt className="text-fg-subtle">这里</dt><dd className="text-fg">{meaningHere}</dd>
          <dt className="text-fg-subtle">词典</dt><dd className="text-fg-muted">{detail?.dictionary_meaning || vocab.meaning}</dd>
        </dl>
      )}

      {detail?.usage_hint && (
        <p className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2.5 text-sm leading-relaxed">
          <span className="font-semibold mr-2">用法提示</span>{detail.usage_hint}
        </p>
      )}

      {/* Your sentences */}
      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold text-fg-muted">
          {atomId && earlier.length > 0 ? `你在库里已有 ${earlier.length} 句` : '你的原句'}
        </h4>
        {atomId && earlier.map(o => (
          <div key={o.id} className="rounded-lg bg-accent-light/60 px-3 py-2.5 flex flex-col gap-1">
            <p className="font-jp text-[0.9375rem] text-fg leading-relaxed">
              <Underlined text={o.sentence_text} pieces={o.surface ? [o.surface] : vocab ? [key] : grammarPieces(key)} />
            </p>
            <p className="text-[11px] text-fg-subtle">{fmtDate(o.created_at)} · {o.analysis_id ? '语料分析' : 'JLPT'}</p>
          </div>
        ))}
        {sentence && (
          <div className={clsx('rounded-lg px-3 py-2.5 flex flex-col gap-1',
            atomId ? 'border border-dashed border-success/50 bg-success-light/40' : 'bg-accent-light/60')}>
            <p className="font-jp text-[0.9375rem] text-fg leading-relaxed">
              <Underlined text={sentence} pieces={vocab ? [vocab.surface] : grammarPieces(key)} />
            </p>
          </div>
        )}
        {newMeaning && (
          <p className="text-xs text-success-fg">＋ 这里的意思：{newMeaning}（库里还没有）</p>
        )}
      </section>

      {examples}

      <div className="flex items-center gap-2 border-t border-border pt-2.5 -mb-1">
        <AttachButton target={{ kind: props.kind, key: vocab ? vocab.surface : grammar!.pattern }} />
        {newMeaning && (
          <button type="button" onClick={() => void supplement()} className="btn-primary h-8 text-xs ml-auto">补充</button>
        )}
      </div>
    </div>
  )
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** An AI example with its target in ⟦ ⟧, drawn underlined. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(⟦.+?⟧)/).map((part, i) => part.startsWith('⟦')
        ? <span key={i} className="underline decoration-fg decoration-2 underline-offset-[0.3em]">{part.slice(1, -1)}</span>
        : <span key={i}>{part}</span>)}
    </>
  )
}

/** A sentence with the first occurrence of each piece underlined. */
function Underlined({ text, pieces }: { text: string; pieces: string[] }) {
  const ranges = pieces
    .map(p => ({ at: p ? text.indexOf(p) : -1, len: p.length }))
    .filter(r => r.at >= 0)
    .sort((a, b) => a.at - b.at)
  const out: React.ReactNode[] = []
  let pos = 0
  ranges.forEach((r, i) => {
    if (r.at < pos) return
    out.push(<span key={`t${i}`}>{text.slice(pos, r.at)}</span>)
    out.push(<span key={`u${i}`} className="underline decoration-fg decoration-2 underline-offset-[0.3em]">{text.slice(r.at, r.at + r.len)}</span>)
    pos = r.at + r.len
  })
  out.push(<span key="end">{text.slice(pos)}</span>)
  return <>{out}</>
}
