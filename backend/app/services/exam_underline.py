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
