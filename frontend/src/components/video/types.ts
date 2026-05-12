import type { SubtitleEntry } from '../../services/api'
import type { PreprocessedSentence, SentenceAnalysis, TokenInfo } from '../../types'

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
}
