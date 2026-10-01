from app.api.jlpt import _clean
from app.services import jlpt_practice as jp


def test_practice_category_by_section_and_number():
    assert jp.category_of("言語知識（文字・語彙）", "問題2").label == "文脈規定"
    assert jp.category_of("読解", "問題13").label == "情報検索"
    assert jp.category_of("聴解", "問題１").label == "課題理解"  # full-width digit, 聴解 restarts at 1
    assert jp.category_of("聴解", "問題9") is None


def test_parts_and_scaling():
    assert jp.part_of_section("言語知識（文法）") == "言語知識"
    assert jp.part_of_section("読解") == "読解"
    assert jp.scaled(22, 44) == 30 and jp.scaled(0, 0) == 0
    assert jp.paper_label("2025年07月", "") == "2025年7月"


def test_clean_rejoins_printed_line_breaks():
    assert _clean("強調す\nることは。\n次の文。") == "強調することは。\n次の文。"
    assert _clean("__下線__の部分") == "下線の部分"
    assert _clean("です。\n（注１）琴線：心\nを動かす") == "です。\n（注１）琴線：心を動かす"
