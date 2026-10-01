"""内化学习: today's cards and their reviews.

GET  /review/today     what is due today plus today's new cards, ready to show
POST /review/{atom_id} one 会 / 不会
GET/PATCH /review/settings  new cards a day, target recall
"""
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.models.db import (
    Atom, AtomOccurrence, AtomProperty, AtomSrsState, AtomTag, User, get_db,
)
from app.services import atom_service, review_service

router = APIRouter(tags=["internalize"])

_LEVELS = {"N1", "N2", "N3", "N4", "N5"}


async def _cards(db: AsyncSession, atoms: list[Atom], states: dict[UUID, AtomSrsState]) -> list[dict]:
    """Everything a card shows, front and back, for these atoms."""
    if not atoms:
        return []
    ids = [a.id for a in atoms]
    props: dict[UUID, list[AtomProperty]] = {}
    for p in (await db.execute(
        select(AtomProperty).where(AtomProperty.atom_id.in_(ids)).order_by(AtomProperty.created_at)
    )).scalars():
        props.setdefault(p.atom_id, []).append(p)
    occs: dict[UUID, list[AtomOccurrence]] = {}
    for o in (await db.execute(
        select(AtomOccurrence).where(AtomOccurrence.atom_id.in_(ids)).order_by(AtomOccurrence.created_at)
    )).scalars():
        occs.setdefault(o.atom_id, []).append(o)
    tags: dict[UUID, list[str]] = {}
    for t in (await db.execute(select(AtomTag).where(AtomTag.atom_id.in_(ids)))).scalars():
        tags.setdefault(t.atom_id, []).append(t.tag)

    out = []
    for atom in atoms:
        p = props.get(atom.id, [])
        srs = states.get(atom.id)
        sentences = occs.get(atom.id, [])
        meanings = list(dict.fromkeys(x.value for x in p if x.kind == "meaning"))
        level = next((x.value for x in p if x.kind == "jlpt_level" and x.value in _LEVELS), None) \
            or next((t for t in tags.get(atom.id, []) if t in _LEVELS), None)
        reading = atom.reading or next((x.value for x in p if x.kind == "reading"), None)
        at = review_service.pick_sentence(len(sentences), srs.reps if srs else 0)
        shown = sentences[at] if at >= 0 else None
        relations = (await atom_service.get_relations(db, atom.id))[:3]
        out.append({
            "atom_id": str(atom.id),
            "type": atom.type,
            "key": atom.key,
            "reading": reading,
            "level": level,
            "meaning": "；".join(meanings[:2]) if meanings else None,
            "connection": next((x.value for x in p if x.kind == "connection"), None),
            # The rest of what the entry holds, for the back of the card
            "part_of_speech": next((x.value for x in p if x.kind == "part_of_speech"), None),
            "register": next((x.value for x in p if x.kind == "register"), None),
            "usage": next((x.value for x in p if x.kind == "usage"), None),
            "nuance": next((x.value for x in p if x.kind == "nuance"), None),
            "examples": list(dict.fromkeys(x.value for x in p if x.kind == "example"))[:2],
            "is_new": srs is None,
            "familiar": bool(srs and (srs.stability or 0) >= review_service.FAMILIAR_DAYS),
            "mode": review_service.front_mode(atom.type, srs.stability if srs else None, shown is not None),
            "sentence": {
                "text": shown.sentence_text,
                "translation": shown.sentence_translation,
                "surface": shown.surface,
                "meaning_here": shown.surface_meaning,
                "met_at": shown.created_at.isoformat(),
                "source": "精读" if shown.analysis_id else "JLPT",
            } if shown else None,
            "sentences": [
                {"text": o.sentence_text, "surface": o.surface, "met_at": o.created_at.isoformat(),
                 "source": "精读" if o.analysis_id else "JLPT", "current": o is shown}
                for o in sentences
            ],
            "relations": [
                {"key": r["target"]["key"], "type": r["type"], "note": r.get("note")} for r in relations if r.get("target")
            ],
        })
    return out


@router.get("/review/today")
async def today(
    tz: int = Query(default=0, description="Browser getTimezoneOffset(), minutes"),
    extra: int = Query(default=0, ge=0, le=100, description="More new cards than the daily limit"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(current_user),
):
    """Today's set: everything due by the end of the person's day, then new
    cards up to the daily limit (already-introduced ones counted). New cards
    are words added before today — a word added today first shows tomorrow."""
    day = review_service.today(tz)

    due_rows = (await db.execute(
        select(Atom, AtomSrsState)
        .join(AtomSrsState, AtomSrsState.atom_id == Atom.id)
        .where(Atom.user_id == user.id, AtomSrsState.next_review < day.end)
        .order_by(AtomSrsState.next_review)
    )).all()

    introduced_today = (await db.execute(
        select(func.count()).select_from(AtomSrsState).join(Atom, Atom.id == AtomSrsState.atom_id)
        .where(Atom.user_id == user.id, AtomSrsState.introduced_at >= day.start)
    )).scalar_one()
    done_today = (await db.execute(
        select(func.count()).select_from(AtomSrsState).join(Atom, Atom.id == AtomSrsState.atom_id)
        .where(Atom.user_id == user.id, AtomSrsState.last_review >= day.start)
    )).scalar_one()

    new_room = max(0, user.new_cards_per_day + extra - introduced_today)
    new_atoms = (await db.execute(
        select(Atom)
        .outerjoin(AtomSrsState, AtomSrsState.atom_id == Atom.id)
        .where(Atom.user_id == user.id, AtomSrsState.atom_id.is_(None), Atom.created_at < day.start)
        .order_by(Atom.created_at)
        .limit(new_room)
    )).scalars().all() if new_room else []
    # New cards that could be had today (one added today waits for tomorrow)
    waiting_new = (await db.execute(
        select(func.count()).select_from(Atom)
        .outerjoin(AtomSrsState, AtomSrsState.atom_id == Atom.id)
        .where(Atom.user_id == user.id, AtomSrsState.atom_id.is_(None), Atom.created_at < day.start)
    )).scalar_one()

    states = {srs.atom_id: srs for _, srs in due_rows}
    cards = await _cards(db, [a for a, _ in due_rows] + list(new_atoms), states)
    library = (await db.execute(select(func.count()).select_from(Atom).where(Atom.user_id == user.id))).scalar_one()

    return {
        "due": len(due_rows),
        "new": len(new_atoms),
        "new_limit": user.new_cards_per_day,
        "new_introduced_today": introduced_today,
        "new_waiting": waiting_new - len(new_atoms),
        "done_today": done_today,
        "library": library,
        "cards": cards,
    }


class ReviewBody(BaseModel):
    result: Literal["know", "unknown"]


@router.post("/review/{atom_id}")
async def review(
    atom_id: UUID, body: ReviewBody,
    db: AsyncSession = Depends(get_db), user: User = Depends(current_user),
):
    atom = await atom_service.get_atom_by_id(db, atom_id, user_id=user.id)
    if atom is None:
        raise HTTPException(status_code=404, detail="Atom not found")
    srs = (await db.execute(select(AtomSrsState).where(AtomSrsState.atom_id == atom_id))).scalar_one_or_none()
    if srs is None:
        srs = AtomSrsState(atom_id=atom_id, reps=0, lapses=0)
        db.add(srs)
    knew = body.result == "know"
    review_service.review(srs, knew, user.desired_retention)
    await atom_service.add_trace(db, atom_id, "review", {"result": body.result})
    await db.commit()
    return {
        "due": srs.next_review.isoformat(),
        "stability": round(srs.stability or 0, 2),
        "familiar": (srs.stability or 0) >= review_service.FAMILIAR_DAYS,
    }


class ReviewSettings(BaseModel):
    new_cards_per_day: int | None = Field(default=None, ge=0, le=200)
    desired_retention: float | None = Field(default=None, ge=0.7, le=0.97)


@router.get("/review/settings")
async def get_settings_(user: User = Depends(current_user)):
    return {"new_cards_per_day": user.new_cards_per_day, "desired_retention": round(user.desired_retention, 2)}


@router.patch("/review/settings")
async def update_settings(body: ReviewSettings, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    me = await db.get(User, user.id)
    if body.new_cards_per_day is not None:
        me.new_cards_per_day = body.new_cards_per_day
    if body.desired_retention is not None:
        me.desired_retention = round(body.desired_retention, 2)
    await db.commit()
    return {"new_cards_per_day": me.new_cards_per_day, "desired_retention": round(me.desired_retention, 2)}
