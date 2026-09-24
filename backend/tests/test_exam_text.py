"""Reading a page in the order it is printed.

`get_text()` returns characters exactly but in the order the PDF stores them.
Where that differs from the printed order the damage is silent: the ★ in a
並べ替え stem marks which blank is asked about, and four options read out of
sequence renumber every answer on the page. Both produce a structurally
perfect, wrong paper, so no later check catches them.

Word tuples below are (x0, y0, x1, y1, text) as PyMuPDF yields them.
"""
from app.services.exam_text import _lines, _split_columns, page_text


def word(x0, y0, text, width=20.0, height=10.0):
    return (x0, y0, x0 + width, y0 + height, text, 0, 0, 0)


class _FakePage:
    def __init__(self, words): self._words = words
    def get_text(self, kind="text"): return self._words if kind == "words" else ""


# --- lines --------------------------------------------------------------------

def test_words_on_one_baseline_are_ordered_left_to_right():
    """Storage order is not reading order; x is."""
    words = [word(300, 100, "４である"), word(100, 100, "１と言えば"), word(200, 100, "２要するに")]
    assert _lines(words) == ["１と言えば ２要するに ４である"]


def test_baselines_a_hair_apart_are_still_one_line():
    words = [word(100, 100, "左"), word(200, 101.5, "右")]
    assert _lines(words) == ["左 右"]


def test_lines_come_out_top_to_bottom():
    words = [word(100, 200, "下"), word(100, 100, "上")]
    assert _lines(words) == ["上", "下"]


# --- columns ------------------------------------------------------------------

def test_a_two_column_page_is_read_one_column_at_a_time():
    """Read straight across, two passages interleave line by line and the
    result still validates perfectly. Both sides run long enough to be columns
    rather than a block of options."""
    words = []
    for i in range(6):
        words.append(word(60, 100 + i * 20, f"左{i}"))
        words.append(word(400, 100 + i * 20, f"右{i}"))
    expected = "\n".join(f"左{i}" for i in range(6)) + "\n" + "\n".join(f"右{i}" for i in range(6))
    assert page_text(_FakePage(words)) == expected


def test_two_short_blocks_side_by_side_are_read_across():
    """A 2x2 option block looks exactly like two columns; splitting it reads
    the options as 1,3,2,4."""
    words = [
        word(60, 100, "１"), word(280, 100, "２"),
        word(60, 120, "３"), word(280, 120, "４"),
    ]
    assert page_text(_FakePage(words)) == "１ ２\n３ ４"


def test_a_single_column_page_is_left_alone():
    words = [word(60, 100, "一"), word(90, 100, "二"), word(60, 120, "三")]
    assert page_text(_FakePage(words)) == "一 二\n三"


def test_an_indent_is_not_mistaken_for_a_column_boundary():
    """A gap against the margin is where the text starts, not a gutter."""
    words = [word(300, 100, "字下げした行"), word(60, 120, "通常の行")]
    assert len(_split_columns(words)) == 1


def test_a_heading_spanning_the_page_does_not_create_a_column():
    """One wide line over a body of text is a title, not a second column."""
    words = [word(60, 80, "見出し", width=500)] + [
        word(60, 100 + i * 20, f"本文{i}") for i in range(10)
    ]
    assert len(_split_columns(words)) == 1


def test_a_page_with_no_text_layer_yields_nothing():
    assert page_text(_FakePage([])) == ""


# --- what this is guarding ----------------------------------------------------

def test_option_numbering_survives_a_page_stored_out_of_order():
    """The paper is renumbered wholesale if these come back shuffled."""
    stored_backwards = [
        word(280, 100, "４今まで欲しいと思いつつ"),
        word(60, 100, "３引越しするのを機に"),
        word(280, 80, "２ソファを買うことにした"),
        word(60, 80, "１買えずにいた"),
    ]
    assert page_text(_FakePage(stored_backwards)) == (
        "１買えずにいた ２ソファを買うことにした\n"
        "３引越しするのを機に ４今まで欲しいと思いつつ"
    )


def test_the_starred_blank_keeps_its_place_in_the_stem():
    """★ says which blank is being asked about; move it and the answer moves."""
    stem = [
        word(60, 100, "妹は、来月初めに"), word(160, 100, "＿＿＿"),
        word(200, 100, "＿＿＿"), word(240, 100, "＿★＿"), word(280, 100, "＿＿＿"),
        word(320, 100, "そうだ。"),
    ]
    line = page_text(_FakePage(stem))
    blanks = [part for part in line.split() if "＿" in part]
    assert blanks.index("＿★＿") == 2      # the third blank, as printed
