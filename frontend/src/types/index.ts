// Analysis
export interface TokenInfo {
  surface: string
  base: string
  pos: string
  reading: string
}

export interface PreprocessedSentence {
  index: number
  text: string
  tokens: TokenInfo[]
}

export interface PreprocessResponse {
  sentences: PreprocessedSentence[]
}

export interface AnalyzeRequest {
  text?: string
  image?: string
  type: string
}

export interface VocabItem {
  surface: string
  base: string
  reading: string | null
  meaning: string
  part_of_speech: string | null
  jlpt_level: string | null
  register: string | null
  usage: string | null
  nuance: string | null
  example: string | null
}

export interface GrammarItem {
  pattern: string
  meaning: string
  connection: string | null
  jlpt_level: string | null
  register: string | null
  usage: string | null
  nuance: string | null
  example: string | null
}

export interface SentenceAnalysis {
  index: number
  text: string
  translation: string
  vocab: VocabItem[]
  grammar: GrammarItem[]
}

// Atoms
export interface PropertyResponse {
  id: string
  kind: string
  value: string
  source_type: string
  source_ref: string | null
  created_at: string
}

export interface RelationResponse {
  id: string
  target: { id: string; type: string; key: string }
  type: string
  note: Record<string, unknown> | null
  direction: 'from' | 'to'
  created_at: string
}

export interface AtomListItem {
  id: string
  type: string
  key: string
  property_count: number
  relation_count: number
  maturity: number
  created_at: string
  reading?: string | null
  meaning?: string | null
  part_of_speech?: string | null
  example?: string | null
  usage?: string | null
  jlpt_level?: string | null
  tags?: string[]
}

export interface AtomDetail {
  atom: { id: string; type: string; key: string; created_at: string }
  properties: PropertyResponse[]
  relations: RelationResponse[]
  analyses: { id: string; input_type: string; created_at: string }[]
  traces_summary: { added_at: string; duplicate_count: number; property_count: number }
}

export interface CreateAtomRequest {
  type: string
  key: string
  properties?: { kind: string; value: string; source_type?: string }[]
  force_create?: boolean
}

export interface CreateAtomResponse {
  atom_id: string | null
  status: 'created' | 'exists' | 'similar'
  existing_properties?: PropertyResponse[]
  candidates?: { atom_id: string; key: string; meaning: string | null; score: number }[]
}

export interface AddPropertiesRequest {
  properties: { kind: string; value: string; source_type?: string; source_ref?: string }[]
}

export interface CreateRelationRequest {
  target_atom_id: string
  type: string
  note?: Record<string, unknown>
}

export interface AnalysisRecord {
  id: string
  input_type: string
  input_content: string
  status: string
  session_data: unknown
  created_at: string
}

// Input types — must match backend values
export type InputType =
  | 'text'
  | 'jlpt_grammar'
  | 'jlpt_ordering'
  | 'jlpt_reading'
  | 'jlpt_listening'

export const INPUT_TYPE_LABELS: Record<InputType, string> = {
  text: '自由文本',
  jlpt_grammar: 'JLPT语法',
  jlpt_ordering: 'JLPT排序',
  jlpt_reading: 'JLPT阅读',
  jlpt_listening: 'JLPT听力',
}

// Exam — 4-layer schema: Paper → Section → Problem → Item

export interface ExamMediaItem {
  id: string
  url: string
  caption: string | null
  seq: number
}

export interface ItemSchema {
  id: string
  seq: number
  num: number | null
  stem: string
  transcript: string | null
  options: Record<string, string>
  meta: Record<string, unknown> | null
}

export interface ProblemDetail {
  id: string
  seq: number
  name: string
  type: string
  instruction: string | null
  passage: string | null
  transcript: string | null
  media: ExamMediaItem[]
  items: ItemSchema[]
}

export interface SectionDetail {
  id: string
  name: string
  seq: number
  problems: ProblemDetail[]
}

export interface ExamPaperList {
  id: string
  title: string
  level: string
  source: string | null
  section_count: number
  item_count: number
  created_at: string
}

export interface ExamPaperDetail {
  id: string
  title: string
  level: string
  source: string | null
  sections: SectionDetail[]
  created_at: string
}

export interface AttemptStatus {
  attempt_id: string
  paper_id: string
  status: string
  score: Record<string, { correct: number; total: number }> | null
  answered_item_ids: string[]
}

export interface SectionAnswerDetail {
  item_id: string
  user_answer: string | null
  is_correct: boolean
  correct_answer: string | null
}

export interface SubmitSectionResponse {
  section_name: string
  score: { correct: number; total: number }
  answers: SectionAnswerDetail[]
}

export interface RelationSuggestion {
  from_key: string
  to_key: string
  type: string
  note: string
}

export interface QuestionAnalysisResponse {
  item_id: string
  session_data: Record<string, unknown> | null
  relations_suggested: RelationSuggestion[]
  cached: boolean
}

export interface CategoryAccuracy {
  correct: number
  total: number
}

export interface AccuracyStats {
  vocab: CategoryAccuracy
  grammar: CategoryAccuracy
  reading: CategoryAccuracy
  listening: CategoryAccuracy
}

export interface AttemptSummary {
  attempt_id: string
  paper_id: string
  status: string
  score: Record<string, { correct: number; total: number }> | null
  started_at: string
  completed_at: string | null
  section_names: string[]
}

// Review types (returned after section submit + getAttemptReview)
export interface ReviewItem {
  id: string
  seq: number
  num: number | null
  stem: string
  options: Record<string, string>
  meta: Record<string, unknown> | null
  user_answer: string | null
  correct_answer: string | null
  is_correct: boolean | null
}

export interface ReviewProblem {
  id: string
  seq: number
  name: string
  type: string
  instruction: string | null
  passage: string | null
  transcript: string | null
  media: ExamMediaItem[]
  items: ReviewItem[]
}

export interface ReviewSection {
  id: string
  name: string
  seq: number
  problems: ReviewProblem[]
}

export interface AttemptReviewData {
  attempt_id: string
  paper_id: string
  status: string
  score: Record<string, { correct: number; total: number }> | null
  started_at: string
  completed_at: string | null
  sections: ReviewSection[]
}

// Admin draft types
export interface DraftItem {
  num: number | null
  seq: number
  stem: string
  transcript: string | null
  options: Record<string, string>
  correct_answer: string | null
  meta: Record<string, unknown> | null
}

export interface DraftProblem {
  name: string
  type: string
  instruction: string | null
  passage: string | null
  transcript: string | null
  items: DraftItem[]
}

export interface DraftSection {
  name: string
  problems: DraftProblem[]
}

export interface DraftJson {
  title: string
  level: string
  source: string
  sections: DraftSection[]
}

export interface DraftSummary {
  id: string
  filename: string | null
  status: string
  paper_id: string | null
  created_at: string
  updated_at: string
}

export interface DraftDetail {
  id: string
  filename: string | null
  markdown_raw: string | null
  draft_json: DraftJson | null
  status: string
  paper_id: string | null
  created_at: string
  updated_at: string
}

// Internalize
export interface InternalizeProperty {
  kind: string
  value: string
}

export interface InternalizeCard {
  id: string
  type: 'vocabulary' | 'grammar'
  key: string
  jlpt_level: 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | null
  prompt_value: string | null
  properties: InternalizeProperty[]
}

export interface InternalizeQueueResponse {
  cards: InternalizeCard[]
}

export type SwipeResult = 'know' | 'unknown'

export interface InfiniteConfig {
  promptMode: 'meaning' | 'reading'
  levels: string[]  // empty = all levels
}

export interface InternalizeStats {
  today: { know: number; unknown: number; total: number }
  total: { know: number; unknown: number; mastery_pct: number }
  distribution: {
    box0: number; box1: number; box2: number
    box3: number; box4: number; box5: number
  }
}

// Knowledge graph
export interface GraphNode {
  id: string
  key: string
  type: string
  jlpt: string | null
  pos: string | null
}

export interface GraphEdge {
  from_id: string
  to_id: string
  type: string
}

export interface AtomGraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
