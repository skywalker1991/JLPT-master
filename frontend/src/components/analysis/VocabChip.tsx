import { useState } from 'react'
import { Plus, Check, ExternalLink, Loader2, AlertCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import type { VocabItem } from '../../types'
import { createAtom } from '../../services/api'
import { useToast } from '../../context/ToastContext'

interface Props { item: VocabItem }

type Status = 'idle' | 'loading' | 'created' | 'exists' | 'error'

const JLPT_BADGE: Record<string, string> = {
  N1: 'badge-n1', N2: 'badge-n2', N3: 'badge-n3', N4: 'badge-n4', N5: 'badge-n5',
}


export default function VocabChip({ item }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus]     = useState<Status>('idle')
  const [atomId, setAtomId]     = useState<string | null>(null)
  const navigate = useNavigate()
  const { toast } = useToast()

  const badgeClass = item.jlpt_level ? (JLPT_BADGE[item.jlpt_level.toUpperCase()] ?? '') : ''
  const atomKey = /^[぀-ヿ]+$/.test(item.base) ? item.surface : item.base

  const style = (() => {
    const pos = item.part_of_speech
    if (pos?.includes('名詞') || pos?.includes('名词'))
      return { bg: 'bg-sky-50',  border: 'border-sky-200',  text: 'text-sky-700' }
    if (pos?.includes('動詞') || pos?.includes('动词'))
      return { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700' }
    return   { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-fg' }
  })()

  const handleIngest = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (status === 'created' || status === 'exists') {
      if (atomId) navigate(`/kb/${atomId}`)
      return
    }
    if (status !== 'idle') return
    setStatus('loading')
    try {
      const res = await createAtom({
        type: 'vocabulary',
        key: atomKey,
        properties: [
          ...(item.reading        ? [{ kind: 'reading',        value: item.reading,        source_type: 'ai' }] : []),
          { kind: 'meaning',        value: item.meaning,                                    source_type: 'ai' },
          ...(item.part_of_speech  ? [{ kind: 'part_of_speech', value: item.part_of_speech, source_type: 'ai' }] : []),
          ...(item.jlpt_level      ? [{ kind: 'jlpt_level',     value: item.jlpt_level,     source_type: 'ai' }] : []),
          ...(item.register        ? [{ kind: 'register',       value: item.register,       source_type: 'ai' }] : []),
          ...(item.usage           ? [{ kind: 'usage',          value: item.usage,          source_type: 'ai' }] : []),
          ...(item.nuance          ? [{ kind: 'nuance',         value: item.nuance,         source_type: 'ai' }] : []),
          ...(item.example         ? [{ kind: 'example',        value: item.example,        source_type: 'ai' }] : []),
        ],
      })
      setAtomId(res.atom_id)
      if (res.status === 'created') {
        setStatus('created')
        toast(`「${atomKey}」已加入知识库`, 'success')
      } else {
        setStatus('exists')
        toast(`「${atomKey}」已在知识库中`, 'info')
      }
    } catch {
      setStatus('error')
      toast('加入失败，请重试', 'error')
    }
  }

  if (!expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        className={clsx(
          'rounded-lg border px-2.5 py-2 cursor-pointer transition-all duration-150 relative',
          'flex flex-col min-w-[5rem]',
          'hover:shadow-card hover:scale-[1.03]',
          style.bg, style.border,
        )}
      >
        {badgeClass && (
          <span className={clsx(badgeClass, 'absolute top-1.5 right-1.5')}>{item.jlpt_level}</span>
        )}
        <div className="flex items-baseline gap-1.5 w-full pr-7">
          <span className={clsx('text-base font-bold leading-tight', style.text)}>{item.surface}</span>
          {item.part_of_speech && (
            <span className={clsx('text-[0.6rem] font-medium shrink-0', style.text, 'opacity-70')}>{item.part_of_speech}</span>
          )}
        </div>
        <span className="text-xs text-fg-muted mt-1 line-clamp-2 leading-snug w-full">{item.meaning}</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-accent-border bg-accent-light w-full overflow-hidden">
      <div
        className="flex items-center gap-2 px-3.5 py-2.5 cursor-pointer border-b border-accent-border/50"
        onClick={() => setExpanded(false)}
      >
        <span className={clsx('font-bold text-base', style.text)}>{item.surface}</span>
        {item.reading && item.reading !== item.surface && (
          <span className="text-xs text-fg-muted font-mono">{item.reading}</span>
        )}
        {badgeClass && <span className={badgeClass}>{item.jlpt_level}</span>}
        <span className="ml-auto text-xs text-fg-subtle">收起</span>
      </div>
      <div className="px-3.5 py-3 space-y-2" onClick={e => e.stopPropagation()}>
        <p className="text-base font-medium text-fg">{item.meaning}</p>
        {item.part_of_speech && <p className="text-sm text-fg-muted">{item.part_of_speech}</p>}
        {item.usage && <p className="text-sm text-fg-muted leading-relaxed">{item.usage}</p>}
        {item.nuance && (
          <p className="text-sm text-fg-muted leading-relaxed pl-2 border-l-2 border-accent/40">
            {item.nuance}
          </p>
        )}
        {item.example && (
          <p className="text-sm font-mono text-fg-muted bg-white/70 rounded-lg px-2.5 py-1.5">
            {item.example}
          </p>
        )}
        <button
          onClick={handleIngest}
          disabled={status === 'loading'}
          className={clsx('btn text-xs h-7 mt-1', {
            'btn-ghost': status === 'idle',
            'btn-ghost opacity-60': status === 'loading',
            'text-success-fg hover:bg-success/10': status === 'created',
            'text-fg-muted hover:bg-gray-100': status === 'exists',
            'text-danger hover:bg-danger/10': status === 'error',
          })}
        >
          {status === 'idle'    && <><Plus className="w-3 h-3" />加入知识库</>}
          {status === 'loading' && <><Loader2 className="w-3 h-3 animate-spin" />加入中</>}
          {status === 'created' && <><Check className="w-3 h-3" />已加入<ExternalLink className="w-3 h-3" /></>}
          {status === 'exists'  && <><ExternalLink className="w-3 h-3" />查看</>}
          {status === 'error'   && <><AlertCircle className="w-3 h-3" />失败</>}
        </button>
      </div>
    </div>
  )
}
