"""知识库: look things up, browse them, tidy them. Review lives in 内化学习.

GET    /kb/overview                how familiar the library is, the last 30 days, what keeps being forgotten
GET    /kb/entries                 the list, filtered and searched
GET    /kb/sources                 the same entries grouped by the passage or test they came from
GET    /kb/entries/{id}            one entry: its sentences first, then its relations
PATCH  /kb/entries/{id}            edit reading / meaning / level (marked 「你改的」; AI never overwrites it)
DELETE /kb/occurrences/{id}        「这句不是这个词」
POST   /kb/entries/{id}/merge      fold this entry into another
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.models.db import (
    Analysis, Atom, AtomOccurrence, AtomProperty, AtomRelation, AtomSrsState, AtomTag, Trace, User, get_db,
)
from app.services import atom_service
from app.services.qdrant_service import qdrant_service
from app.services.review_service import FAMILIAR_DAYS

router = APIRouter(tags=["kb"])

_LEVELS = {"N1", "N2", "N3", "N4", "N5"}


def familiarity(srs: AtomSrsState | None) -> str:
    """新: never reviewed. 熟: stable for about a week. 在学: in between."""
    if srs is None or srs.stability is None:
        return "new"
    return "familiar" if srs.stability >= FAMILIAR_DAYS else "learning"


def _pick(props: list[AtomProperty], kind: str) -> tuple[str | None, bool]:
    """The value shown for a field, and whether the person set it. A value
    the person wrote wins over anything the AI suggested."""
    rows = [p for p in props if p.kind == kind and p.value.strip()]
    mine = [p for p in rows if p.source_type == "user"]
    if mine:
        return max(mine, key=lambda p: p.created_at).value, True
    return (rows[0].value if rows else None), False


async def _library(db: AsyncSession, user: User):
    """Every entry with what the list needs, in a handful of queries."""
    atoms = (await db.execute(select(Atom).where(Atom.user_id == user.id))).scalars().all()
    ids = [a.id for a in atoms]
    props: dict[UUID, list[AtomProperty]] = defaultdict(list)
    for p in (await db.execute(select(AtomProperty).where(AtomProperty.atom_id.in_(ids or [None])).order_by(AtomProperty.created_at))).scalars():
        props[p.atom_id].append(p)
    tags: dict[UUID, set] = defaultdict(set)
    for t in (await db.execute(select(AtomTag).where(AtomTag.atom_id.in_(ids or [None])))).scalars():
        tags[t.atom_id].add(t.tag)
    occ = dict((await db.execute(
        select(AtomOccurrence.atom_id, func.count()).where(AtomOccurrence.atom_id.in_(ids or [None])).group_by(AtomOccurrence.atom_id)
    )).all())
    srs = {s.atom_id: s for s in (await db.execute(select(AtomSrsState).where(AtomSrsState.atom_id.in_(ids or [None])))).scalars()}
    return atoms, props, tags, occ, srs


def _entry(a: Atom, props, tags, occ, srs) -> dict:
    p = props.get(a.id, [])
    meaning, _ = _pick(p, "meaning")
    reading, _ = _pick(p, "reading")
    level, _ = _pick(p, "jlpt_level")
    if level not in _LEVELS:
        level = next((t for t in tags.get(a.id, ()) if t in _LEVELS), None)
    return {
        "id": str(a.id), "type": a.type, "key": a.key,
        "reading": a.reading or reading, "meaning": meaning, "level": level,
        "sentences": occ.get(a.id, 0), "familiarity": familiarity(srs.get(a.id)),
        "created_at": a.created_at.isoformat(),
    }


@router.get("/kb/overview")
async def overview(tz: int = 0, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    atoms, props, tags, occ, srs = await _library(db, user)
    fam = defaultdict(int)
    for a in atoms:
        fam[familiarity(srs.get(a.id))] += 1
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=30)
    offset = timedelta(minutes=tz)
    per_day = [0] * 30
    for a in atoms:
        if a.created_at >= since:
            per_day[min(29, max(0, ((a.created_at - offset).date() - (since - offset).date()).days))] += 1
    became_familiar = sum(1 for s in srs.values() if (s.stability or 0) >= FAMILIAR_DAYS and s.last_review and s.last_review >= since)
    forgotten = sorted((a for a in atoms if (srs.get(a.id) and srs[a.id].lapses >= 2)),
                       key=lambda a: -srs[a.id].lapses)[:8]
    return {
        "total": len(atoms),
        "vocab": sum(1 for a in atoms if a.type == "vocabulary"),
        "grammar": sum(1 for a in atoms if a.type == "grammar"),
        "familiarity": {"new": fam["new"], "learning": fam["learning"], "familiar": fam["familiar"]},
        "added_30": sum(per_day), "familiar_30": became_familiar, "added_per_day": per_day,
        "forgotten": [{"id": str(a.id), "key": a.key, "lapses": srs[a.id].lapses} for a in forgotten],
    }


@router.get("/kb/entries")
async def entries(
    type: str | None = Query(default=None, pattern="^(vocabulary|grammar)$"),
    fam: str | None = Query(default=None, pattern="^(new|learning|familiar)$"),
    level: str | None = Query(default=None, pattern="^N[1-5]$"),
    q: str | None = Query(default=None, max_length=100),
    db: AsyncSession = Depends(get_db), user: User = Depends(current_user),
):
    atoms, props, tags, occ, srs = await _library(db, user)
    hits: set[UUID] | None = None
    if q and q.strip():
        like = f"%{q.strip()}%"
        hits = {a.id for a in atoms if q.strip() in a.key or (a.reading and q.strip() in a.reading)}
        hits |= set((await db.execute(select(AtomProperty.atom_id).where(
            AtomProperty.atom_id.in_([a.id for a in atoms] or [None]), AtomProperty.value.ilike(like)))).scalars())
        hits |= set((await db.execute(select(AtomOccurrence.atom_id).where(
            AtomOccurrence.atom_id.in_([a.id for a in atoms] or [None]), AtomOccurrence.sentence_text.ilike(like)))).scalars())
    out = []
    for a in sorted(atoms, key=lambda a: a.created_at, reverse=True):
        if hits is not None and a.id not in hits:
            continue
        e = _entry(a, props, tags, occ, srs)
        if (type and a.type != type) or (fam and e["familiarity"] != fam) or (level and e["level"] != level):
            continue
        out.append(e)
    return {"items": out, "total": len(out)}


@router.get("/kb/sources")
async def sources(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """Entries grouped by the passage (語料分析) or test (JLPT) they were met in."""
    atoms, props, tags, occ, srs = await _library(db, user)
    by_id = {a.id: a for a in atoms}
    rows = (await db.execute(
        select(AtomOccurrence.atom_id, AtomOccurrence.analysis_id, AtomOccurrence.created_at)
        .where(AtomOccurrence.atom_id.in_(list(by_id) or [None]))
    )).all()
    groups: dict = {}
    for atom_id, analysis_id, when in rows:
        g = groups.setdefault(analysis_id, {"atoms": {}, "when": when})
        g["atoms"][atom_id] = by_id[atom_id]
        g["when"] = max(g["when"], when)
    titles = {a.id: a for a in (await db.execute(select(Analysis).where(
        Analysis.id.in_([k for k in groups if k] or [None]), Analysis.user_id == user.id))).scalars()}
    out = []
    for analysis_id, g in sorted(groups.items(), key=lambda kv: kv[1]["when"], reverse=True):
        an = titles.get(analysis_id) if analysis_id else None
        first = ((an.session_data or {}).get("sentences") or [{}])[0].get("text") if an else None
        out.append({
            "analysis_id": str(analysis_id) if analysis_id else None,
            "title": first or (an.input_content[:40] if an and an.input_content else "JLPT 真题"),
            "source": "语料分析" if analysis_id else "JLPT",
            "date": g["when"].isoformat(),
            "entries": [{"id": str(a.id), "key": a.key} for a in g["atoms"].values()],
        })
    return out


@router.get("/kb/entries/{atom_id}")
async def entry(atom_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    atom = await atom_service.get_atom_by_id(db, atom_id, user_id=user.id)
    if atom is None:
        raise HTTPException(status_code=404, detail="没有这个词条")
    props = (await db.execute(select(AtomProperty).where(AtomProperty.atom_id == atom.id).order_by(AtomProperty.created_at))).scalars().all()
    occs = (await db.execute(select(AtomOccurrence).where(AtomOccurrence.atom_id == atom.id).order_by(AtomOccurrence.created_at.desc()))).scalars().all()
    srs = (await db.execute(select(AtomSrsState).where(AtomSrsState.atom_id == atom.id))).scalar_one_or_none()
    fields = {}
    for kind in ("reading", "meaning", "jlpt_level", "usage", "connection", "part_of_speech"):
        value, mine = _pick(props, kind)
        fields[kind] = {"value": value, "edited": mine}
    if atom.reading and not fields["reading"]["edited"]:
        fields["reading"]["value"] = atom.reading
    meanings = list(dict.fromkeys(p.value for p in props if p.kind == "meaning"))

    # Relations, each with the other side's meaning and a sentence of its own
    rel_rows = (await db.execute(select(AtomRelation).where(
        or_(AtomRelation.from_id == atom.id, AtomRelation.to_id == atom.id)))).scalars().all()
    other_ids = [r.to_id if r.from_id == atom.id else r.from_id for r in rel_rows]
    others = {a.id: a for a in (await db.execute(select(Atom).where(Atom.id.in_(other_ids or [None])))).scalars()}
    oprops: dict[UUID, list] = defaultdict(list)
    for p in (await db.execute(select(AtomProperty).where(AtomProperty.atom_id.in_(other_ids or [None])).order_by(AtomProperty.created_at))).scalars():
        oprops[p.atom_id].append(p)
    osent: dict[UUID, AtomOccurrence] = {}
    for o in (await db.execute(select(AtomOccurrence).where(AtomOccurrence.atom_id.in_(other_ids or [None])).order_by(AtomOccurrence.created_at))).scalars():
        osent.setdefault(o.atom_id, o)
    relations = []
    for r, oid in zip(rel_rows, other_ids):
        o = others.get(oid)
        if o is None:
            continue
        s = osent.get(oid)
        relations.append({
            "id": str(r.id), "type": r.type, "note": (r.note or {}).get("text"),
            "other": {"id": str(o.id), "key": o.key, "reading": o.reading or _pick(oprops[oid], "reading")[0],
                      "meaning": _pick(oprops[oid], "meaning")[0],
                      "sentence": {"text": s.sentence_text, "date": s.created_at.isoformat(),
                                   "source": "语料分析" if s.analysis_id else "JLPT"} if s else None},
        })

    return {
        "id": str(atom.id), "type": atom.type, "key": atom.key, "created_at": atom.created_at.isoformat(),
        "fields": fields, "meanings": meanings,
        "sentences": [{
            "id": str(o.id), "text": o.sentence_text, "translation": o.sentence_translation,
            "surface": o.surface, "meaning_here": o.surface_meaning, "date": o.created_at.isoformat(),
            "source": "语料分析" if o.analysis_id else "JLPT", "analysis_id": str(o.analysis_id) if o.analysis_id else None,
        } for o in occs],
        "review": {
            "familiarity": familiarity(srs),
            "stability": round(srs.stability, 1) if srs and srs.stability else None,
            "due": srs.next_review.isoformat() if srs else None,
            "lapses": srs.lapses if srs else 0,
        },
        "relations": relations,
    }


class EditBody(BaseModel):
    reading: str | None = Field(default=None, max_length=100)
    meaning: str | None = Field(default=None, max_length=300)
    level: str | None = Field(default=None, pattern="^N[1-5]$")


@router.patch("/kb/entries/{atom_id}")
async def edit(atom_id: UUID, body: EditBody, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """The person's own value for a field. Kept as a property of its own
    (source 'user'), so it shows as 「你改的」 and AI suggestions never replace it."""
    atom = await atom_service.get_atom_by_id(db, atom_id, user_id=user.id)
    if atom is None:
        raise HTTPException(status_code=404, detail="没有这个词条")
    for kind, value in (("reading", body.reading), ("meaning", body.meaning), ("jlpt_level", body.level)):
        if value is not None and value.strip():
            db.add(AtomProperty(atom_id=atom.id, kind=kind, value=value.strip(), source_type="user"))
            if kind == "reading" and atom.type == "vocabulary":
                atom.reading = value.strip()
    await atom_service.add_trace(db, atom.id, "edited", body.model_dump(exclude_none=True))
    await db.commit()
    return await entry(atom_id, db, user)


@router.delete("/kb/occurrences/{occ_id}", status_code=204)
async def remove_sentence(occ_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """「这句不是这个词」: a sentence noted under the wrong entry."""
    occ = await db.get(AtomOccurrence, occ_id)
    if occ is None or await atom_service.get_atom_by_id(db, occ.atom_id, user_id=user.id) is None:
        raise HTTPException(status_code=404, detail="没有这一句")
    await db.delete(occ)
    await db.commit()


class MergeBody(BaseModel):
    into: UUID


@router.post("/kb/entries/{atom_id}/merge")
async def merge(atom_id: UUID, body: MergeBody, db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """Fold this entry into another: their sentences and relations come
    together, the other's way of writing it stays, and the review progress
    kept is the further along of the two."""
    src = await atom_service.get_atom_by_id(db, atom_id, user_id=user.id)
    dst = await atom_service.get_atom_by_id(db, body.into, user_id=user.id)
    if src is None or dst is None:
        raise HTTPException(status_code=404, detail="没有这个词条")
    if src.id == dst.id or src.type != dst.type:
        raise HTTPException(status_code=422, detail="只能合并到另一个同类的词条")

    # Sentences: move the ones the target doesn't have yet
    have = {(o.sentence_text, o.surface) for o in (await db.execute(
        select(AtomOccurrence).where(AtomOccurrence.atom_id == dst.id))).scalars()}
    for o in (await db.execute(select(AtomOccurrence).where(AtomOccurrence.atom_id == src.id))).scalars().all():
        if (o.sentence_text, o.surface) in have:
            await db.delete(o)
        else:
            o.atom_id = dst.id
    # Properties: keep new values; the source's spelling is remembered as a variant
    dst_values = {(p.kind, p.value) for p in (await db.execute(select(AtomProperty).where(AtomProperty.atom_id == dst.id))).scalars()}
    for p in (await db.execute(select(AtomProperty).where(AtomProperty.atom_id == src.id))).scalars().all():
        if (p.kind, p.value) in dst_values:
            await db.delete(p)
        else:
            p.atom_id = dst.id
    if src.key != dst.key and ("variant", src.key) not in dst_values:
        db.add(AtomProperty(atom_id=dst.id, kind="variant", value=src.key, source_type="user"))
    # Relations: re-point, dropping any that would join the entry to itself or repeat one
    dst_rels = {(r.from_id, r.to_id, r.type) for r in (await db.execute(select(AtomRelation).where(
        or_(AtomRelation.from_id == dst.id, AtomRelation.to_id == dst.id)))).scalars()}
    for r in (await db.execute(select(AtomRelation).where(
            or_(AtomRelation.from_id == src.id, AtomRelation.to_id == src.id)))).scalars().all():
        f = dst.id if r.from_id == src.id else r.from_id
        t = dst.id if r.to_id == src.id else r.to_id
        if f == t or (f, t, r.type) in dst_rels or (t, f, r.type) in dst_rels:
            await db.delete(r)
        else:
            r.from_id, r.to_id = f, t
            dst_rels.add((f, t, r.type))
    # Review: keep whichever is further along
    s_srs = (await db.execute(select(AtomSrsState).where(AtomSrsState.atom_id == src.id))).scalar_one_or_none()
    d_srs = (await db.execute(select(AtomSrsState).where(AtomSrsState.atom_id == dst.id))).scalar_one_or_none()
    if s_srs is not None and (d_srs is None or (s_srs.stability or 0) > (d_srs.stability or 0)):
        if d_srs is not None:
            await db.delete(d_srs)
            await db.flush()
        s_srs.atom_id = dst.id
    await db.flush()
    await db.execute(update(Trace).where(Trace.atom_id == src.id).values(atom_id=dst.id))
    await db.execute(delete(AtomTag).where(AtomTag.atom_id == src.id))
    await db.delete(src)
    await atom_service.add_trace(db, dst.id, "merged", {"from": src.key})
    await db.commit()
    if src.type == "grammar":
        await qdrant_service.delete_atoms([src.id])
    return {"id": str(dst.id)}


@router.get("/kb/export.csv")
async def export_csv(db: AsyncSession = Depends(get_db), user: User = Depends(current_user)):
    """Everything in the library as CSV — each entry with the sentences it was
    met in and where. The person's data is theirs to take, always."""
    import csv
    import io

    from fastapi.responses import Response

    atoms, props, tags, occ, srs = await _library(db, user)
    sentences: dict[UUID, list[AtomOccurrence]] = defaultdict(list)
    for o in (await db.execute(select(AtomOccurrence).where(
            AtomOccurrence.atom_id.in_([a.id for a in atoms] or [None])).order_by(AtomOccurrence.created_at))).scalars():
        sentences[o.atom_id].append(o)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["类型", "写法", "读音", "意思", "等级", "熟悉程度", "入库日期", "例句", "例句译文", "出处"])
    label = {"new": "新", "learning": "在学", "familiar": "熟"}
    for a in sorted(atoms, key=lambda a: a.created_at):
        e = _entry(a, props, tags, occ, srs)
        rows = sentences.get(a.id) or [None]
        for o in rows:
            w.writerow([
                "词汇" if a.type == "vocabulary" else "语法", a.key, e["reading"] or "", e["meaning"] or "",
                e["level"] or "", label[e["familiarity"]], a.created_at.date().isoformat(),
                o.sentence_text if o else "", (o.sentence_translation or "") if o else "",
                ("语料分析" if o.analysis_id else "JLPT") if o else "",
            ])
    return Response(
        content="﻿" + buf.getvalue(),  # BOM so Excel opens it as UTF-8
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=\"jlpt-master-knowledge.csv\""},
    )
