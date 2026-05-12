import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import type { AtomListItem } from '../../types'
import { jlptBadgeClass } from '../../utils/jlpt'

interface AtomCardProps {
  atom: AtomListItem
}

function MaturityBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value))
  const color =
    pct >= 80 ? 'bg-success' :
    pct >= 50 ? 'bg-yellow-400' :
    pct >= 20 ? 'bg-orange-400' :
    'bg-border'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-bg rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-300', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-fg-subtle w-8 text-right">{Math.round(pct)}</span>
    </div>
  )
}

export default function AtomCard({ atom }: AtomCardProps) {
  const navigate = useNavigate()

  const jlptMatch = atom.key.match(/\b(N[1-5])\b/i)
  const jlptLevel = jlptMatch ? jlptMatch[1].toUpperCase() : null

  return (
    <div
      onClick={() => navigate(`/kb/${atom.id}`)}
      className="card p-4 cursor-pointer hover:border-accent/40 hover:shadow-card-md transition-all duration-150 space-y-3"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-base font-medium text-fg truncate flex-1 min-w-0">{atom.key}</p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {jlptLevel && (
            <span className={clsx('badge', jlptBadgeClass(jlptLevel))}>{jlptLevel}</span>
          )}
          <span className={clsx(
            'badge',
            atom.type === 'vocabulary' ? 'badge-vocab' :
            atom.type === 'grammar'    ? 'badge-grammar' :
            'bg-gray-100 text-fg-muted',
          )}>
            {atom.type === 'vocabulary' ? '词汇' : atom.type === 'grammar' ? '语法' : atom.type}
          </span>
        </div>
      </div>

      {/* Maturity */}
      <MaturityBar value={atom.maturity} />

      {/* Stats */}
      <div className="flex items-center gap-4 text-xs text-fg-subtle">
        <span>{atom.property_count} 属性</span>
        <span>{atom.relation_count} 关联</span>
      </div>
    </div>
  )
}
