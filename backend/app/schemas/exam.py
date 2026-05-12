from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


class ExamPaperList(BaseModel):
    id: UUID
    title: str
    level: str
    source: str | None
    section_count: int
    question_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class QuestionItem(BaseModel):
    id: UUID
    type: str
    stem: str
    passage: str | None
    options: dict
    meta: dict | None
    seq: int


class SectionDetail(BaseModel):
    id: UUID
    name: str
    seq: int
    questions: list[QuestionItem]


class ExamPaperDetail(BaseModel):
    id: UUID
    title: str
    level: str
    source: str | None
    sections: list[SectionDetail]
    created_at: datetime


class StartAttemptResponse(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str


class SubmitAnswerRequest(BaseModel):
    question_id: UUID
    answer: str  # "1"|"2"|"3"|"4"


class SubmitAnswerResponse(BaseModel):
    question_id: UUID
    is_correct: bool | None  # None if no answer key exists


class SectionScore(BaseModel):
    correct: int
    total: int


class SectionAnswerDetail(BaseModel):
    question_id: str
    user_answer: str | None
    is_correct: bool
    correct_answer: str | None  # revealed after submit


class SubmitSectionResponse(BaseModel):
    section_name: str
    score: SectionScore
    answers: list[SectionAnswerDetail]


class AttemptStatus(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str
    score: dict | None
    answered_question_ids: list[UUID]


class RelationSuggestion(BaseModel):
    from_key: str
    to_key: str
    type: str
    note: str


class QuestionAnalysisResponse(BaseModel):
    question_id: UUID
    session_data: dict | None
    relations_suggested: list[RelationSuggestion]
    cached: bool


class CategoryAccuracy(BaseModel):
    correct: int
    total: int


class AccuracyStats(BaseModel):
    vocab: CategoryAccuracy
    grammar: CategoryAccuracy
    reading: CategoryAccuracy
    listening: CategoryAccuracy


class AttemptSummary(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str
    score: dict | None
    started_at: datetime
    completed_at: datetime | None
    section_names: list[str] = []


class ReviewQuestion(BaseModel):
    id: UUID
    type: str
    stem: str
    passage: str | None
    options: dict
    meta: dict | None
    seq: int
    user_answer: str | None
    correct_answer: str | None
    is_correct: bool | None


class ReviewSection(BaseModel):
    id: UUID
    name: str
    seq: int
    questions: list[ReviewQuestion]


class AttemptReview(BaseModel):
    attempt_id: UUID
    paper_id: UUID
    status: str
    score: dict | None
    started_at: datetime
    completed_at: datetime | None
    sections: list[ReviewSection]
