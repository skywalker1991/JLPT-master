# backend/app/api/internalize.py
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, case, exists, and_, Float
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Atom, AtomProperty, AtomTag, Trace, get_db
from app.services import atom_service
from app.services.internalize_service import extract_jlpt_level

router = APIRouter(tags=["internalize"])


@router.get("/internalize/queue")
async def get_queue(
    limit: int = Query(default=20, ge=1, le=200),
    prompt: Literal['meaning', 'reading', 'example'] = Query(default="meaning"),
    tag: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """
    返回按优先级排序的原子复习队列。
    优先级 = fail_rate * 0.6 + days_decay * 0.4
    从未复习的原子具有最高优先级（days_since=999）。
    """
    # 评审统计子查询
    review_stats = (
        select(
            Trace.atom_id,
            func.count().label("review_count"),
            func.sum(
                case(
                    (Trace.detail["result"].astext == "unknown", 1),
                    else_=0,
                )
            ).label("fail_count"),
            func.max(Trace.created_at).label("last_review"),
        )
        .where(Trace.action == "review")
        .group_by(Trace.atom_id)
        .subquery("review_stats")
    )

    days_since_expr = func.coalesce(
        func.extract("epoch", func.now() - review_stats.c.last_review) / 86400.0,
        999.0,
    )
    fail_rate_expr = func.coalesce(
        func.cast(review_stats.c.fail_count, Float)
        / func.greatest(func.cast(review_stats.c.review_count, Float), 1.0),
        0.0,
    )
    priority_expr = (
        fail_rate_expr * 0.6
        + (1 - func.exp(-days_since_expr / 14.0)) * 0.4
    )

    query = (
        select(Atom, priority_expr.label("priority"))
        .outerjoin(review_stats, review_stats.c.atom_id == Atom.id)
    )

    if tag:
        query = query.where(
            exists(
                select(AtomTag.atom_id).where(
                    and_(AtomTag.atom_id == Atom.id, AtomTag.tag == tag)
                )
            )
        )

    query = query.order_by(priority_expr.desc()).limit(limit)

    result = await db.execute(query)
    rows = result.all()

    if not rows:
        return {"cards": []}

    atom_ids = [row.Atom.id for row in rows]
    atoms_map = {row.Atom.id: row.Atom for row in rows}

    # 一次查询所有 properties
    props_result = await db.execute(
        select(AtomProperty)
        .where(AtomProperty.atom_id.in_(atom_ids))
        .order_by(AtomProperty.atom_id, AtomProperty.created_at)
    )
    props_by_atom: dict[UUID, list[AtomProperty]] = {}
    for p in props_result.scalars().all():
        props_by_atom.setdefault(p.atom_id, []).append(p)

    # 一次查询所有 tags
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

        cards.append(
            {
                "id": str(atom_id),
                "type": atom.type,
                "key": atom.key,
                "jlpt_level": jlpt_level,
                "prompt_value": prompt_value,
                "properties": [
                    {"kind": p.kind, "value": p.value} for p in props
                ],
            }
        )

    return {"cards": cards}


@router.post("/internalize/trace", status_code=201)
async def record_trace(body: dict, db: AsyncSession = Depends(get_db)):
    """记录一次卡牌划拨结果到 traces 表。"""
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

    await atom_service.add_trace(
        db, atom_id, "review", {"result": result, "prompt_type": prompt_type}
    )
    await db.commit()
    return {"ok": True}
