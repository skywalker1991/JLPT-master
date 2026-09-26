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


def test_聴解_numbering_means_nothing_because_it_starts_over():
    """聴解問題1 is 課題理解, not 漢字読み. It is the one section the number
    cannot speak for."""
    assert type_by_number("N1", "聴解", "問題1") is None
    assert type_by_number("N1", "聴解", "問題5") is None


def test_the_number_says_which_half_of_the_booklet_too():
    """Where 読解 begins is not reliably printed — 2013年07月 repeats it as a
    divider, 2016年12月 prints it only on the cover — so 問題13 is 情報検索
    whichever half a split happened to put it in."""
    assert type_by_number("N1", "言語知識", "問題13") == "info_search"
    assert type_by_number("N1", "読解", "問題13") == "info_search"
    assert type_by_number("N1", "言語知識", "問題5") == "grammar_fill"
    #: 読解's other five are one type, so the number says nothing for them.
    assert type_by_number("N1", "読解", "問題9") is None


def test_the_last_読解_問題_is_information_retrieval():
    """問題13 prints a notice and asks the reader to find something in it, so
    it is the one reading type whose page has to be kept as printed."""
    assert type_by_number("N1", "読解", "問題13") == "info_search"
    assert type_by_number("N2", "読解", "問題13") is None


def test_a_level_with_no_table_falls_back_to_the_instruction():
    """問題5 of N2 is not 問題5 of N1, so an unknown level says nothing rather
    than applying N1's numbering to it."""
    assert type_by_number("N2", "言語知識", "問題5") is None
    assert type_by_number(None, "言語知識", "問題5") is None


def test_the_number_is_read_however_it_is_printed():
    assert type_by_number("N1", "言語知識", "問題６") == "sentence_order"
