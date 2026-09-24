"""Reading the answer key off a real JLPT answer sheet.

The parser this replaces looked for `Q12: 3`, one per line, which no sheet is
laid out as. The fixtures below are the shapes a 2018年07月 N1 sheet actually
uses, including the two that made the first attempt misread every listening
answer: headings printed in a run before their answers rather than beside
them, and digit groups that ignore 問題 boundaries.
"""
from app.services.exam_answers import (
    cross_check, parse_answer_sheet, parse_explanations, resolve_order_answer,
)

# Laid out as the real sheet is: ranges together, digits together underneath.
SHEET = """
2018 年7 月N1 真题参考答案
第一部分
1-6
7-13
14-19
20-25

241243
4323122
314312
423141

排序题答案：
36→3412  37→4132  38→1423  39→2143  40→2341

第三部分
问题1
问题2
问题3
243324
231221
332142
问题4
问题5
32312  32131  321
2334
"""

#: 問題1-5 of this paper's 聴解, counted off the question paper. 2015年07月 was
#: 6/7/6/14/4 — the counts move between sittings, so they cannot be hardcoded.
COUNTS = {1: 6, 2: 6, 3: 6, 4: 14, 5: 3}


def test_a_range_expands_into_one_answer_per_item():
    key = parse_answer_sheet(SHEET)
    assert [key.written[n] for n in range(1, 7)] == list("241243")
    assert [key.written[n] for n in range(7, 14)] == list("4323122")


def test_every_written_item_in_the_ranges_is_covered():
    key = parse_answer_sheet(SHEET)
    assert len(key.written) == 6 + 7 + 6 + 6


def test_sentence_order_answers_are_kept_as_the_whole_ordering():
    """"36→3412" is the sentence put right, not one option."""
    assert parse_answer_sheet(SHEET).orders[36] == "3412"


def test_the_starred_blank_decides_the_answer():
    assert resolve_order_answer("3412", 3) == "1"
    assert resolve_order_answer("4132", 1) == "4"


def test_a_star_outside_the_ordering_yields_nothing():
    assert resolve_order_answer("3412", 9) is None
    assert resolve_order_answer("", 1) is None


# --- listening ---------------------------------------------------------------

def test_listening_is_keyed_by_problem_because_numbering_restarts():
    key = parse_answer_sheet(SHEET, listening_counts=COUNTS)
    assert key.listening[(1, 1)] == "2"
    assert key.listening[(2, 1)] == "2"   # 問題2 一番, not a duplicate of 問題1's


def test_headings_printed_before_their_answers_still_line_up():
    """The sheet prints 问题1/2/3 together, then their three runs of digits."""
    key = parse_answer_sheet(SHEET, listening_counts=COUNTS)
    assert "".join(key.listening[(1, i)] for i in range(1, 7)) == "243324"
    assert "".join(key.listening[(3, i)] for i in range(1, 7)) == "332142"


def test_digit_groups_that_ignore_problem_boundaries_are_split_by_count():
    """"32312 32131 321 2334" is a 問題 of fourteen and one of three — the
    groups on the page are not the 問題."""
    key = parse_answer_sheet(SHEET, listening_counts=COUNTS)
    assert "".join(key.listening[(4, i)] for i in range(1, 15)) == "32312321313212"
    assert "".join(key.listening[(5, i)] for i in range(1, 4)) == "334"


def test_every_listening_item_is_covered():
    key = parse_answer_sheet(SHEET, listening_counts=COUNTS)
    assert len(key.listening) == sum(COUNTS.values()) == 35


def test_listening_is_left_alone_when_the_paper_has_not_been_counted_yet():
    """Better no listening answers than 35 misaligned ones."""
    assert parse_answer_sheet(SHEET).listening == {}


def test_counts_from_a_different_sitting_cut_the_digits_differently():
    """2015年07月 ran 6/7/6/14/4 where this paper runs 6/6/6/14/3, so the same
    digits have to divide up differently — nothing about the sheet says where
    one 問題 ends."""
    other = {1: 5, 2: 7, 3: 6, 4: 13, 5: 4}
    key = parse_answer_sheet(SHEET, listening_counts=other)
    assert len(key.listening) == sum(other.values()) == 35
    assert "".join(key.listening[(2, i)] for i in range(1, 8)) == "4231221"


def test_answers_run_out_rather_than_shifting_when_counts_are_too_large():
    """A count larger than the sheet supplies leaves items unanswered — which
    the paper validator reports as a missing answer — instead of borrowing
    digits from the next 問題 and misaligning everything after it."""
    too_many = {1: 6, 2: 6, 3: 6, 4: 14, 5: 9}
    key = parse_answer_sheet(SHEET, listening_counts=too_many)
    assert "".join(key.listening[(4, i)] for i in range(1, 15)) == "32312321313212"
    assert len([i for i in range(1, 10) if (5, i) in key.listening]) == 3


# --- the 解析 booklet as a second reading ------------------------------------

EXPLANATIONS = """
1、正解：2
解析：鈴木回顾了一下当时的情况。
2、正解：4
解析：我不禁觉得他的话里多少有点掺假。
3、正解：1
"""


def test_the_explanation_booklet_yields_answers_of_its_own():
    key = parse_explanations(EXPLANATIONS)
    assert key.written == {1: "2", 2: "4", 3: "1"}


def test_two_sources_agreeing_reports_nothing():
    """25 items overlapped in 2018年07月 and every one agreed."""
    assert cross_check(parse_answer_sheet(SHEET), parse_explanations(EXPLANATIONS)) == []


def test_a_disagreement_between_the_two_sources_is_reported():
    wrong = EXPLANATIONS.replace("1、正解：2", "1、正解：3")
    found = cross_check(parse_answer_sheet(SHEET), parse_explanations(wrong))
    assert len(found) == 1
    assert (found[0].num, found[0].sheet, found[0].explanation) == (1, "2", "3")


def test_items_only_one_source_covers_are_not_treated_as_disagreements():
    """The sheet reaches further than the explanations; that is not a conflict."""
    sheet = parse_answer_sheet(SHEET)
    assert len(sheet.written) > len(parse_explanations(EXPLANATIONS).written)
    assert cross_check(sheet, parse_explanations(EXPLANATIONS)) == []


# --- what a second sitting changed --------------------------------------------
#
# 2019年07月 printed the same information differently in three ways, each of
# which silently produced fewer answers rather than an error.

SHEET_2019 = """
2019 年7 月日语能力测试N1 答案
第一部分
1-6 7-13 14-19 20-25
442132 3411234 214312 432132
26-35 36-40 41-45
23413 12314 23412 32241
排序题答案：
36→1423 37→4231 38→3142 39→2143 40→4213
第二部分
46-49 50-57 58-61 62-63
3243 322 144 43 3141 32
"""


def test_ranges_and_answers_each_sharing_one_line_still_pair_up():
    """2018 printed one range per line; 2019 puts four on a line with their
    answers on the next. Requiring a run to stand alone found nothing."""
    key = parse_answer_sheet(SHEET_2019)
    assert [key.written[n] for n in range(1, 7)] == list("442132")
    assert [key.written[n] for n in range(7, 14)] == list("3411234")


def test_a_range_whose_answers_are_split_across_runs_is_still_filled():
    """26-35 is ten items printed as "23413 12314" — matching a run to a range
    by length drops it entirely."""
    key = parse_answer_sheet(SHEET_2019)
    assert [key.written[n] for n in range(26, 36)] == list("2341312314")


def test_runs_that_ignore_range_boundaries_are_cut_by_width():
    """"3243 322 144 43 3141 32" spans four ranges of 4, 8, 4 and 2."""
    key = parse_answer_sheet(SHEET_2019)
    assert [key.written[n] for n in range(46, 50)] == list("3243")
    assert [key.written[n] for n in range(50, 58)] == list("32214443")
    assert [key.written[n] for n in range(62, 64)] == list("32")


def test_sentence_order_answers_are_not_eaten_by_the_range_scan():
    """"36→1423" is four option digits sitting among the ranges."""
    key = parse_answer_sheet(SHEET_2019)
    assert key.orders[36] == "1423"
    # 36-40 is its own range, and 26-35 takes ten digits before it.
    assert key.written[36] == "2"


EXPLANATIONS_2019 = """
2019 年7 月日语能力考试N1 文字解析
1 正解：4
解析：对那种态度激烈地生气了。
2 正解：4
36、答案：1423
37、答案：4231
2019 年7 月N1 听力原文
第五题 63 正解：2
男：新会计系统的启用，好像要延后一个月左右了。
"""


def test_an_item_number_without_its_punctuation_is_still_read():
    """2018 wrote "1、正解：2" and 2019 "1 正解：4"."""
    assert parse_explanations(EXPLANATIONS_2019).written[1] == "4"


def test_the_booklet_also_says_答案_where_it_said_正解():
    assert parse_explanations(EXPLANATIONS_2019).orders[36] == "1423"


def test_listening_explanations_do_not_pose_as_written_items():
    """Listening is numbered inside its 問題, so "63 正解：2" under 听力原文 is
    問題5's third item. Read as written item 63 it contradicted an answer sheet
    that was right — a conflict reported against nothing."""
    key = parse_explanations(EXPLANATIONS_2019)
    assert 63 not in key.written


def test_an_ordering_is_not_read_as_a_single_option():
    """"36、答案：1423" must not land in written as "1"."""
    key = parse_explanations(EXPLANATIONS_2019)
    assert 36 not in key.written
    assert key.orders[36] == "1423"
