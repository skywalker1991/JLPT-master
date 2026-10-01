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


# ── Mock exam ────────────────────────────────────────────────────────────────
# A whole paper under the real clock: 言語知識・読解 first, then 聴解. No answer
# is shown until the paper is handed in; then the score per scored part,
# against the minimum per part and the pass line.

from datetime import datetime, timezone  # noqa: E402

from app.api.exam import build_paper_detail  # noqa: E402

STAGE_SECONDS = {"written": 110 * 60, "listening": 55 * 60}


def _stage_of(section_name: str) -> str:
    return "listening" if "聴解" in section_name else "written"


def _remaining(meta: dict) -> int:
    started = datetime.fromisoformat(meta["stage_started_at"])
    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    return max(0, int(STAGE_SECONDS[meta["stage"]] - elapsed))


async def _own_mock(db: AsyncSession, attempt_id: UUID, user: User) -> ExamAttempt:
    a = await db.get(ExamAttempt, attempt_id)
    if a is None or a.user_id != user.id or not (a.meta or {}).get("mock"):
        raise HTTPException(status_code=404, detail="没有这次模拟考")
    return a


@router.post("/jlpt/mock/{paper_id}")
async def start_mock(paper_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """Start a mock exam on this paper, or pick up the one left unfinished."""
    if await db.get(ExamPaper, paper_id) is None:
        raise HTTPException(status_code=404, detail="没有这套试卷")
    for a in (await db.execute(
        select(ExamAttempt).where(ExamAttempt.user_id == user.id, ExamAttempt.paper_id == paper_id,
                                  ExamAttempt.status == "in_progress")
    )).scalars():
        if (a.meta or {}).get("mock"):
            return {"attempt_id": str(a.id)}
    a = ExamAttempt(paper_id=paper_id, user_id=user.id, meta={
        "mock": True, "stage": "written", "stage_started_at": datetime.now(timezone.utc).isoformat(), "flags": [],
    })
    db.add(a)
    await db.commit()
    return {"attempt_id": str(a.id)}


@router.get("/jlpt/mock/{attempt_id}")
async def get_mock(attempt_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    a = await _own_mock(db, attempt_id, user)
    paper = await db.get(ExamPaper, a.paper_id)
    detail = await build_paper_detail(db, paper)
    answers = (await db.execute(select(AttemptAnswer).where(AttemptAnswer.attempt_id == a.id))).scalars().all()
    meta = a.meta or {}
    return {
        "attempt_id": str(a.id),
        "status": a.status,
        "label": jp.paper_label(paper.source, paper.title),
        "level": paper.level,
        "stage": meta.get("stage"),
        "remaining": _remaining(meta) if a.status == "in_progress" else 0,
        "flags": meta.get("flags", []),
        "answers": {str(x.item_id): x.user_answer for x in answers},
        "sections": [s.model_dump(mode="json") for s in detail.sections
                     if a.status != "in_progress" or _stage_of(s.name) == meta.get("stage")],
    }


class FlagBody(BaseModel):
    item_id: UUID
    flagged: bool


@router.post("/jlpt/mock/{attempt_id}/flag")
async def flag(attempt_id: UUID, body: FlagBody, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    a = await _own_mock(db, attempt_id, user)
    meta = dict(a.meta or {})
    flags = set(meta.get("flags", []))
    (flags.add if body.flagged else flags.discard)(str(body.item_id))
    meta["flags"] = sorted(flags)
    a.meta = meta
    await db.commit()
    return {"flags": meta["flags"]}


async def _result(db: AsyncSession, a: ExamAttempt) -> dict:
    """Score per scored part (scaled to 60), against 基準点 and the pass line,
    and per question type."""
    bank = [r for r in await _bank(db) if r[3].id == a.paper_id]
    given = {x.item_id: x for x in (await db.execute(
        select(AttemptAnswer).where(AttemptAnswer.attempt_id == a.id)
    )).scalars()}
    parts = {p: {"correct": 0, "total": 0} for p in jp.PARTS}
    cats: dict[str, dict] = {}
    wrong = []
    for item, prob, sec, _ in bank:
        part = jp.part_of_section(sec.name)
        right = item.id in given and given[item.id].is_correct
        parts[part]["total"] += 1
        parts[part]["correct"] += int(right)
        cat = jp.category_of(sec.name, prob.name)
        if cat:
            c = cats.setdefault(cat.id, {"id": cat.id, "label": cat.label, "part": cat.part, "correct": 0, "total": 0})
            c["total"] += 1
            c["correct"] += int(right)
        if not right:
            wrong.append(str(item.id))
    out_parts = []
    for name in jp.PARTS:
        p = parts[name]
        score = jp.scaled(p["correct"], p["total"])
        out_parts.append({"part": name, "score": score, "max": jp.PART_MAX, "correct": p["correct"],
                          "total": p["total"], "wrong": p["total"] - p["correct"], "passed_min": score >= jp.PART_MIN})
    total = sum(p["score"] for p in out_parts)
    return {"total": total, "pass_line": jp.PASS_TOTAL, "part_min": jp.PART_MIN,
            "passed": total >= jp.PASS_TOTAL and all(p["passed_min"] for p in out_parts),
            "parts": out_parts, "categories": [cats[c.id] for c in jp.N1 if c.id in cats],
            "wrong": len(wrong), "wrong_items": wrong}


@router.post("/jlpt/mock/{attempt_id}/hand-in")
async def hand_in(attempt_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """Hand in the current part. After 言語知識・読解 the clock starts on 聴解;
    after 聴解 the paper is scored."""
    a = await _own_mock(db, attempt_id, user)
    if a.status != "in_progress":
        raise HTTPException(status_code=409, detail="已经交卷了")
    meta = dict(a.meta or {})
    if meta.get("stage") == "written":
        meta.update(stage="listening", stage_started_at=datetime.now(timezone.utc).isoformat())
        a.meta = meta
        await db.commit()
        return {"stage": "listening"}
    result = await _result(db, a)
    meta.update(stage="done", result={k: v for k, v in result.items() if k != "wrong_items"})
    a.meta = meta
    a.status = "completed"
    a.completed_at = datetime.now(timezone.utc)
    await db.commit()
    # Explain the ones got wrong while the score is being read
    ids = [UUID(i) for i in result["wrong_items"]]
    _background.add(task := asyncio.create_task(prepare_analyses(ids)))
    task.add_done_callback(_background.discard)
    return {"stage": "done"}


@router.get("/jlpt/mock/{attempt_id}/result")
async def mock_result(attempt_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    a = await _own_mock(db, attempt_id, user)
    if a.status != "completed":
        raise HTTPException(status_code=409, detail="还没交卷")
    paper = await db.get(ExamPaper, a.paper_id)
    result = await _result(db, a)
    # Wrong ones in the order to look at them: weakest type first
    rate = {c["id"]: c["correct"] / c["total"] for c in result["categories"] if c["total"]}
    order = {}
    for item, prob, sec, _ in [r for r in await _bank(db) if r[3].id == a.paper_id]:
        cat = jp.category_of(sec.name, prob.name)
        order[str(item.id)] = (rate.get(cat.id if cat else "", 1), sec.seq, prob.seq, item.seq)
    result["wrong_items"].sort(key=lambda i: order.get(i, (1, 0, 0, 0)))
    minutes = int(((a.completed_at or a.started_at) - a.started_at).total_seconds() // 60)
    return {**result, "label": jp.paper_label(paper.source, paper.title), "level": paper.level,
            "minutes": minutes, "date": a.completed_at.isoformat() if a.completed_at else None}


class MockAnswerBody(BaseModel):
    item_id: UUID
    answer: str = Field(min_length=1, max_length=1)


@router.post("/jlpt/mock/{attempt_id}/answer")
async def mock_answer(attempt_id: UUID, body: MockAnswerBody, db: AsyncSession = Depends(get_db),
                      user: User = Depends(current_user)):
    """Record an answer without saying whether it is right. Only the part on
    the clock can be answered, and not once its time is up."""
    a = await _own_mock(db, attempt_id, user)
    meta = a.meta or {}
    if a.status != "in_progress":
        raise HTTPException(status_code=409, detail="已经交卷了")
    row = (await db.execute(
        select(ExamItem, ExamSection)
        .join(ExamProblem, ExamProblem.id == ExamItem.problem_id)
        .join(ExamSection, ExamSection.id == ExamProblem.section_id)
        .where(ExamItem.id == body.item_id, ExamSection.paper_id == a.paper_id)
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail="这套卷子里没有这道题")
    item, sec = row
    if _stage_of(sec.name) != meta.get("stage"):
        raise HTTPException(status_code=409, detail="这一部分已经交了")
    elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(meta["stage_started_at"])).total_seconds()
    if elapsed > STAGE_SECONDS[meta["stage"]] + 30:  # a little grace for the last click in flight
        raise HTTPException(status_code=409, detail="时间到了")
    right = item.correct_answer is not None and body.answer == item.correct_answer
    existing = (await db.execute(select(AttemptAnswer).where(
        AttemptAnswer.attempt_id == a.id, AttemptAnswer.item_id == item.id))).scalar_one_or_none()
    if existing:
        existing.user_answer, existing.is_correct = body.answer, right
    else:
        db.add(AttemptAnswer(attempt_id=a.id, item_id=item.id, user_answer=body.answer, is_correct=right))
    await db.commit()
    return {"ok": True}


# ── Reviewing one question ───────────────────────────────────────────────────

from app.models.db import ItemAsk  # noqa: E402
from app.api.analysis import _parse_ask_answer  # noqa: E402
from app.services.exam_listening import dialogue_for  # noqa: E402
from app.models.db import QuestionAnalysis  # noqa: E402
from app.services.llm.factory import get_llm_client  # noqa: E402


@router.get("/jlpt/review/{item_id}")
async def review_item(
    item_id: UUID,
    attempt_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """One question as it was answered: the whole 問題 it belongs to (with the
    answers, now that it is answered), what was chosen — in this mock exam,
    or else most recently in practice — and how its siblings went."""
    row = (await db.execute(
        select(ExamItem, ExamProblem, ExamSection, ExamPaper)
        .join(ExamProblem, ExamProblem.id == ExamItem.problem_id)
        .join(ExamSection, ExamSection.id == ExamProblem.section_id)
        .join(ExamPaper, ExamPaper.id == ExamSection.paper_id)
        .where(ExamItem.id == item_id)
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail="没有这道题")
    item, prob, sec, paper = row

    chosen: dict[UUID, tuple[str, bool]] = {}
    if attempt_id is not None:
        a = await db.get(ExamAttempt, attempt_id)
        if a is None or a.user_id != user.id:
            raise HTTPException(status_code=404, detail="没有这次作答")
        for x in (await db.execute(select(AttemptAnswer).where(AttemptAnswer.attempt_id == a.id))).scalars():
            chosen[x.item_id] = (x.user_answer, x.is_correct)
    else:
        for x in (await db.execute(
            select(PracticeAnswer).where(PracticeAnswer.user_id == user.id).order_by(PracticeAnswer.created_at)
        )).scalars():
            chosen[x.item_id] = (x.user_answer, x.is_correct)

    detail = await problem_detail(db, prob, with_answers=True)
    cat = jp.category_of(sec.name, prob.name)
    asks = (await db.execute(
        select(ItemAsk).where(ItemAsk.user_id == user.id, ItemAsk.item_id == item_id).order_by(ItemAsk.created_at)
    )).scalars().all()
    return {
        "paper": jp.paper_label(paper.source, paper.title),
        "section": sec.name,
        "category": {"id": cat.id, "label": cat.label} if cat else None,
        "problem": {
            **detail.model_dump(mode="json", exclude={"items": {"__all__": {"answer_votes", "confidence",
                                                                            "source_file", "source_page",
                                                                            "script_file", "script_page"}}}),
            "passage_translation": prob.passage_translation,
        },
        "item_id": str(item.id),
        "answers": {str(k): {"chosen": v[0], "right": v[1]} for k, v in chosen.items()
                    if k in {i.id for i in detail.items}},
        "asks": [{"question": x.question, "targets": x.targets, "result": x.result} for x in asks],
    }


class ItemAskBody(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    targets: list[str] = Field(default_factory=list, max_length=4)
    chosen: str | None = Field(default=None, max_length=1)


_ITEM_ASK = """你是一名耐心的日语老师。学习者在复习一道 JLPT 真题，有个问题想问。

题型：{problem}（{instruction}）
{passage}题目：{stem}
选项：
{options}
正确答案：{correct}{chosen}
{summary}{history}
{targets}学习者的问题：{question}

请用中文回答：紧扣这道题来解释，必要时给出日语例句并附中文翻译（不要罗马音）；简洁清楚，不超过 300 字；不要使用 Markdown 标题、表格或加粗；直接回答，不要寒暄。

另外，把回答里新引入、值得学习的单词或语法点列在 new_items 里（最多 3 个，没有就给空数组）。kind 只能是 vocab 或 grammar；key 用词典形或语法句型；reading 只有单词需要（平假名）；meaning 用中文简短说明。

如果这次问答是在辨析两个词或两个语法的差别，再给出 pair，否则 pair 填 null：
- a、b：两个词条，各自 {{"kind", "key", "reading", "meaning"}}，key 用词典形或语法句型。
- type：只能是 synonym（近义）、derivative（同源）、confusable（形音易混）、antonym（反义）、collocation（搭配）之一。
- difference：一句话说清差在哪，不超过 60 字。

直接输出 JSON 对象，不要代码块：
{{"answer": "…", "new_items": [], "pair": null}}
"""


@router.post("/jlpt/items/{item_id}/ask")
async def ask_item(item_id: UUID, body: ItemAskBody, db: AsyncSession = Depends(get_db),
                   user: User = Depends(current_user)):
    """A follow-up question about one exam question, answered with the
    question, its options, the answer chosen and the explanation in view."""
    row = (await db.execute(
        select(ExamItem, ExamProblem).join(ExamProblem, ExamProblem.id == ExamItem.problem_id)
        .where(ExamItem.id == item_id)
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail="没有这道题")
    item, prob = row
    analysis = (await db.execute(select(QuestionAnalysis).where(QuestionAnalysis.item_id == item_id))).scalar_one_or_none()
    summary = ((analysis.session_data or {}).get("summary") if analysis else None) or ""
    siblings = (await db.execute(select(ExamItem).where(ExamItem.problem_id == prob.id).order_by(ExamItem.seq))).scalars().all()
    passage = item.passage or prob.passage or (dialogue_for(item, siblings) if prob.type == "listening" else "") or ""
    earlier = (await db.execute(
        select(ItemAsk).where(ItemAsk.user_id == user.id, ItemAsk.item_id == item_id).order_by(ItemAsk.created_at)
    )).scalars().all()[-4:]
    prompt = _ITEM_ASK.format(
        problem=prob.name, instruction=prob.instruction or "",
        passage=f"文章／原文：\n{passage[:2500]}\n\n" if passage else "",
        stem=item.stem or "（无题干）",
        options="\n".join(f"{k}. {v}" for k, v in sorted((item.options or {}).items())),
        correct=item.correct_answer or "不明",
        chosen=f"\n学习者选的：{body.chosen}" if body.chosen else "",
        summary=f"已有解析要点：{summary}\n" if summary else "",
        history=("\n之前的问答：\n" + "\n".join(f"问：{x.question}\n答：{(x.result or {}).get('response', '')}" for x in earlier) + "\n") if earlier else "",
        targets=f"学习者特别想问的是：{'、'.join(body.targets)}\n" if body.targets else "",
        question=body.question.strip(),
    )
    try:
        raw = await get_llm_client().analyze(prompt, {})
    except Exception:
        raise HTTPException(status_code=502, detail="这次没回答上来，稍后再试")
    result = _parse_ask_answer(raw, set(body.targets))
    db.add(ItemAsk(user_id=user.id, item_id=item_id, question=body.question.strip(), targets=body.targets, result=result))
    await db.commit()
    return {"question": body.question.strip(), "targets": body.targets, "result": result}
