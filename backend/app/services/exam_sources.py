"""Work out what each uploaded PDF is, and what can be built from the set.

A sitting arrives as several files with different jobs — the question paper,
the 解析 booklet, the answer sheet — and often a second copy of the paper as
page scans, which carries the same content at a far worse extraction rate.
Ingest took a single file, so a sitting either went in incomplete or had to be
assembled by hand.

Nothing here is required. A question paper alone is a perfectly good import
that simply cannot be scored yet; the point is to say so rather than fail.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass
from enum import Enum


class Role(str, Enum):
    QUESTIONS = "questions"      # 試題: stems, options, ★ positions, 読解 passages
    EXPLANATIONS = "explanations"  # 解析: per-item answers, listening scripts, translations
    ANSWER_SHEET = "answer_sheet"  # the answer grid
    SCANNED = "scanned"          # images of a paper already present as text
    UNKNOWN = "unknown"


@dataclass
class Source:
    filename: str
    page_count: int
    text_pages: int
    text: str
    role: Role = Role.UNKNOWN

    @property
    def text_coverage(self) -> float:
        return self.text_pages / self.page_count if self.page_count else 0.0


#: Below this, a file is images of a page rather than a page of text, and
#: putting it through extraction costs more and reads worse than the copy that
#: has a text layer.
SCANNED_BELOW = 0.5

_QUESTION_MARKERS = (
    re.compile(r"１・２・３・４から"),
    re.compile(r"から一?つ選びなさい"),
    re.compile(r"問題\s*[０-９0-9１-５]"),
)
_EXPLANATION_MARKERS = (
    re.compile(r"正解\s*[：:]"),
    re.compile(r"解析\s*[：:]"),
)
#: The grid: ranges with their digits printed underneath.
_SHEET_MARKERS = (
    re.compile(r"\d+\s*-\s*\d+"),
    re.compile(r"^[\s|｜]*[1-4]{4,}[\s|｜]*$", re.M),
)


def _score(text: str, markers) -> int:
    return sum(len(m.findall(text)) for m in markers)


def classify(source: Source, *, has_text_twin: bool = False) -> Role:
    """What this file is for.

    Content decides first, coverage only breaks ties. In 2018年07月 the scanned
    copy of the paper and the answer sheet both read 6% text, so judging by
    coverage first throws the answer sheet away with the scans — an answer
    sheet is mostly grid and needs no text layer to speak of.

    `has_text_twin` says another upload holds the same material as text, which
    is what separates a redundant scan from the only copy there is.
    """
    explanation = _score(source.text, _EXPLANATION_MARKERS)
    question = _score(source.text, _QUESTION_MARKERS)
    sheet = _score(source.text, _SHEET_MARKERS)

    # An answer sheet is short and almost entirely grid; the 解析 booklet also
    # contains ranges and digits, so density rather than presence decides.
    if sheet >= 4 and len(source.text) < 4000 and explanation < 5:
        return Role.ANSWER_SHEET
    if explanation >= 10 and explanation > question:
        return Role.EXPLANATIONS
    if question >= 3:
        # Images of a paper we already hold as text: the same content at a far
        # worse extraction rate, so not worth reading twice.
        if source.text_coverage < SCANNED_BELOW and has_text_twin:
            return Role.SCANNED
        return Role.QUESTIONS
    if source.text_coverage < SCANNED_BELOW:
        return Role.SCANNED
    return Role.UNKNOWN


def classify_all(sources: list[Source]) -> list[Source]:
    """Assign a role to every upload in one sitting.

    Two passes, because a page-scan copy can only be recognised as redundant
    once something else has been found to hold the same material as text.
    """
    for source in sources:
        source.role = classify(source)

    has_questions_as_text = any(
        s.role is Role.QUESTIONS and s.text_coverage >= SCANNED_BELOW for s in sources
    )
    if has_questions_as_text:
        for source in sources:
            source.role = classify(source, has_text_twin=True)

    return sources


#: The level, printed on every cover and every answer sheet.
_LEVEL = re.compile(r"(?<![A-Za-z])[NＮ]\s*([1-5１-５])(?![0-9０-９])")

#: The sitting. Digits get spaced apart by the text layer — "2019 年1 2 月" is
#: December, not January — so spaces inside the number are closed up first.
_SITTING = re.compile(r"(20[0-9]{2})\s*年\s*([0-9]{1,2}(?:\s*[0-9])?)\s*月")


def _digits(raw: str) -> str:
    table = str.maketrans("０１２３４５６７８９", "0123456789")
    return re.sub(r"\s+", "", raw).translate(table)


def detect_identity(sources: list[Source]) -> tuple[str | None, str | None]:
    """The level and sitting, read off the files rather than typed in.

    Every cover and every answer sheet carries both, so asking for them is one
    more thing to get wrong — and a paper whose title is wrong is a paper you
    cannot find in the list afterwards.

    Where files disagree the commonest reading wins: a 解析 booklet quotes
    other sittings in its examples, and a cover does not.
    """
    levels: Counter[str] = Counter()
    sittings: Counter[str] = Counter()

    for source in sources:
        # The identity is printed at the top; the body is where other years
        # get mentioned in passing.
        head = source.text[:600]
        for match in _LEVEL.finditer(head):
            levels[f"N{_digits(match.group(1))}"] += 1
        for match in _SITTING.finditer(head):
            year, month = _digits(match.group(1)), _digits(match.group(2))
            if 1 <= int(month) <= 12:
                sittings[f"{year}年{int(month):02d}月"] += 1

    level = levels.most_common(1)[0][0] if levels else None
    sitting = sittings.most_common(1)[0][0] if sittings else None
    return level, sitting


@dataclass
class Capability:
    """What this set of files supports, and what it does not."""
    can_build_paper: bool
    can_score: bool
    has_listening_scripts: bool
    has_translations: bool
    missing: list[str]


def assess(sources: list[Source]) -> Capability:
    roles = {s.role for s in sources}
    missing: list[str] = []

    can_build = Role.QUESTIONS in roles
    if not can_build:
        missing.append("没有題目文件（試題），无法建卷")

    can_score = Role.ANSWER_SHEET in roles or Role.EXPLANATIONS in roles
    if not can_score:
        missing.append("没有答案来源，题目可入库但无法判分")

    scripts = Role.EXPLANATIONS in roles
    if not scripts:
        missing.append("没有解析文件，听力缺原文（無法合成音频），也没有官方讲解")

    # Only the answer sheet prints 並べ替え as a full ordering, and the ★
    # position alone cannot say which option belongs in the blank.
    if Role.ANSWER_SHEET not in roles:
        missing.append("没有答案表，排序题拿不到完整语序")

    return Capability(
        can_build_paper=can_build,
        can_score=can_score,
        has_listening_scripts=scripts,
        has_translations=scripts,
        missing=missing,
    )
