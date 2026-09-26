"""Recovering the word a question underlines.

Three of the written 問題 say which word they are asking about by underlining
it, and an underline is a drawn line rather than anything the text carries. Cut
it out and 「鈴木氏は当時を回顧して、次のように語った。」 is four candidate words
with nothing to distinguish them — the options are all readings, so they give
no clue either.

The case that took three attempts: papers set their text at different leadings,
and 2018年07月's rules sit 2.8pt above the following line. Choosing the row by
distance picks that one; the row whose glyph boxes contain the rule is the
right one, because the rule is drawn through the characters it marks.
"""
from app.services.exam_underline import (
    MARK, find_underlines, mark_star_blanks, mark_underlines, star_slots,
    underlined_spans,
)


class _Rect:
    def __init__(self, x0, y0, x1, y1):
        self.x0, self.y0, self.x1, self.y1 = x0, y0, x1, y1
        self.width, self.height = x1 - x0, y1 - y0


class _Point:
    def __init__(self, x, y): self.x, self.y = x, y


class _Page:
    """Enough of a PyMuPDF page: drawn rules, and characters with boxes."""
    def __init__(self, rules, chars):
        self._rules, self._chars = rules, chars

    def get_drawings(self):
        return [{"items": [("l", _Point(x0, y), _Point(x1, y))]} for x0, x1, y in self._rules]

    def get_text(self, kind):
        return {"blocks": [{"lines": [{"spans": [{"chars": [
            {"c": c, "bbox": box} for box, c in self._chars
        ]}]}]}]}


def row(text, *, top, left=100.0, width=10.0, height=14.8):
    """One line of characters laid out left to right."""
    return [((left + i * width, top, left + (i + 1) * width, top + height), c)
            for i, c in enumerate(text)]


# --- finding the rules ----------------------------------------------------------

def test_a_flat_stroke_is_an_underline():
    page = _Page([(100.0, 140.0, 158.0)], [])
    assert len(find_underlines(page)) == 1


def test_a_stroke_too_short_to_cover_a_character_is_ignored():
    page = _Page([(100.0, 102.0, 158.0)], [])
    assert find_underlines(page) == []


# --- matching them to text --------------------------------------------------------

def test_the_underlined_word_is_read_off_the_page():
    chars = row("鈴木氏は当時を回顧して", top=146.0)
    # The rule spans 回顧, drawn through the glyphs at y=158.9.
    page = _Page([(170.0, 190.0, 158.9)], chars)
    assert [text for *_, text in underlined_spans(page)] == ["回顧"]


def test_the_row_containing_the_rule_wins_over_the_nearer_one():
    """2018年07月 sets 15.6pt leading, so a rule sits 2.8pt above the next line
    and 12.8pt below the top of its own — picking by distance reads the wrong
    row and interleaves two into gibberish."""
    chars = row("嫌悪感は持たなかった", top=151.6) + row("次の問いに答えなさい", top=167.2)
    page = _Page([(100.0, 130.0, 164.4)], chars)
    assert [text for *_, text in underlined_spans(page)] == ["嫌悪感"]


def test_a_table_rule_with_only_digits_over_it_is_not_an_underline():
    """Answer grids and 並べ替え blanks are ruled too."""
    page = _Page([(100.0, 130.0, 158.9)], row("123", top=146.0))
    assert underlined_spans(page) == []


def test_a_rule_with_no_text_over_it_is_ignored():
    assert underlined_spans(_Page([(400.0, 460.0, 158.9)], row("あいう", top=146.0))) == []


# --- marking ------------------------------------------------------------------------

def test_the_word_is_wrapped_where_it_appears():
    chars = row("鈴木氏は当時を回顧して", top=146.0)
    page = _Page([(170.0, 190.0, 158.9)], chars)
    assert mark_underlines(page, "鈴木氏は当時を回顧して") == f"鈴木氏は当時を{MARK}回顧{MARK}して"


def test_text_with_no_underlines_is_returned_untouched():
    page = _Page([], row("あいう", top=146.0))
    assert mark_underlines(page, "あいう") == "あいう"


def test_a_word_already_marked_is_not_marked_twice():
    chars = row("回顧した", top=146.0)
    page = _Page([(100.0, 120.0, 158.9)], chars)
    once = mark_underlines(page, "回顧した")
    assert mark_underlines(page, once) == once


# --- the ★ in a 並べ替え question ---------------------------------------------

class _StarPage(_Page):
    """A page whose 並べ替え blanks are drawn rules rather than ＿ characters."""
    def __init__(self, rules, stars):
        super().__init__(rules, [])
        self._stars = stars

    def search_for(self, needle):
        assert needle == "★"
        return [_Rect(x0, y - 10.0, x0 + 10.5, y) for x0, y in self._stars]


def line_of_blanks(y, *, left=284.0, star_at=3, number_rule=True):
    """One question's row: a short number rule, then four blanks.

    The blank holding the ★ is set wider to make room for it — 32pt against
    26pt — which is how the papers themselves distinguish it.
    """
    rules = [(90.7, 104.7, y)] if number_rule else []
    x = left
    star_x = None
    for slot in range(1, 5):
        width = 32.2 if slot == star_at else 26.2
        rules.append((x, x + width, y))
        if slot == star_at:
            star_x = x + 10.0
        x += width + 5.2
    return rules, (star_x, y)


def test_the_star_sits_in_the_widest_blank_on_its_line():
    rules, star = line_of_blanks(322.0, star_at=3)
    assert star_slots(_StarPage(rules, [star])) == [3]


def test_the_question_number_rule_is_not_counted_as_a_blank():
    """Without dropping it, every ★ reads one slot later than it is."""
    rules, star = line_of_blanks(322.0, star_at=1)
    assert star_slots(_StarPage(rules, [star])) == [1]


def test_a_star_over_a_single_rule_is_the_instruction_not_a_question():
    """「次の文の ★ に入る」 heads the 問題 and has no blanks to sit in."""
    page = _StarPage([(175.9, 213.4, 270.0)], [(192.0, 270.0)])
    assert star_slots(page) == []


def test_the_blanks_are_written_back_into_the_text():
    rules, star = line_of_blanks(322.0, star_at=2)
    page = _StarPage(rules, [star])
    assert mark_star_blanks(page, "この本が ★ 喜びはありません。") == (
        "この本が ＿＿＿＿ ＿★＿＿ ＿＿＿＿ ＿＿＿＿ 喜びはありません。"
    )


def test_the_instruction_keeps_its_bare_star():
    """It is counted so the questions after it stay lined up, not rewritten."""
    rules, star = line_of_blanks(322.0, star_at=3)
    page = _StarPage([(175.9, 213.4, 270.0)] + rules, [(192.0, 270.0), star])
    marked = mark_star_blanks(page, "次の文の ★ に入る\n36 できるもんなら ★ 困っている。")
    assert marked.startswith("次の文の ★ に入る")
    assert marked.endswith("＿＿＿＿ ＿＿＿＿ ＿★＿＿ ＿＿＿＿ 困っている。")


def test_a_page_whose_blanks_are_characters_is_left_alone():
    """2018年7月 prints 「＿★＿＿」 itself; there is nothing to recover."""
    text = "３６ 妹は、来月初めに＿＿＿ ＿＿＿＿ ＿★＿＿ ＿＿＿そうだ。"
    assert mark_star_blanks(_StarPage([], [(192.0, 322.0)]), text) == text


def test_nothing_is_written_when_the_text_and_the_page_disagree():
    """A column split reorders the page; guessing would move the blanks."""
    rules, star = line_of_blanks(322.0, star_at=3)
    page = _StarPage(rules, [star])
    assert mark_star_blanks(page, "★ と ★") == "★ と ★"
