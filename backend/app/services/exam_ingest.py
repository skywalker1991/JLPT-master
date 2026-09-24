"""Turn a sitting's files into a paper, and say what is wrong with it.

This is the only place that knows the whole sequence. Each step is somebody
else's module, and everything after extraction works on CanonicalPaper rather
than on files, so a new publisher means a new extractor and nothing here moves.

Nothing is required. A question paper on its own produces a perfectly good
import that cannot be scored yet, and the gaps are reported rather than
raised — refusing a paper for want of an answer sheet keeps it out of the
system for a reason that only affects half of what it is for.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict, dataclass, field

from app.services.exam_answer_reader import read_answer_sheet
from app.services.exam_answers import parse_explanations
from app.services.exam_canonical import (
    CanonicalPaper, CanonicalSection,
)
from app.services.exam_extract import extract_block_with_retry
from app.services.exam_merge import merge_answers
from app.services.exam_sources import Role, Source, assess, classify_all, detect_identity
from app.services.exam_split import split_problems
from app.services.exam_text import joined, read_pdf
from app.services.exam_validation import learn_baseline, validate

logger = logging.getLogger(__name__)


@dataclass
class IngestReport:
    """Everything a human would need to decide whether to look at this paper."""
    sources: list[dict] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)          # what the file set lacks
    hard: list[dict] = field(default_factory=list)         # must be fixed
    soft: list[dict] = field(default_factory=list)         # differs from this level's usual
    invented: list[str] = field(default_factory=list)      # text not found in the source
    answers: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    @property
    def clean(self) -> bool:
        """Importable without anyone reading it."""
        return not (self.hard or self.invented)

    def to_dict(self) -> dict:
        return asdict(self)


def read_sources(files: list[tuple[str, bytes]]) -> list[Source]:
    """Pull the text out of each upload and work out what it is."""
    sources = []
    for name, data in files:
        try:
            pages = read_pdf(data)
        except Exception as e:
            logger.warning("Could not read %s: %s", name, e)
            pages = []
        sources.append(Source(
            filename=name,
            page_count=len(pages),
            text_pages=sum(1 for p in pages if p.has_text_layer),
            text=joined(pages),
        ))
    return classify_all(sources)


def _pick(sources: list[Source], role: Role) -> Source | None:
    candidates = [s for s in sources if s.role is role]
    # More than one of a role means a duplicate; the fuller text layer wins.
    return max(candidates, key=lambda s: len(s.text), default=None)


def _title(level: str, source_label: str | None) -> str:
    return f"日本語能力試験{level} {source_label}" if source_label else f"日本語能力試験{level}"


async def build_paper(
    questions: Source, *, level: str, source_label: str | None,
) -> tuple[CanonicalPaper, list[str]]:
    """Extract every 問題, in parallel, and assemble them into a paper."""
    blocks = split_problems(questions.text)
    results = await asyncio.gather(*[
        extract_block_with_retry(block, index, source_name=questions.filename)
        for index, block in enumerate(blocks, start=1)
    ])

    sections: dict[str, CanonicalSection] = {}
    invented: list[str] = []
    for block, result in zip(blocks, results):
        if result.error:
            invented.append(result.error)
            continue
        if result.problem is None:
            continue
        invented.extend(result.invented)
        section = sections.get(block.section)
        if section is None:
            section = CanonicalSection(name=block.section, seq=len(sections) + 1)
            sections[block.section] = section
        result.problem.seq = len(section.problems) + 1
        section.problems.append(result.problem)

    paper = CanonicalPaper(
        level=level,
        title=_title(level, source_label),
        source=source_label,
        sections=list(sections.values()),
    )
    return paper, invented


async def _read_scanned_sheet(
    files_by_name: dict[str, bytes],
    sources: list[Source],
    report: IngestReport,
):
    """Look at a scanned file in case it is the answer sheet."""
    from app.services.exam_answer_reader import read_sheet_images
    from app.services.exam_text import render_pages

    for source in sources:
        if source.role is not Role.SCANNED:
            continue
        data = files_by_name.get(source.filename)
        if not data:
            continue
        try:
            key = await read_sheet_images(render_pages(data))
        except Exception as e:
            logger.warning("Could not look at %s: %s", source.filename, e)
            continue
        if key.written or key.listening:
            source.role = Role.ANSWER_SHEET
            for entry in report.sources:
                if entry["filename"] == source.filename:
                    entry["role"] = Role.ANSWER_SHEET.value
            report.answers = {"method": "image"}
            report.notes.append(
                f"{source.filename} 没有文字层，答案是看图读出来的，请抽查几题"
            )
            return key
    return None


async def ingest(
    files: list[tuple[str, bytes]],
    *,
    level: str | None = None,
    source_label: str | None = None,
    baseline: dict | None = None,
    verify_answers: bool = False,
) -> tuple[CanonicalPaper | None, IngestReport]:
    """Read a sitting end to end.

    `baseline` is what papers of this level have looked like so far; without
    one every difference is new and nothing is worth querying.
    """
    sources = read_sources(files)
    files_by_name = dict(files)
    capability = assess(sources)

    # Every cover and answer sheet prints the level and the sitting, so they are
    # read rather than asked for — a paper titled wrongly is a paper that cannot
    # be found in the list afterwards. Anything passed in still wins.
    detected_level, detected_sitting = detect_identity(sources)
    level = level or detected_level
    source_label = source_label or detected_sitting
    report = IngestReport(
        sources=[
            {"filename": s.filename, "role": s.role.value,
             "pages": s.page_count, "text_pages": s.text_pages}
            for s in sources
        ],
        gaps=capability.missing,
    )

    if not level:
        report.notes.append("文件里没有找到级别（N1-N5），请手动指定")
    if not source_label:
        report.notes.append("文件里没有找到考试年月，请手动指定")

    questions = _pick(sources, Role.QUESTIONS)
    if questions is None:
        report.notes.append("没有可用的試題文件，无法建卷")
        return None, report

    paper, invented = await build_paper(
        questions, level=level or "", source_label=source_label,
    )
    report.invented = invented
    paper.gaps = capability.missing

    # The answer sheet gives listening answers as one run of digits and never
    # says where a 問題 ends, so the counts come from the paper just extracted.
    counts = paper.listening_counts()
    written_expected = sum(
        1 for _, problem, _ in paper.items() if problem.type != "listening"
    )

    sheet_key = None
    sheet = _pick(sources, Role.ANSWER_SHEET)
    if sheet is not None:
        result = await read_answer_sheet(
            sheet.text, listening_counts=counts,
            written_expected=written_expected, always_verify=verify_answers,
        )
        sheet_key = result.key
        report.answers = {"method": result.method, "agreed": result.agreed}
        report.notes.extend(result.notes)
    else:
        # No sheet with text in it. A scan may still be one — 2019年12月's is
        # sixteen pages without a character of text layer — and the sheet is
        # the only source for 並べ替え orderings and for items the 解析 booklet
        # never discusses, so it is worth looking at rather than going without.
        sheet_key = await _read_scanned_sheet(files_by_name, sources, report)

    explanation_key = None
    explanations = _pick(sources, Role.EXPLANATIONS)
    if explanations is not None:
        explanation_key = parse_explanations(explanations.text)

    merge = merge_answers(paper, sheet_key, explanation_key)
    report.answers.update({
        "answered": merge.answered, "unanswered": merge.unanswered,
        "orders": merge.orders_applied,
    })
    report.notes.extend(merge.notes)
    for conflict in merge.conflicts:
        report.hard.append({"where": "答案", "message": conflict})

    findings = validate(paper.to_dict(), baseline)
    report.hard.extend(
        {"where": f.where, "message": f.message, "problem": f.problem_name}
        for f in findings.hard
    )
    report.soft.extend({"where": f.where, "message": f.message} for f in findings.soft)

    return paper, report


def baseline_for(papers: list[dict]) -> dict:
    """What this level's papers have looked like, from the ones already accepted."""
    return learn_baseline(papers)
