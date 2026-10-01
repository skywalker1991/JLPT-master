"""Passwords, sessions, and the first admin.

Only the standard library is used: scrypt for passwords, secrets for tokens.
A session is a random token in an httpOnly cookie; the database keeps its
SHA-256, so neither a leaked table nor a leaked log line can be replayed.
"""
import base64
import hashlib
import hmac
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.db import User, UserSession

logger = logging.getLogger(__name__)

SESSION_COOKIE = "jm_session"
MIN_PASSWORD_LENGTH = 8

# scrypt at n=2**14, r=8: ~16 MB and a few tens of milliseconds per check —
# slow enough to make guessing expensive, fast enough for a login.
_N, _R, _P = 2 ** 14, 8, 1


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return "scrypt${}${}${}${}${}".format(
        _N, _R, _P,
        base64.b64encode(salt).decode(),
        base64.b64encode(digest).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, digest_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        digest = hashlib.scrypt(
            password.encode(), salt=salt, n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, expected)


def password_problem(password: str) -> str | None:
    """Why a new password is refused, or None."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"密码至少 {MIN_PASSWORD_LENGTH} 位"
    if len(password) > 256:
        return "密码太长"
    return None


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_session(db: AsyncSession, user: User, user_agent: str | None) -> str:
    """Start a session and return the raw token for the cookie."""
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    db.add(UserSession(
        token_hash=_token_hash(token),
        user_id=user.id,
        expires_at=now + timedelta(days=get_settings().SESSION_DAYS),
        user_agent=(user_agent or "")[:500] or None,
    ))
    user.last_login_at = now
    await db.flush()
    return token


async def user_for_token(db: AsyncSession, token: str | None) -> User | None:
    """The active user a session cookie belongs to, or None. Slides the
    expiry forward at most once an hour so an active person stays signed in
    without a write on every request."""
    if not token:
        return None
    now = datetime.now(timezone.utc)
    row = (await db.execute(
        select(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .where(UserSession.token_hash == _token_hash(token))
    )).first()
    if row is None:
        return None
    session, user = row
    if session.expires_at <= now or not user.is_active:
        return None
    if now - session.last_seen_at > timedelta(hours=1):
        session.last_seen_at = now
        session.expires_at = now + timedelta(days=get_settings().SESSION_DAYS)
        await db.flush()
    return user


async def end_session(db: AsyncSession, token: str | None) -> None:
    if token:
        await db.execute(delete(UserSession).where(UserSession.token_hash == _token_hash(token)))


async def end_all_sessions(db: AsyncSession, user_id: UUID, keep_token: str | None = None) -> None:
    """Sign a user out everywhere, except (optionally) the current browser."""
    q = delete(UserSession).where(UserSession.user_id == user_id)
    if keep_token:
        q = q.where(UserSession.token_hash != _token_hash(keep_token))
    await db.execute(q)


# ── Guessing ──────────────────────────────────────────────────────────────────
# In-process and per instance, which is what this deployment is. Failures are
# counted per address and per account, so neither one IP spraying accounts nor
# many IPs hammering one account gets far.

_WINDOW_SECONDS = 15 * 60
_MAX_FAILURES = 10
_failures: dict[str, list[float]] = {}


def _recent(key: str) -> list[float]:
    cutoff = time.monotonic() - _WINDOW_SECONDS
    kept = [t for t in _failures.get(key, []) if t > cutoff]
    if kept:
        _failures[key] = kept
    else:
        _failures.pop(key, None)
    return kept


def login_blocked(ip: str, email: str) -> bool:
    return len(_recent(f"ip:{ip}")) >= _MAX_FAILURES or len(_recent(f"email:{email}")) >= _MAX_FAILURES


def record_login_failure(ip: str, email: str) -> None:
    now = time.monotonic()
    for key in (f"ip:{ip}", f"email:{email}"):
        _recent(key)
        _failures.setdefault(key, []).append(now)


def clear_login_failures(ip: str, email: str) -> None:
    _failures.pop(f"ip:{ip}", None)
    _failures.pop(f"email:{email}", None)


# ── First admin ──────────────────────────────────────────────────────────────

_OWNED_TABLES = ("atoms", "analyses", "exam_attempts")


async def ensure_admin(db: AsyncSession) -> User | None:
    """Create the first admin from ADMIN_EMAIL/ADMIN_PASSWORD if there is no
    admin yet, and hand it everything made before accounts existed."""
    settings = get_settings()
    admin = (await db.execute(
        select(User).where(User.role == "admin").order_by(User.created_at).limit(1)
    )).scalar_one_or_none()

    if admin is None:
        email = normalize_email(settings.ADMIN_EMAIL)
        if not email or not settings.ADMIN_PASSWORD:
            logger.warning("No admin account and ADMIN_EMAIL/ADMIN_PASSWORD not set — nobody can sign in yet.")
            return None
        problem = password_problem(settings.ADMIN_PASSWORD)
        if problem:
            logger.error("ADMIN_PASSWORD refused: %s", problem)
            return None
        existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if existing is not None:
            existing.role = "admin"
            admin = existing
        else:
            admin = User(email=email, password_hash=hash_password(settings.ADMIN_PASSWORD), role="admin")
            db.add(admin)
        await db.flush()
        logger.info("Admin account ready: %s", email)

    for table in _OWNED_TABLES:
        has_column = (await db.execute(text(
            "SELECT 1 FROM information_schema.columns WHERE table_name = :t AND column_name = 'user_id'"
        ), {"t": table})).first()
        if has_column:
            result = await db.execute(
                text(f"UPDATE {table} SET user_id = :uid WHERE user_id IS NULL"), {"uid": admin.id}
            )
            if result.rowcount:
                logger.info("Handed %d rows of %s to the admin account.", result.rowcount, table)
    return admin


async def purge_expired_sessions(db: AsyncSession) -> None:
    await db.execute(delete(UserSession).where(UserSession.expires_at <= datetime.now(timezone.utc)))
