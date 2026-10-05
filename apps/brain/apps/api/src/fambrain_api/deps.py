from __future__ import annotations

import uuid

from fambrain_kernel.auth.jwt import verify_auth_token
from fambrain_kernel.auth.service import user_from_id
from fambrain_kernel.config import Settings
from fambrain_kernel.db.models import User, UserStatus
from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession


def _token_from_request(request: Request, settings: Settings) -> str | None:
    header = request.headers.get("authorization")
    if header and header.startswith("Bearer "):
        token = header[7:].strip()
        if token:
            return token
    cookie = request.cookies.get(settings.auth_cookie_name)
    return cookie or None


def _verified_user_id(request: Request) -> str:
    settings: Settings = request.app.state.settings
    raw = _token_from_request(request, settings)
    if not raw:
        raise HTTPException(status_code=401, detail="未登录或缺少 Authorization")
    try:
        return verify_auth_token(settings, raw)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="登录已失效") from exc


async def require_actor(request: Request):
    """JWT subject. Existing web accounts are cuid rows in Prisma SQLite."""

    from fambrain_kernel.auth.directory import lookup_user

    user_id = _verified_user_id(request)
    directory = lookup_user(user_id)
    if directory is not None:
        return directory
    async with request.app.state.session_factory() as session:
        user = await user_from_id(session, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="登录已失效")
    return user


async def require_user(request: Request, session: AsyncSession) -> User:
    user_id = _verified_user_id(request)
    user = await user_from_id(session, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="登录已失效")
    return user


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client is None:
        return "local"
    return request.client.host


def new_turn_id() -> str:
    return str(uuid.uuid4())


def ensure_active(user: User) -> None:
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=403, detail="账号尚未通过审核")
