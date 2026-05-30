import { useCallback, useEffect, useRef, useState } from 'react'
import { FileKey, Loader2, Plus, Trash2 } from 'lucide-react'
import { updateDraft, confirmDraft, uploadMedia, importAnswers } from '../../services/api'
import type { DraftDetail, DraftJson, DraftProblem, DraftItem } from '../../types'

const PROBLEM_TYPES = [
  'kanji_reading', 'kanji_writing', 'word_formation', 'vocab_fill',
  'synonym', 'usage', 'grammar_fill', 'sentence_order',
  'passage_fill', 'reading_comp', 'listening',
]

const LEVELS = ['N1', 'N2', 'N3', 'N4', 'N5']

function emptyItem(seq: number): DraftItem {
  return { num: null, seq, stem: '', transcript: null, options: { '1': '', '2': '', '3': '', '4': '' }, correct_answer: null, meta: null }
}

function emptyProblem(): DraftProblem {
  return { name: '問題', type: 'vocab_fill', instruction: null, passage: null, transcript: null, items: [emptyItem(1)] }
}

// ─── Item editor row ──────────────────────────────────────────────────────────

function ItemRow({
  item, onChange, onDelete, problemType,
}: {
  item: DraftItem
  onChange: (updated: DraftItem) => void
  onDelete: () => void
  problemType?: string
}) {
  const isSentenceOrder = problemType === 'sentence_order'
  const starPos = (item.meta as Record<string, unknown> | null)?.star_position as number | undefined

  function set<K extends keyof DraftItem>(key: K, value: DraftItem[K]) {
    onChange({ ...item, [key]: value })
  }
  function setOpt(k: string, v: string) {
    onChange({ ...item, options: { ...item.options, [k]: v } })
  }
  function setStarPos(pos: number) {
    // Demote existing stars; bare [_★_] (legacy) becomes [_pos_] so it can be promoted
    const withoutStar = item.stem
      .replace(/\[_(\d+)★_\]/g, '[_$1_]')
      .replace(/\[_★_\]/g, `[_${pos}_]`)
    const newStem = withoutStar.replace(new RegExp(`\\[_${pos}_\\]`), `[_${pos}★_]`)
    onChange({ ...item, stem: newStem, meta: { ...(item.meta ?? {}), star_position: pos } })
  }

  return (
    <div className="border border-border rounded-lg p-3 space-y-2 bg-bg text-sm">
      <div className="flex items-center gap-2">
        <label className="text-xs text-fg-muted w-6 shrink-0">Q</label>
        <input
          type="number"
          value={item.num ?? ''}
          onChange={e => set('num', e.target.value ? Number(e.target.value) : null)}
          placeholder="题号"
          className="w-14 border border-border rounded px-2 py-1 text-xs bg-surface"
        />
        <input
          value={item.stem}
          onChange={e => set('stem', e.target.value)}
          placeholder="题干（stem）"
          className="flex-1 border border-border rounded px-2 py-1 text-xs bg-surface"
        />
        <select
          value={item.correct_answer ?? ''}
          onChange={e => set('correct_answer', e.target.value || null)}
          className="w-16 border border-border rounded px-1 py-1 text-xs bg-surface"
        >
          <option value="">答</option>
          {['1', '2', '3', '4'].map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <button onClick={onDelete} className="text-fg-muted hover:text-danger transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5 pl-8">
        {(['1', '2', '3', '4'] as const).map(k => (
          <div key={k} className="flex items-center gap-1">
            <span className="text-xs text-fg-muted w-3">{k}.</span>
            <input
              value={item.options[k] ?? ''}
              onChange={e => setOpt(k, e.target.value)}
              placeholder={`选项${k}`}
              className="flex-1 border border-border rounded px-2 py-1 text-xs bg-surface"
            />
          </div>
        ))}
      </div>
      {isSentenceOrder && (
        <div className="flex items-center gap-2 pl-8 pt-1">
          <span className="text-xs text-fg-muted shrink-0">★ 位置：</span>
          {[1, 2, 3, 4].map(n => (
            <button
              key={n}
              onClick={() => setStarPos(n)}
              className={[
                'w-7 h-7 rounded text-xs font-bold transition-all',
                starPos === n
                  ? 'bg-accent text-white'
                  : 'bg-border/50 text-fg-muted hover:bg-border',
              ].join(' ')}
            >
              {starPos === n ? '★' : n}
            </button>
          ))}
        </div>
      )}
      {problemType === 'listening' && (
        <div className="pl-8 pt-1">
          <textarea
            value={item.transcript ?? ''}
            onChange={e => set('transcript', e.target.value || null)}
            rows={3}
            placeholder="聴解原文…"
            className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-surface resize-y"
          />
        </div>
      )}
    </div>
  )
}

// ─── Problem editor block ─────────────────────────────────────────────────────

function ProblemBlock({
  prob, onChange, onDelete, onImagePaste,
}: {
  prob: DraftProblem
  onChange: (updated: DraftProblem) => void
  onDelete: () => void
  onImagePaste: (probRef: DraftProblem, url: string) => void
}) {
  const isListening = prob.type === 'listening'
  const hasPassage = ['passage_fill', 'reading_comp', 'listening'].includes(prob.type)

  function set<K extends keyof DraftProblem>(key: K, val: DraftProblem[K]) {
    onChange({ ...prob, [key]: val })
  }

  function updateItem(idx: number, updated: DraftItem) {
    const items = [...prob.items]
    items[idx] = updated
    onChange({ ...prob, items })
  }

  function addItem() {
    onChange({ ...prob, items: [...prob.items, emptyItem(prob.items.length + 1)] })
  }

  function deleteItem(idx: number) {
    onChange({ ...prob, items: prob.items.filter((_, i) => i !== idx) })
  }

  const pasteZoneRef = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    const el = pasteZoneRef.current
    if (!el) return
    async function onPaste(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? [])
      const imgItem = items.find(i => i.type.startsWith('image/'))
      if (!imgItem) return
      e.preventDefault()
      const file = imgItem.getAsFile()
      if (!file) return
      setUploading(true)
      try {
        const { url } = await uploadMedia(file)
        onImagePaste(prob, url)
      } finally {
        setUploading(false)
      }
    }
    el.addEventListener('paste', onPaste)
    return () => el.removeEventListener('paste', onPaste)
  }, [prob, onImagePaste])

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-surface border-b border-border">
        <input
          value={prob.name}
          onChange={e => set('name', e.target.value)}
          className="w-20 border border-border rounded px-2 py-1 text-xs bg-bg font-semibold"
        />
        <select
          value={prob.type}
          onChange={e => set('type', e.target.value)}
          className="border border-border rounded px-2 py-1 text-xs bg-bg flex-1 max-w-44 font-medium text-accent"
        >
          {PROBLEM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          value={prob.instruction ?? ''}
          onChange={e => set('instruction', e.target.value || null)}
          placeholder="指示語（可选）"
          className="flex-1 border border-border rounded px-2 py-1 text-xs bg-bg"
        />
        <button onClick={onDelete} className="text-fg-muted hover:text-danger transition-colors shrink-0">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-4 py-3 space-y-3">
        {hasPassage && !isListening && (
          <div ref={pasteZoneRef} className="relative">
            <label className="text-[10px] font-semibold text-fg-muted uppercase tracking-wide mb-1 block">
              文章 <span className="font-normal text-fg-subtle">（Ctrl+V 粘贴图片）</span>
            </label>
            <textarea
              value={prob.passage ?? ''}
              onChange={e => set('passage', e.target.value || null)}
              rows={5}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg resize-y"
              placeholder="阅读文章…"
            />
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-surface/70 rounded-lg">
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          {prob.items.map((item, idx) => (
            <ItemRow
              key={idx}
              item={item}
              onChange={updated => updateItem(idx, updated)}
              onDelete={() => deleteItem(idx)}
              problemType={prob.type}
            />
          ))}
          <button
            onClick={addItem}
            className="flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            添加设问
          </button>
        </div>

      </div>
    </div>
  )
}

// ─── Main DraftEditor ─────────────────────────────────────────────────────────

export default function DraftEditor({
  draft,
  onSaved,
  onConfirmed,
}: {
  draft: DraftDetail
  onSaved: (updated: DraftDetail) => void
  onConfirmed: () => void
}) {
  const [json, setJson] = useState<DraftJson>(() => draft.draft_json ?? {
    title: '', level: 'N2', source: '',
    sections: [
      { name: '言語知識（文字・語彙）', problems: [] },
      { name: '言語知識（文法）', problems: [] },
      { name: '読解', problems: [] },
      { name: '聴解', problems: [] },
    ],
  })
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const answerFileRef = useRef<HTMLInputElement>(null)

  function setMeta<K extends keyof DraftJson>(key: K, val: DraftJson[K]) {
    setJson(j => ({ ...j, [key]: val }))
  }

  function updateProblems(secIdx: number, problems: DraftProblem[]) {
    setJson(j => {
      const sections = [...j.sections]
      sections[secIdx] = { ...sections[secIdx], problems }
      return { ...j, sections }
    })
  }

  function addProblem(secIdx: number) {
    const probs = [...json.sections[secIdx].problems, emptyProblem()]
    updateProblems(secIdx, probs)
  }

  function updateProblem(secIdx: number, probIdx: number, updated: DraftProblem) {
    const probs = [...json.sections[secIdx].problems]
    probs[probIdx] = updated
    updateProblems(secIdx, probs)
  }

  function deleteProblem(secIdx: number, probIdx: number) {
    const probs = json.sections[secIdx].problems.filter((_, i) => i !== probIdx)
    updateProblems(secIdx, probs)
  }

  const handleImagePaste = useCallback((_secIdx: number, _probIdx: number, _prob: DraftProblem, url: string) => {
    alert(`图片已上传：${url}\n（确认入库后可在后台关联至题目）`)
  }, [])

  async function handleImportAnswers(file: File) {
    setImporting(true)
    setError(null)
    try {
      const updated = await importAnswers(draft.id, file)
      setJson(updated.draft_json ?? json)
      onSaved(updated)
    } catch (e) {
      setError(`导入答案失败：${(e as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const updated = await updateDraft(draft.id, json)
      onSaved(updated)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleConfirm() {
    if (!json.title || !json.level) {
      setError('请填写试卷标题和级别')
      return
    }
    if (!confirm(`确认将「${json.title}（${json.level}）」入库？同名试卷将被替换。`)) return
    setConfirming(true)
    setError(null)
    try {
      await updateDraft(draft.id, json)
      await confirmDraft(draft.id)
      onConfirmed()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-5 py-3 border-b border-border bg-surface flex items-center gap-3 flex-wrap">
        <input
          value={json.title}
          onChange={e => setMeta('title', e.target.value)}
          placeholder="试卷标题"
          className="flex-1 min-w-40 border border-border rounded-lg px-3 py-1.5 text-sm bg-bg"
        />
        <select
          value={json.level}
          onChange={e => setMeta('level', e.target.value)}
          className="border border-border rounded-lg px-3 py-1.5 text-sm bg-bg"
        >
          {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <input
          value={json.source}
          onChange={e => setMeta('source', e.target.value)}
          placeholder="出典（例：2023年07月）"
          className="w-44 border border-border rounded-lg px-3 py-1.5 text-sm bg-bg"
        />
        <button
          onClick={() => answerFileRef.current?.click()}
          disabled={importing}
          title="上传答案 PDF（第一页）自动填入正确答案"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-border text-fg-muted hover:border-accent/50 hover:text-accent transition-colors disabled:opacity-40 shrink-0"
        >
          {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileKey className="w-3.5 h-3.5" />}
          {importing ? '导入中…' : '导入答案'}
        </button>
        <input
          ref={answerFileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) handleImportAnswers(f)
            e.target.value = ''
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
        {json.sections.map((sec, si) => (
          <div key={si}>
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs font-semibold text-fg-muted uppercase tracking-wide">{sec.name}</p>
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-fg-subtle">{sec.problems.length} 問題</span>
            </div>
            <div className="space-y-3">
              {sec.problems.map((prob, pi) => (
                <ProblemBlock
                  key={pi}
                  prob={prob}
                  onChange={updated => updateProblem(si, pi, updated)}
                  onDelete={() => deleteProblem(si, pi)}
                  onImagePaste={(_prob, url) => handleImagePaste(si, pi, _prob, url)}
                />
              ))}
              <button
                onClick={() => addProblem(si)}
                className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg border border-dashed border-border rounded-lg px-4 py-2 w-full justify-center transition-colors hover:border-accent/40"
              >
                <Plus className="w-3.5 h-3.5" />
                添加問題
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 px-5 py-3 border-t border-border bg-surface flex items-center gap-3">
        {error && <p className="flex-1 text-xs text-danger truncate">{error}</p>}
        {!error && <div className="flex-1" />}
        <button
          onClick={handleSave}
          disabled={saving || confirming}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm border border-border text-fg-muted hover:border-accent/50 hover:text-fg transition-colors disabled:opacity-40"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          保存草稿
        </button>
        <button
          onClick={handleConfirm}
          disabled={saving || confirming}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40 font-semibold"
        >
          {confirming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          确认入库
        </button>
      </div>
    </div>
  )
}
