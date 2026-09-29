"""What a person decided, laid back over a paper read in again.

A ruling is kept apart from the paper, keyed by where the question sits, so
the paper can be deleted and read again as often as the extractor improves.
Each of these is a decision that was once lost to exactly that.
"""
from app.services.exam_canonical import (
    CanonicalItem, CanonicalPaper, CanonicalProblem, CanonicalSection,
)
from app.services.exam_ingest import _apply_decided
from app.services.exam_merge import MergeReport
from app.services.exam_rulings import RULED, ruled_blank


def paper():
    reading = CanonicalProblem(
        name="問題10", type="reading_comp", seq=1,
        instruction="次の文章を読んで", passage="誤読された文章",
        items=[CanonicalItem(num=59, seq=1, stem="問い", correct_answer="2")],
    )
    listening = CanonicalProblem(
        name="問題1", type="listening", seq=1,
        items=[CanonicalItem(num=4, seq=4, options={"3": "调查協力"}, transcript="旧原文")],
    )
    return CanonicalPaper(level="N1", title="t", source="2018年12月", sections=[
        CanonicalSection(name="読解", seq=3, problems=[reading]),
        CanonicalSection(name="聴解", seq=4, problems=[listening]),
    ])


def test_a_problem_s_own_passage_is_put_back():
    """問題10 prints one passage for all its questions, so the ruling on it
    belongs to no question in particular."""
    p = paper()
    _apply_decided(p, {("読解", "問題10", None, "passage"): ("正しい文章", "第 12 页原文")},
                   MergeReport())
    assert p.sections[0].problems[0].passage == "正しい文章"


def test_a_corrected_option_and_transcript_are_put_back():
    """The one typo in the bank was in an option, and options could not be
    ruled on — so the fix went every time the paper was read again."""
    p = paper()
    _apply_decided(p, {
        ("聴解", "問題1", 4, "options"): ({"3": "調查協力"}, "照原文"),
        ("聴解", "問題1", 4, "transcript"): ("新原文", None),
    }, MergeReport())
    item = p.sections[1].problems[0].items[0]
    assert item.options == {"3": "調查協力"}
    assert item.transcript == "新原文"


def test_a_ruling_that_there_is_no_answer_is_kept_as_one():
    """Not left out: somebody looked and agreed the material does not say, and
    the checks need to hear that or they ask again."""
    p = paper()
    _apply_decided(p, {("読解", "問題10", 59, "correct_answer"): (None, "材料没印")},
                   MergeReport())
    item = p.sections[0].problems[0].items[0]
    assert item.correct_answer is None
    assert ruled_blank(item.votes)


def test_a_ruled_answer_is_a_vote():
    p = paper()
    _apply_decided(p, {("読解", "問題10", 59, "correct_answer"): ("3", "答案页")},
                   MergeReport())
    assert p.sections[0].problems[0].items[0].votes[RULED] == "3"
