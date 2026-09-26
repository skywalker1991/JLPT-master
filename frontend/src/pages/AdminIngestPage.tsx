import { useEffect, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import {
  getBank, createDraft, getDraft, confirmDraft,
} from '../services/api'
import type { BankEntry, BankOverview, DraftDetail } from '../types'
import DraftEditor from '../components/admin/DraftEditor'
import ReportQueue from '../components/admin/ReportQueue'
import BankList from '../components/admin/BankList'
import TypeTotals from '../components/admin/TypeTotals'
import PaperEditor from '../components/admin/PaperEditor'
import DraftReview from '../components/admin/DraftReview'

// ─── Draft list sidebar ───────────────────────────────────────────────────────

export default function AdminIngestPage() {
  const [loadingDrafts, setLoadingDrafts] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftDetail | null>(null)
  const [loadingDraft, setLoadingDraft] = useState(false)
  const [tab, setTab] = useState<'papers' | 'types' | 'reports'>('papers')
  const [bank, setBank] = useState<BankOverview | null>(null)
  // A paper already in the bank, opened to be corrected.
  const [paperId, setPaperId] = useState<string | null>(null)

  async function refresh() {
    setBank(await getBank())
  }

  useEffect(() => {
    refresh().finally(() => setLoadingDrafts(false))
  }, [])

  // Poll when selected draft is still processing
  useEffect(() => {
    if (draft?.status !== 'processing') return
    const timer = setInterval(async () => {
      try {
        const updated = await getDraft(draft.id)
        if (updated.status !== 'processing') {
          setDraft(updated)
          await refresh()
          clearInterval(timer)
        }
      } catch {
        clearInterval(timer)
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [draft?.id, draft?.status])

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

  async function handleUpload(files: File[]) {
    setUploading(true)
    try {
      const d = await createDraft(files)
      await refresh()
      setSelectedId(d.id)
      setDraft(d)
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

  const [confirming, setConfirming] = useState(false)

  async function handleConfirm() {
    if (!selectedId) return
    setConfirming(true)
    try {
      const updated = await confirmDraft(selectedId)
      setDraft(updated)
      refresh()
    } catch (e) {
      alert(`入库失败：${(e as Error).message}`)
    } finally {
      setConfirming(false)
    }
  }


  // suppress unused warning
  void loadingDrafts

  function openEntry(entry: BankEntry) {
    if (entry.kind === 'draft') {
      setPaperId(null)
      void handleSelect(entry.id)
    } else {
      // An imported paper is corrected in place; a wrong answer there is
      // wrong on every attempt made against it from here on.
      setSelectedId(entry.id)
      setDraft(null)
      setPaperId(entry.id)
    }
  }

  return (
    <div className="flex h-full">
      <div className="w-[22rem] shrink-0 flex flex-col border-r border-border min-h-0">
        <div className="shrink-0 flex items-center gap-1 px-4 pt-3">
          {([['papers', '试卷'], ['types', '题型'], ['reports', '报错']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => { setTab(k); setSelectedId(null); setPaperId(null) }}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                tab === k ? 'bg-fg/10 text-fg font-semibold' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {loadingDrafts && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-fg-muted" />
          </div>
        )}
        {!loadingDrafts && tab === 'papers' && bank && (
          <BankList
            coverage={bank.coverage}
            entries={bank.entries}
            selectedId={selectedId}
            onSelect={openEntry}
            onUpload={handleUpload}
            uploading={uploading}
          />
        )}
        {!loadingDrafts && tab === 'types' && bank && <TypeTotals types={bank.types} />}
        {!loadingDrafts && tab === 'reports' && (
          <div className="flex-1 overflow-y-auto p-4"><ReportQueue /></div>
        )}
      </div>

      {!selectedId && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-fg-muted space-y-2 px-8">
            <FileText className="w-10 h-10 mx-auto opacity-20" />
            <p className="text-sm">选一份卷子查看或修改</p>
            <p className="text-xs text-fg-subtle">
              导入时 試題 / 解析 / 答案表 一起选，级别和年月会从文件里读出来
            </p>
          </div>
        </div>
      )}

      {paperId && <PaperEditor paperId={paperId} />}

      {selectedId && loadingDraft && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-fg-muted" />
        </div>
      )}

      {selectedId && draft?.status === 'processing' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto" />
            <p className="text-sm text-fg-muted">AI 识别中，请稍候…</p>
          </div>
        </div>
      )}

      {selectedId && draft?.status === 'failed' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-danger">识别失败，请删除后重新上传</p>
        </div>
      )}

      {/* Read through the new pipeline: review the findings, then confirm.
          The older draft_json path stays for drafts made before it existed. */}
      {selectedId && draft?.canonical && draft.status !== 'processing' && (
        <DraftReview
          draft={draft}
          onConfirm={handleConfirm}
          confirming={confirming}
          onUpdated={setDraft}
        />
      )}

      {selectedId && draft && !draft.canonical
        && draft.status !== 'processing' && draft.status !== 'failed' && (
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
