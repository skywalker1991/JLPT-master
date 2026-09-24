"""Reading an answer sheet two ways and comparing them.

Pattern matching handles the layouts already seen, for free and instantly.
What it does not handle it fails at quietly — 2019年07月 produced fewer
answers rather than an error, and a paper missing answers imports looking
complete. So the count decides whether a second reading is needed, and where
both ran, a disagreement names the item rather than being resolved silently.

Handing this to a model is safe because the check does not come from the
model: a paper has a known number of items and answers are 1 to 4, whatever
the publisher printed.
"""
import asyncio

from app.services.exam_answer_reader import (
    _from_payload, _looks_complete, compare, read_answer_sheet,
)
from app.services.exam_answers import AnswerKey

SHEET = """
1-6
241243
问题1
243324
"""
COUNTS = {1: 6}


def read(monkeypatch, model_key=None, fail=False, **kw):
    async def fake(sheet_text, **_):
        if fail:
            raise RuntimeError("model unavailable")
        return model_key
    monkeypatch.setattr(
        "app.services.exam_answer_reader.read_with_model", fake
    )
    return asyncio.run(read_answer_sheet(SHEET, listening_counts=COUNTS, **kw))


# --- when the fast path is enough ---------------------------------------------

def test_a_complete_pattern_reading_costs_nothing(monkeypatch):
    called = False

    async def should_not_run(*a, **k):
        nonlocal called
        called = True
        return AnswerKey()

    monkeypatch.setattr("app.services.exam_answer_reader.read_with_model", should_not_run)
    result = asyncio.run(read_answer_sheet(SHEET, listening_counts=COUNTS, written_expected=6))
    assert result.method == "pattern"
    assert not called


def test_a_short_reading_asks_the_model(monkeypatch):
    """Missing answers are the failure mode that looks like success."""
    model = AnswerKey(written={n: "1" for n in range(1, 21)})
    result = read(monkeypatch, model, written_expected=20)
    assert result.method == "model"
    assert len(result.key.written) == 20


def test_verification_can_be_asked_for_even_when_the_patterns_look_fine(monkeypatch):
    """Worth it for an unfamiliar publisher: two independent readings agreeing
    is evidence, and disagreeing names the item."""
    model = AnswerKey(written={n: d for n, d in zip(range(1, 7), "241243")},
                      listening={(1, i): d for i, d in enumerate("243324", start=1)})
    result = read(monkeypatch, model, written_expected=6, always_verify=True)
    assert result.method == "pattern+model"
    assert result.agreed is True
    assert result.notes == []


def test_a_disagreement_names_the_item(monkeypatch):
    model = AnswerKey(written={1: "3"})      # the sheet reads 2
    result = read(monkeypatch, model, written_expected=6, always_verify=True)
    assert result.agreed is False
    assert "第1题" in result.notes[0]


def test_the_pattern_reading_is_kept_when_both_ran(monkeypatch):
    """Both are complete, so the free one stands and the difference is flagged
    rather than swapped in."""
    model = AnswerKey(written={1: "3"})
    result = read(monkeypatch, model, written_expected=6, always_verify=True)
    assert result.key.written[1] == "2"      # from the sheet


# --- when the model cannot be reached -----------------------------------------

def test_a_model_failure_still_returns_what_the_patterns_found(monkeypatch):
    result = read(monkeypatch, fail=True, written_expected=6, always_verify=True)
    assert result.method == "pattern"
    assert len(result.key.written) == 6
    assert any("模型解析失败" in n for n in result.notes)


def test_a_model_failure_on_an_incomplete_reading_says_so(monkeypatch):
    result = read(monkeypatch, fail=True, written_expected=50)
    assert any("不完整" in n for n in result.notes)


# --- reading the model's answer ------------------------------------------------

def test_answers_outside_one_to_four_are_dropped():
    """A hallucinated "5" must not reach the paper."""
    key = _from_payload({"written": {"1": "2", "2": "5", "3": ""}})
    assert key.written == {1: "2"}


def test_an_ordering_that_is_not_four_options_is_dropped():
    key = _from_payload({"orders": {"36": "3412", "37": "341", "38": "3455"}})
    assert key.orders == {36: "3412"}


def test_listening_slots_are_keyed_by_problem_and_number():
    key = _from_payload({"listening": {"2-3": "4", "bad": "1", "2-x": "1"}})
    assert key.listening == {(2, 3): "4"}


# --- what counts as complete ----------------------------------------------------

def test_a_reading_short_of_the_paper_is_incomplete():
    assert not _looks_complete(AnswerKey(written={1: "2"}), 70, 0)


def test_a_reading_missing_listening_is_incomplete():
    key = AnswerKey(written={n: "1" for n in range(1, 71)})
    assert not _looks_complete(key, 70, 35)


def test_an_empty_reading_is_never_complete():
    assert not _looks_complete(AnswerKey(), 0, 0)


def test_comparison_ignores_items_only_one_side_read():
    a = AnswerKey(written={1: "2", 2: "3"})
    b = AnswerKey(written={1: "2"})
    assert compare(a, b) == []
