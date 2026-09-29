"""Read a folder of sittings, and only stop where something needs a person.

Importing was one sitting at a time through the upload page: pick the files,
wait two minutes, read the review page, confirm. For the dozens of papers
waiting that is dozens of rounds, and most of them need none — 2018年07月 came
in with nothing to confirm at all.

So this reads them all and sorts them into two piles. The clean ones are
imported; the rest stay as drafts with their findings listed, and the review
page is there for those.

    python -m scripts.ingest_batch ~/papers            # read, import the clean
    python -m scripts.ingest_batch ~/papers --dry-run  # read, import nothing
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.db import ExamDraft, async_session_factory  # noqa: E402
from app.services.exam_ingest import ingest, read_sources  # noqa: E402
from app.services.exam_sources import detect_identity  # noqa: E402


def group_sittings(paths: list[Path]) -> tuple[dict[tuple[str, str], list[Path]], list[Path]]:
    """Which files belong together.

    By what each file says it is, not by its name: every cover and answer sheet
    prints the level and the sitting, and the names these arrive under are
    whatever the download gave them.
    """
    groups: dict[tuple[str, str], list[Path]] = defaultdict(list)
    unknown: list[Path] = []
    for path in paths:
        sources = read_sources([(path.name, path.read_bytes())])
        level, sitting = detect_identity(sources)
        if not (level and sitting):
            # Not only scans: a 答案 or 听力原文 file often opens straight
            # into the body, so the sitting is printed nowhere in the first
            # page. Sixteen of forty-two were dropped that way, and dropping
            # the 解析 costs the listening transcripts and a third of the
            # answers. The name is worth reading when the content says
            # nothing — it is the only thing left.
            level, sitting = _from_name(path.name)
        if level and sitting:
            groups[(level, sitting)].append(path)
        else:
            unknown.append(path)
    return dict(groups), unknown


#: 「2021年12月N1」, 「2021_12_N1」, 「2024年07月日语N1」 — the year and month
#: come first and the level follows, whatever sits between them.
_NAME = re.compile(r"(19[89][0-9]|20[0-9]{2})\D{0,3}([01]?[0-9])\s*月?\D{0,6}?([Nn][1-5])")


def _from_name(filename: str) -> tuple[str | None, str | None]:
    match = _NAME.search(filename)
    if not match:
        return None, None
    month = int(match.group(2))
    if not 1 <= month <= 12:
        return None, None
    return match.group(3).upper(), f"{match.group(1)}年{month:02d}月"


async def import_paper(canonical: dict, report: dict, files: list[str]) -> str:
    """Store the read sitting as a draft, and say which it is."""
    async with async_session_factory() as db:
        draft = ExamDraft(
            filename=", ".join(files),
            status="pending",
            canonical=canonical,
            report=report,
        )
        db.add(draft)
        await db.flush()
        draft_id = str(draft.id)
        await db.commit()
    return draft_id


async def rulings(level: str | None, sitting: str | None) -> dict:
    """What a person has already decided about this sitting.

    Loaded here rather than inside ingest so that ingest stays a function of
    its files; the decisions are the one thing about a sitting that does not
    come out of them.
    """
    from app.services.exam_rulings import load

    if not (level and sitting):
        return {}
    async with async_session_factory() as db:
        return await load(db, level, sitting)


async def confirm(draft_id: str) -> None:
    from uuid import UUID

    from app.api.admin import confirm_draft

    async with async_session_factory() as db:
        await confirm_draft(UUID(draft_id), db)


def inspect(groups: dict[tuple[str, str], list[Path]]) -> None:
    """What each file is and what it carries — the free half of the work.

    Everything here is deterministic: which file is which, what answers and
    transcripts it holds, what the set cannot do. Only pulling the questions
    out costs anything, so sorting a folder should not.
    """
    from app.services.exam_answers import (
        parse_answer_sheet, parse_booklet_table, parse_explanations,
    )
    from app.services.exam_listening import parse_listening
    from app.services.exam_sources import Role, assess, classify_all

    for (level, sitting), paths in sorted(groups.items()):
        sources = classify_all(read_sources([(p.name, p.read_bytes()) for p in paths]))
        print(f"── {level} {sitting}")
        for s in sources:
            carries = []
            if s.role is Role.QUESTIONS:
                carries.append("題目")
            if s.role is Role.ANSWER_SHEET:
                key = parse_answer_sheet(s.text)
                carries.append(f"答案 {len(key.written)} 题" if key.written else "读不出答案")
                if key.orders:
                    carries.append(f"语序 {len(key.orders)}")
            if s.role is Role.EXPLANATIONS:
                carries.append(f"逐题正解 {len(parse_explanations(s.text).written)}")
                table = parse_booklet_table(s.text)
                if table:
                    carries.append(f"答案表 {len(table.written)} 题 · 语序 {len(table.orders)}")
                carries.append(f"听力 {len(parse_listening(s.text))} 段")
            if s.role is Role.SCANNED:
                carries.append("与已有文字版重复，不用传")
            print(f"   {s.text_coverage:>4.0%} 文字  {s.role.value:12} {s.filename[:34]}"
                  f"  {' · '.join(carries)}")
        for gap in assess(sources).missing:
            print(f"     缺：{gap}")
        print()


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--dry-run", action="store_true",
                        help="read everything, import nothing")
    parser.add_argument("--inspect", action="store_true",
                        help="say what each file is and what it carries, "
                             "without reading any questions — no model calls")
    args = parser.parse_args()

    # Recursive: these arrive as a year per folder, not a flat pile.
    pdfs = sorted(p for p in args.folder.rglob("*.pdf"))
    if not pdfs:
        print(f"No PDFs in {args.folder}")
        return 1

    print(f"{len(pdfs)} files. Working out which sitting each belongs to…")
    groups, unknown = group_sittings(pdfs)
    for path in unknown:
        print(f"  ? {path.name} — no level or sitting printed on it; skipped")
    print(f"{len(groups)} sittings.\n")

    if args.inspect:
        inspect(groups)
        return 0

    clean: list[tuple[str, str]] = []
    needs_review: list[tuple[str, str, int]] = []

    for (level, sitting), paths in sorted(groups.items()):
        label = f"{level} {sitting}"
        print(f"── {label}  ({len(paths)} files)")
        try:
            paper, report = await ingest(
                [(p.name, p.read_bytes()) for p in paths],
                level=level, source_label=sitting,
                decided=await rulings(level, sitting),
            )
        except Exception as exc:
            print(f"   failed: {exc}")
            continue
        if paper is None:
            print("   nothing could be built from these files")
            continue

        findings = len(report.hard) + len(report.invented)
        items = sum(1 for _ in paper.items())
        draft_id = await import_paper(paper.to_dict(), report.to_dict(), [p.name for p in paths])
        print(f"   {items} questions, {findings} to confirm")
        for note in report.notes[:3]:
            print(f"   · {note}")

        if findings == 0:
            clean.append((label, draft_id))
        else:
            needs_review.append((label, draft_id, findings))

    print()
    if clean and not args.dry_run:
        for label, draft_id in clean:
            await confirm(draft_id)
            print(f"✓ imported  {label}")
    elif clean:
        for label, _ in clean:
            print(f"· would import  {label}")

    for label, draft_id, findings in needs_review:
        print(f"! {label} — {findings} to confirm, left as a draft ({draft_id})")

    print(f"\n{len(clean)} imported, {len(needs_review)} waiting on you.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
