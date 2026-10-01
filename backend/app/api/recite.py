"""背诵: a queue of passages to say by heart, one at a time.

A passage read in 語料分析 goes to the end of the queue with 「要背」. Only
the first is worked on; the next appears when it is done. Done passages are
not brought back on a schedule — they wait under 「已背完」 to be said again
by choice.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.models.db import Analysis, Recitation, User, get_db

router = APIRouter(tags=["recite"])


def _row(r: Recitation) -> dict:
    return {
        "id": str(r.id), "analysis_id": str(r.analysis_id) if r.analysis_id else None,
        "sentences": r.sentences, "status": r.status, "progress": r.progress,
        "times_done": r.times_done, "created_at": r.created_at.isoformat() if r.created_at else None,
        "done_at": r.done_at.isoformat() if r.done_at else None,
    }


async def _mine(db: AsyncSession, rid: UUID, user: User) -> Recitation:
    r = await db.get(Recitation, rid)
    if r is None or r.user_id != user.id:
        raise HTTPException(status_code=404, detail="没有这一段")
    return r


async def _end_of_queue(db: AsyncSession, user: User) -> int:
    top = (await db.execute(
        select(func.max(Recitation.position)).where(Recitation.user_id == user.id, Recitation.status == "queued")
    )).scalar_one_or_none()
    return (top or 0) + 1


@router.get("/recite")
async def queue(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    rows = (await db.execute(select(Recitation).where(Recitation.user_id == user.id))).scalars().all()
    queued = sorted((r for r in rows if r.status == "queued"), key=lambda r: (r.position, r.created_at))
    done = sorted((r for r in rows if r.status == "done"), key=lambda r: r.done_at or r.created_at, reverse=True)
    return {"queue": [_row(r) for r in queued], "done": [_row(r) for r in done]}


class AddBody(BaseModel):
    analysis_id: UUID
    # Some of the passage's sentences only (by index); all of them if left out
    sentences: list[int] | None = Field(default=None, max_length=200)


@router.post("/recite", status_code=201)
async def add(body: AddBody, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """「要背」: this passage to the end of the queue."""
    analysis = (await db.execute(
        select(Analysis).where(Analysis.id == body.analysis_id, Analysis.user_id == user.id)
    )).scalar_one_or_none()
    if analysis is None:
        raise HTTPException(status_code=404, detail="没有这段语料")
    all_sentences = [s for s in (analysis.session_data or {}).get("sentences") or [] if isinstance(s, dict) and s.get("text")]
    picked = [s for i, s in enumerate(all_sentences) if body.sentences is None or i in set(body.sentences)]
    if not picked:
        raise HTTPException(status_code=422, detail="这段没有可背的句子")
    existing = (await db.execute(select(Recitation).where(
        Recitation.user_id == user.id, Recitation.analysis_id == analysis.id, Recitation.status == "queued",
    ))).scalars().first()
    if existing is not None:
        return _row(existing)
    r = Recitation(
        user_id=user.id, analysis_id=analysis.id, position=await _end_of_queue(db, user),
        sentences=[{"index": i, "text": s["text"], "translation": s.get("translation") or ""} for i, s in enumerate(picked)],
    )
    db.add(r)
    await db.commit()
    return _row(r)


class ProgressBody(BaseModel):
    progress: int = Field(ge=0, le=500)


@router.patch("/recite/{rid}")
async def progress(rid: UUID, body: ProgressBody, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    r = await _mine(db, rid, user)
    r.progress = min(body.progress, len(r.sentences))
    await db.commit()
    return _row(r)


@router.post("/recite/{rid}/done")
async def done(rid: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    r = await _mine(db, rid, user)
    r.status, r.progress, r.done_at = "done", 0, datetime.now(timezone.utc)
    r.times_done += 1
    await db.commit()
    return _row(r)


@router.post("/recite/{rid}/again")
async def again(rid: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """A done passage back to the queue — to the front, since it was chosen now."""
    r = await _mine(db, rid, user)
    first = (await db.execute(
        select(func.min(Recitation.position)).where(Recitation.user_id == user.id, Recitation.status == "queued")
    )).scalar_one_or_none()
    r.status, r.progress, r.position = "queued", 0, (first or 1) - 1
    await db.commit()
    return _row(r)


class OrderBody(BaseModel):
    ids: list[UUID] = Field(max_length=500)


@router.put("/recite/order")
async def reorder(body: OrderBody, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    for pos, rid in enumerate(body.ids):
        r = await db.get(Recitation, rid)
        if r is not None and r.user_id == user.id and r.status == "queued":
            r.position = pos
    await db.commit()
    return {"ok": True}


@router.delete("/recite/{rid}", status_code=204)
async def remove(rid: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    r = await _mine(db, rid, user)
    await db.delete(r)
    await db.commit()
