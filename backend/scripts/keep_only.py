"""Keep only some of an account's 精读 passages, and only the words and
grammar met in them; delete the rest of its passages and library.

    python scripts/keep_only.py you@example.com ID ID ...           # show what would go
    python scripts/keep_only.py you@example.com ID ID ... --apply   # delete it

IDs are analysis ids (a unique prefix is enough). For each word kept, only
its sentences from the kept passages stay (sentences met in JLPT stay too).
Deleted grammar points also leave the similarity index.

In the container: docker compose exec backend python scripts/keep_only.py …
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, select  # noqa: E402

from app.models.db import Analysis, Atom, AtomOccurrence, Recitation, User, async_session_factory  # noqa: E402
from app.services import auth_service as auth  # noqa: E402
from app.services.qdrant_service import qdrant_service  # noqa: E402


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("email")
    ap.add_argument("keep", nargs="+", help="analysis ids (or unique prefixes) to keep")
    ap.add_argument("--apply", action="store_true", help="actually delete")
    args = ap.parse_args()

    async with async_session_factory() as db:
        user = (await db.execute(select(User).where(User.email == auth.normalize_email(args.email)))).scalar_one_or_none()
        if user is None:
            print(f"没有这个账号：{args.email}")
            return 1
        analyses = (await db.execute(select(Analysis).where(Analysis.user_id == user.id))).scalars().all()
        keep = []
        for k in args.keep:
            hits = [a for a in analyses if str(a.id).startswith(k)]
            if len(hits) != 1:
                print(f"「{k}」对应 {len(hits)} 篇，需要唯一的一篇")
                return 1
            keep.append(hits[0])
        keep_ids = {a.id for a in keep}
        drop_analyses = [a.id for a in analyses if a.id not in keep_ids]

        atoms = (await db.execute(select(Atom).where(Atom.user_id == user.id))).scalars().all()
        occ = (await db.execute(
            select(AtomOccurrence).where(AtomOccurrence.atom_id.in_([a.id for a in atoms]))
        )).scalars().all() if atoms else []
        kept_atoms = {o.atom_id for o in occ if o.analysis_id in keep_ids}
        drop_atoms = [a for a in atoms if a.id not in kept_atoms]
        # a kept word's sentences from passages being deleted
        drop_occ = [o.id for o in occ if o.atom_id in kept_atoms and o.analysis_id is not None and o.analysis_id not in keep_ids]

        print(f"{user.email}")
        print("保留的精读：")
        for a in keep:
            print(f"  {str(a.id)[:8]}  {(a.input_content or '')[:40].replace(chr(10), ' ')}")
        print(f"删掉精读 {len(drop_analyses)} 篇（共 {len(analyses)}）")
        print(f"保留词条 {len(kept_atoms)} 个，删掉 {len(drop_atoms)} 个（共 {len(atoms)}）")
        print(f"保留词条在被删精读里的例句，删掉 {len(drop_occ)} 条")
        if not args.apply:
            print("（只是预览；加 --apply 才会删除）")
            return 0

        if drop_occ:
            await db.execute(delete(AtomOccurrence).where(AtomOccurrence.id.in_(drop_occ)))
        if drop_atoms:
            await db.execute(delete(Atom).where(Atom.id.in_([a.id for a in drop_atoms])))
        if drop_analyses:
            await db.execute(delete(Recitation).where(Recitation.user_id == user.id, Recitation.analysis_id.in_(drop_analyses)))
            await db.execute(delete(Analysis).where(Analysis.id.in_(drop_analyses)))
        await db.commit()
    await qdrant_service.delete_atoms([a.id for a in drop_atoms if a.type == "grammar"])
    print("已删除")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
