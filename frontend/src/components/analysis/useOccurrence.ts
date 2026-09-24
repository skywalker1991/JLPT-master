import { useContext } from 'react'
import { AskContext } from './AskPanel'
import type { CreateAtomRequest } from '../../types'

/**
 * The sentence the word is being added from, shaped for createAtom.
 *
 * The atom itself holds the dictionary form and its stable meaning; where the
 * word was met belongs to the encounter, not the word. Keeping them apart is
 * what stops a card reading 尊ぶ on the front and 受到尊重 — the meaning of
 * 尊ばれた — on the back.
 *
 * Spread into the request: `{ ...useOccurrence(surface) }`. Outside a sentence
 * (the knowledge base, an exam) it contributes nothing.
 */
export function useOccurrence(
  surface?: string | null,
  surfaceMeaning?: string | null,
): Pick<CreateAtomRequest, 'analysis_id' | 'occurrence'> {
  const ctx = useContext(AskContext)
  if (!ctx?.sentenceText) return {}
  return {
    analysis_id: ctx.analysisId,
    occurrence: {
      sentence_text: ctx.sentenceText,
      sentence_translation: ctx.sentenceTranslation,
      sentence_index: ctx.sentenceIndex,
      surface: surface ?? null,
      surface_meaning: surfaceMeaning ?? null,
    },
  }
}
