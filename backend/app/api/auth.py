"""Signing in and out, and accounts.

The session lives in an httpOnly cookie, so the frontend never sees the
token; it asks `GET /auth/me` who it is. Admins manage accounts under
/admin/users — with sign-up closed, that is how anyone gets one.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
import secrets

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user, require_admin
from app.config import get_settings
from app.models.db import Analysis, Atom, ExamAttempt, InviteCode, User, get_db
from app.services import auth_service as auth

router = APIRouter(tags=["auth"])

# Checked against when the address is unknown, so a miss costs the same scrypt
# as a hit and the response time does not say which addresses have accounts.
_DUMMY_HASH = auth.hash_password("not-a-real-password")


class LoginRequest(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=256)


class SignupRequest(LoginRequest):
    display_name: str | None = Field(default=None, max_length=100)
    invite_code: str | None = Field(default=None, max_length=32)


class NewInvites(BaseModel):
    note: str | None = Field(default=None, max_length=200)
    max_uses: int = Field(default=1, ge=1, le=1000)
    expires_at: datetime | None = None
    count: int = Field(default=1, ge=1, le=50)


class InviteUpdate(BaseModel):
    is_active: bool | None = None
    note: str | None = Field(default=None, max_length=200)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)


class NewUser(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=256)
    display_name: str | None = Field(default=None, max_length=100)
    role: str = "user"


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=100)
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, max_length=256)


def _public(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "display_name": user.display_name,
        "role": user.role,
    }


def _set_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        auth.SESSION_COOKIE, token,
        max_age=settings.SESSION_DAYS * 24 * 3600,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def _client_ip(request: Request) -> str:
    # X-Real-IP is set by our nginx from the connection itself; X-Forwarded-For
    # is not trusted, because a client can put anything at the front of it.
    real = request.headers.get("x-real-ip", "").strip()
    if real:
        return real
    return request.client.host if request.client else "?"


# No 0/O, 1/I/L: a code is read off a phone screen and typed by hand.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def new_code() -> str:
    raw = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_code(code: str) -> str:
    """Accept what people actually type: lower case, spaces, a missing dash."""
    raw = "".join(ch for ch in code.upper() if ch.isalnum())
    return f"{raw[:4]}-{raw[4:]}" if len(raw) == 8 else raw


def _valid_email(email: str) -> bool:
    return "@" in email and "." in email.split("@")[-1] and len(email) <= 320


@router.post("/auth/login")
async def login(body: LoginRequest, request: Request, response: Response,
                db: AsyncSession = Depends(get_db)):
    email = auth.normalize_email(body.email)
    ip = _client_ip(request)
    if auth.login_blocked(ip, email):
        raise HTTPException(status_code=429, detail="尝试次数太多，请 15 分钟后再试")

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    # Same answer and roughly the same time whether the address exists or not.
    ok = auth.verify_password(body.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not ok or not user.is_active:
        auth.record_login_failure(ip, email)
        raise HTTPException(status_code=401, detail="邮箱或密码不对")

    auth.clear_login_failures(ip, email)
    token = await auth.create_session(db, user, request.headers.get("user-agent"))
    await db.commit()
    _set_cookie(response, token)
    return _public(user)


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    await auth.end_session(db, request.cookies.get(auth.SESSION_COOKIE))
    await db.commit()
    response.delete_cookie(auth.SESSION_COOKIE, path="/")


@router.get("/auth/me")
async def me(user: User = Depends(current_user)):
    return {**_public(user), "signup_mode": get_settings().SIGNUP_MODE}


@router.get("/auth/config")
async def auth_config():
    """What the sign-in page may offer, before anyone is signed in."""
    return {"signup_mode": get_settings().SIGNUP_MODE}


@router.post("/auth/signup")
async def signup(body: SignupRequest, request: Request, response: Response,
                 db: AsyncSession = Depends(get_db)):
    mode = get_settings().SIGNUP_MODE
    if mode not in ("open", "invite"):
        raise HTTPException(status_code=403, detail="暂不开放注册，请联系管理员")
    ip = _client_ip(request)
    if auth.login_blocked(ip, f"signup:{ip}"):
        raise HTTPException(status_code=429, detail="尝试次数太多，请 15 分钟后再试")
    email = auth.normalize_email(body.email)
    if not _valid_email(email):
        raise HTTPException(status_code=400, detail="邮箱格式不对")
    problem = auth.password_problem(body.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if (await db.execute(select(User.id).where(User.email == email))).first():
        raise HTTPException(status_code=409, detail="这个邮箱已经注册过")

    code = None
    if mode == "invite":
        code = normalize_code(body.invite_code or "")
        if not code:
            raise HTTPException(status_code=400, detail="需要邀请码")
        # Claimed in one statement, so a code with one place left cannot be
        # used by two people signing up at the same moment.
        now = datetime.now(timezone.utc)
        claimed = await db.execute(
            update(InviteCode)
            .where(
                InviteCode.code == code,
                InviteCode.is_active.is_(True),
                InviteCode.used_count < InviteCode.max_uses,
                (InviteCode.expires_at.is_(None)) | (InviteCode.expires_at > now),
            )
            .values(used_count=InviteCode.used_count + 1)
        )
        if claimed.rowcount != 1:
            auth.record_login_failure(ip, f"signup:{ip}")
            raise HTTPException(status_code=400, detail="邀请码无效、已用完或已过期")

    user = User(email=email, password_hash=auth.hash_password(body.password),
                display_name=(body.display_name or "").strip() or None, role="user",
                invite_code=code)
    db.add(user)
    await db.flush()
    token = await auth.create_session(db, user, request.headers.get("user-agent"))
    await db.commit()
    _set_cookie(response, token)
    return _public(user)


@router.post("/auth/password", status_code=204)
async def change_password(body: PasswordChange, request: Request,
                          user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if not auth.verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="当前密码不对")
    problem = auth.password_problem(body.new_password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    user.password_hash = auth.hash_password(body.new_password)
    # Anyone else holding a session for this account is signed out.
    await auth.end_all_sessions(db, user.id, keep_token=request.cookies.get(auth.SESSION_COOKIE))
    await db.commit()


# ── Accounts (admin) ──────────────────────────────────────────────────────────

@router.get("/admin/users", dependencies=[Depends(require_admin)])
async def list_users(db: AsyncSession = Depends(get_db)):
    users = (await db.execute(select(User).order_by(User.created_at))).scalars().all()

    async def counts(model) -> dict:
        rows = await db.execute(select(model.user_id, func.count()).group_by(model.user_id))
        return {uid: n for uid, n in rows.all()}

    atoms, analyses, attempts = await counts(Atom), await counts(Analysis), await counts(ExamAttempt)
    return [
        {
            **_public(u),
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "atoms": atoms.get(u.id, 0),
            "analyses": analyses.get(u.id, 0),
            "attempts": attempts.get(u.id, 0),
        }
        for u in users
    ]


@router.post("/admin/users", status_code=201, dependencies=[Depends(require_admin)])
async def create_user(body: NewUser, db: AsyncSession = Depends(get_db)):
    email = auth.normalize_email(body.email)
    if not _valid_email(email):
        raise HTTPException(status_code=400, detail="邮箱格式不对")
    if body.role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="角色只能是 user 或 admin")
    problem = auth.password_problem(body.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if (await db.execute(select(User.id).where(User.email == email))).first():
        raise HTTPException(status_code=409, detail="这个邮箱已经有账号")
    user = User(email=email, password_hash=auth.hash_password(body.password),
                display_name=(body.display_name or "").strip() or None, role=body.role)
    db.add(user)
    await db.commit()
    return _public(user)


@router.patch("/admin/users/{user_id}")
async def update_user(user_id: UUID, body: UserUpdate,
                      admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="没有这个账号")
    demoting_self = user.id == admin.id and (body.role == "user" or body.is_active is False)
    if demoting_self:
        raise HTTPException(status_code=400, detail="不能取消自己的管理员权限或停用自己")
    if body.role is not None:
        if body.role not in ("user", "admin"):
            raise HTTPException(status_code=400, detail="角色只能是 user 或 admin")
        user.role = body.role
    if body.display_name is not None:
        user.display_name = body.display_name.strip() or None
    signed_out = False
    if body.is_active is not None:
        user.is_active = body.is_active
        signed_out = not body.is_active
    if body.password:
        problem = auth.password_problem(body.password)
        if problem:
            raise HTTPException(status_code=400, detail=problem)
        user.password_hash = auth.hash_password(body.password)
        signed_out = True
    if signed_out:
        await auth.end_all_sessions(db, user.id)
    await db.commit()
    return {**_public(user), "is_active": user.is_active}


# ── Invite codes (admin) ──────────────────────────────────────────────────────

def _invite_row(c: InviteCode, users: list[str]) -> dict:
    return {
        "code": c.code,
        "note": c.note,
        "max_uses": c.max_uses,
        "used_count": c.used_count,
        "expires_at": c.expires_at.isoformat() if c.expires_at else None,
        "is_active": c.is_active,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "users": users,
    }


@router.get("/admin/invites", dependencies=[Depends(require_admin)])
async def list_invites(db: AsyncSession = Depends(get_db)):
    codes = (await db.execute(select(InviteCode).order_by(InviteCode.created_at.desc()))).scalars().all()
    rows = await db.execute(select(User.invite_code, User.email).where(User.invite_code.is_not(None)))
    by_code: dict[str, list[str]] = {}
    for code, email in rows.all():
        by_code.setdefault(code, []).append(email)
    return [_invite_row(c, by_code.get(c.code, [])) for c in codes]


@router.post("/admin/invites", status_code=201)
async def create_invites(body: NewInvites, admin: User = Depends(require_admin),
                         db: AsyncSession = Depends(get_db)):
    made = []
    for _ in range(body.count):
        code = InviteCode(code=new_code(), note=(body.note or "").strip() or None,
                          max_uses=body.max_uses, expires_at=body.expires_at, created_by=admin.id)
        db.add(code)
        made.append(code)
    await db.commit()
    return [_invite_row(c, []) for c in made]


@router.patch("/admin/invites/{code}", dependencies=[Depends(require_admin)])
async def update_invite(code: str, body: InviteUpdate, db: AsyncSession = Depends(get_db)):
    invite = await db.get(InviteCode, normalize_code(code))
    if invite is None:
        raise HTTPException(status_code=404, detail="没有这个邀请码")
    if body.is_active is not None:
        invite.is_active = body.is_active
    if body.note is not None:
        invite.note = body.note.strip() or None
    await db.commit()
    return _invite_row(invite, [])
