import logging
from uuid import UUID

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Atom, AtomProperty, AtomRelation, AtomTag, Trace, AnalysisAtom, Analysis
from app.schemas.atoms import PropertyInput

logger = logging.getLogger(__name__)

# Valid property kinds
VALID_KINDS = {
    "reading", "meaning", "part_of_speech", "jlpt_level", "register",
    "usage", "nuance", "oral_form", "connection", "example", "note",
}

# Valid relation types
VALID_RELATION_TYPES = {"synonym", "formal_casual", "derivative", "contrast", "nuance", "confusable"}


async def get_atom_by_key(db: AsyncSession, type: str, key: str) -> Atom | None:
    """Look up an atom by (type, key) unique pair."""
    result = await db.execute(
        select(Atom).where(and_(Atom.type == type, Atom.key == key))
    )
    return result.scalar_one_or_none()


async def get_atom_by_id(db: AsyncSession, atom_id: UUID) -> Atom | None:
    """Look up an atom by primary key."""
    result = await db.execute(select(Atom).where(Atom.id == atom_id))
    return result.scalar_one_or_none()


async def create_atom(db: AsyncSession, type: str, key: str) -> Atom:
    """Create and persist a new atom. Does NOT commit — caller controls transaction."""
    atom = Atom(type=type, key=key)
    db.add(atom)
    await db.flush()  # get generated id without committing
    return atom


async def get_properties(db: AsyncSession, atom_id: UUID) -> list[AtomProperty]:
    """Return all properties for a given atom."""
    result = await db.execute(
        select(AtomProperty)
        .where(AtomProperty.atom_id == atom_id)
        .order_by(AtomProperty.created_at)
    )
    return list(result.scalars().all())


async def add_properties(
    db: AsyncSession,
    atom_id: UUID,
    properties: list[PropertyInput],
    source_type: str,
    source_ref: UUID | None,
) -> tuple[int, int]:
    """
    Add properties with deduplication on (atom_id, kind, value).
    Returns (added_count, skipped_count).
    """
    # Load existing properties for this atom to dedup
    existing = await get_properties(db, atom_id)
    existing_set = {(p.kind, p.value) for p in existing}

    added = 0
    skipped = 0
    for prop in properties:
        key_tuple = (prop.kind, prop.value)
        if key_tuple in existing_set:
            skipped += 1
            continue
        new_prop = AtomProperty(
            atom_id=atom_id,
            kind=prop.kind,
            value=prop.value,
            source_type=source_type,
            source_ref=source_ref,
        )
        db.add(new_prop)
        existing_set.add(key_tuple)
        added += 1

    if added > 0:
        await db.flush()
    return added, skipped


async def get_relations(db: AsyncSession, atom_id: UUID) -> list[dict]:
    """
    Return all relations where this atom is the from_id OR to_id.
    Each entry is a dict with direction ('from'|'to') and the related atom info.
    """
    result_from = await db.execute(
        select(AtomRelation, Atom)
        .join(Atom, Atom.id == AtomRelation.to_id)
        .where(AtomRelation.from_id == atom_id)
    )
    result_to = await db.execute(
        select(AtomRelation, Atom)
        .join(Atom, Atom.id == AtomRelation.from_id)
        .where(AtomRelation.to_id == atom_id)
    )

    relations = []
    for rel, target_atom in result_from.all():
        relations.append({
            "id": rel.id,
            "target": {"id": target_atom.id, "type": target_atom.type, "key": target_atom.key},
            "type": rel.type,
            "note": rel.note,
            "direction": "from",
            "created_at": rel.created_at,
        })
    for rel, target_atom in result_to.all():
        relations.append({
            "id": rel.id,
            "target": {"id": target_atom.id, "type": target_atom.type, "key": target_atom.key},
            "type": rel.type,
            "note": rel.note,
            "direction": "to",
            "created_at": rel.created_at,
        })
    return relations


async def add_relation(
    db: AsyncSession,
    from_id: UUID,
    to_id: UUID,
    type: str,
    note: dict | None,
    source_type: str,
    source_ref: UUID | None,
) -> tuple[UUID, str]:
    """
    Create a relation between two atoms with deduplication on (from_id, to_id, type).
    Returns (relation_id, 'created'|'exists').
    """
    result = await db.execute(
        select(AtomRelation).where(
            and_(
                AtomRelation.from_id == from_id,
                AtomRelation.to_id == to_id,
                AtomRelation.type == type,
            )
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        return existing.id, "exists"

    rel = AtomRelation(
        from_id=from_id,
        to_id=to_id,
        type=type,
        note=note,
        source_type=source_type,
        source_ref=source_ref,
    )
    db.add(rel)
    await db.flush()
    return rel.id, "created"


async def add_trace(
    db: AsyncSession,
    atom_id: UUID,
    action: str,
    detail: dict | None,
) -> None:
    """Append a trace record for the given atom."""
    trace = Trace(atom_id=atom_id, action=action, detail=detail)
    db.add(trace)
    await db.flush()


async def link_atom_to_analysis(
    db: AsyncSession,
    atom_id: UUID,
    analysis_id: UUID,
) -> None:
    """Link an atom to an analysis via the analysis_atoms junction table (idempotent)."""
    result = await db.execute(
        select(AnalysisAtom).where(
            and_(
                AnalysisAtom.analysis_id == analysis_id,
                AnalysisAtom.atom_id == atom_id,
            )
        )
    )
    if result.scalar_one_or_none() is None:
        link = AnalysisAtom(analysis_id=analysis_id, atom_id=atom_id)
        db.add(link)
        await db.flush()


async def compute_maturity(property_count: int, relation_count: int) -> float:
    """
    Maturity score 0-100.
    Formula: (property_count * 0.6 + relation_count * 0.4) normalized by
    assumed maxes of 20 properties and 10 relations.
    """
    raw = property_count * 0.6 + relation_count * 0.4
    max_raw = 20 * 0.6 + 10 * 0.4  # = 16.0
    return min(100.0, (raw / max_raw) * 100.0)


async def get_atom_counts(db: AsyncSession, atom_id: UUID) -> tuple[int, int]:
    """Return (property_count, relation_count) for an atom."""
    prop_count_result = await db.execute(
        select(func.count()).where(AtomProperty.atom_id == atom_id)
    )
    prop_count = prop_count_result.scalar_one()

    rel_count_result = await db.execute(
        select(func.count()).where(
            or_(AtomRelation.from_id == atom_id, AtomRelation.to_id == atom_id)
        )
    )
    rel_count = rel_count_result.scalar_one()
    return prop_count, rel_count


async def add_tag(db: AsyncSession, atom_id: UUID, tag: str) -> str:
    """Add a tag to an atom. Returns 'created' or 'exists'."""
    result = await db.execute(
        select(AtomTag).where(
            and_(AtomTag.atom_id == atom_id, AtomTag.tag == tag)
        )
    )
    if result.scalar_one_or_none() is not None:
        return "exists"
    db.add(AtomTag(atom_id=atom_id, tag=tag))
    await db.flush()
    return "created"


async def remove_tag(db: AsyncSession, atom_id: UUID, tag: str) -> bool:
    """Remove a tag from an atom. Returns True if deleted."""
    result = await db.execute(
        select(AtomTag).where(
            and_(AtomTag.atom_id == atom_id, AtomTag.tag == tag)
        )
    )
    existing = result.scalar_one_or_none()
    if existing is None:
        return False
    await db.delete(existing)
    await db.flush()
    return True
