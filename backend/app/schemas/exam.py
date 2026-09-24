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
    #: Set only where the 問題 holds several texts and this question is about
    #: one of them; otherwise the 問題's own passage is the one to show.
    passage: str | None = None
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

class StartAttemptRequest(BaseModel):
    """The 問題 a sitting covers. Empty means the whole paper."""
    problem_ids: list[UUID] = []


class AttemptSummary(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str
    score: dict | None
    started_at: datetime
    completed_at: datetime | None
    section_names: list[str]
    #: The 問題 this run set out to cover. Empty for runs recorded before a run
    #: said so, and for runs over the whole paper.
    problem_names: list[str] = []
    #: Answered so far, and how many the chosen range holds. `in_scope` is None
    #: for a run recorded before runs stated their range.
    answered: int = 0
    in_scope: int | None = None


class ReviewItem(BaseModel):
    id: UUID
    seq: int
    num: int | None
    stem: str
    transcript: str | None = None
    passage: str | None = None
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


class MistakeItem(BaseModel):
    """A question answered wrongly, and how often.

    The explanation is not carried here — it hangs off the question, so it is
    fetched when the question is opened and is already there for one met
    before. `has_analysis` says which it will be.
    """
    item_id: UUID
    problem_id: UUID
    paper_title: str
    problem_name: str
    problem_type: str
    category: str
    num: int | None
    stem: str
    options: dict
    correct_answer: str | None
    #: The wrong options actually picked, across records.
    wrong_answers: list[str] = []
    wrong_count: int
    seen_count: int
    last_seen: datetime
    has_analysis: bool


# ── Admin: Draft ──────────────────────────────────────────────────────────────

class DraftSummary(BaseModel):
    id: UUID
    filename: str | None
    status: str
    paper_id: UUID | None
    created_at: datetime
    updated_at: datetime


class DraftSource(BaseModel):
    """One uploaded file of a sitting, and what it turned out to be."""
    filename: str
    role: str                 # questions | explanations | answer_sheet | scanned
    page_count: int
    text_pages: int


class DraftDetail(BaseModel):
    id: UUID
    filename: str | None
    markdown_raw: str | None
    draft_json: dict | None
    #: The paper in the shape everything downstream reads (exam_canonical).
    canonical: dict | None = None
    #: What checking it turned up: gaps in the file set, findings, answer stats.
    report: dict | None = None
    sources: list[DraftSource] = []
    status: str
    paper_id: UUID | None
    created_at: datetime
    updated_at: datetime


class MediaUploadResponse(BaseModel):
    url: str
