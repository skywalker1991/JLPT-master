"""Get the text out of a PDF page in the order it is printed.

`get_text()` returns characters exactly but in the order the PDF stores them,
which is not always the order they appear on the page. For most of a JLPT
paper the two agree, but where they don't the damage is silent and severe: the
★ in a 並べ替え stem marks which blank is being asked about, and four options
read out of sequence renumber every answer on the page. Neither shows up as a
structural error afterwards — the result is perfectly well-formed and wrong.

So position comes from geometry. Words are grouped into lines by their
baseline and ordered within a line by x, and a page laid out in columns is
split before that happens rather than read straight across.
"""
from __future__ import annotations

from dataclasses import dataclass

#: Words whose baselines sit within this many points are the same line.
LINE_TOLERANCE = 4.0

#: A gap this wide, running the height of the text, separates columns.
COLUMN_GAP = 40.0

#: Lines each side must have before a gap counts as a column boundary.
#:
#: A 2x2 block of options — 1 and 2 on one line, 3 and 4 on the next — is
#: geometrically identical to two columns, and splitting it reads the options
#: as 1,3,2,4 and renumbers every answer. Coordinates cannot tell the two
#: apart; length can, since a passage set in columns runs for many lines and an
#: option block is two.
COLUMN_MIN_LINES = 5


@dataclass
class PageText:
    number: int          # 1-based
    text: str
    has_text_layer: bool


def _lines(words, tolerance: float = LINE_TOLERANCE) -> list[str]:
    rows: dict[int, list[tuple[float, str]]] = {}
    for x0, y0, _x1, _y1, word, *_ in words:
        rows.setdefault(round(y0 / tolerance), []).append((x0, word))
    return [
        " ".join(word for _, word in sorted(row))
        for _, row in sorted(rows.items())
    ]


def _split_columns(words) -> list[list]:
    """Columns, if the page is laid out in them.

    Reading a two-column page straight across interleaves two passages line by
    line, which no downstream check would catch.
    """
    if not words:
        return []

    xs = sorted((w[0], w[2]) for w in words)
    page_left = xs[0][0]
    page_right = max(x1 for _, x1 in xs)

    # Walk the x axis; a stretch no word occupies, wide enough and not at the
    # margins, is a column boundary.
    occupied = sorted(xs)
    boundary = None
    reach = occupied[0][1]
    for x0, x1 in occupied[1:]:
        if x0 - reach > COLUMN_GAP:
            midpoint = (reach + x0) / 2
            # Ignore gutters hard against either margin: those are indents.
            if page_left + COLUMN_GAP < midpoint < page_right - COLUMN_GAP:
                boundary = midpoint
                break
        reach = max(reach, x1)

    if boundary is None:
        return [words]

    left = [w for w in words if w[2] <= boundary]
    right = [w for w in words if w[2] > boundary]

    # Both sides have to read as a column of text. Too few lines and this is an
    # option block or an indent, where reading across the gap is correct.
    def line_count(side) -> int:
        return len({round(w[1] / LINE_TOLERANCE) for w in side})

    if min(line_count(left), line_count(right)) < COLUMN_MIN_LINES:
        return [words]
    # A handful of stragglers is a heading spanning the page, not a column.
    if min(len(left), len(right)) < max(len(left), len(right)) * 0.15:
        return [words]
    return [left, right]


def page_text(page) -> str:
    """One page, read the way it is printed."""
    words = page.get_text("words")
    if not words:
        return ""
    return "\n".join(
        "\n".join(_lines(column)) for column in _split_columns(words)
    )


def read_pdf(data: bytes) -> list[PageText]:
    """Every page of a PDF, positioned by geometry rather than storage order."""
    import fitz

    document = fitz.open(stream=data, filetype="pdf")
    try:
        pages = []
        for index, page in enumerate(document, start=1):
            text = page_text(page)
            pages.append(PageText(number=index, text=text, has_text_layer=bool(text.strip())))
        return pages
    finally:
        document.close()


def joined(pages: list[PageText]) -> str:
    return "\n".join(p.text for p in pages)


def render_pages(data: bytes, *, limit: int = 3, dpi: int = 200) -> list[bytes]:
    """The first few pages as PNGs, for a file that has no text to read.

    Some answer sheets are pure scans — 2019年12月's is sixteen pages without a
    single character of text layer — so the grid can only be read by looking at
    it. The grid itself is on the first page or two.
    """
    import fitz

    document = fitz.open(stream=data, filetype="pdf")
    try:
        return [
            document[index].get_pixmap(dpi=dpi).tobytes("png")
            for index in range(min(limit, len(document)))
        ]
    finally:
        document.close()
