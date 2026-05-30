from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


# ── Exam paper list / detail ──────────────────────────────────────────────────

class ExamPaperList(BaseModel):
    id: UUID
    title: str
    level: str
    source: str | None
    section_count: int
    item_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class ExamMediaItem(BaseModel):
    id: UUID
    url: str
    caption: str | None
    seq: int


class ItemSchema(BaseModel):
    id: UUID
    seq: int
    num: int | None
    stem: str
    transcript: str | None = None
    options: dict
    meta: dict | None


class ProblemDetail(BaseModel):
    id: UUID
    seq: int
    name: str
    type: str
    instruction: str | None
    passage: str | None
    transcript: str | None
    media: list[ExamMediaItem]
    items: list[ItemSchema]


class SectionDetail(BaseModel):
    id: UUID
    name: str
    seq: int
    problems: list[ProblemDetail]


class ExamPaperDetail(BaseModel):
    id: UUID
    title: str
    level: str
    source: str | None
    sections: list[SectionDetail]
    created_at: datetime


# ── Attempt ───────────────────────────────────────────────────────────────────

class StartAttemptResponse(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str


class SubmitAnswerRequest(BaseModel):
    item_id: UUID
    answer: str  # "1"|"2"|"3"|"4"


class SubmitAnswerResponse(BaseModel):
    item_id: UUID
    is_correct: bool | None


class SectionScore(BaseModel):
    correct: int
    total: int


class SectionAnswerDetail(BaseModel):
    item_id: str
    user_answer: str | None
    is_correct: bool
    correct_answer: str | None


class SubmitSectionResponse(BaseModel):
    section_name: str
    score: SectionScore
    answers: list[SectionAnswerDetail]


class AttemptStatus(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str
    score: dict | None
    answered_item_ids: list[UUID]


# ── Analysis ──────────────────────────────────────────────────────────────────

class RelationSuggestion(BaseModel):
    from_key: str
    to_key: str
    type: str
    note: str


class QuestionAnalysisResponse(BaseModel):
    item_id: UUID
    session_data: dict | None
    relations_suggested: list[RelationSuggestion]
    cached: bool


# ── Stats ─────────────────────────────────────────────────────────────────────

class CategoryAccuracy(BaseModel):
    correct: int
    total: int


class AccuracyStats(BaseModel):
    vocab: CategoryAccuracy
    grammar: CategoryAccuracy
    reading: CategoryAccuracy
    listening: CategoryAccuracy


# ── Attempt history ───────────────────────────────────────────────────────────

class AttemptSummary(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str
    score: dict | None
    started_at: datetime
    completed_at: datetime | None
    section_names: list[str] = []


class ReviewItem(BaseModel):
    id: UUID
    seq: int
    num: int | None
    stem: str
    transcript: str | None = None
    options: dict
    meta: dict | None
    user_answer: str | None
    correct_answer: str | None
    is_correct: bool | None


class ReviewProblem(BaseModel):
    id: UUID
    seq: int
    name: str
    type: str
    instruction: str | None
    passage: str | None
    transcript: str | None
    media: list[ExamMediaItem]
    items: list[ReviewItem]


class ReviewSection(BaseModel):
    id: UUID
    name: str
    seq: int
    problems: list[ReviewProblem]


class AttemptReview(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str
    score: dict | None
    started_at: datetime
    completed_at: datetime | None
    sections: list[ReviewSection]


# ── Admin: Draft ──────────────────────────────────────────────────────────────

class DraftSummary(BaseModel):
    id: UUID
    filename: str | None
    status: str
    paper_id: UUID | None
    created_at: datetime
    updated_at: datetime


class DraftDetail(BaseModel):
    id: UUID
    filename: str | None
    markdown_raw: str | None
    draft_json: dict | None
    status: str
    paper_id: UUID | None
    created_at: datetime
    updated_at: datetime


class MediaUploadResponse(BaseModel):
    url: str
