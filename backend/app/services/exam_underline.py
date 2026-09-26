"""Find the words a paper underlines, and mark them in the extracted text.

Three of the seven written 問題 ask about a specific word and say which one by
underlining it. Plain text extraction drops that, and the question becomes
unanswerable — 「鈴木氏は当時を回顧して、次のように語った。」 is four candidate
words with nothing to say which is being asked about, and the options give no
clue because they are all readings.

The underline is a drawn line, not a font attribute, so it is recovered by
geometry: a thin horizontal stroke, and the characters sitting over it. Its
baseline lands inside the character box rather than below it, which is why
matching on "the line is under the glyph" finds nothing.
"""
from __future__ import annotations

from dataclasses import dataclass

#: A stroke this thin, drawn this flat, is a rule rather than a box edge.
MAX_THICKNESS = 2.5
MIN_LENGTH = 4.0
FLATNESS = 1.5

#: How far the stroke may sit from the glyph's own vertical span. Underlines
#: in these papers are drawn across the lower part of the character box, so
#: the test is overlap-with-tolerance, not "below".
VERTICAL_SLACK = 4.0

#: Characters further apart than this vertically belong to different rows.
SAME_LINE = 3.0

#: A rule further than this from any row of text is a table border, not an
#: underline. Kept under the tightest leading seen (15.6pt) so a rule cannot
#: reach the row above.
MAX_ROW_DISTANCE = 14.0


def _chars(raw):
    for block in raw.get("blocks", []):
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                for char in span.get("chars", []):
                    x0, y0, x1, y1 = char["bbox"]
                    yield y0, x0, x1, y1, char["c"]

MARK = "__"


@dataclass
class Underline:
    x0: float
    x1: float
    y: float


def find_underlines(page) -> list[Underline]:
    """Horizontal rules drawn on a page."""
    found: list[Underline] = []
    for drawing in page.get_drawings():
        for item in drawing["items"]:
            if item[0] == "l":
                start, end = item[1], item[2]
                if abs(start.y - end.y) < FLATNESS and abs(end.x - start.x) >= MIN_LENGTH:
                    found.append(Underline(min(start.x, end.x), max(start.x, end.x), start.y))
            elif item[0] == "re":
                rect = item[1]
                if rect.height < MAX_THICKNESS and rect.width >= MIN_LENGTH:
                    found.append(Underline(rect.x0, rect.x1, rect.y1))
    return found


def underlined_spans(page) -> list[tuple[float, float, float, str]]:
    """Each underline with the text sitting on it, as (x0, x1, y, text)."""
    rules = find_underlines(page)
    if not rules:
        return []

    spans: list[tuple[float, float, float, str]] = []
    raw = page.get_text("rawdict")
    for rule in rules:
        # Characters the stroke actually passes through, keeping only the
        # closest text line: a generous vertical window pulls in the line above
        # as well, interleaving two rows into gibberish like 「ん嫌 悪 2感け」.
        # The rule is drawn through the glyphs it underlines, so the row it
        # belongs to is the one whose boxes contain it. Choosing by distance
        # instead picks the row below whenever the leading is tight — 2018年07月
        # sets 15.6pt, and its rules sit only 2.8pt above the next line.
        over = [
            (top, x0, char)
            for top, x0, x1, bottom, char in _chars(raw)
            if rule.x0 - 1 <= (x0 + x1) / 2 <= rule.x1 + 1
            and top <= rule.y <= bottom
        ]
        if not over:
            continue
        row = min(over, key=lambda c: abs(c[0] - rule.y))[0]
        chars = [(x, c) for top, x, c in over if abs(top - row) < SAME_LINE]

        text = "".join(c for _, c in sorted(chars)).strip()
        # Table rules and the boxes around 並べ替え blanks are horizontal too;
        # what sits over them is a number or nothing, never a word.
        if not text or text.isdigit() or not any(ch.isalpha() for ch in text):
            continue
        spans.append((rule.x0, rule.x1, rule.y, text))
    return spans


def mark_underlines(page, text: str) -> str:
    """Wrap underlined words in the page's text with `__…__`.

    The marker survives extraction because the model is told to copy it, and
    the check that every stem appears in the source strips it on both sides —
    so a marked stem still matches the page it came from.
    """
    marked = text
    for _x0, _x1, _y, phrase in underlined_spans(page):
        phrase = phrase.strip()
        if len(phrase) < 1 or f"{MARK}{phrase}{MARK}" in marked:
            continue
        # Only the first occurrence: a word repeated in one stem is underlined
        # where it is being asked about, and that is the one printed first.
        marked = marked.replace(phrase, f"{MARK}{phrase}{MARK}", 1)
    return marked


#: 並べ替え prints four blanks and marks one with ★. Where the blanks are ＿
#: characters the text layer carries 「＿★＿＿」 and says which slot plainly;
#: where they are drawn as rules — 2013年7月 — nothing of it survives
#: extraction, and a model asked for the position has nothing to read.
#:
#: It is still on the page. The star is a glyph with coordinates, the blanks
#: are rules with coordinates, and the rule holding the star is set wider than
#: its neighbours to make room for it: 32pt against 26pt, every time. That
#: width is what identifies it, and it is also what separates the four blanks
#: from the question-number rule on the same line, which is 14pt.
BLANK_MIN_WIDTH = 18.0
BLANK_MAX_WIDTH = 60.0


def _stars(page) -> list[tuple[float, int | None]]:
    """Every ★ on the page, top to bottom, with the blank it sits in.

    The slot is None where the star is not part of a run of four blanks: the
    instruction line reads 「次の文の ★ に入る」 over a single rule and is not
    a question. It is still returned, because the caller lines these up
    against the ★ characters in the page's text and a dropped one shifts
    every question after it.
    """
    rules = [r for r in find_underlines(page)
             if BLANK_MIN_WIDTH <= r.x1 - r.x0 <= BLANK_MAX_WIDTH]
    found: list[tuple[float, int | None]] = []

    for star in page.search_for("★"):
        slot = None
        row = sorted((r for r in rules if abs(r.y - star.y1) < 6.0),
                     key=lambda r: r.x0)
        # The last four rules on the line are the blanks; anything before
        # them is the question number's rule, set far shorter.
        for index, rule in enumerate(row[-4:], start=1) if len(row) >= 4 else ():
            if rule.x0 - 2 <= star.x0 and star.x1 <= rule.x1 + 2:
                slot = index
                break
        found.append((star.y1, slot))

    return sorted(found)


def star_slots(page) -> list[int]:
    """Which blank each ★ sits in, for the stars that are in one."""
    return [slot for _, slot in _stars(page) if slot is not None]


#: What a drawn blank is written as once it is back in the text, matching the
#: 「＿＿＿ ＿★＿＿」 the papers that use ＿ characters already print.
BLANK = "＿＿＿＿"


def mark_star_blanks(page, text: str) -> str:
    """Write the drawn 並べ替え blanks into the page's text.

    Papers that set the blanks as ＿ characters say where the ★ is and need
    nothing; this puts the other kind into the same shape, so that one reading
    of the stem works for both and the position is read rather than guessed.
    """
    stars = _stars(page)
    if not any(slot for _, slot in stars):
        return text
    # The text is assembled top to bottom, so the nth ★ in it is the nth down
    # the page — but only if both agree on how many there are. They disagree
    # when a column split reorders the page, and then a substitution would
    # move the blanks onto the wrong question.
    if text.count("★") != len(stars):
        return text

    out: list[str] = []
    rest = text
    for _y, slot in stars:
        before, _, rest = rest.partition("★")
        out.append(before)
        if slot is None:
            out.append("★")
            continue
        blanks = [BLANK] * 4
        blanks[slot - 1] = "＿★＿＿"
        out.append(" ".join(blanks))
    out.append(rest)
    return "".join(out)
