import { useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Upload } from 'lucide-react'
import { listDrafts, createDraftFromPdf, getDraft } from '../services/api'
import type { DraftSummary, DraftDetail } from '../types'
import DraftEditor from '../components/admin/DraftEditor'

// ─── Draft list sidebar ───────────────────────────────────────────────────────

function DraftList({
  drafts, selectedId, onSelect, onUpload, uploading,
}: {
  drafts: DraftSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onUpload: (file: File) => void
  uploading: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="w-52 shrink-0 flex flex-col border-r border-border">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border text-xs text-fg-muted hover:border-accent/50 hover:text-accent transition-colors disabled:opacity-40"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {uploading ? '识别中…' : '上传 PDF'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) onUpload(f)
            e.target.value = ''
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {drafts.length === 0 && (
          <p className="text-xs text-fg-muted text-center py-8">暂无草稿</p>
        )}
        {drafts.map(d => {
          const isSelected = d.id === selectedId
          const date = new Date(d.updated_at)
          return (
            <button
              key={d.id}
              onClick={() => onSelect(d.id)}
              className={[
                'w-full text-left px-4 py-2.5 border-b border-border/50 transition-colors',
                isSelected ? 'bg-accent-light' : 'hover:bg-bg',
              ].join(' ')}
            >
              <p className="text-xs font-medium text-fg truncate">{d.filename ?? '无文件名'}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  d.status === 'confirmed'
                    ? 'bg-success-light text-success-fg'
                    : 'bg-orange-100 text-orange-700'
                }`}>
                  {d.status === 'confirmed' ? '已入库' : '待校对'}
                </span>
                <span className="text-[10px] text-fg-subtle">
                  {date.getMonth() + 1}/{date.getDate()}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminIngestPage() {
  const [drafts, setDrafts] = useState<DraftSummary[]>([])
  const [loadingDrafts, setLoadingDrafts] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftDetail | null>(null)
  const [loadingDraft, setLoadingDraft] = useState(false)

  async function refresh() {
    const list = await listDrafts()
    setDrafts(list)
  }

  useEffect(() => {
    listDrafts()
      .then(list => { setDrafts(list); setLoadingDrafts(false) })
      .catch(() => setLoadingDrafts(false))
  }, [])

  async function handleSelect(id: string) {
    setSelectedId(id)
    setDraft(null)
    setLoadingDraft(true)
    try {
      const d = await getDraft(id)
      setDraft(d)
    } finally {
      setLoadingDraft(false)
    }
  }

  async function handleUpload(file: File) {
    setUploading(true)
    try {
      const d = await createDraftFromPdf(file)
      await refresh()
      await handleSelect(d.id)
    } catch (e) {
      alert(`上传失败：${(e as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  function handleSaved(updated: DraftDetail) {
    setDraft(updated)
    refresh()
  }

  function handleConfirmed() {
    refresh()
    alert('入库成功！试卷已添加到考试列表。')
  }

  // suppress unused warning
  void loadingDrafts

  return (
    <div className="flex h-full">
      <DraftList
        drafts={drafts}
        selectedId={selectedId}
        onSelect={handleSelect}
        onUpload={handleUpload}
        uploading={uploading}
      />

      {!selectedId && (
        <div className="flex-1 flex items-center justify-center text-fg-muted">
          <div className="text-center space-y-2">
            <FileText className="w-10 h-10 mx-auto opacity-20" />
            <p className="text-sm">上传 PDF 或选择草稿开始校对</p>
          </div>
        </div>
      )}

      {selectedId && loadingDraft && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-fg-muted" />
        </div>
      )}

      {selectedId && draft && (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="w-2/5 shrink-0 border-r border-border flex flex-col">
            <div className="px-4 py-2 border-b border-border bg-surface shrink-0">
              <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide">识别原文</p>
            </div>
            <textarea
              readOnly
              value={draft.markdown_raw ?? '（无原文）'}
              className="flex-1 p-4 text-xs font-mono text-fg-muted bg-bg resize-none leading-relaxed focus:outline-none"
            />
          </div>

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <DraftEditor
              draft={draft}
              onSaved={handleSaved}
              onConfirmed={handleConfirmed}
            />
          </div>
        </div>
      )}
    </div>
  )
}
