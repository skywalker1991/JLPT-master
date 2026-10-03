"""Who is asking, and are they allowed to.

Every router but the auth endpoints depends on `current_user`; admin-only
routes depend on `require_admin`. Handlers take the user from here and scope
every query on personal data by `user.id` — an id belonging to someone else is
answered exactly like an id that does not exist.
"""
from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import User, get_db
from app.services.auth_service import SESSION_COOKIE, user_for_token


async def current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    cached = getattr(request.state, "user", None)
    if cached is not None:
        return cached
    user = await user_for_token(db, request.cookies.get(SESSION_COOKIE))
    if user is None:
        raise HTTPException(status_code=401, detail="请先登录")
    request.state.user = user
    return user


def sees_paper(user: User, paper) -> bool:
    """Learners see the open papers; an admin sees them all."""
    return bool(paper.is_open) or user.role == "admin"


async def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user
