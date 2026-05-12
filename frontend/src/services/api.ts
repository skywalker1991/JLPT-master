import {
  AnalyzeRequest,
  PreprocessResponse,
  SentenceAnalysis,
  CreateAtomRequest,
  CreateAtomResponse,
  AddPropertiesRequest,
  CreateRelationRequest,
  RelationResponse,
  AtomListItem,
  AtomDetail,
  AnalysisRecord,
  ExamPaperList,
  ExamPaperDetail,
  AttemptStatus,
  SubmitSectionResponse,
  QuestionAnalysisResponse,
  AccuracyStats,
  AttemptSummary,
  AttemptReviewData,
} from '../types'

const BASE_URL = import.meta.env.VITE_API_URL || ''

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
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

export async function* analyzeStream(req: AnalyzeRequest): AsyncGenerator<SentenceAnalysis> {
  const res = await fetch(`${BASE_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
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

export async function completeAnalysis(analysisId: string): Promise<void> {
  await request<void>(`/api/analyses/${analysisId}/complete`, {
    method: 'POST',
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

export async function listExams(): Promise<ExamPaperList[]> {
  return request<ExamPaperList[]>('/api/exams')
}

export async function getExam(paperId: string): Promise<ExamPaperDetail> {
  return request<ExamPaperDetail>(`/api/exams/${paperId}`)
}

export async function startAttempt(paperId: string): Promise<AttemptStatus> {
  return request<AttemptStatus>(`/api/exams/${paperId}/attempts`, { method: 'POST' })
}

export async function submitAnswer(
  attemptId: string,
  questionId: string,
  answer: string,
): Promise<{ question_id: string; is_correct: boolean | null }> {
  return request(`/api/attempts/${attemptId}/answers`, {
    method: 'PUT',
    body: JSON.stringify({ question_id: questionId, answer }),
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

export async function getQuestionAnalysis(questionId: string): Promise<QuestionAnalysisResponse> {
  return request<QuestionAnalysisResponse>(`/api/questions/${questionId}/analysis`)
}

export async function followupAnalysis(
  questionId: string,
  prompt: string,
): Promise<{ response: string }> {
  return request<{ response: string }>(`/api/questions/${questionId}/analysis/followup`, {
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
