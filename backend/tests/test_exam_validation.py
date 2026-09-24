"""Which extraction defects are worth a human's attention.

Grounded in the two N1 papers already imported: 214 items, of which exactly
one was actually broken (a 並べ替え item whose ★ was dropped, leaving it
unscorable) and one 問題 was filed under a different section than the same
問題 in the other paper. Review caught neither.

The numbering cases below are the ones that made the first version of this
module useless: JLPT is two booklets, the written one numbered straight
through and 聴解 starting again at 一番 inside every 問題.
"""
from app.services.exam_validation import (
    baseline_key, check_hard, check_soft, learn_baseline, validate,
)


def item(num, *, options=4, answer="1", stem="問題文"):
    return {
        "num": num, "seq": num, "stem": stem,
        "options": {str(i): f"選択肢{i}" for i in range(1, options + 1)},
        "correct_answer": answer,
    }


def paper(*sections):
    return {"level": "N1", "title": "テスト", "sections": list(sections)}


def section(name, *problems):
    return {"name": name, "problems": list(problems)}


def problem(name, ptype, items):
    return {"name": name, "type": ptype, "items": items}


def written(*items):
    return paper(section("言語知識", problem("問題1", "kanji_reading", list(items))))


# --- hard: violations of what the question type means ------------------------

def test_a_clean_paper_needs_nobody_to_look_at_it():
    assert validate(written(item(1), item(2))).clean


def test_an_item_that_departs_from_its_problem_is_rejected():
    """The count is not fixed at four: 聴解問題4 is 即時応答, one line of audio
    and three replies, and a fixed four files thirteen findings a paper against
    correct questions. What holds is that one 問題 prints one shape, so the odd
    item out is the one worth looking at."""
    report = check_hard(written(item(1), item(2), item(3, options=3)))
    assert "选项数为 3" in report.hard[0].message
    assert "第3题" in report.hard[0].where


def test_a_problem_whose_questions_all_print_three_options_is_accepted():
    p = paper(section("聴解", problem("問題4", "listening", [
        {"num": n, "stem": "", "options": {"1": "a", "2": "b", "3": "c"},
         "correct_answer": "2"} for n in (1, 2, 3)
    ])))
    assert check_hard(p).clean


def test_a_listening_item_may_print_no_options_at_all():
    """Some 聴解 items are answered from audio alone."""
    p = paper(section("聴解", problem("問題1", "listening", [
        {"num": 1, "stem": "", "options": {}, "correct_answer": "2"},
    ])))
    assert check_hard(p).clean


def test_a_missing_answer_is_rejected():
    assert "缺正确答案" in check_hard(written(item(1, answer=""))).hard[0].message


def test_an_answer_outside_one_to_four_is_rejected():
    assert "不在 1-4" in check_hard(written(item(1, answer="5"))).hard[0].message


def test_a_sentence_order_item_without_a_star_cannot_be_scored():
    """The real defect found in 2015年07月 第39题 — silent, and unscorable."""
    p = paper(section("文法", problem("問題6", "sentence_order", [
        item(39, stem="原因を [_1_] [_2_] [_3_] [_4_] 報告があった。"),
    ])))
    report = check_hard(p)
    assert report.hard and "★" in report.hard[0].message
    assert report.problems_to_retry == ["問題6"]


def test_a_sentence_order_item_with_one_star_passes():
    p = paper(section("文法", problem("問題6", "sentence_order", [
        item(39, stem="原因を [_1_] [_2_] [_3★_] [_4_] 報告があった。"),
    ])))
    assert check_hard(p).clean


def test_only_the_broken_problem_is_retried_not_the_whole_paper():
    p = paper(section("言語知識",
        problem("問題1", "kanji_reading", [item(1), item(2)]),
        problem("問題2", "vocab_fill", [item(3), item(4), item(5, options=2)]),
    ))
    assert check_hard(p).problems_to_retry == ["問題2"]


# --- hard: numbering, scoped per booklet -------------------------------------

def test_a_gap_in_the_written_numbering_is_rejected():
    assert "题号不连续" in check_hard(written(item(1), item(4))).hard[0].message


def test_listening_numbering_restarts_inside_every_problem():
    """每個聴解問題 starts again at 一番, so repeated 1s are correct, not
    duplicates — checking the booklet as a whole flagged all 37 items."""
    p = paper(section("聴解",
        problem("問題1", "listening", [item(1), item(2)]),
        problem("問題2", "listening", [item(1), item(2), item(3)]),
    ))
    assert check_hard(p).clean


def test_a_repeat_inside_one_listening_problem_is_still_rejected():
    p = paper(section("聴解", problem("問題1", "listening", [item(1), item(1)])))
    assert "重复" in check_hard(p).hard[0].message


def test_written_and_listening_numbers_do_not_collide():
    """問題1 番1 in 聴解 is not a duplicate of 第1问 in the written booklet."""
    p = paper(
        section("言語知識", problem("問題1", "kanji_reading", [item(1), item(2)])),
        section("聴解", problem("問題1", "listening", [item(1), item(2)])),
    )
    assert check_hard(p).clean


# --- soft: differences from papers of this level seen before -----------------

def test_nothing_is_queried_when_no_paper_of_this_level_exists_yet():
    assert check_soft(written(item(1)), baseline=None).clean


def test_a_problem_filed_under_a_different_section_is_queried():
    """Same 問題7, two papers, two sections — from the same input."""
    first = paper(section("読解", problem("問題7", "passage_fill", [item(1)])))
    second = paper(section("言語知識（文法）", problem("問題7", "passage_fill", [item(1)])))
    report = check_soft(second, learn_baseline([first]))
    assert report.soft and "読解" in report.soft[0].message
    assert not report.hard  # papers vary; this asks, it does not block


def test_an_unusual_item_count_is_queried_not_blocked():
    first = paper(section("言語知識", problem("問題1", "kanji_reading", [item(1), item(2)])))
    second = paper(section("言語知識", problem("問題1", "kanji_reading", [item(1)])))
    report = check_soft(second, learn_baseline([first]))
    assert "本卷 1 题" in report.soft[0].message and not report.hard


def test_the_baseline_follows_the_majority_so_one_oddity_does_not_become_normal():
    usual = paper(section("言語知識", problem("問題1", "kanji_reading", [item(1), item(2)])))
    odd = paper(section("言語知識", problem("問題1", "kanji_reading", [item(1)])))
    baseline = learn_baseline([usual, odd, usual])
    assert baseline["筆記/問題1"]["item_count"] == 2
    assert baseline["筆記/問題1"]["seen_in"] == 3


def test_the_baseline_keeps_the_two_booklets_apart():
    """問題1 means kanji readings in one booklet and a listening set in the
    other; keying on the name alone made each look like a change of type."""
    p = paper(
        section("言語知識", problem("問題1", "kanji_reading", [item(1)])),
        section("聴解", problem("問題1", "listening", [item(1)])),
    )
    baseline = learn_baseline([p])
    assert set(baseline) == {"筆記/問題1", "聴解/問題1"}
    assert check_soft(p, baseline).clean


def test_a_problem_the_level_usually_has_but_this_paper_lacks_is_queried():
    first = paper(section("言語知識",
        problem("問題1", "kanji_reading", [item(1)]),
        problem("問題2", "vocab_fill", [item(2)]),
    ))
    second = paper(section("言語知識", problem("問題1", "kanji_reading", [item(1)])))
    assert any("本卷没有" in f.message for f in check_soft(second, learn_baseline([first])).soft)


def test_baseline_key_names_the_booklet():
    assert baseline_key({"name": "問題1", "type": "listening"}) == "聴解/問題1"
    assert baseline_key({"name": "問題1", "type": "kanji_reading"}) == "筆記/問題1"
