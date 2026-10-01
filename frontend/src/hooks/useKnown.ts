import { useCallback, useEffect, useRef, useState } from 'react'
import type { SentenceAnalysis } from '../types'
import { lookupAtoms } from '../services/api'
import { grammarKey, vocabKey, type Known } from '../utils/marks'

const EMPTY: Known = { vocab: {}, grammar: {} }

/**
 * Which of a passage's words and grammar points are already in the library.
 * Asks once per new key as sentences arrive, and learns from adds made on
 * this page (`remember`) without asking again.
 */
export function useKnown(analyses: (SentenceAnalysis | null)[]) {
  const [known, setKnown] = useState<Known>(EMPTY)
  const asked = useRef({ vocab: new Set<string>(), grammar: new Set<string>() })

  const vocab = analyses.flatMap(a => a?.vocab.map(vocabKey) ?? [])
  const grammar = analyses.flatMap(a => a?.grammar.map(grammarKey) ?? [])
  const signature = `${vocab.join('|')}#${grammar.join('|')}`

  useEffect(() => {
    const v = [...new Set(vocab)].filter(k => k && !asked.current.vocab.has(k))
    const g = [...new Set(grammar)].filter(k => k && !asked.current.grammar.has(k))
    if (v.length === 0 && g.length === 0) return
    const t = setTimeout(() => {
      v.forEach(k => asked.current.vocab.add(k))
      g.forEach(k => asked.current.grammar.add(k))
      lookupAtoms(v, g)
        .then(found => setKnown(prev => ({
          vocab: { ...prev.vocab, ...found.vocab },
          grammar: { ...prev.grammar, ...found.grammar },
        })))
        .catch(() => {
          // Ask again next time rather than showing everything as new for good
          v.forEach(k => asked.current.vocab.delete(k))
          g.forEach(k => asked.current.grammar.delete(k))
        })
    }, 250)
    return () => clearTimeout(t)
  }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  const remember = useCallback((type: 'vocab' | 'grammar', key: string, atomId: string) => {
    setKnown(prev => ({ ...prev, [type]: { ...prev[type], [key]: atomId } }))
  }, [])

  return { known, remember }
}
