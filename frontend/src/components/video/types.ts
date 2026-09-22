import type { SubtitleEntry } from '../../services/api'
import type { PreprocessedSentence, SentenceAnalysis, TokenInfo, AskEntry } from '../../types'

export interface TokenTiming {
  token: TokenInfo
  start: number
  end: number
}

export interface SubtitleState {
  entry: SubtitleEntry
  preprocessed: PreprocessedSentence | null
  tokenTimings: TokenTiming[]
  analysis: SentenceAnalysis | null
  isAnalyzing: boolean
  /** Analysis record this line was analysed into — follow-ups attach to it */
  analysisId: string | null
  /** Follow-up questions asked about this line */
  asks: AskEntry[]
}
