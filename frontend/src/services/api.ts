import {
  AnalyzeRequest,
  PreprocessResponse,
  SentenceAnalysis,
  CardDetail,
  OccurrenceInput,
  ComparedPair,
  JlptOverview,
  PracticeUnit,
  MockState,
  MockResult,
  ItemReview,
  PaperOverview,
  ItemAskEntry,
  Recitation,
  KbOverview,
  KbEntryRow,
  KbSourceGroup,
  KbEntry,
  CreateAtomRequest,
  CreateAtomResponse,
  AddPropertiesRequest,
  CreateRelationRequest,
  RelationResponse,
  AtomListItem,
  AtomDetail,
  AnalysisRecord,
  AskEntry,
  AskTarget,
  ExamPaperList,
  ExamPaperDetail,
  AttemptStatus,
  SubmitSectionResponse,
  QuestionAnalysisResponse,
  AccuracyStats,
  AttemptSummary,
  MistakeItem,
  BankOverview,
  AttemptReviewData,
  DraftSummary,
  DraftDetail,
  ReviewToday,
  ReviewSettings,
} from '../types'

const BASE_URL = import.meta.env.VITE_API_URL || ''

/** Fired when the server says the session is gone (expired, signed out
 *  elsewhere, account disabled). AuthContext listens and shows the sign-in page. */
export const UNAUTHORIZED_EVENT = 'jm:unauthorized'

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    credentials: 'same-origin',
    ...options,
  })
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  return res.json()
}

// ---- Preprocess ----

export async function preprocess(text: string): Promise<PreprocessResponse> {
  return request<PreprocessResponse>('/api/preprocess', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

// ---- Analyze (SSE stream) ----

export async function preprocessBatch(texts: string[]): Promise<PreprocessResponse[]> {
  const res = await request<{ results: PreprocessResponse[] }>('/api/preprocess/batch', {
    method: 'POST',
    body: JSON.stringify({ texts }),
  })
  return res.results
}

export async function* analyzeStream(
  req: AnalyzeRequest,
  opts: { signal?: AbortSignal; onStart?: (analysisId: string) => void } = {},
): AsyncGenerator<SentenceAnalysis> {
  const res = await fetch(`${BASE_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: opts.signal,
  })
  if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lastEvent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        lastEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ') && lastEvent === 'start') {
        try { opts.onStart?.(JSON.parse(line.slice(6)).analysis_id) } catch { /* skip */ }
        lastEvent = ''
      } else if (line.startsWith('data: ') && lastEvent === 'sentence') {
        try { yield JSON.parse(line.slice(6)) } catch { /* skip */ }
        lastEvent = ''
      } else if (line === '') {
        lastEvent = ''
      }
    }
  }
}

// ---- Followup ----

export async function ask(
  analysisId: string,
  params: { sentence_index: number; question: string; targets: AskTarget[] },
): Promise<AskEntry['result']> {
  return request<AskEntry['result']>(`/api/analyses/${analysisId}/followup`, {
    method: 'POST',
    body: JSON.stringify({ template: 'ask', params }),
  })
}

export async function followup(
  analysisId: string,
  template: string,
  params: Record<string, string>,
): Promise<unknown> {
  return request<unknown>(`/api/analyses/${analysisId}/followup`, {
    method: 'POST',
    body: JSON.stringify({ template, params }),
  })
}

export async function getAnalyses(params?: {
  status?: string
  page?: number
  limit?: number
}): Promise<AnalysisRecord[]> {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.page !== undefined) qs.set('page', String(params.page))
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
  const query = qs.toString() ? `?${qs.toString()}` : ''
  return request<AnalysisRecord[]>(`/api/analyses${query}`)
}

export async function getAnalysis(id: string): Promise<AnalysisRecord> {
  return request<AnalysisRecord>(`/api/analyses/${id}`)
}

export async function deleteAnalysis(id: string): Promise<void> {
  await request<void>(`/api/analyses/${id}`, { method: 'DELETE' })
}

// ---- Atoms ----

export async function createAtom(req: CreateAtomRequest): Promise<CreateAtomResponse> {
  return request<CreateAtomResponse>('/api/atoms', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function addProperties(
  atomId: string,
  req: AddPropertiesRequest,
): Promise<{ added: number; skipped: number }> {
  return request<{ added: number; skipped: number }>(`/api/atoms/${atomId}/properties`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function createRelation(
  atomId: string,
  req: CreateRelationRequest,
): Promise<{ relation_id: string; status: string }> {
  return request<{ relation_id: string; status: string }>(`/api/atoms/${atomId}/relations`, {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function getAtoms(params?: {
  type?: string
  tag?: string
  search?: string
  page?: number
  limit?: number
}): Promise<{ items: AtomListItem[]; total: number }> {
  const qs = new URLSearchParams()
  if (params?.type) qs.set('type', params.type)
  if (params?.tag) qs.set('tag', params.tag)
  if (params?.search) qs.set('search', params.search)
  if (params?.page !== undefined) qs.set('page', String(params.page))
  if (params?.limit !== undefined) qs.set('limit', String(params.limit))
  const query = qs.toString() ? `?${qs.toString()}` : ''
  return request<{ items: AtomListItem[]; total: number }>(`/api/atoms${query}`)
}

export async function getAtom(id: string): Promise<AtomDetail> {
  return request<AtomDetail>(`/api/atoms/${id}`)
}

export async function getAtomRelations(id: string): Promise<RelationResponse[]> {
  return request<RelationResponse[]>(`/api/atoms/${id}/relations`)
}

export async function addTag(atomId: string, tag: string): Promise<void> {
  await request<void>(`/api/atoms/${atomId}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tag }),
  })
}

export async function removeTag(atomId: string, tag: string): Promise<void> {
  await request<void>(`/api/atoms/${atomId}/tags/${encodeURIComponent(tag)}`, {
    method: 'DELETE',
  })
}

export async function deleteAtom(id: string): Promise<void> {
  await request<void>(`/api/atoms/${id}`, { method: 'DELETE' })
}

// ---- Dictionary ----

export interface DictSense {
  pos: string[]
  gloss: string[]
  misc: string[]
}

export interface DictEntry {
  kanji_forms: string[]
  readings: string[]
  senses: DictSense[]
  jlpt_level: string | null
}

export async function lookupWord(word: string): Promise<DictEntry | null> {
  try {
    return await request<DictEntry>(`/api/dictionary/${encodeURIComponent(word)}`)
  } catch {
    return null
  }
}

// ---- Video ----

export interface SubtitleEntry {
  start: number
  duration: number
  text: string
  zh?: string
  en?: string
}

export async function getSubtitles(url: string): Promise<{ video_id: string; subtitles: SubtitleEntry[] }> {
  const qs = new URLSearchParams({ url })
  return request<{ video_id: string; subtitles: SubtitleEntry[] }>(`/api/video/subtitles?${qs}`)
}

// ---- Exam ----

export async function reportExamItem(
  itemId: string,
  body: { kind: string; note?: string; attempt_id?: string | null },
): Promise<{ id: string; status: string }> {
  return request(`/api/exam/items/${itemId}/report`, {
    method: 'POST', body: JSON.stringify(body),
  })
}

/** Correct what a 問題 prints once — its passage, its instruction. */
export async function editExamProblem(
  problemId: string,
  body: Record<string, unknown>,
): Promise<{ id: string }> {
  return request(`/api/exam/problems/${problemId}`, {
    method: 'PATCH', body: JSON.stringify(body),
  })
}

export async function editExamItem(
  itemId: string,
  body: Record<string, unknown>,
): Promise<{ id: string; changed: string[] }> {
  return request(`/api/exam/items/${itemId}`, {
    method: 'PATCH', body: JSON.stringify(body),
  })
}

export interface ExamReport {
  id: string
  kind: string
  note: string | null
  created_at: string
  item: { id: string; num: number | null; stem: string; options: Record<string, string>; correct_answer: string | null; answer_order: string | null }
  problem: { id: string; name: string; type: string }
  paper: { id: string; title: string }
}

export async function listExamReports(): Promise<ExamReport[]> {
  return request('/api/exam/reports')
}

export async function resolveExamReport(id: string): Promise<{ id: string; status: string }> {
  return request(`/api/exam/reports/${id}/resolve`, { method: 'POST' })
}

export async function listExams(): Promise<ExamPaperList[]> {
  return request<ExamPaperList[]>('/api/exams')
}

export async function getExam(paperId: string): Promise<ExamPaperDetail> {
  return request<ExamPaperDetail>(`/api/exams/${paperId}`)
}

/** `problemIds` is what this run sets out to cover; omitted, it is the paper. */
/** Synthesise this question's dialogue, or return the clip already stored. */
export async function makeItemAudio(itemId: string): Promise<{ media_id: string; cached: boolean }> {
  return request(`/api/items/${itemId}/audio`, { method: 'POST' })
}

export function mediaUrl(mediaId: string): string {
  return `${BASE_URL}/api/media/${mediaId}`
}

/**
 * The same paper as `getExam`, but with the answers.
 *
 * Answering must not be sent the answer, so `/api/exams` leaves it out; the
 * editor cannot check an answer it is not shown, so it asks the bank.
 */
export async function getBankPaper(paperId: string): Promise<ExamPaperDetail> {
  return request<ExamPaperDetail>(`/api/admin/papers/${paperId}`)
}

/** One page of the booklet a question was read from. */
export function sourcePageUrl(file: string, page: number): string {
  return `/api/admin/source-page?file=${encodeURIComponent(file)}&page=${page}`
}

export async function getBank(): Promise<BankOverview> {
  return request<BankOverview>('/api/admin/bank')
}

export async function listMistakes(category?: string): Promise<MistakeItem[]> {
  const q = category ? `?category=${category}` : ''
  return request<MistakeItem[]>(`/api/mistakes${q}`)
}

export async function startAttempt(
  paperId: string, problemIds?: string[],
): Promise<AttemptStatus> {
  return request<AttemptStatus>(`/api/exams/${paperId}/attempts`, {
    method: 'POST',
    body: JSON.stringify({ problem_ids: problemIds ?? [] }),
  })
}

export async function submitAnswer(
  attemptId: string,
  itemId: string,
  answer: string,
): Promise<{ item_id: string; is_correct: boolean | null }> {
  return request(`/api/attempts/${attemptId}/answers`, {
    method: 'PUT',
    body: JSON.stringify({ item_id: itemId, answer }),
  })
}

export async function submitSection(
  attemptId: string,
  sectionId: string,
): Promise<SubmitSectionResponse> {
  return request<SubmitSectionResponse>(
    `/api/attempts/${attemptId}/sections/${sectionId}/submit`,
    { method: 'POST' },
  )
}

/** An item's explanation; `pending` when it is still being made (the request doesn't wait for it). */
export async function getItemAnalysis(itemId: string): Promise<QuestionAnalysisResponse> {
  return request<QuestionAnalysisResponse>(`/api/items/${itemId}/analysis?wait=false`)
}

export async function getProblemAnalysis(problemId: string): Promise<{ problem_id: string; session_data: Record<string, unknown>; cached: boolean }> {
  return request<{ problem_id: string; session_data: Record<string, unknown>; cached: boolean }>(`/api/problems/${problemId}/analysis`)
}

export async function followupAnalysis(
  itemId: string,
  prompt: string,
): Promise<{ response: string }> {
  return request<{ response: string }>(`/api/items/${itemId}/analysis/followup`, {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  })
}

export async function getAccuracyStats(): Promise<AccuracyStats> {
  return request<AccuracyStats>('/api/stats/accuracy')
}

export async function listPaperAttempts(paperId: string): Promise<AttemptSummary[]> {
  return request<AttemptSummary[]>(`/api/exams/${paperId}/attempts`)
}

export async function completeAttempt(attemptId: string): Promise<void> {
  await request<void>(`/api/attempts/${attemptId}/complete`, { method: 'POST' })
}

export async function deleteAttempt(attemptId: string): Promise<void> {
  await request<void>(`/api/attempts/${attemptId}`, { method: 'DELETE' })
}

export async function getAttemptReview(attemptId: string): Promise<AttemptReviewData> {
  return request<AttemptReviewData>(`/api/attempts/${attemptId}/review`)
}

// ---- Admin (exam ingestion) ----

export async function listDrafts(): Promise<DraftSummary[]> {
  return request<DraftSummary[]>('/api/admin/drafts')
}

export async function getDraft(draftId: string): Promise<DraftDetail> {
  return request<DraftDetail>(`/api/admin/drafts/${draftId}`)
}

export async function updateDraft(draftId: string, draftJson: object): Promise<DraftDetail> {
  return request<DraftDetail>(`/api/admin/drafts/${draftId}`, {
    method: 'PUT',
    body: JSON.stringify({ draft_json: draftJson }),
  })
}

export async function createDraft(
  files: File[],
  opts?: { level?: string; sourceLabel?: string },
): Promise<DraftDetail> {
  const form = new FormData()
  for (const file of files) form.append('files', file)
  // Left out unless overridden: the level and sitting are printed on every
  // cover and answer sheet, so the server reads them off the files.
  if (opts?.level) form.append('level', opts.level)
  if (opts?.sourceLabel) form.append('source_label', opts.sourceLabel)
  const res = await fetch(`${BASE_URL}/api/admin/drafts`, { method: 'POST', body: form })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function deleteDraft(draftId: string): Promise<void> {
  await request<void>(`/api/admin/drafts/${draftId}`, { method: 'DELETE' })
}

export async function editDraftItem(
  draftId: string,
  body: { section?: string; problem: string; seq: number; note?: string } & Record<string, unknown>,
): Promise<DraftDetail> {
  return request(`/api/admin/drafts/${draftId}/items`, {
    method: 'PATCH', body: JSON.stringify(body),
  })
}

/** Correct what a 問題 prints once — its passage, its instruction. */
export async function editDraftProblem(
  draftId: string,
  body: { section: string; problem: string; note?: string } & Record<string, unknown>,
): Promise<DraftDetail> {
  return request(`/api/admin/drafts/${draftId}/problems`, {
    method: 'PATCH', body: JSON.stringify(body),
  })
}

export async function confirmDraft(draftId: string): Promise<DraftDetail> {
  return request<DraftDetail>(`/api/admin/drafts/${draftId}/confirm`, { method: 'POST' })
}

export async function uploadMedia(file: File): Promise<{ url: string }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE_URL}/api/admin/media/upload`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function importAnswers(draftId: string, file: File): Promise<DraftDetail> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE_URL}/api/admin/drafts/${draftId}/import-answers`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `HTTP ${res.status}`)
  }
  return res.json()
}

// ---- Review (内化学习) ----

/** Today's cards: everything due, then new cards up to the daily limit. */
export async function getReviewToday(extra = 0): Promise<ReviewToday> {
  const tz = new Date().getTimezoneOffset()
  return request<ReviewToday>(`/api/review/today?tz=${tz}&extra=${extra}`)
}

export async function postReview(atomId: string, result: 'know' | 'unknown'): Promise<{ due: string; familiar: boolean }> {
  return request(`/api/review/${atomId}`, { method: 'POST', body: JSON.stringify({ result }) })
}

export async function getReviewSettings(): Promise<ReviewSettings> {
  return request<ReviewSettings>('/api/review/settings')
}

export async function updateReviewSettings(body: Partial<ReviewSettings>): Promise<ReviewSettings> {
  return request<ReviewSettings>('/api/review/settings', { method: 'PATCH', body: JSON.stringify(body) })
}


// ── Accounts ──────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string
  email: string
  display_name: string | null
  role: 'user' | 'admin'
}

export interface AdminUserRow extends AuthUser {
  is_active: boolean
  created_at: string | null
  last_login_at: string | null
  atoms: number
  analyses: number
  attempts: number
}

export type SignupMode = 'open' | 'invite' | 'closed'

export async function getMe(): Promise<AuthUser> {
  return request<AuthUser>('/api/auth/me')
}

export async function getAuthConfig(): Promise<{ signup_mode: SignupMode }> {
  return request('/api/auth/config')
}

export async function login(email: string, password: string): Promise<AuthUser> {
  return request<AuthUser>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function signup(email: string, password: string, displayName?: string, inviteCode?: string): Promise<AuthUser> {
  return request<AuthUser>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, display_name: displayName || null, invite_code: inviteCode || null }),
  })
}

export async function logout(): Promise<void> {
  await request<void>('/api/auth/logout', { method: 'POST' })
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await request<void>('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}

export async function listUsers(): Promise<AdminUserRow[]> {
  return request<AdminUserRow[]>('/api/admin/users')
}

export async function createUser(body: {
  email: string; password: string; display_name?: string; role: 'user' | 'admin'
}): Promise<AuthUser> {
  return request<AuthUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(body) })
}

export async function updateUser(id: string, body: {
  display_name?: string; role?: 'user' | 'admin'; is_active?: boolean; password?: string
}): Promise<AuthUser & { is_active: boolean }> {
  return request(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export interface InviteRow {
  code: string
  note: string | null
  max_uses: number
  used_count: number
  expires_at: string | null
  is_active: boolean
  created_at: string | null
  users: string[]
}

export async function listInvites(): Promise<InviteRow[]> {
  return request<InviteRow[]>('/api/admin/invites')
}

export async function createInvites(body: {
  note?: string; max_uses: number; expires_at?: string | null; count?: number
}): Promise<InviteRow[]> {
  return request<InviteRow[]>('/api/admin/invites', { method: 'POST', body: JSON.stringify(body) })
}

export async function updateInvite(code: string, body: { is_active?: boolean; note?: string }): Promise<InviteRow> {
  return request<InviteRow>(`/api/admin/invites/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(body) })
}

/** Which of these dictionary forms / grammar patterns are already in the library (key → atom id). */
export async function lookupAtoms(vocab: string[], grammar: string[]): Promise<{
  vocab: Record<string, string>; grammar: Record<string, string>
}> {
  return request('/api/atoms/lookup', { method: 'POST', body: JSON.stringify({ vocab, grammar }) })
}

/** Analyse one sentence again after the first run left it without a result. */
export async function retrySentence(analysisId: string, index: number): Promise<SentenceAnalysis> {
  return request<SentenceAnalysis>(`/api/analyses/${analysisId}/sentences/${index}/retry`, { method: 'POST' })
}

/** Examples, other spellings and usage rules for a card; generated once, then cached. */
/** generate=false: only what is already kept (null if nothing yet), costs nothing. */
export async function getCardDetail(req: {
  type: 'vocabulary' | 'grammar'; key: string; reading?: string | null; meaning?: string | null; generate?: boolean
}): Promise<CardDetail | null> {
  return request<CardDetail | null>('/api/cards/detail', { method: 'POST', body: JSON.stringify(req) })
}

/** Keep this sentence under an entry already in the library (noting another spelling, if any). */
export async function addOccurrence(atomId: string, body: {
  occurrence: OccurrenceInput; analysis_id?: string | null; variant?: string | null
}): Promise<{ atom_id: string }> {
  return request(`/api/atoms/${atomId}/occurrences`, { method: 'POST', body: JSON.stringify(body) })
}

/** Keep one 「差在哪」 as a relation; either entry is added if it isn't kept yet. */
export async function savePair(body: ComparedPair & {
  source?: 'ask' | 'jlpt'; analysis_id?: string | null; sentence_index?: number | null; item_id?: string | null
}): Promise<{ relation_id: string; a: string; b: string }> {
  return request('/api/relations/pair', { method: 'POST', body: JSON.stringify(body) })
}

// ---- JLPT home & practice ----

export async function getJlptOverview(level: string): Promise<JlptOverview> {
  return request<JlptOverview>(`/api/jlpt/overview?level=${level}`)
}

export async function getPractice(category: string, level: string, runId: string): Promise<{
  category: { id: string; label: string }; units: PracticeUnit[]
  /** Handed in: answers are judged */
  submitted: boolean
  /** The pass's answers so far, by item */
  chosen: Record<string, string>
  /** Right answers by item, once handed in */
  correct: Record<string, string>
}> {
  return request(`/api/jlpt/practice/${category}?level=${level}&run_id=${runId}`)
}

export async function submitRun(runId: string): Promise<void> {
  await request(`/api/jlpt/runs/${runId}/submit`, { method: 'POST' })
}

export async function deleteRecord(type: 'practice' | 'mock', id: string): Promise<void> {
  await request(type === 'mock' ? `/api/jlpt/mock/${id}` : `/api/jlpt/runs/${id}`, { method: 'DELETE' })
}

export async function startRun(paperId: string, kind: string): Promise<{ run_id: string }> {
  return request(`/api/jlpt/papers/${paperId}/runs`, { method: 'POST', body: JSON.stringify({ kind }) })
}

export async function getPaperOverview(paperId: string): Promise<PaperOverview> {
  return request<PaperOverview>(`/api/jlpt/papers/${paperId}`)
}

export async function answerPractice(itemId: string, answer: string, runId: string): Promise<void> {
  await request('/api/jlpt/practice/answer', { method: 'POST', body: JSON.stringify({ item_id: itemId, answer, run_id: runId }) })
}

// ---- Mock exam ----

export async function startMock(paperId: string): Promise<{ attempt_id: string }> {
  return request(`/api/jlpt/mock/${paperId}`, { method: 'POST' })
}

export async function getMock(attemptId: string): Promise<MockState> {
  return request<MockState>(`/api/jlpt/mock/${attemptId}`)
}

export async function answerMock(attemptId: string, itemId: string, answer: string): Promise<void> {
  await request(`/api/jlpt/mock/${attemptId}/answer`, { method: 'POST', body: JSON.stringify({ item_id: itemId, answer }) })
}

export async function flagMock(attemptId: string, itemId: string, flagged: boolean): Promise<{ flags: string[] }> {
  return request(`/api/jlpt/mock/${attemptId}/flag`, { method: 'POST', body: JSON.stringify({ item_id: itemId, flagged }) })
}

export async function handInMock(attemptId: string): Promise<{ stage: 'listening' | 'done' }> {
  return request(`/api/jlpt/mock/${attemptId}/hand-in`, { method: 'POST' })
}

export async function getMockResult(attemptId: string): Promise<MockResult> {
  return request<MockResult>(`/api/jlpt/mock/${attemptId}/result`)
}

export async function getItemReview(itemId: string, attemptId?: string | null, runId?: string | null): Promise<ItemReview> {
  const q = attemptId ? `?attempt_id=${attemptId}` : runId ? `?run_id=${runId}` : ''
  return request<ItemReview>(`/api/jlpt/review/${itemId}${q}`)
}

export async function askItem(itemId: string, body: { question: string; targets: string[]; chosen?: string | null }): Promise<ItemAskEntry> {
  return request<ItemAskEntry>(`/api/jlpt/items/${itemId}/ask`, { method: 'POST', body: JSON.stringify(body) })
}

/** The text a question is read against, analysed like a pasted passage. */
export async function getItemReading(itemId: string): Promise<{ kind: 'passage' | 'script' | 'sentence'; sentences: SentenceAnalysis[] }> {
  return request(`/api/jlpt/items/${itemId}/reading`)
}

export interface MistakeGroup {
  id: string
  label: string
  part: string
  items: { item_id: string; paper: string; num: number | null; stem: string; misses: number }[]
}

/** Questions last answered wrong, by question type. */
export async function getJlptMistakes(level: string): Promise<MistakeGroup[]> {
  return request<MistakeGroup[]>(`/api/jlpt/mistakes?level=${level}`)
}

// ---- Recitation (背诵) ----

export async function getRecitations(): Promise<{ queue: Recitation[]; done: Recitation[] }> {
  return request('/api/recite')
}

export async function addRecitation(analysisId: string): Promise<Recitation> {
  return request<Recitation>('/api/recite', { method: 'POST', body: JSON.stringify({ analysis_id: analysisId }) })
}

export async function setRecitationProgress(id: string, progress: number): Promise<Recitation> {
  return request<Recitation>(`/api/recite/${id}`, { method: 'PATCH', body: JSON.stringify({ progress }) })
}

export async function finishRecitation(id: string): Promise<Recitation> {
  return request<Recitation>(`/api/recite/${id}/done`, { method: 'POST' })
}

export async function reciteAgain(id: string): Promise<Recitation> {
  return request<Recitation>(`/api/recite/${id}/again`, { method: 'POST' })
}

export async function reorderRecitations(ids: string[]): Promise<void> {
  await request('/api/recite/order', { method: 'PUT', body: JSON.stringify({ ids }) })
}

export async function removeRecitation(id: string): Promise<void> {
  await request(`/api/recite/${id}`, { method: 'DELETE' })
}

// ---- Knowledge base (知识库) ----

export async function getKbOverview(): Promise<KbOverview> {
  return request<KbOverview>(`/api/kb/overview?tz=${new Date().getTimezoneOffset()}`)
}

export async function getKbEntries(params: { type?: string; fam?: string; level?: string; q?: string }): Promise<{ items: KbEntryRow[]; total: number }> {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][])
  return request(`/api/kb/entries?${qs}`)
}

export async function getKbSources(): Promise<KbSourceGroup[]> {
  return request<KbSourceGroup[]>('/api/kb/sources')
}

export async function getKbEntry(id: string): Promise<KbEntry> {
  return request<KbEntry>(`/api/kb/entries/${id}`)
}

export async function editKbEntry(id: string, body: { reading?: string; meaning?: string; level?: string }): Promise<KbEntry> {
  return request<KbEntry>(`/api/kb/entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export async function removeKbSentence(occurrenceId: string): Promise<void> {
  await request(`/api/kb/occurrences/${occurrenceId}`, { method: 'DELETE' })
}

export async function mergeKbEntry(id: string, into: string): Promise<{ id: string }> {
  return request(`/api/kb/entries/${id}/merge`, { method: 'POST', body: JSON.stringify({ into }) })
}
