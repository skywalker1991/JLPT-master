import { Search, Loader2, AlertCircle } from 'lucide-react'

interface Props {
  value: string
  onChange: (v: string) => void
  onLoad: () => void
  loading: boolean
  error: string | null
}

export default function VideoURLBar({ value, onChange, onLoad, loading, error }: Props) {
  return (
    <div className="card px-4 py-3 flex items-center gap-3 shrink-0">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onLoad()}
        placeholder="粘贴 YouTube 链接…"
        className="input flex-1 text-sm"
      />
      <button
        onClick={onLoad}
        disabled={loading || !value.trim()}
        className="btn-primary h-9 px-4 gap-2 text-sm shrink-0 flex items-center"
      >
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <Search className="w-4 h-4" />
        }
        加载
      </button>
      {error && (
        <p className="text-xs text-danger flex items-center gap-1.5 shrink-0">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
        </p>
      )}
    </div>
  )
}
