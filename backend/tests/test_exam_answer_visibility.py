"""Who is shown the answer.

The page that asks a question must not be sent its answer, and the editor
that corrects one cannot check an answer it is never shown. Both read the
same paper through the same function, so the only thing standing between
them is one flag — which is exactly the kind of thing that gets flipped by
accident and noticed by nobody, because a leaked answer looks like a
perfectly normal response.
"""
import asyncio
import uuid
from datetime import datetime, timezone

from app.api.exam import build_paper_detail
from app.models.db import ExamItem, ExamMedia, ExamProblem, ExamSection


class _Paper:
    id = uuid.uuid4()
    title, level, source = "N1 2013年07月", "N1", "2013年07月"
    created_at = datetime.now(timezone.utc)


def _item():
    it = ExamItem(
        id=uuid.uuid4(), seq=1, num=36, stem="できるもんなら [_1_] [_2_] [_3★_] [_4_] 困っている。",
        options={"1": "表情が", "2": "あの憎らしい", "3": "というような", "4": "捕まえてごらん"},
        meta={"star_position": 3},
    )
    it.correct_answer, it.answer_order = "2", "4321"
    it.transcript = it.passage = None
    return it


class _Db:
    """Answers whatever `build_paper_detail` selects, by the model it asks for."""
    def __init__(self):
        section = ExamSection(id=uuid.uuid4(), name="言語知識（文法）", seq=1)
        problem = ExamProblem(id=uuid.uuid4(), seq=1, name="問題6", type="sentence_order")
        problem.instruction = problem.passage = problem.transcript = None
        self._rows = {ExamSection: [section], ExamProblem: [problem],
                      ExamItem: [_item()], ExamMedia: []}

    async def execute(self, statement):
        rows = self._rows[statement.column_descriptions[0]["entity"]]
        return _Result(rows)


class _Result:
    def __init__(self, rows): self._rows = rows
    def scalars(self): return self
    def all(self): return self._rows


def _only_item(paper):
    return paper.sections[0].problems[0].items[0]


def test_the_answering_view_is_not_told_the_answer():
    paper = asyncio.run(build_paper_detail(_Db(), _Paper()))
    item = _only_item(paper)
    assert item.correct_answer is None
    assert item.answer_order is None
    # Everything the question needs is still there.
    assert item.options["2"] == "あの憎らしい"
    assert item.meta["star_position"] == 3


def test_the_bank_is_shown_the_answer_because_nobody_can_check_a_blank():
    paper = asyncio.run(build_paper_detail(_Db(), _Paper(), with_answers=True))
    item = _only_item(paper)
    assert item.correct_answer == "2"
    assert item.answer_order == "4321"
