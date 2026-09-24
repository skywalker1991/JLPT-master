"""Read the answer key out of a JLPT answer sheet or 解析 booklet.

The existing parser looks for `Q12: 3`, one per line. No real paper is laid
out that way. A 2018年07月 N1 sheet reads:

    1-6      7-13      14-19    20-25
    241243   4323122   314312   423141

    排序题答案： 36→3412  37→4132 …

    第三部分  问题1  243324    问题2  231221

— ranges with the digits run together underneath, 並べ替え as a full ordering,
listening grouped per 問題 and numbered from one again inside each.

The 解析 booklet states an answer per item as well (「1、正解：2」 and
「1 番 正解：4」), which is an independent reading of the same key. Comparing
the two catches a misread without anyone checking by hand: across the 25
items both covered in 2018年07月, they agreed on every one.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

#: "1-6" … then "241243" on its own line further down.
_RANGE = re.compile(r"(\d{1,3})\s*[-–—]\s*(\d{1,3})")
#: A run of option digits. Not anchored to a line: sheets print the ranges on
#: one line and their answers on the next, and the runs are broken by spaces
#: wherever they happen to fall rather than at 問題 boundaries.
_DIGITS = re.compile(r"(?<![0-9\-])([1-4]{2,})(?![0-9\-])")
#: 並べ替え: "36→3412", the whole ordering rather than one option.
_ORDER = re.compile(r"(\d{1,3})\s*[→>]\s*([1-4]{4})")
#: 解析 booklet, written section. The separator after the item number is not
#: reliable — 2018 wrote "1、正解：2" and 2019 "1 正解：4" — and the heading
#: itself alternates between 正解 and 答案.
_SOLUTION = re.compile(
    r"(?:^|\n)\s*(\d{1,3})\s*[、.．]?\s*(?:正解|答案)\s*[：:]\s*([1-4])(?![0-9])"
)
#: 並べ替え stated as a whole ordering inside the booklet: "36、答案：1423".
_SOLUTION_ORDER = re.compile(r"(\d{1,3})\s*[、.．]?\s*(?:正解|答案)\s*[：:]\s*([1-4]{4})(?![0-9])")
#: 解析 booklet, listening: "6 番 正解：4" — numbered within its 問題.
_SOLUTION_BAN = re.compile(r"(\d{1,2})\s*番\s*正解\s*[：:]\s*([1-4])")
#: "问题3" / "問題3" heading in the listening part of an answer sheet.
_LISTENING_GROUP = re.compile(r"[问問]题?\s*([1-5])")


@dataclass
class AnswerKey:
    """Answers found in one document.

    `written` is keyed by the printed item number, which runs unbroken through
    the written booklet. `listening` needs the 問題 as well because 聴解 starts
    again at 一番 in every one.
    """
    written: dict[int, str] = field(default_factory=dict)
    orders: dict[int, str] = field(default_factory=dict)          # 並べ替え full orderings
    listening: dict[tuple[int, int], str] = field(default_factory=dict)

    @property
    def total(self) -> int:
        return len(self.written) + len(self.listening)


def parse_answer_sheet(text: str, listening_counts: dict[int, int] | None = None) -> AnswerKey:
    """The grid: ranges, then the digits for each range underneath.

    `listening_counts` maps 聴解 問題 number to how many 番 it holds, taken from
    the question paper. The sheet gives no such boundaries — 問題4's fourteen
    answers are simply printed as "32312 32131 321" — so without them the
    digits cannot be split reliably.
    """
    key = AnswerKey()

    # 排序題 answers ("36→1423") are digits too, and belong to a different
    # question type; take them out before anything counts digit runs.
    # Listening lives under 问题N headings and is numbered inside each 問題,
    # so its digits must not be poured into the written numbering. Cutting at
    # the last "部分" happened to work on one sheet and dropped 18 items on
    # another whose listening part was not last.
    listening_at = _LISTENING_GROUP.search(text)
    written_region = text[: listening_at.start()] if listening_at else text
    written_region = _ORDER.sub(" ", written_region)

    _allocate_ranges(written_region, key)

    for num, order in _ORDER.findall(text):
        key.orders[int(num)] = order

    _parse_listening_groups(text, key, listening_counts)
    return key


def _allocate_ranges(text: str, key: AnswerKey) -> None:
    """Pair "1-6 7-13 …" with the digits printed under them.

    Sheets vary in ways that defeat matching a range to a run by length. 2018
    printed one range and one run per line; 2019 puts four ranges on a line and
    their answers on the next, and splits a ten-item range into two runs of
    five. So ranges are collected until digits appear, the digits are
    concatenated, and the range widths say where to cut.
    """
    tokens: list[tuple[str, object]] = []
    for match in re.finditer(r"(\d{1,3})\s*[-–—]\s*(\d{1,3})|([1-4]{2,})", text):
        if match.group(1):
            tokens.append(("range", (int(match.group(1)), int(match.group(2)))))
        else:
            tokens.append(("digits", match.group(3)))

    pending: list[tuple[int, int]] = []
    buffer = ""

    def flush() -> None:
        nonlocal pending, buffer
        position = 0
        for low, high in pending:
            width = high - low + 1
            chunk = buffer[position: position + width]
            for offset, num in enumerate(range(low, low + len(chunk))):
                key.written[num] = chunk[offset]
            position += width
        pending, buffer = [], ""

    for kind, value in tokens:
        if kind == "range":
            if buffer:
                flush()
            pending.append(value)
        else:
            buffer += value
    flush()


def _parse_listening_groups(text: str, key: AnswerKey, counts: dict[int, int] | None) -> None:
    """Listening answers, grouped per 問題 and renumbered from 一番 in each.

    The sheet does not interleave a 問題 with its answers. It prints a run of
    headings, then their answers underneath, then the next run — and the digit
    groups do not line up with 問題 boundaries either: "32312 32131 321 2334"
    is a 問題 of fourteen followed by one of three. So headings are collected
    until digits appear, the digits are concatenated, and `counts` — taken from
    the question paper, since the sheet never states them — says where to cut.
    """
    if not counts:
        return

    listening_at = _LISTENING_GROUP.search(text)
    region = text[listening_at.start():] if listening_at else text
    tokens: list[tuple[str, str]] = []
    for match in re.finditer(r"[问問]题?\s*([1-5])|([1-4]{2,})", region):
        if match.group(1):
            tokens.append(("heading", match.group(1)))
        else:
            tokens.append(("digits", match.group(2)))

    pending: list[int] = []
    buffer = ""

    def flush() -> None:
        nonlocal pending, buffer
        position = 0
        for group in pending:
            width = counts.get(group, 0)
            for index, digit in enumerate(buffer[position: position + width], start=1):
                key.listening[(group, index)] = digit
            position += width
        pending, buffer = [], ""

    for kind, value in tokens:
        if kind == "heading":
            if buffer:          # a new run of headings begins: settle the last one
                flush()
            pending.append(int(value))
        else:
            buffer += value
    flush()


#: Where the booklet stops explaining the written booklet and starts on 聴解.
#: Both sittings head it the same way, and it matters: listening items are
#: numbered inside their 問題, so "63 正解：2" down there is 問題5's third item,
#: not written item 63 — which is what made a cross-check report a conflict
#: against an answer sheet that was right.
_LISTENING_SECTION = re.compile(r"听力原文|聴解原文|听力解析")


def parse_booklet_table(text: str, listening_counts: dict[int, int] | None = None) -> AnswerKey | None:
    """The summary table some 解析 booklets print before the explanations.

    It is an answer sheet in every respect except that it has a text layer,
    which matters where the real sheet does not: 2019年12月's is sixteen pages
    of scan, and 並べ替え orderings cannot be read off an image at all — they
    are printed here as "36→3124".

    Only the table is read, never the booklet. The explanations that follow are
    forty pages of prose full of question numbers and digit runs, and handing
    those to a grid parser invents answers out of them. The boundary is the
    first 正解: the table does not use the word, and every explanation does.

    Returns None when the booklet has no such table — 2018年07月's opens
    straight into 文字解析.
    """
    table = text[: text.find("正解")] if "正解" in text else text
    if not _RANGE.search(table) and not _ORDER.search(table):
        return None
    return parse_answer_sheet(table, listening_counts)


def parse_explanations(text: str) -> AnswerKey:
    """The 解析 booklet, which states an answer alongside each explanation.

    Only the written half is read. The listening half restates answers against
    its own numbering, which would collide with written item numbers.
    """
    boundary = _LISTENING_SECTION.search(text)
    if boundary:
        text = text[: boundary.start()]

    key = AnswerKey()
    # Orderings first: a four-digit answer would otherwise be read as a single
    # option followed by stray digits.
    for num, order in _SOLUTION_ORDER.findall(text):
        key.orders[int(num)] = order
    for num, answer in _SOLUTION.findall(text):
        if int(num) not in key.orders:
            key.written[int(num)] = answer
    return key


def resolve_order_answer(order: str, star_position: int) -> str | None:
    """Which option belongs in the ★ blank.

    The sheet gives the whole ordering (3412) and the stem says which blank
    carries the ★; the answer is whatever lands there. Neither alone is enough,
    which is why the answer sheet stays worth ingesting even when the 解析 is
    available.
    """
    if not order or not 1 <= star_position <= len(order):
        return None
    return order[star_position - 1]


@dataclass
class Disagreement:
    num: int
    sheet: str
    explanation: str


def cross_check(sheet: AnswerKey, explanations: AnswerKey) -> list[Disagreement]:
    """Where two independent readings of the same key differ.

    Agreement is not proof, but a disagreement is always worth a look, and
    finding them mechanically is what removes the need to check the rest.
    """
    shared = sorted(set(sheet.written) & set(explanations.written))
    return [
        Disagreement(num, sheet.written[num], explanations.written[num])
        for num in shared
        if sheet.written[num] != explanations.written[num]
    ]
