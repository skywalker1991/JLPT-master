"""Sorting out what each uploaded PDF is.

A sitting arrives as several files: 2018年07月 came as the question paper with
a full text layer, the same paper again as page scans, the answer sheet, and
the 解析 booklet. Ingest accepted one file, so a sitting went in incomplete or
was assembled by hand.

The case that shapes the code: the scanned copy and the answer sheet both have
a 6% text layer, so coverage alone throws the answer sheet away with the
scans. What separates them is what the little text there says.
"""
from app.services.exam_sources import (
    Role, Source, assess, classify, classify_all,
)

QUESTIONS = """
問題1 ＿＿の言葉の読み方として最もよいものを、１・２・３・４から一つ選びなさい。
1 決勝の素晴らしい試合に観客は興奮した。
問題6 次の文の ★ に入る最もよいものを、１・２・３・４から一つ選びなさい。
"""

EXPLANATIONS = """
2018 年7 月日语能力考试N1 文字解析
1、正解：2  解析：铃木回顾了一下当时的情况。
2、正解：4  解析：我不禁觉得他的话里多少有点掺假。
3、正解：1  解析：我没有特别讨厌。
4、正解：3  解析：…
5、正解：2  解析：…
6、正解：4  解析：…
1 番 正解：2  市役所で女の人と男の人が話しています。
"""

ANSWER_SHEET = """
2018 年7 月N1 真题参考答案
1-6
7-13
14-19
241243
4323122
314312
"""


def source(text, *, pages=10, text_pages=10, name="x.pdf"):
    return Source(filename=name, page_count=pages, text_pages=text_pages, text=text)


def test_a_question_paper_is_recognised_by_its_instructions():
    assert classify(source(QUESTIONS)) is Role.QUESTIONS


def test_the_explanation_booklet_is_recognised_by_its_per_item_answers():
    assert classify(source(EXPLANATIONS)) is Role.EXPLANATIONS


def test_the_answer_sheet_is_recognised_by_its_grid():
    assert classify(source(ANSWER_SHEET, pages=16, text_pages=1)) is Role.ANSWER_SHEET


def test_an_answer_sheet_is_not_mistaken_for_a_scan_despite_its_thin_text_layer():
    """The scanned paper and the answer sheet both read 6% text in 2018年07月;
    only the content tells them apart."""
    sheet = source(ANSWER_SHEET, pages=16, text_pages=1)
    assert sheet.text_coverage < 0.5
    assert classify(sheet, has_text_twin=True) is Role.ANSWER_SHEET


def test_a_scan_of_a_paper_already_present_as_text_is_set_aside():
    """Same content, far worse extraction — worth skipping, not re-reading."""
    scan = source("2018 年7 月新日本語能力試験 N1 注意", pages=16, text_pages=1)
    text_copy = source(QUESTIONS, pages=23, text_pages=23)
    classify_all([text_copy, scan])
    assert text_copy.role is Role.QUESTIONS
    assert scan.role is Role.SCANNED


def test_a_scan_is_kept_when_it_is_the_only_copy_of_the_paper():
    """Nothing else holds this material, so a bad source beats no source."""
    scan = source(QUESTIONS, pages=16, text_pages=1)
    classify_all([scan])
    assert scan.role is Role.QUESTIONS


def test_the_explanations_are_not_mistaken_for_the_answer_sheet():
    """Both carry ranges and digits; the 解析 booklet is simply much longer."""
    long_booklet = source(EXPLANATIONS + "1-6\n241243\n" + "解析：" * 500)
    assert classify(long_booklet) is Role.EXPLANATIONS


# --- what the set can support -------------------------------------------------

def test_a_full_set_reports_nothing_missing():
    sources = classify_all([
        source(QUESTIONS, pages=23, text_pages=23),
        source(EXPLANATIONS, pages=43, text_pages=42),
        source(ANSWER_SHEET, pages=16, text_pages=1),
    ])
    capability = assess(sources)
    assert capability.can_build_paper and capability.can_score
    assert capability.has_listening_scripts and capability.missing == []


def test_a_question_paper_on_its_own_still_imports():
    """Requiring the whole set would keep papers out for want of a file that
    only affects scoring."""
    capability = assess(classify_all([source(QUESTIONS, pages=23, text_pages=23)]))
    assert capability.can_build_paper
    assert not capability.can_score
    assert any("无法判分" in m for m in capability.missing)


def test_without_explanations_listening_has_no_script():
    """試題 prints the options but never the dialogue, so audio cannot be made."""
    capability = assess(classify_all([
        source(QUESTIONS, pages=23, text_pages=23),
        source(ANSWER_SHEET, pages=16, text_pages=1),
    ]))
    assert capability.can_score
    assert not capability.has_listening_scripts
    assert any("听力缺原文" in m for m in capability.missing)


def test_without_the_answer_sheet_sentence_order_loses_its_ordering():
    """The 解析 states which option is right; only the sheet gives 36→3412,
    and the ★ position alone cannot fill the blank."""
    capability = assess(classify_all([
        source(QUESTIONS, pages=23, text_pages=23),
        source(EXPLANATIONS, pages=43, text_pages=42),
    ]))
    assert capability.can_score
    assert any("完整语序" in m for m in capability.missing)


def test_a_set_with_no_question_paper_cannot_build_one():
    capability = assess(classify_all([source(ANSWER_SHEET, pages=16, text_pages=1)]))
    assert not capability.can_build_paper
    assert any("无法建卷" in m for m in capability.missing)
