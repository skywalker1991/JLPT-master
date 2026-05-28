# backend/app/api/internalize.py
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, case, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Atom, AtomProperty, AtomTag, AtomSrsState, Trace, get_db
from app.services import atom_service
from app.services.internalize_service import (
    extract_jlpt_level,
    next_review_after_know,
    next_review_after_unknown,
)

router = APIRouter(tags=["internalize"])


@router.get("/internalize/queue")
async def get_queue(
    limit: int = Query(default=20, ge=1, le=200),
    prompt: Literal['meaning', 'reading'] = Query(default="meaning"),
    levels: list[str] = Query(default=[]),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns atoms ordered by SRS due-date.
    New atoms (no SRS state) appear first (coalesced to epoch), then
    overdue atoms, then future atoms.
    """
    from sqlalchemy import and_, exists as sa_exists

    order_expr = func.coalesce(
        AtomSrsState.next_review,
        text("'1970-01-01 00:00:00+00'::timestamptz"),
    ).asc()

    query = (
        select(Atom)
        .outerjoin(AtomSrsState, AtomSrsState.atom_id == Atom.id)
        .order_by(order_expr)
        .limit(limit)
    )

    if levels:
        query = query.where(
            sa_exists(
                select(AtomTag.atom_id).where(
                    and_(AtomTag.atom_id == Atom.id, AtomTag.tag.in_(levels))
                )
            )
        )

    result = await db.execute(query)
    atoms = result.scalars().all()

    if not atoms:
        return {"cards": []}

    atom_ids = [a.id for a in atoms]
    atoms_map = {a.id: a for a in atoms}

    props_result = await db.execute(
        select(AtomProperty)
        .where(AtomProperty.atom_id.in_(atom_ids))
        .order_by(AtomProperty.atom_id, AtomProperty.created_at)
    )
    props_by_atom: dict[UUID, list[AtomProperty]] = {}
    for p in props_result.scalars().all():
        props_by_atom.setdefault(p.atom_id, []).append(p)

    tags_result = await db.execute(
        select(AtomTag).where(AtomTag.atom_id.in_(atom_ids))
    )
    tags_by_atom: dict[UUID, list[str]] = {}
    for t in tags_result.scalars().all():
        tags_by_atom.setdefault(t.atom_id, []).append(t.tag)

    cards = []
    for atom_id in atom_ids:
        atom = atoms_map[atom_id]
        props = props_by_atom.get(atom_id, [])
        tags = tags_by_atom.get(atom_id, [])
        jlpt_level = extract_jlpt_level(tags)
        prompt_value = next((p.value for p in props if p.kind == prompt), None)

        cards.append({
            "id": str(atom_id),
            "type": atom.type,
            "key": atom.key,
            "jlpt_level": jlpt_level,
            "prompt_value": prompt_value,
            "properties": [{"kind": p.kind, "value": p.value} for p in props],
        })

    return {"cards": cards}


@router.post("/internalize/trace", status_code=201)
async def record_trace(body: dict, db: AsyncSession = Depends(get_db)):
    """Records a card swipe result and updates the atom's SRS state."""
    atom_id_str = body.get("atom_id")
    result = body.get("result")
    prompt_type = body.get("prompt_type", "meaning")

    if result not in ("know", "unknown"):
        raise HTTPException(status_code=422, detail="result must be 'know' or 'unknown'")

    try:
        atom_id = UUID(atom_id_str)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="invalid atom_id")

    atom = await atom_service.get_atom_by_id(db, atom_id)
    if atom is None:
        raise HTTPException(status_code=404, detail="Atom not found")

    # Record trace
    await atom_service.add_trace(
        db, atom_id, "review", {"result": result, "prompt_type": prompt_type}
    )

    # Update SRS state
    srs_result = await db.execute(
        select(AtomSrsState).where(AtomSrsState.atom_id == atom_id)
    )
    srs = srs_result.scalar_one_or_none()
    current_box = srs.box_level if srs else 0

    if result == "know":
        new_box, next_review = next_review_after_know(current_box)
    else:
        new_box, next_review = next_review_after_unknown(current_box)

    if srs is None:
        db.add(AtomSrsState(atom_id=atom_id, box_level=new_box, next_review=next_review))
    else:
        srs.box_level = new_box
        srs.next_review = next_review
        srs.updated_at = datetime.now(timezone.utc)

    await db.commit()
    return {"ok": True}


@router.get("/internalize/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    """Returns today's and all-time review stats plus box-level distribution."""
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    today_row = (await db.execute(
        select(
            func.sum(case((Trace.detail["result"].astext == "know", 1), else_=0)).label("know"),
            func.sum(case((Trace.detail["result"].astext == "unknown", 1), else_=0)).label("unknown"),
        ).where(Trace.action == "review", Trace.created_at >= today_start)
    )).one()

    total_row = (await db.execute(
        select(
            func.sum(case((Trace.detail["result"].astext == "know", 1), else_=0)).label("know"),
            func.sum(case((Trace.detail["result"].astext == "unknown", 1), else_=0)).label("unknown"),
        ).where(Trace.action == "review")
    )).one()

    dist_rows = (await db.execute(
        select(AtomSrsState.box_level, func.count().label("cnt"))
        .group_by(AtomSrsState.box_level)
    )).all()

    distribution = {f"box{row.box_level}": row.cnt for row in dist_rows}
    total_in_state = sum(distribution.values())
    mastery_pct = round(distribution.get("box5", 0) / max(total_in_state, 1) * 100)

    return {
        "today": {
            "know": today_row.know or 0,
            "unknown": today_row.unknown or 0,
            "total": (today_row.know or 0) + (today_row.unknown or 0),
        },
        "total": {
            "know": total_row.know or 0,
            "unknown": total_row.unknown or 0,
            "mastery_pct": mastery_pct,
        },
        "distribution": {f"box{i}": distribution.get(f"box{i}", 0) for i in range(6)},
    }
