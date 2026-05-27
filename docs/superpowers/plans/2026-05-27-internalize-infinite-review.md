# Internalize Infinite Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the card review feature from a session-based flow into an infinite Tinder-style swipe experience with Leitner-box spaced repetition, mobile-optimised card design, inline stats bar, and a gear-icon config sheet.

**Architecture:** Backend adds an `atom_srs_states` table to track each atom's Leitner box level and next-review timestamp; the queue endpoint orders by due-date and the trace endpoint updates SRS state on every swipe. Frontend removes SessionSetup/SessionResult and replaces CardDeck with InfiniteCardDeck that pre-fetches in rolling batches of 20; ConfigSheet and StatsBar are new inline components; FlashCard is redesigned for mobile with ruby annotation and flip-gated swiping.

**Tech Stack:** Python/FastAPI/SQLAlchemy (async), PostgreSQL, React 18/TypeScript, Framer Motion, Tailwind CSS

---

## File Map

| File | Action |
|------|--------|
| `migrations/002_atom_srs_state.sql` | Create |
| `backend/app/models/db.py` | Modify – add `AtomSrsState` model |
| `backend/app/services/internalize_service.py` | Modify – add SRS box logic |
| `backend/tests/test_internalize.py` | Modify – add SRS tests |
| `backend/app/api/internalize.py` | Modify – update queue + trace + add stats |
| `frontend/src/types/index.ts` | Modify – add `InfiniteConfig`, `InternalizeStats`, remove `SessionConfig` |
| `frontend/src/services/api.ts` | Modify – update queue params, add stats call |
| `frontend/src/components/internalize/FlashCard.tsx` | Modify – ruby, larger, flip-gated swipe |
| `frontend/src/components/internalize/ConfigSheet.tsx` | Create |
| `frontend/src/components/internalize/StatsBar.tsx` | Create |
| `frontend/src/components/internalize/InfiniteCardDeck.tsx` | Create |
| `frontend/src/components/internalize/CardDeck.tsx` | Delete |
| `frontend/src/components/internalize/SessionSetup.tsx` | Delete |
| `frontend/src/components/internalize/SessionResult.tsx` | Delete |
| `frontend/src/pages/InternalizePage.tsx` | Modify – simplify to home\|playing, add config/stats wiring |

---

## Task 1: DB migration + AtomSrsState model

**Files:**
- Create: `migrations/002_atom_srs_state.sql`
- Modify: `backend/app/models/db.py`

- [ ] **Step 1: Write migration SQL**

Create `migrations/002_atom_srs_state.sql`:

```sql
CREATE TABLE atom_srs_states (
    atom_id     UUID PRIMARY KEY REFERENCES atoms(id) ON DELETE CASCADE,
    box_level   SMALLINT NOT NULL DEFAULT 0
                    CHECK (box_level BETWEEN 0 AND 5),
    next_review TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_atom_srs_states_next_review ON atom_srs_states(next_review);
```

- [ ] **Step 2: Run migration**

```bash
psql $DATABASE_URL -f migrations/002_atom_srs_state.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX`

- [ ] **Step 3: Add SQLAlchemy model**

In `backend/app/models/db.py`, add after the `Trace` class and before `Analysis`:

```python
class AtomSrsState(Base):
    __tablename__ = "atom_srs_states"

    atom_id    = Column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), primary_key=True)
    box_level  = Column(Integer, nullable=False, default=0)
    next_review = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at  = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    atom = relationship("Atom", back_populates="srs_state")

    __table_args__ = (
        Index("ix_atom_srs_states_next_review", "next_review"),
    )
```

Also add the back-reference to the `Atom` class (after `traces = relationship(...)`):

```python
srs_state = relationship("AtomSrsState", back_populates="atom", uselist=False, cascade="all, delete-orphan")
```

- [ ] **Step 4: Commit**

```bash
git add migrations/002_atom_srs_state.sql backend/app/models/db.py
git commit -m "feat: add atom_srs_states table and SQLAlchemy model"
```

---

## Task 2: SRS service logic + tests

**Files:**
- Modify: `backend/app/services/internalize_service.py`
- Modify: `backend/tests/test_internalize.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_internalize.py`:

```python
from datetime import datetime, timezone, timedelta
from app.services.internalize_service import (
    next_review_after_know,
    next_review_after_unknown,
)

def test_know_from_box0_goes_to_box1():
    new_box, next_review = next_review_after_know(0)
    assert new_box == 1
    assert next_review > datetime.now(timezone.utc)

def test_know_from_box5_stays_at_box5():
    new_box, _ = next_review_after_know(5)
    assert new_box == 5

def test_know_box1_interval_is_1_hour():
    _, next_review = next_review_after_know(0)  # box 0 → box 1, interval = 1h
    delta = next_review - datetime.now(timezone.utc)
    assert timedelta(minutes=55) < delta < timedelta(minutes=65)

def test_know_box4_interval_is_7_days():
    _, next_review = next_review_after_know(3)  # box 3 → box 4, interval = 7d
    delta = next_review - datetime.now(timezone.utc)
    assert timedelta(days=6, hours=23) < delta < timedelta(days=7, hours=1)

def test_unknown_always_goes_to_box1():
    for box in range(6):
        new_box, _ = next_review_after_unknown(box)
        assert new_box == 1

def test_unknown_next_review_is_10_minutes():
    _, next_review = next_review_after_unknown(3)
    delta = next_review - datetime.now(timezone.utc)
    assert timedelta(minutes=9) < delta < timedelta(minutes=11)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python -m pytest tests/test_internalize.py -v -k "know or unknown"
```

Expected: FAIL with `ImportError: cannot import name 'next_review_after_know'`

- [ ] **Step 3: Implement SRS functions**

Append to `backend/app/services/internalize_service.py`:

```python
from datetime import datetime, timedelta, timezone

# Leitner box review intervals indexed by target box level
_BOX_INTERVALS: dict[int, timedelta] = {
    0: timedelta(0),
    1: timedelta(hours=1),
    2: timedelta(days=1),
    3: timedelta(days=3),
    4: timedelta(days=7),
    5: timedelta(days=14),
}


def next_review_after_know(box_level: int) -> tuple[int, datetime]:
    """Returns (new_box_level, next_review_at) after a 'know' swipe."""
    new_box = min(5, box_level + 1)
    return new_box, datetime.now(timezone.utc) + _BOX_INTERVALS[new_box]


def next_review_after_unknown(box_level: int) -> tuple[int, datetime]:
    """Returns (new_box_level, next_review_at) after an 'unknown' swipe. Always Box 1, 10 min."""
    return 1, datetime.now(timezone.utc) + timedelta(minutes=10)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_internalize.py -v
```

Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/internalize_service.py backend/tests/test_internalize.py
git commit -m "feat: add Leitner box SRS functions with tests"
```

---

## Task 3: Update trace endpoint to write SRS state

**Files:**
- Modify: `backend/app/api/internalize.py`

- [ ] **Step 1: Update imports at top of internalize.py**

Replace the existing import block with:

```python
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, case, text, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Atom, AtomProperty, AtomTag, AtomSrsState, Trace, get_db
from app.services import atom_service
from app.services.internalize_service import (
    extract_jlpt_level,
    next_review_after_know,
    next_review_after_unknown,
)
```

- [ ] **Step 2: Replace the `record_trace` endpoint**

Replace the entire `record_trace` function (lines 128–151) with:

```python
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
```

- [ ] **Step 3: Verify backend starts without error**

```bash
cd backend && python -m uvicorn app.main:app --reload --port 8000
```

Expected: `Application startup complete.`

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/internalize.py
git commit -m "feat: update trace endpoint to write Leitner box SRS state"
```

---

## Task 4: Update queue endpoint (SRS ordering + levels filter)

**Files:**
- Modify: `backend/app/api/internalize.py`

- [ ] **Step 1: Replace the `get_queue` endpoint**

Replace the entire `get_queue` function (lines 16–125) with:

```python
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
    # Coalesce NULL next_review to epoch so new atoms sort first
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
        from sqlalchemy import and_, exists as sa_exists
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
```

- [ ] **Step 2: Test queue endpoint manually**

```bash
curl "http://localhost:8000/api/internalize/queue?limit=5&prompt=meaning"
```

Expected: JSON with `cards` array, atoms ordered with new atoms first.

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/internalize.py
git commit -m "feat: update queue endpoint with SRS ordering and levels filter"
```

---

## Task 5: Add stats endpoint

**Files:**
- Modify: `backend/app/api/internalize.py`

- [ ] **Step 1: Add the stats endpoint**

Append to `backend/app/api/internalize.py`:

```python
@router.get("/internalize/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    """Returns today's and all-time review stats plus box-level distribution."""
    from sqlalchemy import Float

    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    # Today's know/unknown counts
    today_row = (await db.execute(
        select(
            func.sum(case((Trace.detail["result"].astext == "know", 1), else_=0)).label("know"),
            func.sum(case((Trace.detail["result"].astext == "unknown", 1), else_=0)).label("unknown"),
        ).where(Trace.action == "review", Trace.created_at >= today_start)
    )).one()

    # All-time know/unknown counts
    total_row = (await db.execute(
        select(
            func.sum(case((Trace.detail["result"].astext == "know", 1), else_=0)).label("know"),
            func.sum(case((Trace.detail["result"].astext == "unknown", 1), else_=0)).label("unknown"),
        ).where(Trace.action == "review")
    )).one()

    # Box level distribution
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
```

- [ ] **Step 2: Verify endpoint**

```bash
curl "http://localhost:8000/api/internalize/stats"
```

Expected: JSON with `today`, `total`, `distribution` keys.

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/internalize.py
git commit -m "feat: add GET /api/internalize/stats endpoint"
```

---

## Task 6: Frontend types + API service

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Update types**

In `frontend/src/types/index.ts`, replace the `SessionConfig` interface and add new types:

Remove:
```ts
export interface SessionConfig {
  limit: number
  promptType: string
  tag: string
}
```

Add:
```ts
export interface InfiniteConfig {
  promptMode: 'meaning' | 'reading'
  levels: string[]  // empty = all levels
}

export interface InternalizeStats {
  today: { know: number; unknown: number; total: number }
  total: { know: number; unknown: number; mastery_pct: number }
  distribution: {
    box0: number; box1: number; box2: number
    box3: number; box4: number; box5: number
  }
}
```

- [ ] **Step 2: Update API service**

In `frontend/src/services/api.ts`, replace the `getInternalizeQueue` function and add `getInternalizeStats`:

Replace:
```ts
export async function getInternalizeQueue(params: {
  limit: number
  prompt: string
  tag?: string
}): Promise<InternalizeQueueResponse> {
  const qs = new URLSearchParams({ limit: String(params.limit), prompt: params.prompt })
  if (params.tag) qs.set('tag', params.tag)
  return request<InternalizeQueueResponse>(`/api/internalize/queue?${qs}`)
}
```

With:
```ts
export async function getInternalizeQueue(params: {
  limit: number
  prompt: 'meaning' | 'reading'
  levels?: string[]
}): Promise<InternalizeQueueResponse> {
  const qs = new URLSearchParams({ limit: String(params.limit), prompt: params.prompt })
  params.levels?.forEach(l => qs.append('levels', l))
  return request<InternalizeQueueResponse>(`/api/internalize/queue?${qs}`)
}

export async function getInternalizeStats(): Promise<InternalizeStats> {
  return request<InternalizeStats>('/api/internalize/stats')
}
```

Also add `InternalizeStats` to the import from types (if types are imported).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat: add InfiniteConfig, InternalizeStats types and stats API call"
```

---

## Task 7: Refactor FlashCard for mobile + ruby + flip-gated swipe

**Files:**
- Modify: `frontend/src/components/internalize/FlashCard.tsx`

- [ ] **Step 1: Replace FlashCard.tsx entirely**

```tsx
// frontend/src/components/internalize/FlashCard.tsx
import { useRef, useState } from 'react'
import { motion, useMotionValue, useTransform, animate } from 'framer-motion'
import clsx from 'clsx'
import type { InternalizeCard, SwipeResult } from '../../types'

interface Props {
  card: InternalizeCard
  stackIndex: number   // 0=top (interactive), 1=second, 2=third
  onSwipe: (result: SwipeResult) => void
}

function getCardStyle(level: string | null, type: string) {
  const typeGradient =
    type === 'vocabulary' ? 'from-blue-50 to-blue-100' : 'from-violet-50 to-violet-100'
  switch (level) {
    case 'N1': return { border: 'border-yellow-400', bg: `bg-gradient-to-br ${typeGradient}`, glow: 'shadow-[0_0_20px_4px_rgba(234,179,8,0.3)]', particle: true,  label: 'text-yellow-700' }
    case 'N2': return { border: 'border-slate-400',  bg: `bg-gradient-to-br ${typeGradient}`, glow: 'shadow-[0_0_12px_2px_rgba(148,163,184,0.3)]', particle: false, label: 'text-slate-700' }
    case 'N3': return { border: 'border-amber-500',  bg: `bg-gradient-to-br ${typeGradient}`, glow: '', particle: false, label: 'text-amber-700' }
    case 'N4': return { border: 'border-amber-300',  bg: `bg-gradient-to-br from-amber-50 ${type === 'vocabulary' ? 'to-blue-50' : 'to-violet-50'}`, glow: '', particle: false, label: 'text-amber-600' }
    default:   return { border: 'border-gray-200',   bg: 'bg-white', glow: '', particle: false, label: 'text-gray-500' }
  }
}

function ShimmerOverlay() {
  return (
    <motion.div
      className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none"
      animate={{ opacity: [0, 0.6, 0] }}
      transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent animate-shimmer" />
    </motion.div>
  )
}

function GoldParticles() {
  return (
    <div className="absolute inset-0 rounded-2xl pointer-events-none overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-yellow-400"
          style={{ top: `${(i * 13 + 5) % 100}%`, left: `${(i * 17 + 10) % 100}%` }}
          animate={{ opacity: [0, 1, 0], scale: [0, 1.5, 0], y: [0, -20] }}
          transition={{ duration: 1.5 + (i % 3) * 0.4, repeat: Infinity, delay: i * 0.3 }}
        />
      ))}
    </div>
  )
}

function CardShell({
  backface,
  children,
}: {
  backface: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className="absolute inset-0 rounded-2xl p-5 flex flex-col"
      style={{
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: backface ? 'rotateY(180deg)' : 'rotateY(0deg)',
      }}
    >
      {children}
    </div>
  )
}

export default function FlashCard({ card, stackIndex, onSwipe }: Props) {
  const [isFlipped, setIsFlipped] = useState(false)
  const swipeDirRef = useRef<'left' | 'right' | null>(null)
  const isTop = stackIndex === 0

  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 0, 200], [-18, 0, 18])
  const leftOpacity  = useTransform(x, [-200, -60, 0], [1, 0.8, 0])
  const rightOpacity = useTransform(x, [0, 60, 200], [0, 0.8, 1])

  const style = getCardStyle(card.jlpt_level, card.type)
  const isN1 = card.jlpt_level === 'N1'

  const stackVariants: Record<number, object> = {
    0: { scale: 1,    y: 0,  opacity: 1   },
    1: { scale: 0.95, y: 12, opacity: 1   },
    2: { scale: 0.90, y: 24, opacity: 0.7 },
  }

  const reading  = card.properties.find(p => p.kind === 'reading')?.value
  const meanings = card.properties.filter(p => p.kind === 'meaning').map(p => p.value)
  const examples = card.properties.filter(p => p.kind === 'example').map(p => p.value)
  const others   = card.properties.filter(
    p => !['reading', 'meaning', 'example'].includes(p.kind)
  )

  function handleDragEnd(_: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    if (!isFlipped) return  // flip-gated: swipe only allowed after flip
    const { offset, velocity } = info
    if (offset.x > 80 || velocity.x > 500) {
      swipeDirRef.current = 'right'
      onSwipe('know')
    } else if (offset.x < -80 || velocity.x < -500) {
      swipeDirRef.current = 'left'
      ;(animate(x, [x.get(), x.get() - 10, x.get() + 7, x.get() - 4, 0], {
        duration: 0.22,
      }) as unknown as Promise<void>).then(() => onSwipe('unknown'))
    } else {
      animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 })
    }
  }

  function handleTap() {
    if (isTop && Math.abs(x.get()) < 5) setIsFlipped(f => !f)
  }

  return (
    <>
      {isTop && isN1 && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.35, 0] }}
          transition={{ duration: 0.8, times: [0, 0.3, 1] }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <motion.div
            className="w-40 h-40 rounded-full bg-yellow-300/60"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 4] }}
            transition={{ duration: 0.6 }}
            style={{ filter: 'blur(20px)' }}
          />
        </motion.div>
      )}

      <motion.div
        className="absolute w-72 h-[420px]"
        style={{
          x: isTop ? x : 0,
          rotate: isTop ? rotate : 0,
          zIndex: 30 - stackIndex * 10,
          top: '50%',
          left: '50%',
          marginTop: -210,
          marginLeft: -144,
        }}
        initial={isTop && isN1 ? { y: -120, scale: 1.2, opacity: 0 } : { opacity: 1 }}
        animate={stackVariants[stackIndex] ?? stackVariants[2]}
        transition={
          isTop && isN1
            ? { type: 'spring', stiffness: 200, damping: 18 }
            : { type: 'spring', stiffness: 300, damping: 28 }
        }
        drag={isTop && isFlipped ? 'x' : false}
        dragConstraints={{ left: -250, right: 250 }}
        dragElastic={0.15}
        onDragEnd={isTop ? handleDragEnd : undefined}
        onTap={handleTap}
        custom={swipeDirRef.current}
        variants={{
          exit: (dir: 'left' | 'right' | null) => ({
            x: dir === 'right' ? 700 : dir === 'left' ? -700 : 0,
            rotate: dir === 'right' ? 20 : -20,
            opacity: 0,
            transition: { duration: 0.28, ease: 'easeIn' },
          }),
        }}
        exit="exit"
      >
        <div className="relative w-full h-full" style={{ perspective: '1000px' }}>
          <motion.div
            className="relative w-full h-full"
            animate={{ rotateY: isFlipped ? 180 : 0 }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
            style={{ transformStyle: 'preserve-3d' }}
          >
            {/* ── FRONT ───────────────────────────────────────────── */}
            <CardShell backface={false}>
              <div className={clsx('absolute inset-0 rounded-2xl border-2', style.border, style.bg, style.glow)} />
              {style.particle && <GoldParticles />}
              {card.jlpt_level === 'N2' && <ShimmerOverlay />}

              <div className="relative flex flex-col h-full">
                {/* Top badges */}
                <div className="flex items-center justify-between">
                  <span className={clsx(
                    'text-xs font-semibold px-2 py-0.5 rounded-md',
                    card.type === 'vocabulary' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700',
                  )}>
                    {card.type === 'vocabulary' ? '词汇' : '语法'}
                  </span>
                  {card.jlpt_level && (
                    <span className={clsx('text-xs font-bold', style.label)}>{card.jlpt_level}</span>
                  )}
                </div>

                {/* Main word – centred in upper half so position matches back face */}
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-5xl font-bold text-fg text-center leading-tight">{card.key}</p>
                </div>

                {/* Tap hint */}
                <p className="text-center text-xs text-fg-subtle pb-1">点击翻转</p>
              </div>
            </CardShell>

            {/* ── BACK ────────────────────────────────────────────── */}
            <CardShell backface={true}>
              <div className={clsx('absolute inset-0 rounded-2xl border-2', style.border, style.bg)} />

              <div className="relative flex flex-col h-full">
                {/* Top badges – same as front */}
                <div className="flex items-center justify-between mb-3">
                  <span className={clsx(
                    'text-xs font-semibold px-2 py-0.5 rounded-md',
                    card.type === 'vocabulary' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700',
                  )}>
                    {card.type === 'vocabulary' ? '词汇' : '语法'}
                  </span>
                  {card.jlpt_level && (
                    <span className={clsx('text-xs font-bold', style.label)}>{card.jlpt_level}</span>
                  )}
                </div>

                {/* Word + ruby – same vertical region as front's main word */}
                <div className="flex items-center justify-center py-4">
                  <ruby className="text-5xl font-bold text-fg leading-tight">
                    {card.key}
                    {reading && <rt className="text-sm font-normal text-fg-subtle">{reading}</rt>}
                  </ruby>
                </div>

                <div className="h-px bg-border mx-1 my-2" />

                {/* Info zone – scrollable if content overflows */}
                <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
                  {meanings.length > 0 && (
                    <p className="text-base font-medium text-fg leading-snug">
                      {meanings.join('；')}
                    </p>
                  )}

                  {examples.map((ex, i) => (
                    <p key={i} className="text-sm text-fg-subtle leading-snug">{ex}</p>
                  ))}

                  {others.length > 0 && (
                    <p className="text-xs text-fg-subtle/70">
                      {others.map(p => p.value).join(' · ')}
                    </p>
                  )}
                </div>

                <div className="h-px bg-border mx-1 my-2" />

                {/* Swipe hints – only shown after flip */}
                <div className="flex justify-between text-xs text-fg-subtle pb-1 px-1">
                  <span>← 不会</span>
                  <span>会 →</span>
                </div>
              </div>
            </CardShell>
          </motion.div>
        </div>

        {/* Swipe overlays – only active after flip */}
        {isTop && isFlipped && (
          <>
            <motion.div
              className="absolute inset-0 rounded-2xl flex items-center justify-center pointer-events-none"
              style={{ opacity: leftOpacity }}
            >
              <div className="absolute inset-0 rounded-2xl bg-red-400/30" />
              <span className="relative text-3xl font-black text-red-600 rotate-[-15deg]">不会</span>
            </motion.div>

            <motion.div
              className="absolute inset-0 rounded-2xl flex items-center justify-center pointer-events-none"
              style={{ opacity: rightOpacity }}
            >
              <div className="absolute inset-0 rounded-2xl bg-green-400/30" />
              <span className="relative text-3xl font-black text-green-600 rotate-[15deg]">会</span>
            </motion.div>
          </>
        )}
      </motion.div>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/internalize/FlashCard.tsx
git commit -m "feat: redesign FlashCard for mobile with ruby, larger size, flip-gated swipe"
```

---

## Task 8: Create ConfigSheet

**Files:**
- Create: `frontend/src/components/internalize/ConfigSheet.tsx`

- [ ] **Step 1: Create ConfigSheet.tsx**

```tsx
// frontend/src/components/internalize/ConfigSheet.tsx
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import type { InfiniteConfig } from '../../types'

interface Props {
  config: InfiniteConfig
  onChange: (config: InfiniteConfig) => void
  onClose: () => void
}

const JLPT_LEVELS = ['N1', 'N2', 'N3', 'N4', 'N5']

export default function ConfigSheet({ config, onChange, onClose }: Props) {
  function setPromptMode(mode: InfiniteConfig['promptMode']) {
    onChange({ ...config, promptMode: mode })
  }

  function toggleLevel(level: string) {
    const next = config.levels.includes(level)
      ? config.levels.filter(l => l !== level)
      : [...config.levels, level]
    onChange({ ...config, levels: next })
  }

  function selectAllLevels() {
    onChange({ ...config, levels: [] })
  }

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex flex-col justify-end"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/40" />

        <motion.div
          className="relative bg-surface rounded-t-2xl p-6 pb-10 space-y-6 shadow-xl"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          onClick={e => e.stopPropagation()}
        >
          {/* Handle */}
          <div className="w-10 h-1 rounded-full bg-border mx-auto -mt-1" />

          {/* Prompt mode */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-fg">复习模式</p>
            <div className="flex gap-2">
              {(['meaning', 'reading'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setPromptMode(mode)}
                  className={clsx(
                    'btn flex-1 text-sm',
                    config.promptMode === mode ? 'btn-primary' : 'btn-ghost border border-border',
                  )}
                >
                  {mode === 'meaning' ? '词义模式' : '读音模式'}
                </button>
              ))}
            </div>
          </div>

          {/* JLPT level filter */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-fg">
              级别筛选 <span className="font-normal text-fg-subtle">（可多选）</span>
            </p>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={selectAllLevels}
                className={clsx(
                  'btn text-sm',
                  config.levels.length === 0 ? 'btn-primary' : 'btn-ghost border border-border',
                )}
              >
                全部
              </button>
              {JLPT_LEVELS.map(l => (
                <button
                  key={l}
                  onClick={() => toggleLevel(l)}
                  className={clsx(
                    'btn text-sm',
                    config.levels.includes(l) ? 'btn-primary' : 'btn-ghost border border-border',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/internalize/ConfigSheet.tsx
git commit -m "feat: add ConfigSheet bottom sheet for prompt mode and level filter"
```

---

## Task 9: Create StatsBar

**Files:**
- Create: `frontend/src/components/internalize/StatsBar.tsx`

- [ ] **Step 1: Create StatsBar.tsx**

```tsx
// frontend/src/components/internalize/StatsBar.tsx
import { useState, useEffect } from 'react'
import { getInternalizeStats } from '../../services/api'
import type { InternalizeStats } from '../../types'

interface Props {
  todayKnow: number
  todayUnknown: number
}

type ViewMode = 'today' | 'total'

export default function StatsBar({ todayKnow, todayUnknown }: Props) {
  const [mode, setMode] = useState<ViewMode>('today')
  const [totalStats, setTotalStats] = useState<InternalizeStats | null>(null)

  useEffect(() => {
    getInternalizeStats().then(setTotalStats).catch(() => {})
  }, [])

  function toggle() {
    setMode(m => m === 'today' ? 'total' : 'today')
  }

  return (
    <button
      onClick={toggle}
      className="w-full flex items-center justify-between px-4 py-2 bg-surface/60 border-b border-border text-xs text-fg-subtle hover:bg-surface transition-colors"
    >
      {mode === 'today' ? (
        <>
          <span className="font-medium text-fg-subtle">今日</span>
          <span>
            <span className="text-green-600 font-semibold">{todayKnow} 会</span>
            <span className="mx-1">·</span>
            <span className="text-red-500 font-semibold">{todayUnknown} 不会</span>
            <span className="ml-1 text-fg-subtle/50">{todayKnow + todayUnknown} 张</span>
          </span>
          <span className="text-fg-subtle/40">总体 →</span>
        </>
      ) : (
        <>
          <span className="font-medium text-fg-subtle">总体</span>
          <span>
            {totalStats ? (
              <>
                <span className="text-green-600 font-semibold">掌握 {totalStats.total.mastery_pct}%</span>
                <span className="mx-1">·</span>
                <span className="text-fg-subtle">学习中 {totalStats.distribution.box1 + totalStats.distribution.box2}</span>
              </>
            ) : (
              <span className="text-fg-subtle/40">加载中...</span>
            )}
          </span>
          <span className="text-fg-subtle/40">← 今日</span>
        </>
      )}
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/internalize/StatsBar.tsx
git commit -m "feat: add StatsBar with today/total toggle"
```

---

## Task 10: Create InfiniteCardDeck

**Files:**
- Create: `frontend/src/components/internalize/InfiniteCardDeck.tsx`

- [ ] **Step 1: Create InfiniteCardDeck.tsx**

```tsx
// frontend/src/components/internalize/InfiniteCardDeck.tsx
import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import FlashCard from './FlashCard'
import { getInternalizeQueue, postInternalizeTrace } from '../../services/api'
import type { InternalizeCard, SwipeResult, InfiniteConfig } from '../../types'

interface Props {
  config: InfiniteConfig
  onSwipe: (result: SwipeResult) => void
}

function ShuffleAnimation({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="absolute w-40 h-56 rounded-xl bg-surface border border-border shadow-card"
          initial={{ rotate: 0, x: 0, y: 0 }}
          animate={{ rotate: [0, (i - 1.5) * 18, 0], x: [0, (i - 1.5) * 30, 0], y: [0, -10, 0] }}
          transition={{ duration: 0.6, times: [0, 0.5, 1], ease: 'easeInOut', delay: 0.1 }}
          onAnimationComplete={i === 3 ? onComplete : undefined}
        />
      ))}
    </div>
  )
}

export default function InfiniteCardDeck({ config, onSwipe }: Props) {
  const [queue, setQueue] = useState<InternalizeCard[]>([])
  const [head, setHead] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'shuffle' | 'playing'>('loading')
  const fetchingRef = useRef(false)

  const fetchBatch = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    try {
      const res = await getInternalizeQueue({
        limit: 20,
        prompt: config.promptMode,
        levels: config.levels.length > 0 ? config.levels : undefined,
      })
      if (res.cards.length > 0) {
        setQueue(prev => [...prev, ...res.cards])
      }
    } catch {
      // silently ignore fetch errors; user can keep swiping existing cards
    } finally {
      fetchingRef.current = false
    }
  }, [config])

  // Reset when config changes
  useEffect(() => {
    setQueue([])
    setHead(0)
    setPhase('loading')
    fetchingRef.current = false
    getInternalizeQueue({
      limit: 20,
      prompt: config.promptMode,
      levels: config.levels.length > 0 ? config.levels : undefined,
    }).then(res => {
      setQueue(res.cards)
      setPhase(res.cards.length > 0 ? 'shuffle' : 'playing')
    }).catch(() => setPhase('playing'))
  }, [config])

  // Pre-fetch when queue runs low
  useEffect(() => {
    if (phase === 'playing' && queue.length - head < 5) {
      fetchBatch()
    }
  }, [head, queue.length, phase, fetchBatch])

  function handleSwipe(result: SwipeResult, cardId: string) {
    setHead(h => h + 1)
    onSwipe(result)
    postInternalizeTrace(cardId, result, config.promptMode).catch(console.error)
  }

  const visibleCards = queue.slice(head, head + 3)

  return (
    <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
      {phase === 'loading' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-fg-muted">加载中...</p>
        </div>
      )}

      {phase === 'shuffle' && (
        <ShuffleAnimation onComplete={() => setPhase('playing')} />
      )}

      {phase === 'playing' && (
        queue.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-fg-muted text-sm">知识库暂无原子，先去分析一些内容吧</p>
          </div>
        ) : (
          <div className="relative flex-1">
            <AnimatePresence mode="popLayout">
              {[...visibleCards].reverse().map((card, reverseIdx) => {
                const stackIndex = visibleCards.length - 1 - reverseIdx
                return (
                  <FlashCard
                    key={card.id}
                    card={card}
                    stackIndex={stackIndex}
                    onSwipe={(result) => handleSwipe(result, card.id)}
                  />
                )
              })}
            </AnimatePresence>
          </div>
        )
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/internalize/InfiniteCardDeck.tsx
git commit -m "feat: add InfiniteCardDeck with rolling prefetch queue"
```

---

## Task 11: Refactor InternalizePage + delete old components

**Files:**
- Modify: `frontend/src/pages/InternalizePage.tsx`
- Delete: `frontend/src/components/internalize/CardDeck.tsx`
- Delete: `frontend/src/components/internalize/SessionSetup.tsx`
- Delete: `frontend/src/components/internalize/SessionResult.tsx`

- [ ] **Step 1: Replace InternalizePage.tsx**

```tsx
// frontend/src/pages/InternalizePage.tsx
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Settings, Keyboard, Languages, Volume2, GitCompare, FileText } from 'lucide-react'
import InfiniteCardDeck from '../components/internalize/InfiniteCardDeck'
import StatsBar from '../components/internalize/StatsBar'
import ConfigSheet from '../components/internalize/ConfigSheet'
import type { InfiniteConfig, SwipeResult } from '../types'

type PagePhase = 'home' | 'playing'

function CardStackIcon() {
  return (
    <div className="relative w-20 h-28">
      {[2, 1, 0].map((i) => (
        <div
          key={i}
          className="absolute inset-0 rounded-xl border border-border bg-surface shadow-card"
          style={{ transform: `translateY(${i * 5}px) scale(${1 - i * 0.04})`, zIndex: 3 - i }}
        />
      ))}
      <div className="absolute inset-0 z-10 rounded-xl border border-border bg-gradient-to-br from-blue-50 to-violet-50 flex flex-col items-center justify-center gap-1 shadow-card">
        <span className="text-2xl font-bold text-fg">あ</span>
        <div className="w-8 h-0.5 rounded-full bg-border" />
        <span className="text-xs text-fg-subtle">意味</span>
      </div>
    </div>
  )
}

function CardModeIcon({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-surface border border-border hover:border-accent/50 hover:shadow-lg transition-shadow cursor-pointer w-44"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
    >
      <CardStackIcon />
      <div className="text-center">
        <p className="text-sm font-semibold text-fg">卡牌记忆</p>
        <p className="text-xs text-fg-subtle mt-0.5">主动召回练习</p>
      </div>
    </motion.button>
  )
}

function ComingSoonIcon({ icon, label, desc }: { icon: React.ReactNode; label: string; desc: string }) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-surface/50 border border-dashed border-border w-44 cursor-not-allowed">
      <div className="w-20 h-28 rounded-xl border border-dashed border-border/60 bg-surface flex items-center justify-center text-fg-subtle/40">
        {icon}
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-fg-subtle">{label}</p>
        <p className="text-xs text-fg-subtle/60 mt-0.5">{desc}</p>
        <p className="text-[10px] text-fg-subtle/40 mt-1">即将推出</p>
      </div>
    </div>
  )
}

export default function InternalizePage() {
  const [phase, setPhase] = useState<PagePhase>('home')
  const [config, setConfig] = useState<InfiniteConfig>({ promptMode: 'meaning', levels: [] })
  const [isConfigOpen, setIsConfigOpen] = useState(false)
  const [todayKnow, setTodayKnow] = useState(0)
  const [todayUnknown, setTodayUnknown] = useState(0)

  function handleSwipe(result: SwipeResult) {
    if (result === 'know') setTodayKnow(n => n + 1)
    else setTodayUnknown(n => n + 1)
  }

  function handleConfigChange(next: InfiniteConfig) {
    setConfig(next)
    setTodayKnow(0)
    setTodayUnknown(0)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {phase === 'home' && (
        <div className="flex-1 flex flex-col p-6 gap-6 overflow-y-auto">
          <div>
            <h1 className="text-base font-bold text-fg">内化学习</h1>
            <p className="text-xs text-fg-muted mt-0.5">选择练习模式开始</p>
          </div>
          <div className="flex flex-wrap gap-4">
            <CardModeIcon onClick={() => setPhase('playing')} />
            <ComingSoonIcon icon={<Volume2 className="w-8 h-8" />}   label="读音练习" desc="汉字→假名" />
            <ComingSoonIcon icon={<GitCompare className="w-8 h-8" />} label="辨析练习" desc="近义词辨别" />
            <ComingSoonIcon icon={<FileText className="w-8 h-8" />}   label="情景填空" desc="语境还原" />
            <ComingSoonIcon icon={<Keyboard className="w-8 h-8" />}   label="打字练习" desc="默写输入" />
            <ComingSoonIcon icon={<Languages className="w-8 h-8" />}  label="翻译练习" desc="双向翻译" />
          </div>
        </div>
      )}

      {phase === 'playing' && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <button
              onClick={() => setPhase('home')}
              className="text-sm text-fg-subtle hover:text-fg transition-colors"
            >
              ← 返回
            </button>
            <span className="text-sm font-semibold text-fg">卡牌复习</span>
            <button
              onClick={() => setIsConfigOpen(true)}
              className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
            >
              <Settings className="w-4 h-4 text-fg-subtle" />
            </button>
          </div>

          {/* Stats bar */}
          <StatsBar todayKnow={todayKnow} todayUnknown={todayUnknown} />

          {/* Infinite deck */}
          <InfiniteCardDeck config={config} onSwipe={handleSwipe} />

          {/* Config sheet */}
          {isConfigOpen && (
            <ConfigSheet
              config={config}
              onChange={handleConfigChange}
              onClose={() => setIsConfigOpen(false)}
            />
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Delete old components**

```bash
rm frontend/src/components/internalize/CardDeck.tsx
rm frontend/src/components/internalize/SessionSetup.tsx
rm frontend/src/components/internalize/SessionResult.tsx
```

- [ ] **Step 3: Check TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/InternalizePage.tsx
git add -u frontend/src/components/internalize/
git commit -m "feat: refactor InternalizePage to infinite mode, remove session components"
```

---

## Task 12: Smoke test the full flow

- [ ] **Step 1: Start backend and frontend**

```bash
# Terminal 1
cd backend && uvicorn app.main:app --reload --port 8000

# Terminal 2
cd frontend && npm run dev
```

- [ ] **Step 2: Verify the full flow**

1. Open the app, click "卡牌记忆" → enters playing view
2. StatsBar shows "今日 会 0 不会 0 0 张"
3. Cards appear in the deck
4. Tap a card → it flips, 会/不会 swipe hints appear
5. Swipe right (会) → card exits right, StatsBar "会" count increments
6. Swipe left (不会) → card exits left with shake, StatsBar "不会" count increments
7. Tap StatsBar → switches to total view showing mastery %
8. Tap ⚙️ → ConfigSheet opens, change to "读音模式" → deck reloads
9. Tap "← 返回" → back to home

- [ ] **Step 3: Verify SRS state in DB**

```bash
psql $DATABASE_URL -c "SELECT atom_id, box_level, next_review FROM atom_srs_states LIMIT 5;"
```

Expected: Rows with box_level values and next_review timestamps reflecting swipe results.
