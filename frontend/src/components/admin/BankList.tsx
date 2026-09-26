import { useRef } from 'react'
import { AlertTriangle, Loader2, Upload } from 'lucide-react'
import type { BankEntry } from '../../types'

/**
 * The bank, and what is being added to it.
 *
 * A draft is a paper mid-arrival, not a separate kind of thing, so it sits in
 * the same list under the sitting it belongs to. What each row carries is what
 * you would otherwise have to open the paper to find out: whether every
 * question has an answer, whether the listening can be heard, and whether it
 * came in through the old extractor — which split one 読解 heading into four
 * 問題8 and left the questions without their own text.
 */
export default function BankList({
  entries, selectedId, onSelect, onUpload, uploading,
}: {
  entries: BankEntry[]
  selectedId: string | null
  onSelect: (e: BankEntry) => void
  onUpload: (files: File[]) => void
  uploading: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  const byLevel = new Map<string, BankEntry[]>()
  for (const e of entries) {
    if (!byLevel.has(e.level)) byLevel.set(e.level, [])
    byLevel.get(e.level)!.push(e)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border">
        <p className="text-xs text-fg-muted">
          {entries.filter(e => e.kind === 'paper').length} 份已入库
          {entries.some(e => e.kind === 'draft') && (
            <span className="text-accent">
              {' · '}{entries.filter(e => e.kind === 'draft').length} 份待校对
            </span>
          )}
        </p>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed
                     border-border text-xs text-fg-muted hover:border-accent/50 hover:text-accent
                     transition-colors disabled:opacity-40"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {uploading ? '识别中…' : '导入一次考试'}
        </button>
        <input
          ref={fileRef} type="file" accept="application/pdf" multiple className="hidden"
          onChange={e => {
            // A sitting is 試題 + 解析 + 答案表; which is which is worked out
            // from the files, so they go up together.
            const picked = Array.from(e.target.files ?? [])
            if (picked.length) onUpload(picked)
            e.target.value = ''
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <p className="text-sm text-fg-muted text-center py-12">题库还是空的</p>
        )}
        {[...byLevel.entries()].map(([level, rows]) => (
          <div key={level}>
            <p className="sticky top-0 bg-surface px-5 py-1.5 text-xs font-semibold text-fg-muted
                          border-b border-border">{level}</p>
            {rows.map(e => (
              <button
                key={e.id}
                onClick={() => onSelect(e)}
                className={`w-full text-left px-5 py-3 border-b border-border transition-colors
                            ${e.id === selectedId ? 'bg-accent-light' : 'hover:bg-bg'}`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-fg">{e.source || e.title}</span>
                  <span className="text-xs text-fg-subtle">{e.items} 题</span>
                  {e.kind === 'draft' && (
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      e.findings > 0 ? 'bg-danger-light text-danger-fg' : 'bg-orange-100 text-orange-700'
                    }`}>
                      {e.findings > 0 ? `待校对 ${e.findings} 处` : '待校对'}
                    </span>
                  )}
                </div>
                {e.kind === 'paper' && <Health entry={e} />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** What the paper is short of, and nothing when it is short of nothing. */
function Health({ entry }: { entry: BankEntry }) {
  const gaps: string[] = []
  if (entry.answered < entry.items) gaps.push(`${entry.items - entry.answered} 题无答案`)
  if (entry.listening > entry.transcripts) {
    gaps.push(`听力缺 ${entry.listening - entry.transcripts} 段原文`)
  }
  if (entry.empty_problems > 0) gaps.push(`${entry.empty_problems} 个空题组`)
  // Not a fault in the paper, a fault in how it was read — worth re-importing
  // from the PDFs if they are still to hand.
  if (entry.duplicate_names > 0) gaps.push('旧流水线导入，建议重导')

  if (gaps.length === 0) {
    return <p className="text-xs text-fg-subtle mt-0.5">完整</p>
  }
  return (
    <p className="text-xs text-fg-muted mt-0.5 flex items-center gap-1">
      <AlertTriangle className="w-3 h-3 text-danger shrink-0" />
      {gaps.join(' · ')}
    </p>
  )
}
