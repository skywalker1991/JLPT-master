import { useState, useCallback, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Check, ChevronLeft, ChevronRight, Loader2, Menu, Plus, X } from 'lucide-react'
import { useAnalysis } from '../hooks/useAnalysis'
import { useKnown } from '../hooks/useKnown'
import { useSettings } from '../context/SettingsContext'
import { useToast } from '../context/ToastContext'
import PassageReader from '../components/reader/PassageReader'
import ReaderToolbar from '../components/reader/ReaderToolbar'
import SentencePanel from '../components/analysis/SentencePanel'
import NewAnalysisBox from '../components/analysis/NewAnalysisBox'
import AnalysisHistory from '../components/analysis/AnalysisHistory'
import { AskContext } from '../components/analysis/AskPanel'
import { AskComposer, AskThread } from '../components/analysis/AskBox'
import type { AnalysisRecord, AskTarget } from '../types'
import type { Mark } from '../utils/marks'
import { getAnalyses, getAnalysis, deleteAnalysis, retrySentence, addRecitation, getRecitations } from '../services/api'
import { Thinking } from '../components/shared/Motion'

/**
 * 语料分析: paste a passage, read it whole with the gaps marked, pick a
 * sentence to see its translation, words and grammar, ask about it.
 */
export default function AnalysisPage() {
  const { pathname } = useLocation()
  const isActive = pathname === '/'
  const { settings } = useSettings()
  const { toast } = useToast()

  const {
    analysisId, asks, addAsk,
    sentences, selectedIndex,
    isStreaming, error,
    setSelectedIndex, startAnalysis, restoreFromHistory, reset, replaceSentence,
  } = useAnalysis()
  const { known, remember } = useKnown(sentences.map(s => s.analysis))

  const [draftText, setDraftText] = useState('')
  const [imageData, setImageData] = useState<string | null>(null)
  const [imageMime, setImageMime] = useState('image/png')
  const [history, setHistory] = useState<AnalysisRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [picked, setPicked] = useState<{ sentence: number; item: Mark['item'] } | null>(null)
  const [retrying, setRetrying] = useState<number | null>(null)
  const [reciting, setReciting] = useState<'no' | 'adding' | 'queued'>('no')
  const navigate = useNavigate()
  const { search } = useLocation()

  // Opened from elsewhere (背诵's 「回到语料重新学」): /?analysis=<id>
  useEffect(() => {
    const id = new URLSearchParams(search).get('analysis')
    if (!isActive || !id || id === analysisId) return
    getAnalysis(id).then(r => { restoreFromHistory(r); navigate('/', { replace: true }) }).catch(() => {})
  }, [isActive, search]) // eslint-disable-line react-hooks/exhaustive-deps

  // Whether this passage is already waiting in the 背诵 queue
  useEffect(() => {
    setReciting('no')
    if (!analysisId || isStreaming) return
    getRecitations().then(r => {
      if (r.queue.some(x => x.analysis_id === analysisId)) setReciting('queued')
    }).catch(() => {})
  }, [analysisId, isStreaming])

  const recite = async () => {
    if (!analysisId || reciting !== 'no') return
    setReciting('adding')
    try {
      await addRecitation(analysisId)
      setReciting('queued')
      toast('整段排进了背诵队列', 'success')
    } catch {
      setReciting('no')
      toast('没加上，请再试一次', 'error')
    }
  }

  const reciteButton = analysisId && !isStreaming && (
    reciting === 'queued' ? (
      <Link to="/internalize?recite=1" className="btn h-9 text-sm text-success-fg border border-success/40">
        <Check className="w-4 h-4" />在背诵队列里
      </Link>
    ) : (
      <button type="button" onClick={() => void recite()} disabled={reciting === 'adding'}
              className="btn h-9 text-sm border border-border text-fg hover:border-fg-subtle">
        {reciting === 'adding' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}要背
      </button>
    )
  )

  const hasResults = sentences.length > 0 || isStreaming
  const analysed = sentences.filter(s => s.analysis && !s.analysis.failed).length

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await getAnalyses({ limit: 50, status: 'completed,in_progress' }))
    } catch { /* keep what we have */ } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])
  useEffect(() => {
    if (isStreaming) {
      const t = setTimeout(loadHistory, 3000)
      return () => clearTimeout(t)
    }
    if (sentences.length > 0) loadHistory()
  }, [isStreaming]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyze = () => {
    if (isStreaming || (!imageData && !draftText.trim())) return
    startAnalysis(draftText, imageData ?? undefined, imageMime)
  }

  const handleNew = () => {
    reset()
    setDraftText('')
    setImageData(null)
    setSheetOpen(false)
    setHistoryOpen(false)
  }

  const handleRestoreHistory = async (record: AnalysisRecord) => {
    try {
      restoreFromHistory(await getAnalysis(record.id))
    } catch {
      restoreFromHistory(record)
    }
    setHistoryOpen(false)
    setSheetOpen(false)
  }

  const handleDeleteHistory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await deleteAnalysis(id)
    setHistory(prev => prev.filter(r => r.id !== id))
    if (id === analysisId) handleNew()
  }

  const loadImage = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const dataUrl = e.target?.result as string
      setImageData(dataUrl.split(',')[1])
      setImageMime(file.type || 'image/png')
      setDraftText('')
    }
    reader.readAsDataURL(file)
  }, [])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!isActive || isStreaming || hasResults) return
      for (const item of e.clipboardData?.items ?? []) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) loadImage(file)
          return
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [isActive, isStreaming, hasResults, loadImage])

  // What the follow-up question is about, besides the sentence itself
  const [attached, setAttached] = useState<AskTarget[]>([])
  const composerRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setAttached([]) }, [selectedIndex, analysisId])

  const select = (index: number) => {
    setSelectedIndex(index)
    setPicked(null)
    setSheetOpen(true)
  }

  const pickItem = (sentence: number, item: Mark['item']) => {
    setSelectedIndex(sentence)
    setPicked({ sentence, item })
    setSheetOpen(true)
  }

  const retry = async (index: number) => {
    if (!analysisId || retrying !== null) return
    setRetrying(index)
    try {
      replaceSentence(await retrySentence(analysisId, index))
    } catch (err) {
      toast(err instanceof Error ? err.message : '还是没分析出来，稍后再试', 'error')
    } finally {
      setRetrying(null)
    }
  }

  const selected = selectedIndex !== null ? sentences[selectedIndex] : null
  const panel = selected && selectedIndex !== null ? (tabs: boolean) => (
    <SentencePanel
      key={`${analysisId}-${selectedIndex}`}
      index={selectedIndex}
      text={selected.preprocessed.text}
      analysis={selected.analysis}
      streaming={isStreaming}
      threshold={settings.markLevel}
      known={known}
      remember={remember}
      picked={picked?.sentence === selectedIndex ? picked.item : null}
      retrying={retrying === selectedIndex}
      onRetry={() => void retry(selectedIndex)}
      tabs={tabs}
    />
  ) : null

  const historyList = (
    <AnalysisHistory history={history} loading={historyLoading}
                     onSelect={handleRestoreHistory} onDelete={handleDeleteHistory} />
  )

  const toolbar = <ReaderToolbar />

  const reader = (
    <PassageReader
      sentences={sentences.map(s => ({ text: s.preprocessed.text, tokens: s.preprocessed.tokens, analysis: s.analysis }))}
      selectedIndex={selectedIndex}
      onSelect={select}
      onPickItem={pickItem}
      threshold={settings.markLevel}
      known={known}
      furigana={!settings.hideFurigana}
      translations={settings.showTranslations}
      streaming={isStreaming}
      retrying={retrying}
      onRetry={i => void retry(i)}
    />
  )

  return (
    <AskContext.Provider value={{
      analysisId, sentenceIndex: selectedIndex,
      sentenceText: selected?.preprocessed.text ?? null,
      sentenceTranslation: selected?.analysis?.translation ?? null,
      asks, addAsk, busy: isStreaming, attached, setAttached, composerRef,
    }}>
    <div className="flex flex-1 min-h-0 overflow-hidden">

      {/* ── History (desktop) ── */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-accent-light/40">
        <div className="p-4 pb-2">
          <button type="button" onClick={handleNew}
                  className="btn w-full justify-center h-10 border border-border bg-surface text-fg font-semibold hover:border-fg-subtle">
            <Plus className="w-4 h-4" />新建分析
          </button>
        </div>
        <p className="px-4 pt-2 text-xs text-fg-subtle">最近</p>
        {historyList}
      </aside>

      {/* ── History (phone) ── */}
      {historyOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setHistoryOpen(false)} />
          <div className="relative w-[82%] max-w-xs bg-surface flex flex-col animate-drawer-in"
               style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center justify-between px-4 h-14 border-b border-border">
              <span className="font-semibold text-fg">最近的语料</span>
              <button type="button" onClick={() => setHistoryOpen(false)} aria-label="关闭" className="p-2 -mr-2 text-fg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>
            {historyList}
          </div>
        </div>
      )}

      {/* ── Passage ── */}
      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        <header className="md:hidden h-14 shrink-0 flex items-center gap-2 px-1 border-b border-border">
          <button type="button" onClick={() => setHistoryOpen(true)} aria-label="最近的语料" className="w-11 h-11 flex items-center justify-center text-fg">
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-semibold text-fg">语料分析</span>
          {hasResults && (
            <>
              <span className="ml-auto">{reciteButton}</span>
              <button type="button" onClick={handleNew} aria-label="新建分析" className="w-11 h-11 flex items-center justify-center text-fg">
                <Plus className="w-5 h-5" />
              </button>
            </>
          )}
        </header>

        {!hasResults ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <NewAnalysisBox
              text={draftText} imageData={imageData} imageMime={imageMime} error={error}
              firstUse={!historyLoading && history.length === 0}
              onTextChange={setDraftText} onImagePick={loadImage}
              onImageClear={() => setImageData(null)} onSubmit={handleAnalyze}
            />
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-5 md:px-10 py-5 md:py-8 flex flex-col gap-5">
                <div className="hidden md:flex items-baseline gap-3">
                  <h2 className="text-2xl font-bold text-fg">原文</h2>
                  <span className="text-sm text-fg-muted tabular-nums">
                    {sentences.length} 句{isStreaming && ` · 已分析 ${analysed} 句`}
                  </span>
                  {isStreaming ? (
                    <span className="ml-auto flex items-center gap-2 text-sm text-fg-muted">
                      <Thinking className="w-4 h-4" />还在分析，先读着
                    </span>
                  ) : <span className="ml-auto">{reciteButton}</span>}
                </div>
                {isStreaming && sentences.length > 0 && (
                  <div className="h-1 rounded-full bg-border overflow-hidden" role="progressbar"
                       aria-valuenow={analysed} aria-valuemax={sentences.length} aria-label="分析进度">
                    <div className="h-full bg-fg transition-[width] duration-500" style={{ width: `${(analysed / sentences.length) * 100}%` }} />
                  </div>
                )}
                {toolbar}
                {reader}
                <div className="hidden md:block"><AskThread /></div>
              </div>
            </div>
            <div className="hidden md:block shrink-0 px-10 pb-5 pt-2">
              <div className="max-w-3xl mx-auto"><AskComposer /></div>
            </div>
          </>
        )}
      </main>

      {/* ── Selected sentence (desktop) ── */}
      {hasResults && (
        <aside className="hidden md:block w-[26rem] shrink-0 border-l border-border overflow-y-auto">
          <div className="px-6 py-7">
            {panel ? panel(false) : <p className="text-sm text-fg-subtle">点左边的一句，这里显示它的译文、词和语法</p>}
          </div>
        </aside>
      )}

      {/* ── Selected sentence (phone): bottom sheet ── */}
      {hasResults && sheetOpen && panel && selectedIndex !== null && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setSheetOpen(false)} />
          <div className="relative bg-surface rounded-t-2xl max-h-[85dvh] flex flex-col animate-sheet-up"
               style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <button type="button" onClick={() => setSheetOpen(false)} aria-label="收起"
                    className="mx-auto mt-2 mb-1 w-12 h-1.5 rounded-full bg-border shrink-0" />
            <div className="flex items-center justify-between px-4 pt-1 shrink-0">
              <button type="button" aria-label="上一句" disabled={selectedIndex === 0}
                      onClick={() => select(selectedIndex - 1)}
                      className="w-11 h-11 rounded-xl border border-border flex items-center justify-center disabled:opacity-30">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-xs text-fg-subtle tabular-nums">第 {selectedIndex + 1} / {sentences.length} 句</span>
              <button type="button" aria-label="下一句" disabled={selectedIndex >= sentences.length - 1}
                      onClick={() => select(selectedIndex + 1)}
                      className="w-11 h-11 rounded-xl border border-border flex items-center justify-center disabled:opacity-30">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            <div className={clsx('flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4 flex flex-col gap-4')}>
              {panel(true)}
              <AskThread />
            </div>
            <div className="shrink-0 px-4 pb-3 pt-2 border-t border-border">
              <AskComposer />
            </div>
          </div>
        </div>
      )}
    </div>
    </AskContext.Provider>
  )
}
