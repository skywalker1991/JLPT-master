"""Read the official 公式問題集, which is printed unlike anything else.

The community reprints are retyped in Word and read like it. The official
booklets are typeset, and three things they do defeat a reader written for
the reprints:

    ruby        The listening script sets furigana over almost every kanji —
                a third of the characters on the page — and extraction lays
                them down beside the words they gloss, so 「女の人が」 comes
                out 「女 おんな の人 ひと が」. Sent to a synthesiser that is
                read aloud.

    the tab     A section name runs down the outside margin, one character
                to a line, and lands in the text as 文 / 字 / ・ / 語 / 彙
                between the questions.

    the number  Each question is numbered in a reversed-out box, set in a
                font subsetted per page whose codes carry no meaning: the
                first glyph a page uses is \x02 whatever digit it draws. On
                page 3 \x02 is 1; on page 4 it is 7.

None of the three is a defect in the booklet. They are what a printed page
looks like, and the reader has to be told about them once.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

#: Ruby is set at half the size of what it glosses. Anything under this much
#: of the body size is a candidate; being small is not enough on its own.
RUBY_MAX_RATIO = 0.7

#: …it also has to sit over the words it belongs to. A note or a page number
#: is small too, and sits on a line of its own.
RUBY_MAX_GAP = 14.0

#: The outside margin, where the section tab runs. Measured from the right
#: edge of the paper rather than in absolute points, since the booklets are
#: not all the same width.
TAB_MARGIN = 45.0


@dataclass
class Span:
    x0: float
    y0: float
    x1: float
    y1: float
    size: float
    font: str
    text: str


def spans_of(page) -> list[Span]:
    out: list[Span] = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "")
                if not text.strip():
                    continue
                x0, y0, x1, y1 = span["bbox"]
                out.append(Span(x0, y0, x1, y1, round(span["size"], 1),
                                span.get("font", ""), text))
    return out


def body_size(spans: list[Span]) -> float:
    """The size most of the page is set in."""
    weighted: Counter = Counter()
    for s in spans:
        weighted[s.size] += len(s.text)
    return weighted.most_common(1)[0][0] if weighted else 0.0


def _rows(spans: list[Span], tolerance: float = 3.0) -> list[list[Span]]:
    rows: dict[int, list[Span]] = {}
    for s in spans:
        rows.setdefault(round(s.y0 / tolerance), []).append(s)
    return [sorted(v, key=lambda s: s.x0) for _, v in sorted(rows.items())]


def ruby_rows(spans: list[Span], body: float) -> list[list[Span]]:
    """The lines that are glosses rather than text.

    Judged a line at a time, not a span at a time. How the ruby over one line
    of text is cut into spans is the typesetter's business and it varies
    between the booklets: the listening script emits the whole line's
    furigana as a single run, 「かちょううみやまさんぎょう…」, which is wider
    than any of the words it glosses and so fits inside none of them. What
    holds either way is that the line is set small and the line under it is
    the text it belongs to.
    """
    if body <= 0:
        return []
    rows = _rows(spans)
    found = []
    for index, row in enumerate(rows[:-1]):
        size = max(s.size for s in row)
        if size > body * RUBY_MAX_RATIO:
            continue
        below = rows[index + 1]
        if max(s.size for s in below) <= size * 1.3:
            continue                       # two small lines: not a gloss
        gap = min(s.y0 for s in below) - max(s.y1 for s in row)
        if not -2.0 <= gap <= RUBY_MAX_GAP:
            continue
        left, right = min(s.x0 for s in row), max(s.x1 for s in row)
        b_left, b_right = min(s.x0 for s in below), max(s.x1 for s in below)
        if right < b_left or left > b_right:
            continue                       # not over it at all
        found.append(row)
    return found


def is_tab(span: Span, page) -> bool:
    """One character of the section name, running down the outside margin."""
    return (
        len(span.text.strip()) == 1
        and span.x0 > page.rect.x1 - TAB_MARGIN
    )
