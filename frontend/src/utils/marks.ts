import type { GrammarItem, SentenceAnalysis, VocabItem } from '../types'
import type { MarkLevel } from '../context/SettingsContext'

/**
 * Where the reader draws its lines under a sentence.
 *
 *   new     — a word at or above the chosen level, not in the library: a gap
 *   known   — a word already in the library: a thin grey line
 *   grammar — a grammar point (each piece of it, for split patterns): dashed
 *
 * Positions are character offsets into the sentence text. Words win over
 * grammar where they overlap, and nothing is drawn twice.
 */
export type MarkKind = 'new' | 'known' | 'grammar'

export interface Mark {
  start: number
  end: number
  kind: MarkKind
  item: { type: 'vocab' | 'grammar'; index: number }
}

export interface Known {
  vocab: Record<string, string>
  grammar: Record<string, string>
}

const ORDER = ['N1', 'N2', 'N3', 'N4', 'N5']

/** Is this level at or above the threshold? (N1 is the hardest.) Unknown levels count. */
export function atLevel(level: string | null | undefined, threshold: MarkLevel): boolean {
  if (threshold === 'all' || !level) return true
  const at = ORDER.indexOf(level.toUpperCase())
  return at === -1 || at <= ORDER.indexOf(threshold)
}

export const vocabKey = (v: VocabItem) => (v.base || v.surface).trim()
export const grammarKey = (g: GrammarItem) => g.pattern.trim()

/** Is this item one the reader should show up front, rather than folded away? */
export function isShown(item: VocabItem | GrammarItem, kind: 'vocab' | 'grammar', threshold: MarkLevel, known: Known) {
  const inLibrary = kind === 'vocab'
    ? !!known.vocab[vocabKey(item as VocabItem)]
    : !!known.grammar[grammarKey(item as GrammarItem)]
  return inLibrary || atLevel(item.jlpt_level, threshold)
}

// Placeholders a pattern uses for the slot it attaches to — not text to find.
const SLOT = /[詞形]|^[A-ZＡ-Ｚ]+$|普通|辞書|連用|未然|仮定|意向|語幹|名詞|数量/

/** The literal pieces of a grammar pattern that can be found in a sentence:
 *  「〜てみると」→ ["てみると"], 「決して〜ない」→ ["決して", "ない"]. */
export function grammarPieces(pattern: string): string[] {
  return pattern
    .split(/[〜～~…・/／（）()＋+\s,，、]+|\.{2,}/)
    .map(p => p.trim())
    .filter(p => p.length >= 2 && !SLOT.test(p))
}

function claim(taken: boolean[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) if (taken[i]) return false
  for (let i = start; i < end; i++) taken[i] = true
  return true
}

/** Find `needle` in `text` at a position not yet claimed. */
function place(text: string, needle: string, taken: boolean[]): number {
  let from = 0
  while (needle) {
    const at = text.indexOf(needle, from)
    if (at === -1) return -1
    if (claim(taken, at, at + needle.length)) return at
    from = at + 1
  }
  return -1
}

export function marksFor(
  text: string, analysis: SentenceAnalysis | null, threshold: MarkLevel, known: Known,
): Mark[] {
  if (!analysis) return []
  const taken = new Array<boolean>(text.length).fill(false)
  const marks: Mark[] = []

  analysis.vocab.forEach((v, index) => {
    const inLibrary = !!known.vocab[vocabKey(v)]
    if (!inLibrary && !atLevel(v.jlpt_level, threshold)) return
    const needle = text.includes(v.surface) ? v.surface : v.base
    const at = place(text, needle, taken)
    if (at === -1) return
    marks.push({ start: at, end: at + needle.length, kind: inLibrary ? 'known' : 'new', item: { type: 'vocab', index } })
  })

  analysis.grammar.forEach((g, index) => {
    if (!isShown(g, 'grammar', threshold, known)) return
    for (const piece of grammarPieces(g.pattern)) {
      // A word may already cover part of it (聞いて in 聞いてみると):
      // the grammar line runs under the rest.
      const at = text.indexOf(piece)
      if (at === -1) continue
      let runStart = -1
      for (let i = at; i <= at + piece.length; i++) {
        const free = i < at + piece.length && !taken[i]
        if (free && runStart === -1) runStart = i
        if (!free && runStart !== -1) {
          marks.push({ start: runStart, end: i, kind: 'grammar', item: { type: 'grammar', index } })
          runStart = -1
        }
        if (free) taken[i] = true
      }
    }
  })

  return marks.sort((a, b) => a.start - b.start)
}
