"""Correcting an imported question.

Importing used to be one-way: 2015年07月 第39题 lost the ★ from its 並べ替え
stem and could only be fixed by deleting the paper and losing the six attempts
recorded against it.

Edits are versioned because an attempt was answered against the wording as it
stood — the history is what keeps a change from silently rewriting what a past
score meant. It is also what made a wrong value recoverable while this was
being built.
"""
import asyncio

import pytest
from fastapi import HTTPException

from app.services import exam_edit


class _Item:
    def __init__(self, **kw):
        self.id = "i1"
        self.stem = "原因を [_1_] [_2_] [_3_] [_4_] 報告があった。"
        self.options = {"1": "あ", "2": "い", "3": "う", "4": "え"}
        self.correct_answer = "1"
        self.answer_order = None
        self.transcript = None
        self.meta = {"star_position": 3}
        self.__dict__.update(kw)


class _Problem:
    def __init__(self):
        self.id = "p1"
        self.passage = "本文"
        self.passage_translation = None
        self.instruction = None
        self.transcript = None


class _DB:
    """Enough of a session to drive the edit helpers."""
    def __init__(self, found=None, existing_reports=()):
        self.found = found
        self.existing_reports = list(existing_reports)
        self.added, self.flushed = [], False

    def add(self, obj): self.added.append(obj)
    async def flush(self): self.flushed = True

    async def execute(self, stmt):
        found, reports = self.found, self.existing_reports
        class _Res:
            def scalar_one_or_none(_s): return found
            def scalars(_s):
                class _S:
                    def first(_x): return reports[0] if reports else None
                    def all(_x): return reports
                return _S()
        return _Res()


def edit(db, changes, **kw):
    return asyncio.run(exam_edit.apply_item_edit(db, "i1", changes, **kw))


# --- editing ------------------------------------------------------------------

def test_a_correction_is_applied_to_the_question():
    item = _Item()
    fixed = "原因を [_1_] [_2_] [_3★_] [_4_] 報告があった。"
    updated, _ = edit(_DB(item), {"stem": fixed})
    assert updated.stem == fixed


def test_the_full_ordering_can_be_filled_in_afterwards():
    """並べ替え answers only reached the schema recently; older papers have none."""
    item = _Item()
    updated, revisions = edit(_DB(item), {"answer_order": "3412"})
    assert updated.answer_order == "3412"
    assert [r.field for r in revisions] == ["answer_order"]


def test_every_changed_field_is_recorded_with_its_previous_value():
    item = _Item()
    _, revisions = edit(_DB(item), {"correct_answer": "4", "answer_order": "3412"})
    by_field = {r.field: r for r in revisions}
    assert by_field["correct_answer"].old_value == "1"
    assert by_field["correct_answer"].new_value == "4"
    assert by_field["answer_order"].old_value is None


def test_the_reason_for_a_change_is_kept_with_it():
    _, revisions = edit(_DB(_Item()), {"answer_order": "3412"}, note="答案表 39→3412")
    assert revisions[0].note == "答案表 39→3412"


def test_setting_a_field_to_what_it_already_is_records_nothing():
    item = _Item()
    _, revisions = edit(_DB(item), {"correct_answer": "1"})
    assert revisions == []


def test_options_are_recorded_readably_rather_than_as_an_object():
    item = _Item()
    _, revisions = edit(_DB(item), {"options": {"1": "X", "2": "い", "3": "う", "4": "え"}})
    assert '"1": "X"' in revisions[0].new_value


def test_a_field_that_is_not_editable_is_refused():
    """seq and num position the question inside its paper."""
    with pytest.raises(HTTPException) as e:
        edit(_DB(_Item()), {"num": 99})
    assert e.value.status_code == 400


def test_editing_a_question_that_does_not_exist_is_a_404():
    with pytest.raises(HTTPException) as e:
        edit(_DB(None), {"stem": "x"})
    assert e.value.status_code == 404


def test_a_passage_and_its_translation_can_be_corrected():
    problem = _Problem()
    updated = asyncio.run(exam_edit.apply_problem_edit(
        _DB(problem), "p1", {"passage_translation": "中文译文"}))
    assert updated.passage_translation == "中文译文"


def test_a_field_that_is_not_on_a_problem_is_refused():
    with pytest.raises(HTTPException):
        asyncio.run(exam_edit.apply_problem_edit(_DB(_Problem()), "p1", {"stem": "x"}))


# --- reporting ----------------------------------------------------------------

def test_a_question_can_be_flagged_while_answering():
    db = _DB(_Item())
    report = asyncio.run(exam_edit.report_item(db, "i1", "missing", note="排序题没有 ★"))
    assert report.kind == "missing"
    assert report.note == "排序题没有 ★"
    assert report.item_id == "i1"
    assert db.added == [report]


def test_flagging_the_same_defect_twice_does_not_queue_it_twice():
    class _Report:
        def __init__(self): self.note, self.kind, self.status = "已报", "missing", "open"
    existing = _Report()
    db = _DB(_Item(), existing_reports=[existing])
    again = asyncio.run(exam_edit.report_item(db, "i1", "missing", note="又发现一次"))
    assert again is existing
    assert not db.added
    assert "又发现一次" in again.note   # the new detail is kept


def test_an_unknown_report_kind_is_refused():
    with pytest.raises(HTTPException) as e:
        asyncio.run(exam_edit.report_item(_DB(_Item()), "i1", "whatever"))
    assert e.value.status_code == 400


def test_reporting_a_question_that_does_not_exist_is_a_404():
    with pytest.raises(HTTPException) as e:
        asyncio.run(exam_edit.report_item(_DB(None), "i1", "typo"))
    assert e.value.status_code == 404


def test_resolving_a_report_closes_it_and_stamps_when():
    class _Report:
        status, resolved_at = "open", None
        id = "r1"
    report = _Report()
    done = asyncio.run(exam_edit.resolve_report(_DB(report), "r1"))
    assert done.status == "resolved" and done.resolved_at is not None
