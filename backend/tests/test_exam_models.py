"""Verify new 4-layer model structure is importable and consistent."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import inspect as sa_inspect

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


def test_back_populates_symmetry():
    item_rel = sa_inspect(ExamItem).relationships["problem"]
    assert item_rel.back_populates == "items"
    prob_rel = sa_inspect(ExamProblem).relationships["items"]
    assert prob_rel.back_populates == "problem"


def test_question_analysis_is_one_to_one():
    rel = sa_inspect(ExamItem).relationships["analysis"]
    assert "delete-orphan" in str(rel.cascade)
    assert rel.uselist is False


def test_attempt_answer_fk_targets_exam_items():
    fks = {fk.column.table.name for fk in AttemptAnswer.__table__.c.item_id.foreign_keys}
    assert "exam_items" in fks
