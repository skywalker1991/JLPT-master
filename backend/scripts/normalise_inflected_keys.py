"""Normalise atoms whose *key* is an inflected or derived form.

Companion to repair_inflected_atoms.py, which could only fix reading and
meaning. Two cases are left over:

  key is inflected     やらない → やる, ついています → つく
  derived duplicate    手軽 and 手軽に are the same word twice

Both come from the analysis prompt not demanding dictionary-form
normalisation; the prompt now does, so this is a one-off cleanup.

    venv/bin/python scripts/normalise_inflected_keys.py          # propose
    venv/bin/python scripts/normalise_inflected_keys.py --apply  # write
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, select, update  # noqa: E402

from app.models.db import Atom, AtomOccurrence, AtomProperty, async_session_factory  # noqa: E402
from app.services.llm.factory import get_llm_client  # noqa: E402

PROPOSALS = Path(__file__).parent / "normalise_proposals.json"

# key -> dictionary form. Verified beforehand: none of the targets already
# exist as atoms, so these are renames, not merges.
RENAMES = {
    "やらない": "やる",
    "ついています": "つく",
    "こぼし": "こぼす",
    "いかない": "いく",
    "ありえなかった": "ありえる",
}

# The derived form to drop; the dictionary form to keep.
DROP_DUPLICATES = {
    "もの珍しさ": "もの珍しい",
    "煮付け": "煮付ける",
    "手軽に": "手軽",
}

PROMPT = """你是一名日语词典编纂专家。下面每行给出一个日语辞書形。
请为每个词给出它的平假名读音和中文含义（精炼，不超过 15 字，不要加括号说明）。

{items}

直接输出 JSON，不要代码块：
{{"results": [{{"key": "...", "reading": "...", "meaning": "..."}}]}}
"""


async def propose():
    async with async_session_factory() as session:
        present = {
            a.key: a for a in (await session.execute(
                select(Atom).where(Atom.key.in_([*RENAMES, *DROP_DUPLICATES]))
            )).scalars().all()
        }
        # A rename must not collide with an atom that already exists.
        clashes = (await session.execute(
            select(Atom.key).where(Atom.key.in_(list(RENAMES.values())))
        )).scalars().all()
        if clashes:
            print(f"停止：这些辞書形已存在，需要合并而非改名 → {list(clashes)}")
            return

    targets = sorted(set(RENAMES.values()))
    client = get_llm_client()
    chunks = []
    async for chunk in client.analyze_stream(
        PROMPT.format(items="\n".join(f"- {k}" for k in targets)), {}
    ):
        chunks.append(chunk)
    raw = "".join(chunks).strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].removeprefix("json").strip()
    looked_up = {r["key"]: r for r in json.loads(raw)["results"]}

    plan = {
        "renames": [
            {"from": old, "to": new, **looked_up.get(new, {})}
            for old, new in RENAMES.items() if old in present
        ],
        "drops": [
            {"drop": bad, "keep": good}
            for bad, good in DROP_DUPLICATES.items() if bad in present
        ],
    }
    PROPOSALS.write_text(json.dumps(plan, ensure_ascii=False, indent=2))

    print("改名（key 是活用形）：")
    for r in plan["renames"]:
        print(f"  {r['from']:14} → {r['to']:10} {r.get('reading','?'):10} {r.get('meaning','?')}")
    print("\n删除派生形重复（保留辞書形）：")
    for d in plan["drops"]:
        print(f"  删 {d['drop']:10} 保留 {d['keep']}")
    print(f"\n提案已写入 {PROPOSALS.name}，确认后执行 --apply")


async def apply():
    plan = json.loads(PROPOSALS.read_text())
    async with async_session_factory() as session:
        for r in plan["renames"]:
            atom = (await session.execute(
                select(Atom).where(Atom.key == r["from"])
            )).scalar_one_or_none()
            if atom is None:
                continue
            await session.execute(update(Atom).where(Atom.id == atom.id).values(key=r["to"]))
            for kind in ("reading", "meaning"):
                if not r.get(kind):
                    continue
                prop = (await session.execute(
                    select(AtomProperty)
                    .where(AtomProperty.atom_id == atom.id, AtomProperty.kind == kind)
                    .order_by(AtomProperty.created_at)
                )).scalars().first()
                if prop is not None:
                    await session.execute(
                        update(AtomProperty).where(AtomProperty.id == prop.id).values(value=r[kind])
                    )

        for d in plan["drops"]:
            bad = (await session.execute(select(Atom).where(Atom.key == d["drop"]))).scalar_one_or_none()
            good = (await session.execute(select(Atom).where(Atom.key == d["keep"]))).scalar_one_or_none()
            if bad is None:
                continue
            if good is not None:
                # Sentences are the point of the knowledge base — carry them over.
                await session.execute(
                    update(AtomOccurrence)
                    .where(AtomOccurrence.atom_id == bad.id)
                    .values(atom_id=good.id)
                )
            await session.execute(delete(Atom).where(Atom.id == bad.id))

        await session.commit()
    print(f"改名 {len(plan['renames'])} 条，删除重复 {len(plan['drops'])} 条")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    asyncio.run(apply() if ap.parse_args().apply else propose())
