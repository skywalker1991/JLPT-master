"""What kind of question each 問題 is.

The instruction cannot always say, and the difference matters downstream:
vocabulary and grammar are kept apart in the knowledge base, so a 問題 typed
wrongly puts its questions in the wrong half of it.
"""
from app.services.exam_categories import type_by_number


def test_the_number_tells_grammar_from_vocabulary():
    """言語知識 問題2 and 問題5 are both printed as 「（ ）に入れるのに最もよい
    ものを」. Read from the instruction, 問題5's 「と引きかえに」「守るべく」 come
    out as vocabulary."""
    assert type_by_number("N1", "言語知識", "問題2") == "vocab_fill"
    assert type_by_number("N1", "言語知識", "問題5") == "grammar_fill"


def test_it_says_nothing_outside_言語知識():
    """読解 and 聴解 state what they are, and their numbering carries no such
    meaning."""
    assert type_by_number("N1", "読解", "問題5") is None
    assert type_by_number("N1", "聴解", "問題5") is None


def test_a_level_with_no_table_falls_back_to_the_instruction():
    """問題5 of N2 is not 問題5 of N1, so an unknown level says nothing rather
    than applying N1's numbering to it."""
    assert type_by_number("N2", "言語知識", "問題5") is None
    assert type_by_number(None, "言語知識", "問題5") is None


def test_the_number_is_read_however_it_is_printed():
    assert type_by_number("N1", "言語知識", "問題６") == "sentence_order"
