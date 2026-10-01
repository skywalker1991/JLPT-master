import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2, Plus } from 'lucide-react'
import type { KnowledgePoint } from '../../types'
import { addOccurrence, createAtom, lookupAtoms } from '../../services/api'
import { useToast } from '../../context/ToastContext'

const LEVEL_CLASS: Record<string, string> = {
  N1: 'badge-n1', N2: 'badge-n2', N3: 'badge-n3', N4: 'badge-n4', N5: 'badge-n5',
}

/**
 * 本题知识点: the options' words / grammar, then the ones worth keeping from
 * the whole sentence. Each is decided on its own; adding one keeps the
 * sentence with the answer filled in as its example and source.
 */
export default function KnowledgeList({ points, sentence, translation }: {
  points: KnowledgePoint[]
  sentence: string | null
  translation: string | null
}) {
  const [known, setKnown] = useState<Record<string, string>>({})
  const keyOf = (p: KnowledgePoint) => `${p.kind}:${p.key}`

  useEffect(() => {
    const vocab = points.filter(p => p.kind === 'vocab').map(p => p.key)
    const grammar = points.filter(p => p.kind === 'grammar').map(p => p.key)
    if (!vocab.length && !grammar.length) return
    lookupAtoms(vocab, grammar).then(r => setKnown({
      ...Object.fromEntries(Object.entries(r.vocab).map(([k, v]) => [`vocab:${k}`, v])),
      ...Object.fromEntries(Object.entries(r.grammar).map(([k, v]) => [`grammar:${k}`, v])),
    })).catch(() => {})
  }, [points])

  const options = points.filter(p => p.from === 'option')
  const fromSentence = points.filter(p => p.from === 'sentence')

  const group = (title: string, list: KnowledgePoint[]) => list.length > 0 && (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs text-fg-subtle">{title}</h3>
      <ul className="flex flex-col gap-2">
        {list.map(p => (
          <Row key={keyOf(p)} point={p} atomId={known[keyOf(p)]} sentence={sentence} translation={translation}
               onAdded={id => setKnown(k => ({ ...k, [keyOf(p)]: id }))} />
        ))}
      </ul>
    </section>
  )

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-baseline gap-2">
        <span className="font-bold text-fg">本题知识点</span>
      </p>
      {group('选项', options)}
      {group('完整句子', fromSentence)}
    </div>
  )
}

function Row({ point, atomId, sentence, translation, onAdded }: {
  point: KnowledgePoint
  atomId?: string
  sentence: string | null
  translation: string | null
  onAdded: (id: string) => void
}) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)
  const [similar, setSimilar] = useState<{ atom_id: string; key: string } | null>(null)
  const level = point.level?.toUpperCase()
  const occurrence = sentence ? { sentence_text: sentence, sentence_translation: translation, surface: null } : null

  const keepUnder = async (c: { atom_id: string; key: string }) => {
    if (occurrence) await addOccurrence(c.atom_id, { occurrence, variant: point.kind === 'vocab' ? point.key : null }).catch(() => {})
    setSimilar(null)
    onAdded(c.atom_id)
    toast(`记在了「${c.key}」下面`, 'success')
  }

  const add = async (force = false) => {
    setBusy(true)
    try {
      const res = await createAtom({
        type: point.kind === 'vocab' ? 'vocabulary' : 'grammar',
        key: point.key,
        ...(occurrence ? { occurrence } : {}),
        properties: [
          ...(point.reading ? [{ kind: 'reading', value: point.reading, source_type: 'ai' }] : []),
          { kind: 'meaning', value: point.meaning, source_type: 'ai' },
          ...(level ? [{ kind: 'jlpt_level', value: level, source_type: 'ai' }] : []),
        ],
        ...(force ? { force_create: true } : {}),
      })
      if (res.status === 'similar' || res.status === 'other_spelling') {
        const c = res.candidates?.[0]
        if (c) setSimilar({ atom_id: String(c.atom_id), key: c.key })
        return
      }
      if (res.atom_id) {
        setSimilar(null)
        onAdded(String(res.atom_id))
        setAdded(res.status === 'created')
        toast(res.status === 'created' ? `「${point.key}」已入库` : `「${point.key}」已在知识库里，这句已记下`, res.status === 'created' ? 'success' : 'info')
      }
    } catch {
      toast('入库失败，请再试一次', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-xl border border-border bg-surface px-3.5 py-2.5 flex flex-wrap items-center gap-3">
      {point.option && <span className="text-xs text-fg-subtle tabular-nums w-3">{point.option}</span>}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <p className="flex items-baseline gap-2 flex-wrap">
          <span className="font-jp text-base text-fg">{point.key}</span>
          {level && <span className={LEVEL_CLASS[level] ?? 'badge'}>{level}</span>}
          <span className="text-[11px] text-fg-subtle">{point.kind === 'vocab' ? '词' : '语法'}</span>
        </p>
        <p className="text-xs text-fg-muted truncate">{point.reading ? `${point.reading} · ` : ''}{point.meaning}</p>
      </div>
      {atomId ? (
        <button type="button" onClick={() => navigate(`/kb/${atomId}`)}
                className={added ? 'btn h-8 text-xs text-success-fg' : 'btn h-8 text-xs bg-accent-light text-fg-muted hover:text-fg'}>
          {added ? <><Check className="w-3.5 h-3.5" />已入库</> : '已在库'}
        </button>
      ) : (
        <button type="button" onClick={() => void add()} disabled={busy} className="btn h-8 text-xs border border-border text-fg">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}入库
        </button>
      )}
      {similar && (
        <div className="basis-full flex flex-wrap items-center gap-2 text-xs text-fg-muted pt-1">
          库里已有「<span className="font-jp text-fg">{similar.key}</span>」
          <button type="button" onClick={() => void keepUnder(similar)} className="btn h-7 text-xs border border-border text-fg">是同一个</button>
          <button type="button" onClick={() => void add(true)} className="btn h-7 text-xs border border-border text-fg">分开存</button>
        </div>
      )}
    </li>
  )
}
