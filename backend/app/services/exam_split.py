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

#: The largest number a 問題 heading carries. N1's written booklet runs to
#: 問題13 and its listening to 問題5; no level numbers higher.
#:
#: The bound is what keeps 問題 from being read as the ordinary word it also
#: is. 2012年07月's 問題7 ends 「…文化の問題 45 と思うのである。」 — a
#: sentence about a problem, followed by the passage's last blank — and read
#: as a heading it cut 問題7 off before its options, leaving the 問題 with no
#: questions at all.
MAX_HEADING = 20

#: 問題 heading. The number may be half-width, full-width, or spaced away.
#: 「問 題 1」 too: 2011年07月 spaces its listening headings for furigana, and
#: 聴解問題1 and 2 — thirteen questions — were never split out.
_HEADING = re.compile(r"問[^\S\n]*題\s*([0-9０-９]{1,2})(?![0-9０-９])")

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

    The cover lists 聴解 among the paper's parts, so a marker before the first
    問題 does not count. Nor, if there is no marker after it, is the cover's the
    one to fall back on: 2025年07月's pages were transcribed without the
    listening booklet's own cover, the cover's 聴解 was the only one, and
    every 問題 of the paper was filed under 聴解. The numbering says it
    instead — 聴解 is where 問題 starts again from 1.
    """
    first = _HEADING.search(text)
    floor = first.start() if first else 0
    matches = [m for m in _LISTENING_MARKER.finditer(text) if m.start() >= floor]
    # The real one follows the written booklet.
    for match in matches:
        if match.start() > len(text) * 0.5:
            return match.start()
    restart = _numbering_restart(text)
    if restart is not None:
        return restart
    return matches[-1].start() if matches else len(text)


def _numbering_restart(text: str) -> int | None:
    """The first 問題1 that follows a higher 問題."""
    highest = 0
    for match in _HEADING.finditer(text):
        number = _number(match.group(1))
        if number == 1 and highest > 1:
            return match.start()
        highest = max(highest, number)
    return None


def _reading_start(text: str, limit: int) -> int:
    """Where 読解 begins, searched only within the written booklet."""
    match = _READING_MARKER.search(text, 0, limit)
    # The cover lists it too, so require it to be past the first 問題.
    first_problem = _HEADING.search(text)
    floor = first_problem.start() if first_problem else 0
    while match and match.start() < floor:
        match = _READING_MARKER.search(text, match.end(), limit)
    return match.start() if match else limit


_RUN_ON = 1000


def split_problems(text: str) -> list[Block]:
    """The paper as a list of 問題 blocks, in the order they are printed."""
    listening_at = _listening_start(text)
    reading_at = _reading_start(text, listening_at)

    headings: list[tuple[int, int]] = []
    for match in _HEADING.finditer(text):
        number = _number(match.group(1))
        # 問題 is also an ordinary word, and a passage that uses it before a
        # blank reads exactly like a heading. No level numbers this high.
        if not 1 <= number <= MAX_HEADING:
            continue
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
        # A written 問題 does not run on into 聴解. Normally the next heading
        # is a few characters past where 聴解 starts — 502 at most across
        # thirty papers, its instructions — but 2011年07月 spaces its first
        # two headings with furigana, 「問 題 1」, neither is read, and 問題13
        # ran on through 2,094 characters of 聴解: the model extracted three
        # problems from it and the import failed. Cut only a run-on that
        # long, so no other paper's block — and cached reading — changes.
        if start < listening_at < end and end - listening_at > _RUN_ON:
            end = listening_at
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
