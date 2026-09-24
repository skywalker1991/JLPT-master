"""The shape an exam paper has once it is out of its source files.

This is the contract between the two halves of ingest. On one side, whatever
the publisher happened to print: a text-layer PDF, page scans, an answer grid
laid out four different ways, a 解析 booklet. On the other, everything that
does not care where the paper came from — validation, import, scoring, audio
synthesis, review.

Everything downstream reads `CanonicalPaper` and nothing else. When a new
source turns up — a different publisher, a changed layout, a scan where there
used to be text — a new extractor is written to emit this, and the rest of the
system is untouched.

Two things are kept that a finished paper does not need, because they are what
makes re-extraction and checking possible later:

  `Provenance` on each item, saying which file and page it came from, so a
  disputed question can be traced back without re-reading everything.

  `raw_text` on the sources, so improving the extractor means re-running the
  middle layer over stored text rather than asking for the PDFs again.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

CANONICAL_VERSION = 1


@dataclass
class Provenance:
    """Where this came from, for tracing a dispute back to the page."""
    source: str | None = None      # filename
    page: int | None = None
    extractor: str | None = None   # which extractor produced it


@dataclass
class CanonicalItem:
    num: int | None
    seq: int
    stem: str = ""
    #: Keyed "1".."4". Empty for 聴解 items answered from audio alone.
    options: dict[str, str] = field(default_factory=dict)
    correct_answer: str | None = None
    #: 並べ替え only: the whole ordering, e.g. "3412". correct_answer is
    #: whichever of these lands in the ★ blank.
    answer_order: str | None = None
    #: 聴解 only: the dialogue, which the question paper never prints.
    transcript: str | None = None
    #: 読解 only, and only where the 問題 holds more than one text. 問題8 prints
    #: four unrelated passages under one heading and 問題11 prints an A and a B;
    #: kept on the 問題 alone, answering 第46题 means reading all four. Empty
    #: where the 問題 has a single passage, which stays on the 問題.
    passage: str | None = None
    #: 並べ替え carries star_position here; other types may carry nothing.
    meta: dict[str, Any] = field(default_factory=dict)
    provenance: Provenance = field(default_factory=Provenance)


@dataclass
class CanonicalProblem:
    name: str                      # 問題1
    type: str                      # kanji_reading | sentence_order | listening | …
    seq: int
    instruction: str | None = None
    passage: str | None = None
    passage_translation: str | None = None
    transcript: str | None = None
    items: list[CanonicalItem] = field(default_factory=list)


@dataclass
class CanonicalSection:
    name: str                      # 言語知識（文字・語彙）
    seq: int
    problems: list[CanonicalProblem] = field(default_factory=list)


@dataclass
class CanonicalPaper:
    level: str                     # N1..N5
    title: str
    source: str | None = None      # 2018年07月
    sections: list[CanonicalSection] = field(default_factory=list)
    #: What the source files did not supply — no answers, no listening scripts.
    #: A paper is importable without them; the gaps are stated, not fatal.
    gaps: list[str] = field(default_factory=list)
    version: int = CANONICAL_VERSION

    # -- convenience for the consumers ---------------------------------------

    def problems(self):
        for section in self.sections:
            for problem in section.problems:
                yield section, problem

    def items(self):
        for section, problem in self.problems():
            for item in problem.items:
                yield section, problem, item

    def listening_counts(self) -> dict[int, int]:
        """How many 番 each 聴解 問題 holds.

        The answer sheet prints listening answers as one run of digits and
        never says where one 問題 ends, so this is what makes them divisible.
        """
        counts: dict[int, int] = {}
        for _, problem in self.problems():
            if problem.type != "listening":
                continue
            digits = "".join(c for c in problem.name if c.isdigit())
            if digits:
                counts[int(digits)] = len(problem.items)
        return counts

    def to_dict(self) -> dict:
        return asdict(self)


def from_dict(data: dict) -> CanonicalPaper:
    """Rebuild a paper from its stored form.

    Unknown keys are dropped rather than raising: a paper extracted by an older
    version should still be readable, which is the point of storing it.
    """
    def _item(raw: dict) -> CanonicalItem:
        prov = raw.get("provenance") or {}
        return CanonicalItem(
            num=raw.get("num"), seq=raw.get("seq", 0),
            stem=raw.get("stem", ""), options=raw.get("options") or {},
            correct_answer=raw.get("correct_answer"),
            answer_order=raw.get("answer_order"),
            transcript=raw.get("transcript"), passage=raw.get("passage"),
            meta=raw.get("meta") or {},
            provenance=Provenance(
                source=prov.get("source"), page=prov.get("page"),
                extractor=prov.get("extractor"),
            ),
        )

    def _problem(raw: dict) -> CanonicalProblem:
        return CanonicalProblem(
            name=raw.get("name", ""), type=raw.get("type", ""), seq=raw.get("seq", 0),
            instruction=raw.get("instruction"), passage=raw.get("passage"),
            passage_translation=raw.get("passage_translation"),
            transcript=raw.get("transcript"),
            items=[_item(i) for i in raw.get("items") or []],
        )

    return CanonicalPaper(
        level=data.get("level", ""), title=data.get("title", ""),
        source=data.get("source"),
        sections=[
            CanonicalSection(
                name=s.get("name", ""), seq=s.get("seq", 0),
                problems=[_problem(p) for p in s.get("problems") or []],
            )
            for s in data.get("sections") or []
        ],
        gaps=list(data.get("gaps") or []),
        version=data.get("version", CANONICAL_VERSION),
    )
