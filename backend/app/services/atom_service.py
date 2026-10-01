import logging
import re
from uuid import UUID

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Atom, AtomProperty, AtomRelation, AtomTag, Trace, AtomOccurrence, Analysis
from app.schemas.atoms import PropertyInput

logger = logging.getLogger(__name__)

# ── Tag normalization ────────────────────────────────────────────────────────

_POS_NORMS = [
    (re.compile(r'惯用|慣用|idiom', re.IGNORECASE), '慣用語'),
    (re.compile(r'助動詞|auxiliary verb', re.IGNORECASE), '助動詞'),
    (re.compile(r'代名詞|pronoun', re.IGNORECASE), '代名詞'),
    (re.compile(r'名詞|noun|名词', re.IGNORECASE), '名詞'),
    (re.compile(r'動詞|verb|动词', re.IGNORECASE), '動詞'),
    (re.compile(r'形容|adjective|adj|形容词', re.IGNORECASE), '形容詞'),
    (re.compile(r'副詞|adverb|adv|副词', re.IGNORECASE), '副詞'),
    (re.compile(r'助詞|particle', re.IGNORECASE), '助詞'),
    (re.compile(r'接続詞|conjunction', re.IGNORECASE), '接続詞'),
    (re.compile(r'感動詞|interjection', re.IGNORECASE), '感動詞'),
    (re.compile(r'接頭|prefix', re.IGNORECASE), '接頭語'),
    (re.compile(r'接尾|suffix', re.IGNORECASE), '接尾語'),
]

_REGISTER_NORMS = [
    (re.compile(r'書面|formal|文語|正式', re.IGNORECASE), '書面語'),
    (re.compile(r'口語|casual|会話|くだけ', re.IGNORECASE), '口語'),
    (re.compile(r'敬語|polite|honorific|丁寧|尊敬', re.IGNORECASE), '敬語'),
    (re.compile(r'俗語|slang', re.IGNORECASE), '俗語'),
]


def _normalize_pos(pos: str) -> str | None:
    for pat, tag in _POS_NORMS:
        if pat.search(pos):
            return tag
    return None


def _normalize_register(reg: str) -> str | None:
    for pat, tag in _REGISTER_NORMS:
        if pat.search(reg):
            return tag
    return None

# Valid property kinds
VALID_KINDS = {
    "reading", "meaning", "part_of_speech", "jlpt_level", "register",
    "usage", "nuance", "oral_form", "connection", "example", "note",
}

# Valid relation types
VALID_RELATION_TYPES = {"synonym", "formal_casual", "derivative", "contrast", "nuance", "confusable"}


async def get_atom_by_key(
    db: AsyncSession, type: str, key: str, *, user_id: UUID, reading: str | None = None,
) -> Atom | None:
    """Look up an atom by (type, key) in one person's dictionary.

    For words the reading tells same-spelt words apart (市場 いちば / しじょう).
    An entry with no reading recorded matches any reading, and a lookup with
    no reading takes the first entry with that spelling.
    """
    query = select(Atom).where(and_(Atom.user_id == user_id, Atom.type == type, Atom.key == key))
    if reading:
        query = query.where(or_(Atom.reading == reading, Atom.reading.is_(None)))
    result = await db.execute(query.order_by(Atom.reading.is_(None), Atom.created_at).limit(1))
    return result.scalars().first()


_KANJI = re.compile(r"[\u4E00-\u9FFF\u3400-\u4DBF々]")
_KANA_ONLY = re.compile(r"^[\u3040-\u30FFー]+$")


def _to_hiragana(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def same_word_other_spelling(key: str, reading: str, other_key: str, other_reading: str | None) -> bool:
    """Is `other` plausibly the same word written another way?

    Same reading, and either one of them is written in kana (分かる / わかる)
    or they share a kanji (落ち着く / 落着く). Homophones that share neither
    (橋 / 箸) are different words.
    """
    if not reading or not other_reading or key == other_key:
        return False
    if _to_hiragana(reading) != _to_hiragana(other_reading):
        return False
    if _KANA_ONLY.match(key) or _KANA_ONLY.match(other_key):
        return True
    return bool(set(_KANJI.findall(key)) & set(_KANJI.findall(other_key)))


async def find_other_spellings(db: AsyncSession, key: str, reading: str, *, user_id: UUID) -> list[Atom]:
    """Words in the dictionary that look like `key` written differently."""
    rows = await db.execute(
        select(Atom).where(Atom.user_id == user_id, Atom.type == "vocabulary", Atom.key != key,
                           Atom.reading.is_not(None))
    )
    return [a for a in rows.scalars().all() if same_word_other_spelling(key, reading, a.key, a.reading)]


async def get_atom_by_id(db: AsyncSession, atom_id: UUID, *, user_id: UUID) -> Atom | None:
    """Look up an atom by primary key — only if it is this person's. Someone
    else's atom is answered exactly like one that does not exist."""
    result = await db.execute(select(Atom).where(Atom.id == atom_id, Atom.user_id == user_id))
    return result.scalar_one_or_none()


async def create_atom(
    db: AsyncSession, type: str, key: str, *, user_id: UUID, reading: str | None = None,
) -> Atom:
    """Create and persist a new atom. Does NOT commit — caller controls transaction."""
    atom = Atom(type=type, key=key, user_id=user_id, reading=reading or None)
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

    # Auto-derive tags from key properties so multi-dimensional filtering works
    auto_tags: list[str] = []
    for prop in properties:
        if not prop.value:
            continue
        if prop.kind == "jlpt_level":
            auto_tags.append(prop.value.upper())
        elif prop.kind == "part_of_speech":
            norm = _normalize_pos(prop.value)
            if norm:
                auto_tags.append(norm)
        elif prop.kind == "register":
            norm = _normalize_register(prop.value)
            if norm:
                auto_tags.append(norm)

    for tag_val in auto_tags:
        existing_tag = await db.execute(
            select(AtomTag).where(and_(AtomTag.atom_id == atom_id, AtomTag.tag == tag_val))
        )
        if existing_tag.scalar_one_or_none() is None:
            db.add(AtomTag(atom_id=atom_id, tag=tag_val))
    if auto_tags:
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


async def record_occurrence(
    db: AsyncSession,
    atom_id: UUID,
    sentence_text: str,
    *,
    analysis_id: UUID | None = None,
    sentence_index: int | None = None,
    sentence_text_translation: str | None = None,
    surface: str | None = None,
    surface_meaning: str | None = None,
) -> None:
    """Record where an atom was met. Idempotent per (atom, sentence, form), so
    re-analysing the same text or tapping the same word twice adds nothing."""
    existing = await db.execute(
        select(AtomOccurrence).where(
            and_(
                AtomOccurrence.atom_id == atom_id,
                AtomOccurrence.sentence_text == sentence_text,
                AtomOccurrence.surface.is_not_distinct_from(surface),
            )
        )
    )
    if existing.scalar_one_or_none() is not None:
        return

    db.add(AtomOccurrence(
        atom_id=atom_id,
        analysis_id=analysis_id,
        sentence_index=sentence_index,
        surface=surface,
        surface_meaning=surface_meaning,
        sentence_text=sentence_text,
        sentence_translation=sentence_text_translation,
    ))
    await db.flush()


async def get_occurrences(db: AsyncSession, atom_id: UUID) -> list[AtomOccurrence]:
    result = await db.execute(
        select(AtomOccurrence)
        .where(AtomOccurrence.atom_id == atom_id)
        .order_by(AtomOccurrence.created_at)
    )
    return list(result.scalars().all())


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


async def record_known_occurrences(
    db: AsyncSession, user_id: UUID, analysis_id: UUID | None, sentences: list[dict],
) -> int:
    """Note down, for every word and grammar point of these sentences that is
    already in the person's dictionary, the sentence it was met in.

    Meeting a known word again is the point of keeping it; the person should
    not have to tap anything for that. Returns how many were recorded.
    """
    vocab_keys = {(v.get("base") or v.get("surface") or "").strip()
                  for s in sentences for v in (s.get("vocab") or []) if isinstance(v, dict)}
    grammar_keys = {re.sub(r"[~～]", "〜", (g.get("pattern") or "")).strip()
                    for s in sentences for g in (s.get("grammar") or []) if isinstance(g, dict)}
    vocab_keys.discard("")
    grammar_keys.discard("")
    if not vocab_keys and not grammar_keys:
        return 0
    rows = await db.execute(
        select(Atom).where(
            Atom.user_id == user_id,
            or_(and_(Atom.type == "vocabulary", Atom.key.in_(vocab_keys or {""})),
                and_(Atom.type == "grammar", Atom.key.in_(grammar_keys or {""}))),
        )
    )
    atoms = rows.scalars().all()
    vocab = {}
    for a in atoms:
        if a.type == "vocabulary":
            vocab.setdefault(a.key, []).append(a)
    grammar = {a.key: a for a in atoms if a.type == "grammar"}

    recorded = 0
    for s in sentences:
        text_ = s.get("text") or ""
        if not text_ or s.get("failed"):
            continue
        for v in s.get("vocab") or []:
            key = (v.get("base") or v.get("surface") or "").strip()
            reading = _to_hiragana(v.get("reading") or "")
            candidates = vocab.get(key) or []
            match = next((a for a in candidates if not a.reading or not reading
                          or _to_hiragana(a.reading) == reading), None)
            if match is None:
                continue
            await record_occurrence(
                db, match.id, text_, analysis_id=analysis_id, sentence_index=s.get("index"),
                sentence_text_translation=s.get("translation") or None,
                surface=v.get("surface"), surface_meaning=v.get("surface_meaning") or v.get("meaning"),
            )
            recorded += 1
        for g in s.get("grammar") or []:
            atom = grammar.get(re.sub(r"[~～]", "〜", (g.get("pattern") or "")).strip())
            if atom is None:
                continue
            await record_occurrence(
                db, atom.id, text_, analysis_id=analysis_id, sentence_index=s.get("index"),
                sentence_text_translation=s.get("translation") or None,
            )
            recorded += 1
    return recorded
