import { X, Send, Loader2 } from 'lucide-react'
import clsx from 'clsx'

const PHASE_LABEL: Record<string, string> = {
  preprocessing: '分词分句中…',
  extracting:    '文字提取中…',
  analyzing:     '分析中…',
}

interface Props {
  text: string
  imageData: string | null
  isStreaming: boolean
  hasResults: boolean
  phase: string
  error: string | null
  onTextChange: (v: string) => void
  onImageClear: () => void
  onSubmit: () => void
}

export default function AnalysisInput({
  text, imageData, isStreaming, hasResults, phase, error,
  onTextChange, onImageClear, onSubmit,
}: Props) {

  // ── Streaming: show progress ──
  if (isStreaming) {
    return (
      <div className="px-5 py-4 flex items-center gap-3 text-sm text-fg-muted">
        <Loader2 className="w-4 h-4 animate-spin text-accent shrink-0" />
        {PHASE_LABEL[phase] ?? '分析中…'}
      </div>
    )
  }

  // ── Has results: followup bar ──
  if (hasResults) {
    return (
      <div className="px-4 py-3">
        <div className={clsx(
          'flex items-center gap-2 rounded-xl border border-border bg-gray-50/60 px-3 py-2',
          'focus-within:border-accent/40 focus-within:bg-white transition-all',
        )}>
          <input
            type="text"
            placeholder="追问…（例：这个语法点怎么用？）"
            disabled
            className="flex-1 bg-transparent text-sm text-fg placeholder:text-fg-subtle outline-none disabled:cursor-not-allowed"
          />
          <button disabled className="btn-ghost h-7 w-7 p-0 justify-center rounded-lg opacity-40">
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-xs text-fg-subtle mt-1.5 px-1">追问功能开发中</p>
      </div>
    )
  }

  // ── No results: new analysis input ──
  const canSubmit = !!imageData || !!text.trim()

  return (
    <div className="p-4">
      <div className={clsx(
        'rounded-xl border border-border bg-gray-50/60 transition-all duration-200',
        'focus-within:border-accent/50 focus-within:bg-white focus-within:shadow-sm',
      )}>
        {imageData ? (
          <div className="p-3 flex items-start gap-2">
            <div className="relative inline-flex shrink-0">
              <img
                src={`data:image/png;base64,${imageData}`}
                alt="素材图片"
                className="max-h-20 max-w-[160px] rounded-lg border border-border object-contain"
              />
              <button
                onClick={onImageClear}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-gray-200
                           hover:bg-gray-300 flex items-center justify-center transition-colors"
              >
                <X className="w-3 h-3 text-fg-muted" />
              </button>
            </div>
            <span className="text-xs text-fg-subtle pt-0.5">图片已就绪</span>
          </div>
        ) : (
          <textarea
            value={text}
            onChange={e => onTextChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSubmit()
              }
            }}
            rows={3}
            placeholder="粘贴日语文本或截图…"
            className="w-full resize-none bg-transparent px-3 pt-3 pb-3 text-sm leading-relaxed
                       text-fg placeholder:text-fg-subtle outline-none border-none block"
          />
        )}
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className="btn-primary flex-1 h-11 rounded-xl text-base font-semibold gap-2"
        >
          <Send className="w-4 h-4" />
          开始分析
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  )
}
