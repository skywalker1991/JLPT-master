"""Cut a question paper into 問題 blocks before anything tries to read it.

Splitting is done with patterns because the anchors barely move between
sittings, and it buys three things that matter more than the splitting itself:
each block is small enough for a model to read carefully, a block that fails
validation can be re-read on its own, and a failure names the 問題 rather than
the paper.

The awkward parts are all in how a heading is written. 問題 numbers appear
half-width, full-width, and with a space ("問題1", "問題２", "問題 4"); every
heading is immediately restated by the instruction beneath it ("問題１ 問題１
では、…"); and 聴解 starts its numbering over, so 問題1 exists twice in one
paper and means different things.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

#: 問題 heading. The number may be half-width, full-width, or spaced away.
_HEADING = re.compile(r"問題\s*([0-9０-９]{1,2})")

#: Where 読解 begins. Printed as its own word above 問題8 in both sittings.
_READING_MARKER = re.compile(r"(?<![^\s])読解(?![^\s])")

#: Where the listening booklet begins and 問題 numbering starts over.
_LISTENING_MARKER = re.compile(r"第三部分|聽解|聴解")

WRITTEN = "言語知識"
READING = "読解"
LISTENING = "聴解"


def _number(raw: str) -> int:
    return int(raw.translate(str.maketrans("０１２３４５６７８９", "0123456789")))


@dataclass
class Block:
    """One 問題 and the text under it."""
    section: str        # 言語知識 | 読解 | 聴解
    name: str           # 問題1
    number: int
    text: str
    start: int          # offset in the source, for tracing back


def _listening_start(text: str) -> int:
    """Where the listening booklet begins, or past the end if there is none.

    Taken from the last marker rather than the first: 聴解 also appears on the
    cover, listing what the paper contains.
    """
    matches = list(_LISTENING_MARKER.finditer(text))
    if not matches:
        return len(text)
    # The cover mentions it within the first page or so; the real one follows
    # the written booklet.
    for match in matches:
        if match.start() > len(text) * 0.5:
            return match.start()
    return matches[-1].start()


def _reading_start(text: str, limit: int) -> int:
    """Where 読解 begins, searched only within the written booklet."""
    match = _READING_MARKER.search(text, 0, limit)
    # The cover lists it too, so require it to be past the first 問題.
    first_problem = _HEADING.search(text)
    floor = first_problem.start() if first_problem else 0
    while match and match.start() < floor:
        match = _READING_MARKER.search(text, match.end(), limit)
    return match.start() if match else limit


def split_problems(text: str) -> list[Block]:
    """The paper as a list of 問題 blocks, in the order they are printed."""
    listening_at = _listening_start(text)
    reading_at = _reading_start(text, listening_at)

    headings: list[tuple[int, int]] = []
    for match in _HEADING.finditer(text):
        number = _number(match.group(1))
        # Every heading is restated by the instruction below it; keep the first.
        if headings and headings[-1][1] == number and match.start() - headings[-1][0] < 120:
            continue
        # Listening numbering restarts, so the same number appearing again is
        # only a repeat while we are still in the same booklet.
        if headings and headings[-1][1] == number and match.start() < listening_at:
            continue
        headings.append((match.start(), number))

    blocks: list[Block] = []
    for index, (start, number) in enumerate(headings):
        end = headings[index + 1][0] if index + 1 < len(headings) else len(text)
        if start >= listening_at:
            section = LISTENING
        elif start >= reading_at:
            section = READING
        else:
            section = WRITTEN
        blocks.append(Block(
            section=section, name=f"問題{number}", number=number,
            text=text[start:end].strip(), start=start,
        ))
    return blocks
