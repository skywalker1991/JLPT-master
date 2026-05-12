import { History, Loader2, Trash2 } from 'lucide-react'
import type { AnalysisRecord } from '../../types'
import { INPUT_TYPE_LABELS } from '../../types'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

interface Props {
  history: AnalysisRecord[]
  loading: boolean
  onSelect: (record: AnalysisRecord) => void
  onDelete: (e: React.MouseEvent, id: string) => void
}

export default function AnalysisHistory({ history, loading, onSelect, onDelete }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 py-12">
        <Loader2 className="w-5 h-5 animate-spin text-fg-subtle" />
      </div>
    )
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 gap-2 py-12 text-fg-subtle">
        <History className="w-8 h-8 opacity-30" />
        <p className="text-sm">暂无历史记录</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto py-2">
      {history.map(record => (
        <button
          key={record.id}
          onClick={() => onSelect(record)}
          className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors group relative"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/10 text-accent">
                  {INPUT_TYPE_LABELS[record.input_type as keyof typeof INPUT_TYPE_LABELS] ?? record.input_type}
                </span>
                <span className="text-[10px] text-fg-subtle">{timeAgo(record.created_at)}</span>
              </div>
              <p className="text-sm text-fg leading-snug line-clamp-2">
                {record.input_content || '（无内容）'}
              </p>
            </div>
            <button
              onClick={e => onDelete(e, record.id)}
              className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded hover:bg-danger/10
                         hover:text-danger text-fg-subtle transition-all mt-0.5"
              title="删除"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </button>
      ))}
    </div>
  )
}
