import { useState, useCallback, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { Plus, Loader2, History, X } from 'lucide-react'
import { useAnalysis } from '../hooks/useAnalysis'
import { useSwipe } from '../hooks/useSwipe'
import SentenceList from '../components/analysis/SentenceList'
import SentenceCard from '../components/analysis/SentenceCard'
import AnalysisCard from '../components/analysis/AnalysisCard'
import AnalysisInput from '../components/analysis/AnalysisInput'
import AnalysisHistory from '../components/analysis/AnalysisHistory'
import ThemeToggle from '../components/shared/ThemeToggle'
import { getAnalyses, getAnalysis, deleteAnalysis } from '../services/api'
import type { AnalysisRecord } from '../types'
import clsx from 'clsx'

export default function AnalysisPage() {
  const { pathname } = useLocation()
  const isActive = pathname === '/'

  const {
    sentences, selectedIndex,
    isStreaming, phase, error,
    setSelectedIndex, startAnalysis, restoreFromHistory, reset,
  } = useAnalysis()

  const [draftText, setDraftText] = useState('')
  const [imageData, setImageData] = useState<string | null>(null)
  const [history, setHistory]     = useState<AnalysisRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const hasResults = sentences.length > 0 || isStreaming

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const records = await getAnalyses({ limit: 50, status: 'completed,in_progress' })
      setHistory(records)
    } catch { /* ignore */ } finally {
      setHistoryLoading(false)
    }
  }, [])

  // Load on mount, shortly after an analysis starts (shows it as 分析中)
  // and after it finishes
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
    startAnalysis(draftText, imageData ?? undefined)
  }

  const handleNew = () => {
    reset()
    setDraftText('')
    setImageData(null)
  }

  const handleRestoreHistory = async (record: AnalysisRecord) => {
    try {
      const full = await getAnalysis(record.id)
      restoreFromHistory(full)
    } catch {
      restoreFromHistory(record)
    }
    setHistoryOpen(false)
  }

  const handleDeleteHistory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await deleteAnalysis(id)
    setHistory(prev => prev.filter(r => r.id !== id))
  }

  const loadImage = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      const dataUrl = e.target?.result as string
      setImageData(dataUrl.split(',')[1])
      setDraftText('')
    }
    reader.readAsDataURL(file)
  }, [])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!isActive || isStreaming) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
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
  }, [isActive, isStreaming, loadImage])

  // Sentence switching: swipe on phones, dots / numbers everywhere.
  // slideDir picks the slide-in direction of the next sentence.
  const [slideDir, setSlideDir] = useState<0 | 1 | -1>(0)
  const slideRef = useRef<HTMLDivElement>(null)

  const selectSentence = useCallback((index: number) => {
    if (index === selectedIndex) return
    setSlideDir(selectedIndex === null || index > selectedIndex ? 1 : -1)
    setSelectedIndex(index)
  }, [selectedIndex, setSelectedIndex])

  const swipeAreaRef = useSwipe(dir => {
    const next = (selectedIndex ?? 0) + dir
    if (next < 0 || next >= sentences.length) return
    if (!sentences[next].preprocessed.text.trim()) return
    selectSentence(next)
  }, slideRef)

  const selectedSentence     = selectedIndex !== null ? sentences[selectedIndex] : null
  const selectedPreprocessed = selectedSentence?.preprocessed ?? null
  const selectedAnalysis     = selectedSentence?.analysis ?? null

  return (
    <div className="flex flex-1 min-h-0 p-2 md:p-4 gap-4 overflow-hidden">

      {/* ── Left: History sidebar (desktop) ── */}
      <div className="card hidden md:flex w-56 shrink-0 flex-col overflow-hidden">
        <div className="px-3 py-3 border-b border-border shrink-0">
          <button onClick={handleNew} className="btn-primary w-full gap-2 justify-center">
            <Plus className="w-4 h-4" />新建分析
          </button>
        </div>
        <AnalysisHistory
          history={history}
          loading={historyLoading}
          onSelect={handleRestoreHistory}
          onDelete={handleDeleteHistory}
        />
      </div>

      {/* ── Mobile history overlay ── */}
      {historyOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setHistoryOpen(false)} />
          <div className="relative bg-surface rounded-t-2xl flex flex-col max-h-[70vh] z-10">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="font-semibold text-sm text-fg">历史记录</span>
              <button onClick={() => setHistoryOpen(false)} className="p-1 rounded-lg hover:bg-gray-100 text-fg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            <AnalysisHistory
              history={history}
              loading={historyLoading}
              onSelect={handleRestoreHistory}
              onDelete={handleDeleteHistory}
            />
          </div>
        </div>
      )}

      {/* ── Main: Results + Input ── */}
      <div className="card flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
          <button onClick={handleNew} className="btn-primary gap-1.5 py-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" />新建
          </button>
          <button
            onClick={() => setHistoryOpen(true)}
            className="btn-ghost gap-1.5 py-1.5 text-xs"
          >
            <History className="w-3.5 h-3.5" />历史
          </button>
          <ThemeToggle className="ml-auto" />
        </div>

        {/* Results area */}
        {hasResults ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

            {/* Sentence nav */}
            <div className="border-b border-border shrink-0">
              <SentenceList
                sentences={sentences}
                selectedIndex={selectedIndex}
                isStreaming={isStreaming}
                onSelect={selectSentence}
              />
            </div>

            {/* Mobile: sentence + vocab/grammar scroll together so a long
                sentence can't squeeze the analysis to zero height.
                Desktop: sentence card stays pinned, analysis scrolls. */}
            <div
              ref={swipeAreaRef}
              className="flex-1 min-h-0 flex flex-col overflow-hidden"
            >
            <div
              key={selectedIndex ?? -1}
              ref={slideRef}
              // touch-action must sit on the scroll container itself: the browser
              // ignores it on ancestors above the nearest scroller
              style={{ touchAction: 'pan-y pinch-zoom' }}
              className={clsx(
                'flex-1 min-h-0 overflow-y-auto md:overflow-hidden md:flex md:flex-col md:animate-none',
                slideDir === 1 && 'animate-slide-from-right',
                slideDir === -1 && 'animate-slide-from-left',
              )}
            >
              {/* Sentence card */}
              {selectedPreprocessed && (
                <div className="px-3 md:px-6 pt-3 md:pt-4 pb-2 md:shrink-0">
                  <SentenceCard
                    preprocessed={selectedPreprocessed}
                    analysis={selectedAnalysis}
                  />
                </div>
              )}

              {/* Vocab + grammar */}
              <div className="px-3 md:px-6 pb-6 pt-2 md:flex-1 md:min-h-0 md:overflow-y-auto">
                <AnalysisCard
                  preprocessed={selectedPreprocessed}
                  analysis={selectedAnalysis}
                />
              </div>
            </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-fg-subtle text-sm">
            {isStreaming
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : '输入日语文本，开始分析'
            }
          </div>
        )}

        {/* Unified input — analysis / progress / followup */}
        <div className="border-t border-border shrink-0">
          <AnalysisInput
            text={draftText}
            imageData={imageData}
            isStreaming={isStreaming}
            hasResults={hasResults}
            phase={phase}
            error={error}
            onTextChange={setDraftText}
            onImageClear={() => setImageData(null)}
            onSubmit={handleAnalyze}
          />
        </div>
      </div>

    </div>
  )
}
