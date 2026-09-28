"""Take the finished papers out of the workbench, for the product to load.

Ingest is local: it needs the booklets, the model, the drafts and the
re-runs. None of that belongs in production, which never re-extracts
anything — so what crosses is the result, not the machinery.

`CanonicalPaper` is what crosses, because it is already the line the rest of
the system is built on: everything downstream reads it and nothing else, so
a bundle of canonical papers is a bank.

The rulings travel with them. They are the only record of work a person did
rather than a machine, they are keyed by sitting rather than by paper, and
production has an edit endpoint of its own — so a correction made there is
a ruling too, and comes home in the next bundle rather than being lost at
the next re-import.

    python -m scripts.export_bank bank.json           # every clean paper
    python -m scripts.export_bank bank.json --all     # gaps and all
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select                                    # noqa: E402
from sqlalchemy.orm import selectinload                          # noqa: E402

from app.models.db import (                                      # noqa: E402
    ExamAdjudication, ExamDraft, ExamPaper, async_session_factory,
)

BUNDLE_VERSION = 1


async def _shortfall(db, paper) -> str | None:
    """What still stands in the way of this paper being answered, if anything.

    A question without an answer cannot be scored, which is the one thing
    that makes a paper unfit for the product. Gaps in the listening
    transcripts do not: the question is still answerable, only its dialogue
    is missing.
    """
    from app.models.db import ExamItem, ExamProblem, ExamSection

    rows = (await db.execute(
        select(ExamItem.correct_answer)
        .join(ExamProblem, ExamProblem.id == ExamItem.problem_id)
        .join(ExamSection, ExamSection.id == ExamProblem.section_id)
        .where(ExamSection.paper_id == paper.id)
    )).all()
    missing = sum(1 for (answer,) in rows if not answer)
    return f"{missing} 题没有答案" if missing else None


async def gather(everything: bool) -> dict:
    async with async_session_factory() as db:
        papers = (await db.execute(select(ExamPaper))).scalars().all()

        # The canonical each paper was built from, kept on its draft. Read
        # from there rather than rebuilt out of the rows: it is the shape
        # that was checked, and rebuilding would be a second implementation
        # of the same thing to keep in step.
        drafts = (await db.execute(
            select(ExamDraft).where(ExamDraft.paper_id.isnot(None))
        )).scalars().all()
        by_paper = {d.paper_id: d for d in drafts}

        out = []
        skipped = []
        for paper in sorted(papers, key=lambda p: (p.level, p.source or "")):
            draft = by_paper.get(paper.id)
            if draft is None or not draft.canonical:
                skipped.append((paper.source, "没有 canonical，无法导出"))
                continue
            # Judged on the paper as it stands, not on the report the draft
            # arrived with. That report is a snapshot from extraction, and
            # everything settled since — by a ruling or by hand — is still
            # written in it; gating on it holds back papers that are fine.
            short = await _shortfall(db, paper)
            if short and not everything:
                skipped.append((paper.source, short))
                continue
            out.append({
                "level": paper.level,
                "sitting": paper.source,
                "canonical": draft.canonical,
            })

        rulings = [
            {
                "level": r.level, "sitting": r.sitting, "section": r.section,
                "problem_name": r.problem_name, "num": r.num, "field": r.field,
                "value": r.value, "reason": r.reason,
                "decided_by": r.decided_by,
                "decided_at": r.decided_at.isoformat() if r.decided_at else None,
            }
            for r in (await db.execute(select(ExamAdjudication))).scalars().all()
        ]

    return {
        "version": BUNDLE_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "papers": out,
        "rulings": rulings,
        "skipped": skipped,
    }


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path)
    parser.add_argument("--all", action="store_true",
                        help="include papers that still have findings")
    args = parser.parse_args()

    bundle = await gather(args.all)
    args.out.write_text(json.dumps(bundle, ensure_ascii=False, indent=1))

    items = sum(
        len(pr.get("items") or [])
        for p in bundle["papers"]
        for s in p["canonical"].get("sections") or []
        for pr in s.get("problems") or []
    )
    size = args.out.stat().st_size / 1024 / 1024
    print(f"{len(bundle['papers'])} 份卷子 · {items} 题 · "
          f"{len(bundle['rulings'])} 条人工判定 → {args.out} （{size:.1f} MB）")
    for sitting, why in bundle["skipped"]:
        print(f"  跳过 {sitting}：{why}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
