import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Check, ExternalLink, Loader2, AlertCircle, GitMerge } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import type { GrammarItem } from '../../types'
import { createAtom } from '../../services/api'
import { useToast } from '../../context/ToastContext'

interface Props { item: GrammarItem }

type Status = 'idle' | 'loading' | 'created' | 'exists' | 'similar' | 'error'

interface Candidate {
  atom_id: string
  key: string
  meaning: string | null
  score: number
}

const JLPT_BADGE: Record<string, string> = {
  N1: 'badge-n1', N2: 'badge-n2', N3: 'badge-n3', N4: 'badge-n4', N5: 'badge-n5',
}

const grammarProperties = (item: GrammarItem) => [
  { kind: 'meaning',    value: item.meaning,    source_type: 'ai' },
  ...(item.connection ? [{ kind: 'connection', value: item.connection, source_type: 'ai' }] : []),
  ...(item.usage      ? [{ kind: 'usage',      value: item.usage,      source_type: 'ai' }] : []),
  ...(item.nuance     ? [{ kind: 'nuance',     value: item.nuance,     source_type: 'ai' }] : []),
  ...(item.example    ? [{ kind: 'example',    value: item.example,    source_type: 'ai' }] : []),
]

export default function GrammarCard({ item }: Props) {
  const [expanded, setExpanded]     = useState(false)
  const [status, setStatus]         = useState<Status>('idle')
  const [atomId, setAtomId]         = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const navigate = useNavigate()
  const { toast } = useToast()

  const badgeClass = item.jlpt_level ? (JLPT_BADGE[item.jlpt_level.toUpperCase()] ?? '') : ''

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
        type: 'grammar',
        key: item.pattern,
        properties: grammarProperties(item),
      })
      if (res.status === 'created') {
        setAtomId(res.atom_id ? String(res.atom_id) : null)
        setStatus('created')
        toast(`「${item.pattern}」已加入知识库`, 'success')
      } else if (res.status === 'exists') {
        setAtomId(res.atom_id ? String(res.atom_id) : null)
        setStatus('exists')
        toast(`「${item.pattern}」已在知识库中`, 'info')
      } else if (res.status === 'similar') {
        setCandidates((res.candidates ?? []).map(c => ({ ...c, atom_id: String(c.atom_id) })))
        setStatus('similar')
      }
    } catch {
      setStatus('error')
      toast('加入失败，请重试', 'error')
    }
  }

  // User confirms candidate IS the same atom
  const handleMerge = (candidate: Candidate) => {
    setAtomId(candidate.atom_id)
    setStatus('exists')
    toast(`已关联到「${candidate.key}」`, 'info')
  }

  // User confirms it's NOT the same — force create
  const handleForceCreate = async () => {
    setStatus('loading')
    try {
      const res = await createAtom({
        type: 'grammar',
        key: item.pattern,
        properties: grammarProperties(item),
        force_create: true,
      })
      setAtomId(res.atom_id ? String(res.atom_id) : null)
      setStatus('created')
      toast(`「${item.pattern}」已加入知识库`, 'success')
    } catch {
      setStatus('error')
      toast('加入失败，请重试', 'error')
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface hover:border-accent/40 transition-colors duration-150 overflow-hidden">
      <div
        className={clsx(
          'flex items-center gap-3 px-3.5 py-2.5 cursor-pointer select-none',
          expanded && 'border-b border-border',
        )}
        onClick={() => setExpanded(v => !v)}
      >
        <code className="text-base font-mono font-semibold text-accent shrink-0">{item.pattern}</code>
        <span className="text-sm text-fg-muted flex-1 truncate">{item.meaning}</span>
        {badgeClass && <span className={badgeClass}>{item.jlpt_level}</span>}
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-fg-subtle shrink-0" />
        }
      </div>

      {expanded && (
        <div className="px-3.5 py-3 space-y-2 bg-gray-50/50" onClick={e => e.stopPropagation()}>
          {item.connection && (
            <p className="text-sm text-fg-muted">
              <span className="font-medium text-fg-subtle">接续：</span>{item.connection}
            </p>
          )}
          {item.usage && <p className="text-sm text-fg-muted leading-relaxed">{item.usage}</p>}
          {item.nuance && (
            <p className="text-sm text-fg-muted leading-relaxed pl-2 border-l-2 border-accent/40">
              {item.nuance}
            </p>
          )}
          {item.example && (
            <p className="text-sm font-mono text-fg-muted bg-white rounded-lg px-2.5 py-1.5">
              {item.example}
            </p>
          )}

          {/* Similar candidates — left/right comparison */}
          {status === 'similar' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
              <p className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
                <GitMerge className="w-3.5 h-3.5" />
                发现相似语法点，是同一个吗？
              </p>
              {candidates.map(c => (
                <div key={c.atom_id} className="space-y-2">
                  {/* Left / Right comparison */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md bg-white border border-border p-2 space-y-1">
                      <p className="text-[10px] text-fg-subtle font-medium uppercase tracking-wide">当前</p>
                      <p className="font-mono font-semibold text-accent">{item.pattern}</p>
                      <p className="text-fg-muted leading-snug">{item.meaning}</p>
                    </div>
                    <div className="rounded-md bg-white border border-accent/30 p-2 space-y-1">
                      <p className="text-[10px] text-fg-subtle font-medium uppercase tracking-wide">已有</p>
                      <p className="font-mono font-semibold text-accent">{c.key}</p>
                      <p className="text-fg-muted leading-snug">{c.meaning ?? '—'}</p>
                    </div>
                  </div>
                  {/* Decision buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleMerge(c)}
                      className="btn btn-ghost text-xs h-7 flex-1 text-success-fg hover:bg-success/10"
                    >
                      <Check className="w-3 h-3" />是同一个
                    </button>
                    <button
                      onClick={handleForceCreate}
                      className="btn btn-ghost text-xs h-7 flex-1 text-fg-muted"
                    >
                      <Plus className="w-3 h-3" />单独创建
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Main action button */}
          {status !== 'similar' && (
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
          )}
        </div>
      )}
    </div>
  )
}
