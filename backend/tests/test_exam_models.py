"""Verify new 4-layer model structure is importable and consistent."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.db import (
    ExamPaper, ExamSection, ExamProblem, ExamItem,
    ExamMedia, ExamDraft, QuestionAnalysis, ExamAttempt, AttemptAnswer,
)


def test_exam_problem_has_items_relationship():
    assert hasattr(ExamProblem, "items")
    assert hasattr(ExamProblem, "media")


def test_exam_item_has_problem_relationship():
    assert hasattr(ExamItem, "problem")
    assert hasattr(ExamItem, "analysis")


def test_attempt_answer_references_item():
    cols = {c.key for c in AttemptAnswer.__table__.columns}
    assert "item_id" in cols
    assert "attempt_id" in cols


def test_exam_draft_exists():
    cols = {c.key for c in ExamDraft.__table__.columns}
    assert "markdown_raw" in cols
    assert "draft_json" in cols
    assert "status" in cols


def test_exam_media_exists():
    cols = {c.key for c in ExamMedia.__table__.columns}
    assert "problem_id" in cols
    assert "url" in cols
