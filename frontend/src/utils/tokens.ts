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

const OPEN_BRACKETS = new Set(['「', '『', '（', '(', '《', '“'])
const INDEPENDENT_POS = new Set([
  '名詞', '動詞', '形容詞', '副詞', '連体詞', '接続詞', '感動詞', '接頭詞', 'フィラー',
])

/** Does `token` begin a new 文節 (bunsetsu), given the token before it? */
function startsChunk(token: TokenInfo, prev: TokenInfo | undefined): boolean {
  if (!prev) return true
  if (prev.pos === '接頭詞') return false
  if (prev.pos === '記号' && OPEN_BRACKETS.has(prev.surface)) return false
  if (token.pos === '記号') return OPEN_BRACKETS.has(token.surface)
  if (!INDEPENDENT_POS.has(token.pos)) return false          // 助詞・助動詞
  if (token.pos_detail === '非自立' || token.pos_detail === '接尾') return false  // 〜ている, 〜者
  if (token.pos === '名詞' && prev.pos === '名詞') return false                // compound nouns
  if (token.pos === '動詞' && token.base === 'する' && prev.pos === '名詞') return false  // 名詞＋する
  return true
}

/** Split tokens into 文節: each content word plus the function words after it. */
export function toChunks(tokens: TokenInfo[]): TokenInfo[][] {
  const chunks: TokenInfo[][] = []
  tokens.forEach((t, i) => {
    if (chunks.length === 0 || startsChunk(t, tokens[i - 1])) chunks.push([])
    chunks[chunks.length - 1].push(t)
  })
  return chunks
}

/** Grammatical glue shown de-emphasised: particles, auxiliaries, punctuation, 〜ている's いる. */
export function isFunctionToken(t: TokenInfo): boolean {
  return t.pos === '助詞' || t.pos === '助動詞' || t.pos === '記号'
    || (t.pos === '動詞' && t.pos_detail === '非自立')
}
