import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Check, Loader2, Plus } from 'lucide-react'
import type { GrammarItem, VocabItem } from '../../types'
import { createAtom } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import { useOccurrence } from './useOccurrence'
import { AttachButton } from './AskPanel'
import { Example } from './VocabChip'
import { grammarKey, vocabKey } from '../../utils/marks'

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

interface Candidate { atom_id: string; key: string; meaning: string | null }

function vocabProperties(v: VocabItem) {
  return [
    ...(v.reading ? [{ kind: 'reading', value: v.reading, source_type: 'ai' }] : []),
    { kind: 'meaning', value: v.meaning, source_type: 'ai' },
    ...(v.part_of_speech ? [{ kind: 'part_of_speech', value: v.part_of_speech, source_type: 'ai' }] : []),
    ...(v.jlpt_level ? [{ kind: 'jlpt_level', value: v.jlpt_level, source_type: 'ai' }] : []),
    ...(v.usage ? [{ kind: 'usage', value: v.usage, source_type: 'ai' }] : []),
    ...(v.example ? [{ kind: 'example', value: v.example, source_type: 'ai' }] : []),
  ]
}

function grammarProperties(g: GrammarItem) {
  return [
    { kind: 'meaning', value: g.meaning, source_type: 'ai' },
    ...(g.jlpt_level ? [{ kind: 'jlpt_level', value: g.jlpt_level, source_type: 'ai' }] : []),
    ...(g.connection ? [{ kind: 'connection', value: g.connection, source_type: 'ai' }] : []),
    ...(g.usage ? [{ kind: 'usage', value: g.usage, source_type: 'ai' }] : []),
    ...(g.example ? [{ kind: 'example', value: g.example, source_type: 'ai' }] : []),
  ]
}

/**
 * A word or grammar point of the current sentence, in its one-line form:
 * the dictionary form as the title (the text's own form is noted under it),
 * what it means here, its level, and whether it is in the library.
 * Tapping it opens the rest.
 */
export default function ItemRow(props: Props) {
  const { kind, atomId, onAdded, picked } = props
  const vocab = kind === 'vocab' ? props.item : null
  const grammar = kind === 'grammar' ? props.item : null
  const key = vocab ? vocabKey(vocab) : grammarKey(grammar!)
  const occurrence = useOccurrence(vocab?.surface, vocab?.surface_meaning)
  const navigate = useNavigate()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
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
      if (res.status === 'similar') {
        setCandidates((res.candidates ?? []).map(c => ({ atom_id: String(c.atom_id), key: c.key, meaning: c.meaning })))
        setOpen(true)
        return
      }
      const id = String(res.atom_id)
      setCandidates(null)
      setAdded(res.status === 'created')
      onAdded(key, id)
      toast(res.status === 'created' ? `「${key}」已入库，这一句作为例句一起保存` : `「${key}」已在知识库里，这一句已记下`,
        res.status === 'created' ? 'success' : 'info')
    } catch {
      toast('入库失败，请重试', 'error')
    } finally {
      setBusy(false)
    }
  }

  function sameAs(c: Candidate) {
    setCandidates(null)
    onAdded(key, c.atom_id)
    toast(`已算作「${c.key}」`, 'info')
  }

  return (
    <li
      ref={ref}
      className={clsx(
        'rounded-xl border bg-surface transition-colors',
        picked ? 'border-fg' : 'border-border',
      )}
    >
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
            <span className="font-jp text-lg text-fg leading-snug">{key}</span>
            {vocab?.reading && vocab.reading !== key && (
              <span className="text-xs text-fg-subtle">{vocab.reading}</span>
            )}
            {level && <span className={LEVEL_CLASS[level] ?? 'badge'}>{level}</span>}
          </span>
          <span className="text-sm text-fg-muted leading-snug pl-[1.375rem]">
            {meaningHere}
            {inflected && <span className="text-fg-subtle"> · 文中：{vocab!.surface}</span>}
          </span>
        </button>

        <div className="shrink-0 pt-0.5">
          {atomId ? (
            <button
              type="button"
              onClick={() => navigate(`/kb/${atomId}`)}
              className={clsx(
                'btn h-8 text-xs',
                added ? 'text-success-fg hover:bg-success/10' : 'bg-accent-light text-fg-muted hover:text-fg',
              )}
            >
              {added ? <><Check className="w-3.5 h-3.5" />已入库</> : '已在库'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy}
              className="btn h-8 text-xs border border-border text-fg hover:bg-accent-light"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}入库
            </button>
          )}
        </div>
      </div>

      {candidates && (
        <div className="mx-3.5 mb-3 rounded-lg border border-dashed border-fg-subtle p-3 flex flex-col gap-2.5">
          <p className="text-xs text-fg-muted">库里已有相似的语法，是同一个吗？</p>
          {candidates.map(c => (
            <div key={c.atom_id} className="flex flex-wrap items-center gap-2">
              <span className="font-jp text-fg">{key}</span>
              <span className="text-xs text-fg-subtle">↔ 库里已有</span>
              <span className="font-jp text-fg">{c.key}</span>
              {c.meaning && <span className="text-xs text-fg-muted w-full">{c.meaning}</span>}
              <button type="button" onClick={() => sameAs(c)} className="btn h-8 text-xs border border-border">是同一个</button>
            </div>
          ))}
          <button type="button" onClick={() => void add(true)} className="btn-primary h-8 text-xs self-start">分开存</button>
        </div>
      )}

      {open && (
        <div className="px-3.5 pb-3 pl-[2.75rem] flex flex-col gap-2 text-sm text-fg-muted">
          {vocab && vocab.meaning && vocab.meaning !== meaningHere && (
            <p><span className="text-fg-subtle">词典　</span>{vocab.meaning}</p>
          )}
          {vocab?.part_of_speech && <p className="text-xs text-fg-subtle">{vocab.part_of_speech}</p>}
          {grammar?.connection && <p><span className="text-fg-subtle">接续　</span>{grammar.connection}</p>}
          {props.item.usage && <p className="leading-relaxed">{props.item.usage}</p>}
          {props.item.example && <Example text={props.item.example} />}
          <div className="-ml-2.5">
            <AttachButton target={{ kind, key: vocab ? vocab.surface : grammar!.pattern }} />
          </div>
        </div>
      )}
    </li>
  )
}
