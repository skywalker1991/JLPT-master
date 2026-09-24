"""Editing a question after it has been imported, with a record of the change.

Confirming a draft used to be final: the only way to fix a question was to
delete the paper and lose the attempts recorded against it. That was tolerable
at two papers and is not at dozens.

Every change is written to exam_item_revisions before it is applied, because
an attempt was answered against the wording as it stood — without the history,
changing a question silently rewrites what a past score meant.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import (
    ExamItem, ExamItemReport, ExamItemRevision, ExamProblem,
)

#: Fields on an item that may be corrected, and how their value is stored in
#: the revision log (which is text, so options are recorded as they read).
ITEM_FIELDS = {"stem", "options", "correct_answer", "answer_order", "transcript", "meta"}
PROBLEM_FIELDS = {"passage", "passage_translation", "instruction", "transcript"}

REPORT_KINDS = {"wrong_answer", "typo", "missing", "other"}


def _as_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        import json
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


async def apply_item_edit(
    db: AsyncSession,
    item_id: UUID,
    changes: dict[str, Any],
    *,
    note: str | None = None,
    source: str = "user",
) -> tuple[ExamItem, list[ExamItemRevision]]:
    """Change one question, recording each field that actually moves."""
    unknown = set(changes) - ITEM_FIELDS
    if unknown:
        raise HTTPException(status_code=400, detail=f"Cannot edit: {', '.join(sorted(unknown))}")

    item = (await db.execute(select(ExamItem).where(ExamItem.id == item_id))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    revisions: list[ExamItemRevision] = []
    for field, new_value in changes.items():
        old_value = getattr(item, field)
        # A no-op edit should not litter the history.
        if _as_text(old_value) == _as_text(new_value):
            continue
        revision = ExamItemRevision(
            item_id=item.id, field=field,
            old_value=_as_text(old_value), new_value=_as_text(new_value),
            source=source, note=note,
        )
        db.add(revision)
        revisions.append(revision)
        setattr(item, field, new_value)

    await db.flush()
    return item, revisions


async def apply_problem_edit(
    db: AsyncSession,
    problem_id: UUID,
    changes: dict[str, Any],
) -> ExamProblem:
    """Change a passage, its translation, or the instruction above it.

    Not versioned: these carry no answer, so a past attempt does not hang on
    their exact wording the way it hangs on an item's.
    """
    unknown = set(changes) - PROBLEM_FIELDS
    if unknown:
        raise HTTPException(status_code=400, detail=f"Cannot edit: {', '.join(sorted(unknown))}")

    problem = (await db.execute(
        select(ExamProblem).where(ExamProblem.id == problem_id)
    )).scalar_one_or_none()
    if problem is None:
        raise HTTPException(status_code=404, detail="Problem not found")

    for field, value in changes.items():
        setattr(problem, field, value)
    await db.flush()
    return problem


async def report_item(
    db: AsyncSession,
    item_id: UUID,
    kind: str,
    *,
    note: str | None = None,
    attempt_id: UUID | None = None,
) -> ExamItemReport:
    """Flag a question as wrong, from wherever it was noticed."""
    if kind not in REPORT_KINDS:
        raise HTTPException(status_code=400, detail=f"Unknown report kind: {kind}")

    item = (await db.execute(select(ExamItem).where(ExamItem.id == item_id))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    # Flagging the same question twice while it is still open should not
    # create a queue of identical entries.
    existing = (await db.execute(
        select(ExamItemReport).where(
            ExamItemReport.item_id == item_id,
            ExamItemReport.kind == kind,
            ExamItemReport.status == "open",
        )
    )).scalars().first()
    if existing is not None:
        if note and note not in (existing.note or ""):
            existing.note = f"{existing.note}\n{note}" if existing.note else note
        await db.flush()
        return existing

    report = ExamItemReport(item_id=item_id, kind=kind, note=note, attempt_id=attempt_id)
    db.add(report)
    await db.flush()
    return report


async def resolve_report(db: AsyncSession, report_id: UUID) -> ExamItemReport:
    report = (await db.execute(
        select(ExamItemReport).where(ExamItemReport.id == report_id)
    )).scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=404, detail="Report not found")
    report.status = "resolved"
    report.resolved_at = datetime.now(timezone.utc)
    await db.flush()
    return report
