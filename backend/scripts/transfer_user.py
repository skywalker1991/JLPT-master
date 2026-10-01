"""Move everything one account owns to another account.

    python scripts/transfer_user.py old@example.com new@example.com            # show what would move
    python scripts/transfer_user.py old@example.com new@example.com --apply    # move it
    python scripts/transfer_user.py old@example.com new@example.com --apply --deactivate-old

For when the admin changes address: the library, analyses, review state,
exam attempts, practice, follow-ups and recitations all go to the new
account, which must already exist (an admin is created at startup from
ADMIN_EMAIL). The new account must own no words yet, so nothing collides.

In the container: docker compose exec backend python scripts/transfer_user.py …
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select, text  # noqa: E402

from app.models.db import Atom, User, async_session_factory  # noqa: E402
from app.services import auth_service as auth  # noqa: E402
from app.services.qdrant_service import qdrant_service  # noqa: E402

TABLES = ["atoms", "analyses", "exam_attempts", "practice_answers", "item_asks", "recitations", "exam_item_reports"]


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("--apply", action="store_true", help="actually move the data")
    ap.add_argument("--deactivate-old", action="store_true", help="then switch the old account off")
    args = ap.parse_args()

    async with async_session_factory() as db:
        old = (await db.execute(select(User).where(User.email == auth.normalize_email(args.old)))).scalar_one_or_none()
        new = (await db.execute(select(User).where(User.email == auth.normalize_email(args.new)))).scalar_one_or_none()
        if old is None or new is None:
            print(f"没有这个账号：{args.old if old is None else args.new}")
            return 1
        if (await db.execute(select(func.count()).select_from(Atom).where(Atom.user_id == new.id))).scalar_one():
            print(f"{new.email} 已经有词条了；为避免同一个词出现两次，不转移。")
            return 1

        counts = {}
        for t in TABLES:
            counts[t] = (await db.execute(text(f"SELECT count(*) FROM {t} WHERE user_id = :u"), {"u": old.id})).scalar_one()
        print(f"{old.email} → {new.email}")
        for t, n in counts.items():
            print(f"  {t:<18} {n}")
        if not args.apply:
            print("（只是预览；加 --apply 才会转移）")
            return 0

        for t in TABLES:
            await db.execute(text(f"UPDATE {t} SET user_id = :n WHERE user_id = :o"), {"n": new.id, "o": old.id})
        if args.deactivate_old:
            old.is_active = False
            await auth.end_all_sessions(db, old.id, None)
        await db.commit()
    # Grammar points are searched by owner; move their owner in the index too
    await qdrant_service.claim_unowned(new.id)
    await qdrant_service.reassign(old.id, new.id)
    print("已转移" + ("，旧账号已停用" if args.deactivate_old else ""))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
