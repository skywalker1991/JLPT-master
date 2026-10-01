// Analysis
export interface TokenInfo {
  surface: string
  base: string
  pos: string
  reading: string
  /** Janome POS subcategory, e.g. 非自立 / 接尾 (absent on older data) */
  pos_detail?: string
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
  image_mime?: string
  type: string
}

export interface VocabItem {
  surface: string
  base: string
  reading: string | null
  /** The dictionary form's own meaning — not what the inflected form meant here */
  meaning: string
  surface_meaning?: string | null
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
  /** The model gave nothing back for this sentence; it can be retried alone */
  failed?: boolean
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
  occurrences: {
    id: string
    analysis_id: string | null
    sentence_index: number | null
    surface: string | null
    surface_meaning: string | null
    sentence_text: string
    sentence_translation: string | null
    created_at: string
  }[]
  traces_summary: { added_at: string; duplicate_count: number; property_count: number }
}

export interface OccurrenceInput {
  sentence_text: string
  sentence_translation?: string | null
  sentence_index?: number | null
  /** The form the word took in the text, e.g. 尊ばれた */
  surface?: string | null
  /** What it meant there, e.g. 受到尊重 — kept apart from the atom's own meaning */
  surface_meaning?: string | null
}

export interface CreateAtomRequest {
  type: string
  key: string
  properties?: { kind: string; value: string; source_type?: string }[]
  analysis_id?: string | null
  occurrence?: OccurrenceInput
  force_create?: boolean
}

export interface CreateAtomResponse {
  atom_id: string | null
  /** similar: grammar close in meaning; other_spelling: the same word written differently */
  status: 'created' | 'exists' | 'similar' | 'other_spelling'
  existing_properties?: PropertyResponse[]
  candidates?: { atom_id: string; key: string; meaning: string | null; score: number; reading?: string | null }[]
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
  /** Set only where the 問題 holds several texts and this question is about
   *  one of them; otherwise the 問題's own passage is the one to show. */
  passage: string | null
  options: Record<string, string>
  meta: Record<string, unknown> | null
  /** Null from `/api/exams` by design — answering is not told the answer.
   *  `/api/admin/papers` fills these in for the bank's editor. */
  correct_answer?: string | null
  answer_order?: string | null
  /** Where it was read from, so the page can be opened rather than hunted. */
  source_file?: string | null
  source_page?: number | null
  /** 聴解 only: where the dialogue and its answer were read. */
  script_file?: string | null
  script_page?: number | null
  /** What each source said, keyed by the file it came from. */
  answer_votes?: Record<string, string> | null
  /** 已核对 | 多源一致 | 单源 | 无答案 */
  confidence?: string | null
  /** A picture standing in for this question's passage, where the text of
   *  it could not be read — a page set in columns. Empty otherwise. */
  media?: ExamMediaItem[]
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
  /** The 問題 this run set out to cover; empty for runs recorded before a run
   *  stated its range. */
  problem_names: string[]
  /** Answered so far, and how many the chosen range holds. */
  answered: number
  in_scope: number | null
}

/** A question answered wrongly, gathered across records. */
export interface MistakeItem {
  item_id: string
  problem_id: string
  paper_title: string
  problem_name: string
  problem_type: string
  category: string
  num: number | null
  stem: string
  options: Record<string, string>
  correct_answer: string | null
  /** The wrong options actually picked, across records. */
  wrong_answers: string[]
  wrong_count: number
  seen_count: number
  last_seen: string
  has_analysis: boolean
}

// Review types (returned after section submit + getAttemptReview)
export interface ReviewItem {
  id: string
  seq: number
  num: number | null
  stem: string
  passage: string | null
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
  passage?: string | null
  options: Record<string, string>
  correct_answer: string | null
  answer_order?: string | null
  meta: Record<string, unknown> | null
  /** What each source said, keyed by the file it came from. */
  votes?: Record<string, string> | null
  /** Which file and page it was read from. */
  provenance?: { source?: string | null; page?: number | null } | null
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

export interface CanonicalItem {
  num: number | null
  seq: number
  stem: string
  options: Record<string, string>
  correct_answer: string | null
  answer_order: string | null
  transcript: string | null
  /** Set only where the 問題 holds several texts and this question is about
   *  one of them; otherwise the 問題's own passage is the one to show. */
  passage: string | null
  meta: Record<string, unknown>
  /** What each source said about the answer, keyed by the file it came from.
   *  The evidence, so the draft can be reviewed against it rather than on
   *  trust — this is the moment the question is still open. */
  votes?: Record<string, string> | null
  /** Which file and page it was read from. */
  provenance?: { source?: string | null; page?: number | null } | null
  /** 聴解 only: where the dialogue and its answer were read. */
  script?: { source?: string | null; page?: number | null } | null
}

export interface CanonicalProblem {
  name: string
  type: string
  seq: number
  instruction: string | null
  passage: string | null
  passage_translation: string | null
  items: CanonicalItem[]
}

export interface CanonicalPaper {
  level: string
  title: string
  source: string | null
  sections: { name: string; seq: number; problems: CanonicalProblem[] }[]
  gaps: string[]
}

export interface IngestReport {
  sources: { filename: string; role: string; pages: number; text_pages: number }[]
  gaps: string[]
  hard: { where: string; message: string; problem?: string | null }[]
  soft: { where: string; message: string }[]
  invented: string[]
  answers: { method?: string; agreed?: boolean | null; answered?: number; unanswered?: number; orders?: number }
  notes: string[]
}

export interface DraftSourceInfo {
  filename: string
  role: string
  page_count: number
  text_pages: number
}

export interface DraftDetail {
  id: string
  filename: string | null
  markdown_raw: string | null
  draft_json: DraftJson | null
  canonical: CanonicalPaper | null
  report: IngestReport | null
  sources: DraftSourceInfo[]
  status: string
  paper_id: string | null
  created_at: string
  updated_at: string
}

// Review (内化学习)
export interface ReviewSentence {
  text: string
  translation?: string | null
  surface: string | null
  meaning_here?: string | null
  met_at: string
  source: string
  current?: boolean
}

export interface ReviewCard {
  atom_id: string
  type: 'vocabulary' | 'grammar'
  key: string
  reading: string | null
  level: string | null
  meaning: string | null
  connection: string | null
  is_new: boolean
  familiar: boolean
  /** word: no sentence yet; recognize: word marked in its sentence; cloze: blanked, with translation */
  mode: 'word' | 'recognize' | 'cloze'
  sentence: ReviewSentence | null
  sentences: ReviewSentence[]
  relations: { key: string; type: string }[]
}

export interface ReviewToday {
  due: number
  new: number
  new_limit: number
  new_introduced_today: number
  new_waiting: number
  done_today: number
  library: number
  cards: ReviewCard[]
}

export interface ReviewSettings {
  new_cards_per_day: number
  desired_retention: number
}

// Follow-up questions on a sentence, optionally about some of its vocab / grammar items
export interface AskTarget {
  kind: 'vocab' | 'grammar'
  key: string   // vocab surface or grammar pattern
}

export interface AskNewItem {
  kind: 'vocab' | 'grammar'
  key: string
  reading: string | null
  meaning: string
}

export interface AskEntry {
  template: 'ask'
  params: {
    sentence_index: number
    question: string
    targets?: AskTarget[]
    /** older single-target shape */
    kind?: 'sentence' | 'vocab' | 'grammar'
    target?: string
  }
  result: { response: string; new_items?: AskNewItem[]; pair?: ComparedPair | null }
}

export type RelationType = 'synonym' | 'derivative' | 'confusable' | 'antonym' | 'collocation'

/** Two entries an answer told apart: offered as 「存成关系」 */
export interface ComparedPair {
  a: { kind: 'vocab' | 'grammar'; key: string; reading: string | null; meaning: string | null }
  b: { kind: 'vocab' | 'grammar'; key: string; reading: string | null; meaning: string | null }
  type: RelationType
  difference: string
}

/** Items an ask referenced, reading either shape. */
export function askTargets(entry: AskEntry): AskTarget[] {
  const p = entry.params
  if (p.targets) return p.targets
  if ((p.kind === 'vocab' || p.kind === 'grammar') && p.target) return [{ kind: p.kind, key: p.target }]
  return []
}

// ─── Bank overview (admin) ────────────────────────────────────────────────────

/** A paper in the bank, or one being added. A draft is a paper mid-arrival
 *  rather than a different kind of thing, so both share this shape. */
export interface BankEntry {
  kind: 'paper' | 'draft'
  id: string
  level: string
  source: string
  title: string
  items: number
  answered: number
  listening: number
  transcripts: number
  empty_problems: number
  /** 問題8 four times over — how the old extractor split a 読解 heading. */
  duplicate_names: number
  status: string | null
  findings: number
}

export interface TypeTotal {
  type: string
  items: number
  papers: number
}

export interface Coverage {
  label: string
  year: number
  month: number
  /** held | draft | cancelled | missing */
  state: string
  note: string | null
  items: number
  entry_id: string | null
}

export interface BankOverview {
  entries: BankEntry[]
  types: TypeTotal[]
  /** Every sitting the test has held, and what the bank has of it. */
  coverage: Coverage[]
}

/** The generic part of a word / grammar card (examples mark the target with ⟦ ⟧) */
export interface CardDetail {
  examples: { ja: string; zh: string; point: string }[]
  usage_hint: string | null
  /** words */
  dictionary_meaning?: string
  variants?: string[]
  /** grammar */
  connection?: string[]
  conjugation?: string | null
}

// JLPT home & practice
/** One of the four kinds: 文字・語彙, 文法, 読解, 聴解 */
export interface JlptCategory {
  id: 'vocab' | 'grammar' | 'reading' | 'listening'
  label: string
  per_paper: number
  answered: number
  accuracy: number | null
}

export interface JlptPaperRow {
  id: string
  label: string
  level: string
  status: 'new' | 'in_progress' | 'completed'
  attempt_id: string | null
  stage: 'written' | 'listening' | null
  /** Seconds left on the part being taken, while a mock exam is under way */
  remaining?: number | null
  total: number | null
  /** Questions in the paper, and how many have been answered (practice or mock) */
  questions: number
  done: number
}

export interface PaperOverview {
  id: string
  label: string
  level: string
  /** Each kind as its latest pass left it; run_id is that pass when unfinished */
  kinds: { id: JlptCategory['id']; label: string; total: number; answered: number; right: number; run_id: string | null }[]
  /** Every pass and mock exam at this paper, newest first */
  records: PaperRecord[]
  written_minutes: number
  listening_minutes: number
}

export type PaperRecord =
  | { type: 'practice'; id: string; at: string; kind: JlptCategory['id']; label: string; total: number; answered: number; right: number; finished: boolean }
  | { type: 'mock'; id: string; at: string; status: 'in_progress' | 'completed'; stage: string | null; remaining: number | null; score: number | null; max_total: number }

export interface JlptOverview {
  level: string
  /** Every level and how many papers it has (0 = nothing to practise yet) */
  levels: { level: string; papers: number }[]
  categories: JlptCategory[]
  papers: JlptPaperRow[]
  mistakes: number
  pass_line: number
  written_minutes: number
  listening_minutes: number
}

export interface PracticeUnit {
  paper: string
  section: string
  problem: ProblemDetail
}

/** The parts of an item analysis the review and practice pages read. */
export interface OptionAnalysis {
  option: string
  is_correct: boolean
  explanation?: string
  translation?: string | null
  vs_correct?: string | null
  most_confusable?: boolean
  relation_type?: RelationType | null
  word?: { surface?: string; reading?: string; meaning?: string; usage_condition?: string; synonym_note?: string } | null
  grammar?: { pattern?: string; meaning?: string; connection?: string } | null
  violation?: string | null
}

export interface KnowledgePoint {
  kind: 'vocab' | 'grammar'
  key: string
  reading: string | null
  meaning: string
  level: string | null
  from: 'option' | 'sentence'
  option: string | null
}

export interface ItemAnalysis {
  analysis_type?: string
  summary?: string
  options_analysis?: OptionAnalysis[]
  filled_sentence?: string | null
  filled_translation?: string | null
  stem_translation?: string | null
  knowledge?: KnowledgePoint[]
  key_sentence?: string
  [k: string]: unknown
}

export interface MockState {
  attempt_id: string
  status: 'in_progress' | 'completed'
  label: string
  level: string
  stage: 'written' | 'listening' | 'done'
  /** Seconds left on the current part's clock */
  remaining: number
  flags: string[]
  answers: Record<string, string>
  sections: SectionDetail[]
}

export interface MockResult {
  label: string
  level: string
  minutes: number
  date: string | null
  total: number
  max_total: number
  pass_line: number
  passed: boolean
  parts: { part: string; score: number; max: number; min: number; correct: number; total: number; wrong: number; passed_min: boolean }[]
  categories: { id: string; label: string; part: string; correct: number; total: number }[]
  wrong: number
  /** In the order to look at them: weakest question type first */
  wrong_items: string[]
}

export interface ItemAskEntry {
  question: string
  targets: string[] | null
  result: { response: string; new_items?: AskNewItem[]; pair?: ComparedPair | null }
}

export interface ItemReview {
  paper: string
  section: string
  category: { id: string; label: string } | null
  problem: ProblemDetail & { passage_translation: string | null }
  item_id: string
  answers: Record<string, { chosen: string; right: boolean }>
  asks: ItemAskEntry[]
}

// Recitation (背诵)
export interface Recitation {
  id: string
  analysis_id: string | null
  sentences: { index: number; text: string; translation: string }[]
  status: 'queued' | 'done'
  /** Sentences said so far this time round */
  progress: number
  times_done: number
  created_at: string | null
  done_at: string | null
}

// Knowledge base (知识库)
export type Familiarity = 'new' | 'learning' | 'familiar'

export interface KbOverview {
  total: number
  vocab: number
  grammar: number
  familiarity: Record<Familiarity, number>
  added_30: number
  familiar_30: number
  added_per_day: number[]
  forgotten: { id: string; key: string; lapses: number }[]
}

export interface KbEntryRow {
  id: string
  type: 'vocabulary' | 'grammar'
  key: string
  reading: string | null
  meaning: string | null
  level: string | null
  sentences: number
  familiarity: Familiarity
  created_at: string
}

export interface KbSourceGroup {
  analysis_id: string | null
  title: string
  source: string
  date: string
  entries: { id: string; key: string }[]
}

export interface KbField { value: string | null; edited: boolean }

export interface KbEntry {
  id: string
  type: 'vocabulary' | 'grammar'
  key: string
  created_at: string
  fields: Record<'reading' | 'meaning' | 'jlpt_level' | 'usage' | 'connection' | 'part_of_speech', KbField>
  meanings: string[]
  sentences: { id: string; text: string; translation: string | null; surface: string | null; meaning_here: string | null; date: string; source: string; analysis_id: string | null }[]
  review: { familiarity: Familiarity; stability: number | null; due: string | null; lapses: number }
  relations: {
    id: string
    type: string
    note: string | null
    other: { id: string; key: string; reading: string | null; meaning: string | null; sentence: { text: string; date: string; source: string } | null }
  }[]
}
