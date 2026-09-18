import type { PreprocessResponse, TokenInfo } from '../types'

/**
 * Tokens covering the whole of `text`. /preprocess may split the text into
 * several sub-sentences (e.g. an AI-merged sentence or a multi-sentence
 * subtitle line); join all of them and re-insert the whitespace the splitter
 * stripped, so displayed tokens cover the full text and character offsets
 * stay aligned. Returns [] if the response doesn't line up with `text`.
 */
export function tokensFor(text: string, res: PreprocessResponse | null): TokenInfo[] {
  const tokens: TokenInfo[] = []
  let cursor = 0
  for (const s of res?.sentences ?? []) {
    const at = text.indexOf(s.text, cursor)
    if (at === -1) return []
    if (at > cursor) {
      const gap = text.slice(cursor, at)
      tokens.push({ surface: gap, base: gap, pos: '記号', reading: gap })
    }
    tokens.push(...s.tokens)
    cursor = at + s.text.length
  }
  return cursor > 0 && text.slice(cursor).trim() === '' ? tokens : []
}
