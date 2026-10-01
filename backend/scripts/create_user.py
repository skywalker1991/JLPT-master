"""Create an account, or reset its password.

    python scripts/create_user.py someone@example.com            # a user
    python scripts/create_user.py someone@example.com --admin    # an admin
    python scripts/create_user.py someone@example.com --reset    # new password

In the container: docker compose exec backend python scripts/create_user.py …

Without --password a random one is generated and printed once. Creating the
first admin also hands it the data from before accounts existed.
"""
import argparse
import asyncio
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.models.db import User, async_session_factory  # noqa: E402
from app.services import auth_service as auth  # noqa: E402


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("email")
    ap.add_argument("--admin", action="store_true", help="make this account an admin")
    ap.add_argument("--reset", action="store_true", help="set a new password on an existing account")
    ap.add_argument("--password", help="use this password instead of generating one")
    ap.add_argument("--name", help="display name")
    args = ap.parse_args()

    email = auth.normalize_email(args.email)
    password = args.password or secrets.token_urlsafe(12)
    problem = auth.password_problem(password)
    if problem:
        print(f"refused: {problem}", file=sys.stderr)
        return 1

    async with async_session_factory() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            if args.reset:
                print(f"no account for {email}", file=sys.stderr)
                return 1
            user = User(email=email, password_hash=auth.hash_password(password),
                        display_name=args.name, role="admin" if args.admin else "user")
            db.add(user)
            action = "created"
        else:
            if not args.reset and not args.admin:
                print(f"{email} already has an account (use --reset or --admin)", file=sys.stderr)
                return 1
            if args.reset:
                user.password_hash = auth.hash_password(password)
                await auth.end_all_sessions(db, user.id)
            if args.admin:
                user.role = "admin"
            action = "updated"
        await db.flush()
        if user.role == "admin":
            await auth.ensure_admin(db)
        await db.commit()

    print(f"{action}: {email} ({user.role})")
    if not args.password and (action == "created" or args.reset):
        print(f"password: {password}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
