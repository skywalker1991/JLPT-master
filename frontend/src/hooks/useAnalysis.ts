import { useState, useCallback, useEffect, useRef } from 'react'
import type {
  SentenceAnalysis, InputType, PreprocessedSentence, AnalysisRecord, TokenInfo, AskEntry,
} from '../types'
import { preprocess, preprocessBatch, analyzeStream, getAnalysis } from '../services/api'
import { tokensFor } from '../utils/tokens'

export interface SentenceState {
  preprocessed: PreprocessedSentence
  analysis: SentenceAnalysis | null  // null = still streaming
}

export type AnalysisPhase = 'idle' | 'preprocessing' | 'extracting' | 'analyzing'

interface UseAnalysisReturn {
  inputType: InputType
  /** Current analysis record (null until the server has created it) */
  analysisId: string | null
  /** Saved questions & answers about this analysis's sentences / items */
  asks: AskEntry[]
  addAsk: (entry: AskEntry) => void
  sentences: SentenceState[]
  selectedIndex: number | null
  isStreaming: boolean
  phase: AnalysisPhase
  error: string | null
  setSelectedIndex: (index: number) => void
  startAnalysis: (text: string, imageBase64?: string) => Promise<void>
  restoreFromHistory: (record: AnalysisRecord) => void
  reset: () => void
}

/** Rough client-side split for immediate display before API responds */
function roughSplit(text: string): SentenceState[] {
  const parts = text.split(/(?<=[。！？!?\n])\s*/).filter(s => s.trim())
  const sentences = parts.length > 0 ? parts : [text.trim()]
  return sentences.map((t, i) => ({
    preprocessed: { index: i, text: t, tokens: [] },
    analysis: null,
  }))
}

// The analysis runs as a background job on the server. Remember the one in
// flight so it can be picked up again after the page was backgrounded or
// reloaded (mobile browsers suspend or kill background tabs).
const PENDING_KEY = 'jlpt:pendingAnalysis'
const POLL_MS = 2000

function savePending(id: string | null) {
  try {
    if (id) localStorage.setItem(PENDING_KEY, id)
    else localStorage.removeItem(PENDING_KEY)
  } catch { /* storage unavailable */ }
}

function loadPending(): string | null {
  try { return localStorage.getItem(PENDING_KEY) } catch { return null }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function recordAsks(record: AnalysisRecord): AskEntry[] {
  const data = record.session_data as { followups?: AskEntry[] } | null
  return (data?.followups ?? []).filter(f => f?.template === 'ask')
}

function recordSentences(record: AnalysisRecord): SentenceAnalysis[] {
  const data = record.session_data as { sentences?: SentenceAnalysis[] } | null
  return (data?.sentences ?? []).filter(s => s && typeof s.text === 'string')
}

export function useAnalysis(): UseAnalysisReturn {
  const [inputType]                        = useState<InputType>('text')
  const [sentences, setSentences]          = useState<SentenceState[]>([])
  const [selectedIndex, setSelectedIndex]  = useState<number | null>(null)
  const [isStreaming, setIsStreaming]      = useState(false)
  const [phase, setPhase]                  = useState<AnalysisPhase>('idle')
  const [error, setError]                  = useState<string | null>(null)
  const [analysisId, setAnalysisId]        = useState<string | null>(null)
  const [asks, setAsks]                    = useState<AskEntry[]>([])
  const addAsk = useCallback((entry: AskEntry) => setAsks(prev => [...prev, entry]), [])

  const streamAbortRef = useRef<AbortController | null>(null)  // live SSE stream
  const handoffRef     = useRef<AbortController | null>(null)  // stream aborted to switch to polling
  const followingRef   = useRef<string | null>(null)           // job being polled
  const tokenCache     = useRef(new Map<string, TokenInfo[]>())

  /** Tokenize (for furigana) any sentence that has no tokens yet. */
  const ensureTokens = useCallback(async (texts: string[]) => {
    const todo = [...new Set(texts)].filter(t => t.trim() && !tokenCache.current.has(t))
    if (todo.length > 0) {
      const results = await preprocessBatch(todo).catch(() => null)
      todo.forEach((t, i) => tokenCache.current.set(t, tokensFor(t, results?.[i] ?? null)))
    }
    setSentences(prev => prev.map(s => {
      if (s.preprocessed.tokens.length > 0) return s
      const tokens = tokenCache.current.get(s.preprocessed.text) ?? []
      return tokens.length > 0 ? { ...s, preprocessed: { ...s.preprocessed, tokens } } : s
    }))
  }, [])

  /**
   * Merge a (possibly partial) server record into the view. Text jobs key
   * sentences by source index; image jobs by position.
   */
  const applyRecord = useCallback((record: AnalysisRecord) => {
    setAsks(recordAsks(record))
    const list = recordSentences(record)
    const byIndex = record.input_type === 'text'
    setSentences(prev => {
      const updated = [...prev]
      list.forEach((s, pos) => {
        const slot = byIndex && Number.isInteger(s.index) ? s.index : pos
        const existing = updated[slot]?.preprocessed
        updated[slot] = {
          preprocessed: existing?.text === s.text
            ? existing
            : { index: slot, text: s.text, tokens: [] },
          analysis: s,
        }
      })
      for (let i = 0; i < updated.length; i++) {
        updated[i] ??= { preprocessed: { index: i, text: '', tokens: [] }, analysis: null }
      }
      return updated
    })
    if (list.length > 0) setSelectedIndex(i => i ?? 0)
    void ensureTokens(list.map(s => s.text))
  }, [ensureTokens])

  /** Stop streaming/polling the current analysis (the server job keeps running). */
  const stopActivity = useCallback(() => {
    const controller = streamAbortRef.current
    streamAbortRef.current = null
    controller?.abort()
    followingRef.current = null
  }, [])

  /** Poll a background job until it is no longer running. */
  const follow = useCallback(async (id: string) => {
    followingRef.current = id
    setIsStreaming(true)
    setPhase('analyzing')
    try {
      while (followingRef.current === id) {
        const record = await getAnalysis(id).catch(() => null)
        if (followingRef.current !== id) return
        if (record) {
          applyRecord(record)
          if (record.status !== 'in_progress') {
            if (record.status === 'interrupted') {
              setError('分析被中断（服务重启），已显示完成的部分')
            }
            break
          }
        }
        await sleep(POLL_MS)
      }
    } finally {
      if (followingRef.current === id) {
        followingRef.current = null
        savePending(null)
        setIsStreaming(false)
        setPhase('idle')
      }
    }
  }, [applyRecord])

  /** Show a running record (source sentences as placeholders) and follow its job. */
  const resume = useCallback(async (record: AnalysisRecord) => {
    stopActivity()
    setError(null)
    setSentences([])
    setSelectedIndex(null)
    if (record.input_type === 'text' && record.input_content) {
      const res = await preprocess(record.input_content).catch(() => null)
      if (res) setSentences(res.sentences.map(s => ({ preprocessed: s, analysis: null })))
    }
    savePending(record.id)
    setAnalysisId(record.id)
    applyRecord(record)
    await follow(record.id)
  }, [applyRecord, follow, stopActivity])

  const reset = useCallback(() => {
    stopActivity()
    savePending(null)
    setAnalysisId(null)
    setAsks([])
    setSentences([])
    setSelectedIndex(null)
    setError(null)
    setIsStreaming(false)
    setPhase('idle')
  }, [stopActivity])

  const restoreFromHistory = useCallback(async (record: AnalysisRecord) => {
    if (record.status === 'in_progress') {
      await resume(record)
      return
    }
    stopActivity()
    savePending(null)
    setAnalysisId(record.id)
    setAsks(recordAsks(record))
    const rawSentences = recordSentences(record)
    const restored: SentenceState[] = rawSentences.map((s, i) => ({
      preprocessed: { index: i, text: s.text, tokens: [] },
      analysis: s,
    }))
    setSentences(restored)
    setSelectedIndex(restored.length > 0 ? 0 : null)
    setError(null)
    setIsStreaming(false)
    setPhase('idle')
    void ensureTokens(rawSentences.map(s => s.text))
  }, [ensureTokens, resume, stopActivity])

  const startAnalysis = useCallback(async (text: string, imageBase64?: string) => {
    if (!imageBase64 && !text.trim()) return
    if (isStreaming) return

    stopActivity()
    setError(null)
    setAnalysisId(null)
    setAsks([])
    setSentences([])
    setSelectedIndex(null)
    setIsStreaming(true)

    if (!imageBase64) {
      // Text mode: immediate client-side split — left panel appears instantly
      setSentences(roughSplit(text))

      // Preprocess API — refines sentence boundaries & tokens
      setPhase('preprocessing')
      try {
        const res = await preprocess(text)
        setSentences(res.sentences.map(s => ({ preprocessed: s, analysis: null })))
        setSelectedIndex(0)
      } catch {
        // Keep rough split on preprocess failure
      }
    } else {
      setPhase('extracting')
    }

    // AI analysis stream. The job keeps running on the server even if this
    // connection drops; in that case we fall back to polling it.
    setPhase('analyzing')
    const controller = new AbortController()
    streamAbortRef.current = controller
    let analysisId: string | null = null
    try {
      const stream = analyzeStream(
        imageBase64 ? { image: imageBase64, type: 'image' } : { text, type: inputType },
        {
          signal: controller.signal,
          onStart: id => { analysisId = id; savePending(id); setAnalysisId(id) },
        },
      )

      let pos = 0
      for await (const sentenceAnalysis of stream) {
        // Text mode: the backend segments with the same preprocessor and keys
        // every result by sentence index, so place it by index (results may
        // arrive out of order when missing sentences are retried).
        // Image mode: sentences come from OCR, so append in arrival order.
        const slot = imageBase64 ? pos++ : sentenceAnalysis.index
        if (slot === 0) setSelectedIndex(0)
        setSentences(prev => {
          // In image mode the placeholder is at slot 0 — replace it first, then append
          const updated = [...prev]
          const existing = prev[slot]?.preprocessed
          updated[slot] = {
            preprocessed: existing?.text === sentenceAnalysis.text
              ? existing
              : { index: slot, text: sentenceAnalysis.text, tokens: [] },
            analysis: sentenceAnalysis,
          }
          // Fill any gap (only possible if the local split fell back to roughSplit)
          for (let i = 0; i < updated.length; i++) {
            updated[i] ??= { preprocessed: { index: i, text: '', tokens: [] }, analysis: null }
          }
          return updated
        })
      }
    } catch (err) {
      if (!analysisId && !controller.signal.aborted) {
        setError(err instanceof Error ? err.message : '分析失败')
      }
    }
    if (streamAbortRef.current === controller) streamAbortRef.current = null

    // Aborted by the user (new analysis / history / reset): nothing more to do.
    const cancelled = controller.signal.aborted && handoffRef.current !== controller
    if (handoffRef.current === controller) handoffRef.current = null
    if (cancelled) return

    if (analysisId) {
      // Stream finished or dropped: sync with the saved record (this also
      // tokenizes image-mode sentences) and keep polling while it runs.
      await follow(analysisId)
    } else {
      setIsStreaming(false)
      setPhase('idle')
    }
  }, [inputType, isStreaming, follow, stopActivity])

  // Returning to the page after it was hidden: a mobile browser has usually
  // frozen or dropped the stream, so abort it and poll the job instead.
  useEffect(() => {
    let wasHidden = false
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        wasHidden = true
      } else if (wasHidden) {
        wasHidden = false
        const controller = streamAbortRef.current
        if (controller) {
          streamAbortRef.current = null
          handoffRef.current = controller
          controller.abort()  // startAnalysis then follows the job
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // Page (re)loaded while an analysis was in flight: pick it up again.
  useEffect(() => {
    const id = loadPending()
    if (!id) return
    getAnalysis(id)
      .then(record => {
        if (record.status === 'in_progress') void resume(record)
        else void restoreFromHistory(record)
      })
      .catch(() => savePending(null))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    inputType, analysisId, asks, addAsk, sentences, selectedIndex,
    isStreaming, phase, error,
    setSelectedIndex, startAnalysis, restoreFromHistory, reset,
  }
}
