import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import type { AtomDetail } from '../../types'
import { jlptBadgeClass } from '../../utils/jlpt'

interface AtomDetailViewProps {
  detail: AtomDetail
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SourceBadge({ sourceType }: { sourceType: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    dictionary: { label: '词典', cls: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200/60' },
    ai:         { label: 'AI',   cls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200/60' },
    user:       { label: '用户', cls: 'bg-green-50 text-green-700 ring-1 ring-green-200/60' },
  }
  const entry = map[sourceType] ?? { label: sourceType, cls: 'bg-gray-100 text-fg-muted' }
  return <span className={clsx('badge', entry.cls)}>{entry.label}</span>
}

function KindBadge({ kind }: { kind: string }) {
  const kindLabels: Record<string, string> = {
    meaning:       '释义',
    reading:       '读音',
    part_of_speech:'词性',
    jlpt_level:    'JLPT',
    register:      '语域',
    usage:         '用法',
    nuance:        '语感',
    example:       '例句',
    connection:    '接续',
    tag:           '标签',
  }
  return (
    <span className="badge bg-gray-100 text-fg-muted">
      {kindLabels[kind] ?? kind}
    </span>
  )
}

export default function AtomDetailView({ detail }: AtomDetailViewProps) {
  const navigate = useNavigate()
  const { atom, properties, relations, analyses, traces_summary } = detail

  const grouped = properties.reduce<Record<string, typeof properties>>((acc, p) => {
    const key = p.source_ref ?? '__direct__'
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})

  const jlptProp = properties.find((p) => p.kind === 'jlpt_level')
  const jlptLevel = jlptProp?.value ?? null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold text-fg">{atom.key}</h1>
              <span className={clsx(
                'badge text-sm px-2.5 py-1',
                atom.type === 'vocabulary' ? 'badge-vocab' :
                atom.type === 'grammar'    ? 'badge-grammar' :
                'bg-gray-100 text-fg-muted',
              )}>
                {atom.type === 'vocabulary' ? '词汇' : atom.type === 'grammar' ? '语法' : atom.type}
              </span>
              {jlptLevel && (
                <span className={clsx('badge text-sm px-2.5 py-1', jlptBadgeClass(jlptLevel))}>
                  {jlptLevel}
                </span>
              )}
            </div>
            <p className="text-xs text-fg-subtle">创建于 {formatDate(atom.created_at)}</p>
          </div>

          {traces_summary && (
            <div className="text-right text-xs text-fg-subtle space-y-1">
              <div>遇见 {traces_summary.duplicate_count + 1} 次</div>
              {traces_summary.added_at && (
                <div>最近 {formatDate(traces_summary.added_at)}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Properties */}
      {properties.length > 0 && (
        <div className="card p-5 space-y-4">
          <h2 className="section-label">属性</h2>

          {Object.entries(grouped).map(([sourceRef, props]) => (
            <div key={sourceRef} className="space-y-2">
              {sourceRef !== '__direct__' && (
                <p className="text-xs text-fg-subtle font-mono">{sourceRef}</p>
              )}
              <div className="space-y-1">
                {props.map((prop) => (
                  <div
                    key={prop.id}
                    className="flex items-start gap-3 py-2.5 border-b border-border last:border-0"
                  >
                    <KindBadge kind={prop.kind} />
                    <p className="flex-1 text-sm text-fg leading-relaxed">{prop.value}</p>
                    <SourceBadge sourceType={prop.source_type} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Relations */}
      {relations.length > 0 && (
        <div className="card p-5 space-y-3">
          <h2 className="section-label">关联</h2>
          <div className="space-y-1">
            {relations.map((rel) => (
              <div
                key={rel.id}
                className="flex items-center gap-3 py-2.5 border-b border-border last:border-0"
              >
                <span className="badge bg-gray-100 text-fg-muted">{rel.type}</span>
                <span className="text-fg-subtle text-xs">
                  {rel.direction === 'from' ? '→' : '←'}
                </span>
                <button
                  onClick={() => navigate(`/kb/${rel.target.id}`)}
                  className="text-sm text-accent hover:text-accent-hover font-medium cursor-pointer transition-colors"
                >
                  {rel.target.key}
                </button>
                <span className="text-xs text-fg-subtle ml-auto">{rel.target.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Linked analyses */}
      {analyses.length > 0 && (
        <div className="card p-5 space-y-3">
          <h2 className="section-label">关联分析</h2>
          <div className="space-y-1">
            {analyses.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 py-2.5 border-b border-border last:border-0"
              >
                <span className="badge bg-gray-100 text-fg-muted">{a.input_type}</span>
                <span className="text-xs text-fg-subtle ml-auto">{formatDate(a.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
