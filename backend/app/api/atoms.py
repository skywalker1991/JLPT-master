import logging
import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import (
    Atom, AtomProperty, AtomRelation, AtomTag, Trace, AnalysisAtom, Analysis, get_db
)
from app.schemas.atoms import (
    CreateAtomRequest,
    CreateAtomResponse,
    AddPropertiesRequest,
    CreateRelationRequest,
    PropertyResponse,
    RelationResponse,
    AtomListItem,
    AtomDetail,
    SimilarCandidate,
)
from app.services import atom_service
from app.services.qdrant_service import qdrant_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["atoms"])

_JLPT_PATTERN = re.compile(r"^N[1-5]$")


def _normalize_grammar_key(key: str) -> str:
    """Normalize grammar pattern key: unify tilde variants, strip whitespace."""
    normalized = re.sub(r"[~～]", "〜", key)
    return normalized.strip()


def _validate_jlpt(value: str | None) -> str | None:
    if value and _JLPT_PATTERN.match(value):
        return value
    return None


# ---------------------------------------------------------------------------
# POST /atoms
# ---------------------------------------------------------------------------

@router.post("/atoms", response_model=CreateAtomResponse)
async def create_atom(request: CreateAtomRequest, db: AsyncSession = Depends(get_db)):
    """
    Create a new atom with properties. Returns 'exists', 'similar', or 'created'.
    Grammar atoms go through Qdrant similarity check first.
    """
    atom_type = request.type
    key = request.key

    # Step 1: Normalize grammar key
    if atom_type == "grammar":
        key = _normalize_grammar_key(key)

    # Step 2: Exact match check (also try stripped-tilde variant for grammar)
    keys_to_try = [key]
    if atom_type == "grammar":
        if key.startswith("〜"):
            keys_to_try.append(key.lstrip("〜").strip())
        else:
            keys_to_try.append("〜" + key)

    existing = None
    for k in keys_to_try:
        existing = await atom_service.get_atom_by_key(db, atom_type, k)
        if existing is not None:
            break

    if existing is not None:
        props = await atom_service.get_properties(db, existing.id)
        prop_responses = [
            PropertyResponse(
                id=p.id,
                kind=p.kind,
                value=p.value,
                source_type=p.source_type,
                source_ref=p.source_ref,
                created_at=p.created_at,
            )
            for p in props
        ]
        return CreateAtomResponse(
            atom_id=existing.id,
            status="exists",
            existing_properties=prop_responses,
        )

    # Step 3: Qdrant semantic search for grammar atoms
    if atom_type == "grammar" and not request.force_create:
        # Extract meaning from request properties for richer embedding
        meaning_values = [p.value for p in request.properties if p.kind == "meaning"]
        meaning = meaning_values[0] if meaning_values else ""
        query = f"{key} {meaning}".strip()

        similar = await qdrant_service.search_similar(query, limit=5, score_threshold=0.75)
        if similar:
            # Check for near-exact match (score > 0.95)
            top = similar[0]
            if top["score"] > 0.95:
                # Treat as existing — look up the atom in DB
                atom_id_str = top["id"]
                try:
                    atom_id = UUID(atom_id_str)
                    db_atom = await atom_service.get_atom_by_id(db, atom_id)
                    if db_atom is not None:
                        props = await atom_service.get_properties(db, db_atom.id)
                        prop_responses = [
                            PropertyResponse(
                                id=p.id,
                                kind=p.kind,
                                value=p.value,
                                source_type=p.source_type,
                                source_ref=p.source_ref,
                                created_at=p.created_at,
                            )
                            for p in props
                        ]
                        return CreateAtomResponse(
                            atom_id=db_atom.id,
                            status="exists",
                            existing_properties=prop_responses,
                        )
                except (ValueError, Exception) as e:
                    logger.warning("Could not resolve Qdrant hit to DB atom: %s", e)

            # Scores between 0.75-0.95 → return candidates
            candidates = [
                SimilarCandidate(
                    atom_id=UUID(hit["id"]) if isinstance(hit["id"], str) else hit["id"],
                    key=hit["key"],
                    meaning=hit.get("meaning"),
                    score=hit["score"],
                )
                for hit in similar
            ]
            return CreateAtomResponse(
                atom_id=None,
                status="similar",
                candidates=candidates,
            )

    # Step 4: Create atom
    atom = await atom_service.create_atom(db, atom_type, key)

    # Add properties
    if request.properties:
        await atom_service.add_properties(
            db,
            atom.id,
            request.properties,
            source_type="ai",
            source_ref=request.analysis_id,
        )

    # Link to analysis
    if request.analysis_id:
        await atom_service.link_atom_to_analysis(db, atom.id, request.analysis_id)

    # Write trace
    await atom_service.add_trace(db, atom.id, "added", {"key": key, "type": atom_type})

    await db.commit()

    # Upsert into Qdrant for grammar atoms (non-blocking)
    if atom_type == "grammar":
        meaning_values = [p.value for p in request.properties if p.kind == "meaning"]
        meaning = meaning_values[0] if meaning_values else ""
        await qdrant_service.upsert_grammar_atom(atom.id, key, meaning)

    return CreateAtomResponse(atom_id=atom.id, status="created")


# ---------------------------------------------------------------------------
# POST /atoms/{id}/properties
# ---------------------------------------------------------------------------

@router.post("/atoms/{atom_id}/properties")
async def add_properties(
    atom_id: UUID,
    request: AddPropertiesRequest,
    db: AsyncSession = Depends(get_db),
):
    """Add properties to an existing atom with deduplication."""
    atom = await atom_service.get_atom_by_id(db, atom_id)
    if atom is None:
        raise HTTPException(status_code=404, detail="Atom not found")

    added, skipped = await atom_service.add_properties(
        db,
        atom_id,
        request.properties,
        source_type="user",
        source_ref=request.analysis_id,
    )

    await atom_service.add_trace(
        db, atom_id, "property_added",
        {"added": added, "skipped": skipped}
    )
    await db.commit()
    return {"added": added, "skipped": skipped}


# ---------------------------------------------------------------------------
# POST /atoms/{id}/relations
# ---------------------------------------------------------------------------

@router.post("/atoms/{atom_id}/relations")
async def add_relation(
    atom_id: UUID,
    request: CreateRelationRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create a relation between two atoms."""
    if request.type not in atom_service.VALID_RELATION_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid relation type '{request.type}'. Must be one of: {atom_service.VALID_RELATION_TYPES}",
        )

    from_atom = await atom_service.get_atom_by_id(db, atom_id)
    if from_atom is None:
        raise HTTPException(status_code=404, detail="Source atom not found")

    to_atom = await atom_service.get_atom_by_id(db, request.target_atom_id)
    if to_atom is None:
        raise HTTPException(status_code=404, detail="Target atom not found")

    if atom_id == request.target_atom_id:
        raise HTTPException(status_code=400, detail="Cannot create self-relation")

    relation_id, rel_status = await atom_service.add_relation(
        db,
        from_id=atom_id,
        to_id=request.target_atom_id,
        type=request.type,
        note=request.note,
        source_type="user",
        source_ref=None,
    )

    if rel_status == "created":
        await atom_service.add_trace(
            db, atom_id, "relation_created",
            {"to_id": str(request.target_atom_id), "type": request.type}
        )
        await db.commit()

    return {"relation_id": str(relation_id), "status": rel_status}


# ---------------------------------------------------------------------------
# GET /atoms
# ---------------------------------------------------------------------------

@router.get("/atoms")
async def list_atoms(
    type: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List atoms with optional filters and pagination, including maturity scores."""
    base_query = select(Atom)
    if type:
        base_query = base_query.where(Atom.type == type)
    if search:
        base_query = base_query.where(Atom.key.ilike(f"%{search}%"))
    if tag:
        base_query = base_query.join(AtomTag, AtomTag.atom_id == Atom.id).where(AtomTag.tag == tag)

    count_result = await db.execute(select(func.count()).select_from(base_query.subquery()))
    total = count_result.scalar() or 0

    query = base_query.order_by(Atom.created_at.desc()).offset(page * limit).limit(limit)
    result = await db.execute(query)
    atoms = result.scalars().all()

    atom_ids = [a.id for a in atoms]

    # Batch-fetch tags for all atoms on this page
    tags_res = await db.execute(select(AtomTag).where(AtomTag.atom_id.in_(atom_ids)))
    tags_map: dict[str, list[str]] = {}
    for t in tags_res.scalars().all():
        aid = str(t.atom_id)
        tags_map.setdefault(aid, []).append(t.tag)

    # Batch-fetch key properties for all atoms on this page
    _KEY_KINDS = {"reading", "meaning", "part_of_speech", "example", "usage", "jlpt_level"}
    props_res = await db.execute(
        select(AtomProperty)
        .where(AtomProperty.atom_id.in_(atom_ids))
        .where(AtomProperty.kind.in_(_KEY_KINDS))
    )
    props_map: dict[str, dict[str, str]] = {}
    for p in props_res.scalars().all():
        aid = str(p.atom_id)
        if aid not in props_map:
            props_map[aid] = {}
        if p.kind not in props_map[aid]:
            props_map[aid][p.kind] = p.value

    items = []
    for atom in atoms:
        prop_count, rel_count = await atom_service.get_atom_counts(db, atom.id)
        maturity = await atom_service.compute_maturity(prop_count, rel_count)
        kp = props_map.get(str(atom.id), {})
        items.append({
            "id": str(atom.id),
            "type": atom.type,
            "key": atom.key,
            "property_count": prop_count,
            "relation_count": rel_count,
            "maturity": maturity,
            "created_at": atom.created_at.isoformat() if atom.created_at else None,
            "reading": kp.get("reading"),
            "meaning": kp.get("meaning"),
            "part_of_speech": kp.get("part_of_speech"),
            "example": kp.get("example"),
            "usage": kp.get("usage"),
            "jlpt_level": kp.get("jlpt_level"),
            "tags": tags_map.get(str(atom.id), []),
        })

    return {"items": items, "total": total}


# ---------------------------------------------------------------------------
# POST /atoms/backfill-jlpt-tags — one-time fix for existing atoms
# ---------------------------------------------------------------------------

@router.post("/atoms/backfill-tags")
async def backfill_tags(db: AsyncSession = Depends(get_db)):
    """Derive tags from jlpt_level / part_of_speech / register properties for all existing atoms."""
    from app.services.atom_service import _normalize_pos, _normalize_register

    props_res = await db.execute(
        select(AtomProperty).where(
            AtomProperty.kind.in_(["jlpt_level", "part_of_speech", "register"])
        )
    )
    created = 0
    skipped = 0
    for p in props_res.scalars().all():
        if not p.value:
            continue
        if p.kind == "jlpt_level":
            tag_val = p.value.upper()
        elif p.kind == "part_of_speech":
            tag_val = _normalize_pos(p.value)
        else:
            tag_val = _normalize_register(p.value)
        if not tag_val:
            continue
        existing = await db.execute(
            select(AtomTag).where(and_(AtomTag.atom_id == p.atom_id, AtomTag.tag == tag_val))
        )
        if existing.scalar_one_or_none() is None:
            db.add(AtomTag(atom_id=p.atom_id, tag=tag_val))
            created += 1
        else:
            skipped += 1
    await db.commit()
    return {"created": created, "skipped": skipped}


# ---------------------------------------------------------------------------
# GET /atoms/graph  — must be defined before /atoms/{atom_id}
# ---------------------------------------------------------------------------

_JLPT_LEVELS = {"N1", "N2", "N3", "N4", "N5"}


@router.get("/atoms/graph")
async def get_atom_graph(db: AsyncSession = Depends(get_db)):
    """Return all atoms and relations for knowledge graph visualisation."""
    atoms_res = await db.execute(select(Atom).order_by(Atom.created_at))
    atoms = atoms_res.scalars().all()

    rels_res = await db.execute(select(AtomRelation))
    rels = rels_res.scalars().all()

    atom_ids = [a.id for a in atoms]

    # Read JLPT level and POS from properties (single batch query)
    graph_props_res = await db.execute(
        select(AtomProperty)
        .where(AtomProperty.atom_id.in_(atom_ids))
        .where(AtomProperty.kind.in_(["jlpt_level", "part_of_speech"]))
    )
    jlpt_map: dict = {}
    pos_map: dict = {}
    for p in graph_props_res.scalars().all():
        if p.kind == "jlpt_level" and p.atom_id not in jlpt_map and p.value:
            jlpt_map[p.atom_id] = p.value.upper()
        elif p.kind == "part_of_speech" and p.atom_id not in pos_map:
            pos_map[p.atom_id] = p.value

    return {
        "nodes": [
            {
                "id": str(a.id),
                "key": a.key,
                "type": a.type,
                "jlpt": jlpt_map.get(a.id),
                "pos": pos_map.get(a.id),
            }
            for a in atoms
        ],
        "edges": [
            {"from_id": str(r.from_id), "to_id": str(r.to_id), "type": r.type}
            for r in rels
        ],
    }


# ---------------------------------------------------------------------------
# GET /atoms/{id}
# ---------------------------------------------------------------------------

@router.get("/atoms/{atom_id}")
async def get_atom(atom_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return full atom detail with properties, relations, analyses, and trace summary."""
    atom = await atom_service.get_atom_by_id(db, atom_id)
    if atom is None:
        raise HTTPException(status_code=404, detail="Atom not found")

    props = await atom_service.get_properties(db, atom_id)
    relations = await atom_service.get_relations(db, atom_id)

    # Tags
    tags_result = await db.execute(select(AtomTag).where(AtomTag.atom_id == atom_id))
    tags = [t.tag for t in tags_result.scalars().all()]

    # Linked analyses
    analysis_result = await db.execute(
        select(Analysis)
        .join(AnalysisAtom, AnalysisAtom.analysis_id == Analysis.id)
        .where(AnalysisAtom.atom_id == atom_id)
        .order_by(Analysis.created_at.desc())
        .limit(10)
    )
    analyses_list = [
        {
            "id": str(a.id),
            "input_type": a.input_type,
            "status": a.status,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in analysis_result.scalars().all()
    ]

    # Traces summary
    traces_result = await db.execute(
        select(Trace)
        .where(Trace.atom_id == atom_id)
        .order_by(Trace.created_at.desc())
        .limit(20)
    )
    traces = traces_result.scalars().all()
    action_counts: dict[str, int] = {}
    for t in traces:
        action_counts[t.action] = action_counts.get(t.action, 0) + 1
    traces_summary = {
        "total": len(traces),
        "by_action": action_counts,
        "recent": [
            {"action": t.action, "created_at": t.created_at.isoformat() if t.created_at else None}
            for t in traces[:5]
        ],
    }

    prop_count, rel_count = await atom_service.get_atom_counts(db, atom_id)
    maturity = await atom_service.compute_maturity(prop_count, rel_count)

    return {
        "atom": {
            "id": str(atom.id),
            "type": atom.type,
            "key": atom.key,
            "tags": tags,
            "maturity": maturity,
            "created_at": atom.created_at.isoformat() if atom.created_at else None,
        },
        "properties": [
            {
                "id": str(p.id),
                "kind": p.kind,
                "value": p.value,
                "source_type": p.source_type,
                "source_ref": str(p.source_ref) if p.source_ref else None,
                "created_at": p.created_at.isoformat() if p.created_at else None,
            }
            for p in props
        ],
        "relations": [
            {
                "id": str(r["id"]),
                "target": {
                    "id": str(r["target"]["id"]),
                    "type": r["target"]["type"],
                    "key": r["target"]["key"],
                },
                "type": r["type"],
                "note": r["note"],
                "direction": r["direction"],
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
            }
            for r in relations
        ],
        "analyses": analyses_list,
        "traces_summary": traces_summary,
    }


# ---------------------------------------------------------------------------
# GET /atoms/{id}/relations
# ---------------------------------------------------------------------------

@router.get("/atoms/{atom_id}/relations")
async def get_atom_relations(atom_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return all relations (both directions) for an atom."""
    atom = await atom_service.get_atom_by_id(db, atom_id)
    if atom is None:
        raise HTTPException(status_code=404, detail="Atom not found")

    relations = await atom_service.get_relations(db, atom_id)
    return [
        {
            "id": str(r["id"]),
            "target": {
                "id": str(r["target"]["id"]),
                "type": r["target"]["type"],
                "key": r["target"]["key"],
            },
            "type": r["type"],
            "note": r["note"],
            "direction": r["direction"],
            "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
        }
        for r in relations
    ]


# ---------------------------------------------------------------------------
# POST /atoms/{id}/tags
# ---------------------------------------------------------------------------

@router.post("/atoms/{atom_id}/tags")
async def add_tag(atom_id: UUID, body: dict, db: AsyncSession = Depends(get_db)):
    """Add a tag to an atom."""
    tag = body.get("tag", "").strip()
    if not tag:
        raise HTTPException(status_code=400, detail="Tag must not be empty")

    atom = await atom_service.get_atom_by_id(db, atom_id)
    if atom is None:
        raise HTTPException(status_code=404, detail="Atom not found")

    status = await atom_service.add_tag(db, atom_id, tag)
    await db.commit()
    return {"tag": tag, "status": status}


# ---------------------------------------------------------------------------
# DELETE /atoms/{id}/tags/{tag}
# ---------------------------------------------------------------------------

@router.delete("/atoms/{atom_id}/tags/{tag}", status_code=204)
async def remove_tag(atom_id: UUID, tag: str, db: AsyncSession = Depends(get_db)):
    """Remove a tag from an atom."""
    atom = await atom_service.get_atom_by_id(db, atom_id)
    if atom is None:
        raise HTTPException(status_code=404, detail="Atom not found")

    deleted = await atom_service.remove_tag(db, atom_id, tag)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Tag '{tag}' not found on this atom")
    await db.commit()


# ---------------------------------------------------------------------------
# DELETE /atoms/{id}
# ---------------------------------------------------------------------------

@router.delete("/atoms/{atom_id}", status_code=204)
async def delete_atom(atom_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete an atom and cascade to all related records."""
    atom = await atom_service.get_atom_by_id(db, atom_id)
    if atom is None:
        raise HTTPException(status_code=404, detail="Atom not found")

    await db.delete(atom)
    await db.commit()
