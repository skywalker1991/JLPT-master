"""JLPT home and practice by question type.

GET  /jlpt/overview                  accuracy per question type, the papers and how far each mock got
GET  /jlpt/practice/{category}       a set of questions of one type, drawn across papers
POST /jlpt/practice/answer           one answer, told at once whether it was right
"""
import random
from collections import defaultdict
from uuid import UUID

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.api.exam import prepare_analyses, problem_detail
from app.models.db import (
    AttemptAnswer, ExamAttempt, ExamItem, ExamPaper, ExamProblem, ExamSection, PracticeAnswer, User, get_db,
)
from app.services import jlpt_practice as jp

router = APIRouter(tags=["jlpt"])

_background: set = set()


async def _bank(db: AsyncSession):
    """Every question with its 問題, section and paper: (item, problem, section, paper)."""
    return (await db.execute(
        select(ExamItem, ExamProblem, ExamSection, ExamPaper)
        .join(ExamProblem, ExamProblem.id == ExamItem.problem_id)
        .join(ExamSection, ExamSection.id == ExamProblem.section_id)
        .join(ExamPaper, ExamPaper.id == ExamSection.paper_id)
    )).all()


async def _answers(db: AsyncSession, user_id: UUID) -> list[tuple[UUID, bool, object]]:
    """All of a person's answers, from papers and from practice: (item, right, when)."""
    rows = (await db.execute(
        select(AttemptAnswer.item_id, AttemptAnswer.is_correct, ExamAttempt.started_at)
        .join(ExamAttempt, ExamAttempt.id == AttemptAnswer.attempt_id)
        .where(ExamAttempt.user_id == user_id)
    )).all()
    rows += (await db.execute(
        select(PracticeAnswer.item_id, PracticeAnswer.is_correct, PracticeAnswer.created_at)
        .where(PracticeAnswer.user_id == user_id)
    )).all()
    return [tuple(r) for r in rows]


def _latest(answers) -> dict[UUID, bool]:
    """Whether each item's most recent answer was right."""
    latest: dict[UUID, tuple] = {}
    for item_id, right, when in answers:
        if item_id not in latest or when >= latest[item_id][1]:
            latest[item_id] = (right, when)
    return {k: v[0] for k, v in latest.items()}


@router.get("/jlpt/overview")
async def overview(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    bank = await _bank(db)
    answers = await _answers(db, user.id)
    category_of_item: dict[UUID, str] = {}
    items_per_cat: dict[str, int] = defaultdict(int)
    papers_per_cat: dict[str, set] = defaultdict(set)
    for item, prob, sec, paper in bank:
        cat = jp.category_of(sec.name, prob.name)
        if cat is None:
            continue
        category_of_item[item.id] = cat.id
        items_per_cat[cat.id] += 1
        papers_per_cat[cat.id].add(paper.id)

    tried: dict[str, int] = defaultdict(int)
    right: dict[str, int] = defaultdict(int)
    for item_id, ok, _ in answers:
        cat = category_of_item.get(item_id)
        if cat:
            tried[cat] += 1
            right[cat] += int(ok)

    categories = [{
        "id": c.id, "label": c.label, "part": c.part, "number": c.number, "listening": c.listening,
        "per_paper": round(items_per_cat[c.id] / max(1, len(papers_per_cat[c.id]))),
        "answered": tried[c.id],
        "accuracy": round(right[c.id] / tried[c.id] * 100) if tried[c.id] else None,
    } for c in jp.N1 if items_per_cat[c.id]]

    mocks = (await db.execute(
        select(ExamAttempt).where(ExamAttempt.user_id == user.id).order_by(ExamAttempt.started_at.desc())
    )).scalars().all()
    latest_mock: dict[UUID, ExamAttempt] = {}
    for a in mocks:
        if (a.meta or {}).get("mock") and a.paper_id not in latest_mock:
            latest_mock[a.paper_id] = a

    papers = (await db.execute(select(ExamPaper).order_by(ExamPaper.source.desc()))).scalars().all()
    paper_rows = []
    for p in papers:
        a = latest_mock.get(p.id)
        row = {"id": str(p.id), "label": jp.paper_label(p.source, p.title), "level": p.level,
               "status": "new", "attempt_id": None, "stage": None, "total": None}
        if a is not None:
            row["attempt_id"] = str(a.id)
            if a.status == "completed":
                row["status"] = "completed"
                row["total"] = (a.meta or {}).get("result", {}).get("total")
            else:
                row["status"] = "in_progress"
                row["stage"] = (a.meta or {}).get("stage", "written")
        paper_rows.append(row)

    wrong_now = sum(1 for ok in _latest(answers).values() if not ok)
    return {"categories": categories, "papers": paper_rows, "mistakes": wrong_now,
            "pass_line": jp.PASS_TOTAL, "part_min": jp.PART_MIN}


def _units(rows, grouped: bool) -> list[list]:
    """What is answered together: a single question, or a text / 番 with its questions."""
    if not grouped:
        return [[r] for r in rows]
    groups: dict[tuple, list] = defaultdict(list)
    for r in rows:
        item, prob = r[0], r[1]
        if prob.section_id and "聴解" in r[2].name:
            key = (prob.id, (item.meta or {}).get("ban") or str(item.id))
        else:
            key = (prob.id, item.passage or "")
        groups[key].append(r)
    return [sorted(g, key=lambda r: r[0].seq) for g in groups.values()]


@router.get("/jlpt/practice/{category}")
async def practice(
    category: str,
    count: int | None = Query(default=None, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Questions of one type from all papers: ones never answered first, then
    ones last answered wrong, then the rest — each group shuffled."""
    cat = jp.BY_ID.get(category)
    if cat is None:
        raise HTTPException(status_code=404, detail="没有这个题型")
    rows = [r for r in await _bank(db) if (c := jp.category_of(r[2].name, r[1].name)) and c.id == cat.id]
    latest = _latest(await _answers(db, user.id))

    def rank(unit) -> int:
        seen = [latest.get(r[0].id) for r in unit]
        if all(s is None for s in seen):
            return 0
        return 1 if any(s is False for s in seen) else 2

    units = _units(rows, cat.grouped)
    random.shuffle(units)
    units.sort(key=rank)
    units = units[: count or (3 if cat.grouped else 10)]

    # Practice shows the explanation right after each answer; start on them
    # now so most are ready by then. Explanations are shared and kept, so
    # each question is explained once for everyone.
    item_ids = [r[0].id for unit in units for r in unit]
    _background.add(task := asyncio.create_task(prepare_analyses(item_ids)))
    task.add_done_callback(_background.discard)

    out = []
    for unit in units:
        item0, prob, sec, paper = unit[0]
        detail = await problem_detail(db, prob)
        keep = {r[0].id for r in unit}
        detail.items = [i for i in detail.items if i.id in keep]
        out.append({"paper": jp.paper_label(paper.source, paper.title), "section": sec.name,
                    "problem": detail.model_dump(mode="json")})
    return {"category": {"id": cat.id, "label": cat.label, "part": cat.part}, "units": out}


class PracticeAnswerBody(BaseModel):
    item_id: UUID
    answer: str = Field(min_length=1, max_length=10)


@router.post("/jlpt/practice/answer")
async def answer(body: PracticeAnswerBody, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    item = await db.get(ExamItem, body.item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="没有这道题")
    ok = item.correct_answer is not None and body.answer.strip() == item.correct_answer
    db.add(PracticeAnswer(user_id=user.id, item_id=item.id, user_answer=body.answer.strip(), is_correct=ok))
    await db.commit()
    return {"is_correct": ok, "correct_answer": item.correct_answer, "answer_order": item.answer_order}
