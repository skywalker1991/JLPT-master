"""Putting answers onto a paper, and saying what did not land.

Answers come separately from questions and in three shapes — a grid of ranges,
a full ordering for 並べ替え, and per-item 正解 lines in the 解析 booklet — so
joining them is its own step between extraction and import.

It works on a CanonicalPaper, never on a file. That is the point of the
intermediate form: a new publisher or a changed layout is a new extractor, and
nothing here moves.
"""
from app.services.exam_answers import AnswerKey
from app.services.exam_canonical import (
    CanonicalItem, CanonicalPaper, CanonicalProblem, CanonicalSection, from_dict,
)
from app.services.exam_merge import merge_answers


def paper(*problems, level="N1"):
    return CanonicalPaper(
        level=level, title="テスト",
        sections=[CanonicalSection(name="言語知識", seq=1, problems=list(problems))],
    )


def problem(name, ptype, items, seq=1):
    return CanonicalProblem(name=name, type=ptype, seq=seq, items=items)


def item(num, seq=None, **kw):
    return CanonicalItem(num=num, seq=seq if seq is not None else num, **kw)


def test_written_answers_land_on_their_numbers():
    p = paper(problem("問題1", "kanji_reading", [item(1), item(2)]))
    report = merge_answers(p, AnswerKey(written={1: "3", 2: "4"}))
    assert [i.correct_answer for _, _, i in p.items()] == ["3", "4"]
    assert report.answered == 2 and report.unanswered == 0


def test_items_with_no_answer_are_counted_rather_than_guessed():
    """A paper whose answer sheet is missing still imports; those questions
    just cannot be scored."""
    p = paper(problem("問題1", "kanji_reading", [item(1), item(2)]))
    report = merge_answers(p, AnswerKey(written={1: "3"}))
    assert report.answered == 1 and report.unanswered == 1
    assert any("无法判分" in n for n in report.notes)


def test_listening_answers_are_matched_per_problem_not_by_item_number():
    """聴解 numbering restarts at 一番 in every 問題."""
    p = paper(
        problem("問題1", "listening", [item(1), item(2)], seq=1),
        problem("問題2", "listening", [item(1), item(2)], seq=2),
    )
    merge_answers(p, AnswerKey(listening={(1, 1): "2", (1, 2): "3", (2, 1): "4", (2, 2): "1"}))
    answers = [i.correct_answer for _, _, i in p.items()]
    assert answers == ["2", "3", "4", "1"]


def test_sentence_order_takes_the_option_sitting_in_the_starred_blank():
    p = paper(problem("問題6", "sentence_order", [
        item(36, meta={"star_position": 3}),
    ]))
    report = merge_answers(p, AnswerKey(orders={36: "3412"}))
    _, _, first = next(p.items())
    assert first.answer_order == "3412"
    assert first.correct_answer == "1"      # third of 3-4-1-2
    assert report.orders_applied == 1


def test_an_ordering_without_a_star_position_is_kept_but_reported():
    """2015年07月 第39题 lost its ★ during extraction; the ordering is still
    worth storing so review can show the sentence put right."""
    p = paper(problem("問題6", "sentence_order", [item(39, meta={})]))
    report = merge_answers(p, AnswerKey(orders={39: "2143"}))
    _, _, only = next(p.items())
    assert only.answer_order == "2143"
    assert only.correct_answer is None
    assert any("不知道 ★" in n for n in report.notes)


def test_a_star_beyond_the_ordering_is_reported():
    p = paper(problem("問題6", "sentence_order", [item(36, meta={"star_position": 9})]))
    report = merge_answers(p, AnswerKey(orders={36: "3412"}))
    assert any("超出" in n for n in report.notes)


# --- two sources ---------------------------------------------------------------

def test_the_answer_sheet_wins_where_both_sources_cover_an_item():
    """The sheet spans the whole paper; the 解析 only answers what it discusses."""
    p = paper(problem("問題1", "kanji_reading", [item(1)]))
    merge_answers(p, AnswerKey(written={1: "3"}), AnswerKey(written={1: "3"}))
    _, _, only = next(p.items())
    assert only.correct_answer == "3"


def test_the_explanations_fill_in_what_the_sheet_missed():
    p = paper(problem("問題1", "kanji_reading", [item(1), item(2)]))
    merge_answers(p, AnswerKey(written={1: "3"}), AnswerKey(written={2: "4"}))
    assert [i.correct_answer for _, _, i in p.items()] == ["3", "4"]


def test_two_sources_disagreeing_is_reported_not_resolved_quietly():
    p = paper(problem("問題1", "kanji_reading", [item(1)]))
    report = merge_answers(p, AnswerKey(written={1: "3"}), AnswerKey(written={1: "2"}))
    assert len(report.conflicts) == 1
    assert "答案表=3" in report.conflicts[0] and "解析=2" in report.conflicts[0]


def test_merging_with_no_answers_at_all_leaves_the_paper_importable():
    p = paper(problem("問題1", "kanji_reading", [item(1)]))
    report = merge_answers(p)
    assert report.answered == 0 and report.unanswered == 1
    assert report.conflicts == []


# --- the contract itself --------------------------------------------------------

def test_listening_counts_come_from_the_paper_not_from_the_source_file():
    """The answer sheet never states where one 聴解 問題 ends, so the counts
    that divide its digits are read off the extracted paper."""
    p = paper(
        problem("問題1", "listening", [item(i, seq=i) for i in range(1, 7)], seq=1),
        problem("問題2", "listening", [item(i, seq=i) for i in range(1, 8)], seq=2),
    )
    assert p.listening_counts() == {1: 6, 2: 7}


def test_a_paper_survives_a_round_trip_through_storage():
    """Re-running an improved extractor means reading back what was stored."""
    p = paper(problem("問題6", "sentence_order", [
        item(36, meta={"star_position": 3}, answer_order="3412", correct_answer="1"),
    ]))
    back = from_dict(p.to_dict())
    _, _, restored = next(back.items())
    assert restored.answer_order == "3412"
    assert restored.meta["star_position"] == 3
    assert back.version == p.version


def test_a_paper_stored_by_an_older_extractor_still_loads():
    """Unknown keys are dropped rather than raising, so stored papers stay
    readable as the shape grows."""
    back = from_dict({
        "level": "N1", "title": "旧版",
        "sections": [{"name": "言語知識", "problems": [
            {"name": "問題1", "type": "kanji_reading",
             "items": [{"num": 1, "stem": "…", "unknown_field": "x"}]},
        ]}],
    })
    _, _, only = next(back.items())
    assert only.num == 1 and only.answer_order is None
