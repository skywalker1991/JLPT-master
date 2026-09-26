import { useRef } from 'react'
import { AlertTriangle, Loader2, Upload } from 'lucide-react'
import type { BankEntry, Coverage } from '../../types'

/**
 * Every sitting the test has held, and what the bank has of each.
 *
 * Listed as a calendar rather than as an inventory, because the question this
 * page exists to answer is which sitting to go and find next — and a list of
 * what is already here cannot be read for what is not. The test has run every
 * July and December since 2010, so the rows that are missing are as knowable
 * as the rows that are filled, and they are shown greyed with what they need.
 *
 * A draft is a paper mid-arrival, not a separate kind of thing, so it sits in
 * the row of the sitting it belongs to.
 */
export default function BankList({
  coverage, entries, selectedId, onSelect, onUpload, uploading,
}: {
  coverage: Coverage[]
  entries: BankEntry[]
  selectedId: string | null
  onSelect: (e: BankEntry) => void
  onUpload: (files: File[]) => void
  uploading: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const byId = new Map(entries.map(e => [e.id, e]))

  const held = coverage.filter(c => c.state === 'held').length
  const drafts = coverage.filter(c => c.state === 'draft').length
  const wanted = coverage.filter(c => c.state === 'missing').length

  // Newest first: the sitting most people are studying for is the last one.
  const byYear = new Map<number, Coverage[]>()
  for (const c of [...coverage].reverse()) {
    if (!byYear.has(c.year)) byYear.set(c.year, [])
    byYear.get(c.year)!.push(c)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-border">
        <p className="text-xs text-fg-muted">
          {held} / {coverage.filter(c => c.state !== 'cancelled').length} 场已入库
          {drafts > 0 && <span className="text-accent">{' · '}{drafts} 份待校对</span>}
          {wanted > 0 && <span className="text-fg-subtle">{' · '}{wanted} 场缺资料</span>}
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
        {[...byYear.entries()].map(([year, rows]) => (
          <div key={year}>
            <p className="sticky top-0 bg-surface px-5 py-1.5 text-xs font-semibold text-fg-muted
                          border-b border-border">{year} 年</p>
            {rows.map(c => (
              <Row
                key={c.label}
                sitting={c}
                entry={c.entry_id ? byId.get(c.entry_id) : undefined}
                selected={!!c.entry_id && c.entry_id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Row({
  sitting, entry, selected, onSelect,
}: {
  sitting: Coverage
  entry: BankEntry | undefined
  selected: boolean
  onSelect: (e: BankEntry) => void
}) {
  const month = `${sitting.month} 月`

  // Nothing to open: no paper, and none coming.
  if (!entry) {
    const off = sitting.state === 'cancelled'
    return (
      <div className={`px-5 py-3 border-b border-border ${off ? 'opacity-40' : 'opacity-60'}`}>
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-fg-subtle">{month}</span>
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-border/50 text-fg-subtle">
            {off ? '未举行' : '待上传资料'}
          </span>
        </div>
        {off && <p className="text-xs text-fg-subtle mt-0.5">{sitting.note}</p>}
      </div>
    )
  }

  return (
    <button
      onClick={() => onSelect(entry)}
      className={`w-full text-left px-5 py-3 border-b border-border transition-colors
                  ${selected ? 'bg-accent-light' : 'hover:bg-bg'}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-fg">{month}</span>
        <span className="text-xs text-fg-subtle">{entry.items} 题</span>
        {entry.kind === 'draft' && (
          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            entry.findings > 0 ? 'bg-danger-light text-danger-fg' : 'bg-orange-100 text-orange-700'
          }`}>
            {entry.findings > 0 ? `待校对 ${entry.findings} 处` : '待校对'}
          </span>
        )}
      </div>
      {entry.kind === 'paper' && <Health entry={entry} />}
    </button>
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
