import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import type { AtomListItem, AtomDetail } from '../../types'
import { jlptBadgeClass } from '../../utils/jlpt'
import { getAtom } from '../../services/api'

interface AtomCardProps {
  atom: AtomListItem
  selected?: boolean
  onSelect?: (id: string) => void
  compact?: boolean
}

const JLPT_RE = /^N[1-5]$/i

const POS_TAGS = new Set(['名詞', '動詞', '形容詞', '副詞', '助詞', '助動詞', '接続詞', '感動詞', '代名詞', '慣用語', '接頭語', '接尾語'])
const REGISTER_TAGS = new Set(['書面語', '口語', '敬語', '俗語'])

const PROP_LABEL: Record<string, string> = {
  reading: '読音', meaning: '含義', part_of_speech: '詞性',
  jlpt_level: 'JLPT', register: '語體', connection: '接続',
  usage: '用法', nuance: '語感', example: '例句',
}
const PROP_ORDER = ['reading', 'meaning', 'example', 'part_of_speech', 'jlpt_level', 'register', 'connection', 'usage', 'nuance']

const RELATION_LABEL: Record<string, string> = {
  synonym: '同義', formal_casual: '正式/口語', derivative: '派生', contrast: '對比', nuance: '細微差別',
}

function tagStyle(tag: string): string {
  if (JLPT_RE.test(tag)) return jlptBadgeClass(tag.toUpperCase())
  if (POS_TAGS.has(tag)) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (REGISTER_TAGS.has(tag)) return 'bg-orange-50 text-orange-700 border-orange-200'
  return 'bg-gray-100 text-fg-muted border-border'
}

function TagPills({ tags, small }: { tags: string[]; small?: boolean }) {
  if (!tags.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className={clsx(
            'inline-flex items-center rounded-full border font-medium',
            small ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5',
            tagStyle(tag),
          )}
        >
          {tag}
        </span>
      ))}
    </div>
  )
}

function AtomDetailExpanded({ id }: { id: string }) {
  const [detail, setDetail] = useState<AtomDetail | null>(null)

  useEffect(() => {
    getAtom(id).then(setDetail).catch(() => {})
  }, [id])

  if (!detail) return <p className="text-xs text-fg-muted mt-2">加載中…</p>

  const grouped: Record<string, string[]> = {}
  for (const p of detail.properties) {
    if (!grouped[p.kind]) grouped[p.kind] = []
    grouped[p.kind].push(p.value)
  }

  const kinds = [
    ...PROP_ORDER.filter(k => grouped[k]),
    ...Object.keys(grouped).filter(k => !PROP_ORDER.includes(k)),
  ]

  return (
    <div className="mt-2 pt-2 border-t border-border/60 space-y-2" onClick={e => e.stopPropagation()}>
      {kinds.map(kind => (
        <div key={kind}>
          <p className="text-[10px] text-fg-muted uppercase tracking-wide">{PROP_LABEL[kind] ?? kind}</p>
          {grouped[kind].map((val, i) =>
            kind === 'jlpt_level' ? (
              <span key={i} className={clsx('inline-flex items-center rounded-full border font-medium text-xs px-2 py-0.5 mt-0.5', jlptBadgeClass(val))}>{val}</span>
            ) : kind === 'example' ? (() => {
                const [ja, zh] = val.split('｜')
                return (
                  <div key={i} className="mt-1 pl-2 border-l-2 border-border">
                    <p className="text-sm text-fg leading-snug">{ja}</p>
                    {zh && <p className="text-xs text-fg-muted leading-snug mt-0.5">{zh}</p>}
                  </div>
                )
              })() : (
              <p key={i} className="text-sm text-fg leading-snug">{val}</p>
            )
          )}
        </div>
      ))}

      {detail.relations.length > 0 && (
        <div>
          <p className="text-[10px] text-fg-muted uppercase tracking-wide">關聯詞條</p>
          <div className="flex flex-wrap gap-1.5 mt-0.5">
            {detail.relations.map(rel => (
              <span key={rel.id} className="flex items-center gap-1 text-[11px]">
                <span className="text-fg-muted bg-surface border border-border rounded px-1 py-0.5">{RELATION_LABEL[rel.type] ?? rel.type}</span>
                <span className="text-accent">{rel.target.key}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AtomCard({ atom, selected, onSelect, compact }: AtomCardProps) {
  const navigate = useNavigate()
  const tags = atom.tags ?? []

  function handleClick() {
    if (onSelect) onSelect(atom.id)
    else navigate(`/kb/${atom.id}`)
  }

  if (compact) {
    const isVocab = atom.type === 'vocabulary'
    const isGrammar = atom.type === 'grammar'
    return (
      <div
        data-atom-id={atom.id}
        onClick={handleClick}
        className={clsx(
          'px-3 py-2.5 rounded-lg border border-border cursor-pointer transition-all duration-150',
          'hover:shadow-card-md hover:border-transparent',
          selected && 'shadow-card-md border-transparent bg-surface',
        )}
      >
        {/* 词条主角 */}
        <div className="flex items-start gap-2 min-w-0">
          <ruby className={clsx(
            'text-[1.05rem] font-bold tracking-tight flex-1 min-w-0',
            isVocab ? 'text-accent' : isGrammar ? 'text-blue-600' : 'text-fg',
          )}>
            {atom.key}
            {atom.reading && /[一-鿿]/.test(atom.key) && (
              <rt className="text-[0.55rem] font-normal text-fg-muted tracking-normal">{atom.reading}</rt>
            )}
          </ruby>
          <span className={clsx(
            'badge text-[10px] px-1 py-0 shrink-0 mt-1',
            isVocab ? 'badge-vocab' : isGrammar ? 'badge-grammar' : 'bg-gray-100 text-fg-muted',
          )}>
            {isVocab ? '词' : isGrammar ? '法' : atom.type}
          </span>
        </div>

        {/* 例句 */}
        {!selected && (atom.example || atom.usage) && (
          <p className="text-sm text-fg-muted mt-1 leading-snug line-clamp-2">
            {atom.example ?? atom.usage}
          </p>
        )}

        {/* 含义（注脚） */}
        {atom.meaning && (
          <p className={clsx('text-[11px] text-fg-subtle mt-0.5 leading-snug', !selected && 'line-clamp-1')}>
            {atom.meaning}
          </p>
        )}

        {tags.length > 0 && <div className="mt-1.5"><TagPills tags={tags} small /></div>}

        {selected && <AtomDetailExpanded id={atom.id} />}
      </div>
    )
  }

  // Non-compact grid card
  return (
    <div
      data-atom-id={atom.id}
      onClick={handleClick}
      className={clsx(
        'card p-4 cursor-pointer hover:border-accent/40 hover:shadow-card-md transition-all duration-150 space-y-2',
        selected && 'border-accent ring-1 ring-accent/30 shadow-card-md',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-base font-medium text-fg truncate flex-1 min-w-0">{atom.key}</p>
        <span className={clsx(
          'badge flex-shrink-0',
          atom.type === 'vocabulary' ? 'badge-vocab' : atom.type === 'grammar' ? 'badge-grammar' : 'bg-gray-100 text-fg-muted',
        )}>
          {atom.type === 'vocabulary' ? '词汇' : atom.type === 'grammar' ? '语法' : atom.type}
        </span>
      </div>

      {tags.length > 0 && <TagPills tags={tags} />}
      {atom.reading && <p className="text-xs text-accent/80">{atom.reading}</p>}
      {!selected && (atom.example || atom.usage) && (
        <p className="text-sm text-fg-subtle line-clamp-2 italic">{atom.example ?? atom.usage}</p>
      )}
      {atom.meaning && <p className={clsx('text-xs text-fg-muted', !selected && 'line-clamp-2')}>{atom.meaning}</p>}

      {selected && <AtomDetailExpanded id={atom.id} />}
    </div>
  )
}
