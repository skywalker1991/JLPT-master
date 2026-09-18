import { useState, useCallback } from 'react'
import type {
  SentenceAnalysis, InputType, PreprocessedSentence, AnalysisRecord,
} from '../types'
import { preprocess, analyzeStream } from '../services/api'
import { tokensFor } from '../utils/tokens'

export interface SentenceState {
  preprocessed: PreprocessedSentence
  analysis: SentenceAnalysis | null  // null = still streaming
}

export type AnalysisPhase = 'idle' | 'preprocessing' | 'extracting' | 'analyzing'

interface UseAnalysisReturn {
  inputType: InputType
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

export function useAnalysis(): UseAnalysisReturn {
  const [inputType]                        = useState<InputType>('text')
  const [sentences, setSentences]          = useState<SentenceState[]>([])
  const [selectedIndex, setSelectedIndex]  = useState<number | null>(null)
  const [isStreaming, setIsStreaming]      = useState(false)
  const [phase, setPhase]                  = useState<AnalysisPhase>('idle')
  const [error, setError]                  = useState<string | null>(null)

  const reset = useCallback(() => {
    setSentences([])
    setSelectedIndex(null)
    setError(null)
    setIsStreaming(false)
    setPhase('idle')
  }, [])

  const restoreFromHistory = useCallback(async (record: AnalysisRecord) => {
    const data = record.session_data as { sentences?: SentenceAnalysis[] } | null
    const rawSentences = data?.sentences ?? []
    const restored: SentenceState[] = rawSentences.map((s, i) => ({
      preprocessed: { index: i, text: s.text, tokens: [] },
      analysis: s,
    }))
    setSentences(restored)
    setSelectedIndex(restored.length > 0 ? 0 : null)
    setError(null)
    setIsStreaming(false)
    setPhase('idle')

    // Tokenize sentences in background
    if (rawSentences.length > 0) {
      const tokenized = await Promise.all(
        rawSentences.map(s => preprocess(s.text).catch(() => null))
      )
      setSentences(prev => prev.map((s, i) => {
        const tokens = tokensFor(s.preprocessed.text, tokenized[i])
        if (tokens.length === 0) return s
        return { ...s, preprocessed: { ...s.preprocessed, tokens } }
      }))
    }
  }, [])

  const startAnalysis = useCallback(async (text: string, imageBase64?: string) => {
    if (!imageBase64 && !text.trim()) return
    if (isStreaming) return

    setError(null)
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

    // AI analysis stream
    setPhase('analyzing')
    try {
      const stream = imageBase64
        ? analyzeStream({ image: imageBase64, type: 'image' })
        : analyzeStream({ text, type: inputType })

      let pos = 0
      const imageSentenceTexts: string[] = []
      for await (const sentenceAnalysis of stream) {
        // Text mode: the backend segments with the same preprocessor and keys
        // every result by sentence index, so place it by index (results may
        // arrive out of order when missing sentences are retried).
        // Image mode: sentences come from OCR, so append in arrival order.
        const slot = imageBase64 ? pos++ : sentenceAnalysis.index
        if (slot === 0) setSelectedIndex(0)
        if (imageBase64) imageSentenceTexts[slot] = sentenceAnalysis.text
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

      // For image mode: tokenize each sentence after streaming completes
      if (imageBase64 && imageSentenceTexts.length > 0) {
        const tokenized = await Promise.all(
          imageSentenceTexts.map(t => preprocess(t).catch(() => null))
        )
        setSentences(prev => prev.map((s, i) => {
          const tokens = tokensFor(s.preprocessed.text, tokenized[i])
          if (tokens.length === 0) return s
          return { ...s, preprocessed: { ...s.preprocessed, tokens } }
        }))
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : '分析失败')
    } finally {
      setIsStreaming(false)
      setPhase('idle')
    }
  }, [inputType, isStreaming])

  return {
    inputType, sentences, selectedIndex,
    isStreaming, phase, error,
    setSelectedIndex, startAnalysis, restoreFromHistory, reset,
  }
}
