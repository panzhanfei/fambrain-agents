from __future__ import annotations

import asyncio
import random
import uuid
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from fambrain_kernel.auth.jwt import sign_auth_token
from fambrain_kernel.auth.passwords import hash_password, verify_password
from fambrain_kernel.auth.rate_limit import WindowLimiter
from fambrain_kernel.auth.schemas import LoginBody, RegisterBody
from fambrain_kernel.config import Settings
from fambrain_kernel.db.models import User, UserRole, UserStatus

_LIMITER = WindowLimiter()


@dataclass(frozen=True)
class AuthOk:
    redirect: str
    token: str
    bootstrap: bool = False


@dataclass(frozen=True)
class AuthError:
    error: str
    status: int
    retry_after_sec: int | None = None


def format_validation_error(exc: ValidationError) -> str:
    parts: list[str] = []
    for item in exc.errors():
        message = str(item["msg"])
        prefix = "Value error, "
        if message.startswith(prefix):
            message = message[len(prefix) :]
        parts.append(message)
    return "；".join(parts) or "字段校验失败"


async def _jitter(settings: Settings) -> None:
    low = settings.auth_failure_jitter_min_ms
    high = max(settings.auth_failure_jitter_max_ms, low)
    if high <= 0:
        return
    delay_ms = random.randint(low, high)
    await asyncio.sleep(delay_ms / 1000)


async def register_user(
    session: AsyncSession,
    settings: Settings,
    raw: object,
    ip_key: str,
) -> AuthOk | AuthError:
    allowed, retry = _LIMITER.allow(f"register:{ip_key}", max_hits=12, window_s=3600)
    if not allowed:
        return AuthError("注册次数过多，请稍后再试", 429, retry)
    try:
        body = RegisterBody.model_validate(raw)
    except ValidationError as exc:
        return AuthError(format_validation_error(exc), 400)

    existing_id = await session.scalar(select(User.id).where(User.national_id == body.national_id))
    if existing_id is not None:
        return AuthError("该身份证号已在系统中注册", 409)
    existing_name = await session.scalar(select(User.id).where(User.username == body.username))
    if existing_name is not None:
        return AuthError("该用户名已被注册", 409)

    total = await session.scalar(select(func.count()).select_from(User))
    bootstrap = (total or 0) == 0
    principal_id = None
    if not bootstrap:
        principal_id = await session.scalar(
            select(User.id)
            .where(User.role == UserRole.ADMIN, User.status == UserStatus.ACTIVE)
            .order_by(User.created_at.asc())
        )
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        national_id=body.national_id,
        display_name=body.display_name,
        relation_to_principal=body.relation_to_principal,
        role=UserRole.ADMIN if bootstrap else UserRole.MEMBER,
        status=UserStatus.ACTIVE if bootstrap else UserStatus.PENDING,
        corpus_user_id=principal_id,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token = sign_auth_token(settings, str(user.id))
    return AuthOk(redirect="/" if bootstrap else "/pending", token=token, bootstrap=bootstrap)


async def login_user(
    session: AsyncSession,
    settings: Settings,
    raw: object,
    ip_key: str,
) -> AuthOk | AuthError:
    allowed, retry = _LIMITER.allow(f"login:{ip_key}", max_hits=40, window_s=15 * 60)
    if not allowed:
        return AuthError("登录尝试过于频繁，请稍后再试", 429, retry)
    try:
        body = LoginBody.model_validate(raw)
    except ValidationError:
        return AuthError("用户名或密码无效", 400)
    user = await session.scalar(select(User).where(User.username == body.username))
    if user is None:
        from fambrain_kernel.auth.directory import lookup_username

        directory = lookup_username(body.username)
        if directory is None or directory.status == UserStatus.REJECTED:
            await _jitter(settings)
            return AuthError("登录失败，请核对用户名和密码", 401)
        if not verify_password(body.password, directory.password_hash):
            await _jitter(settings)
            return AuthError("登录失败，请核对用户名和密码", 401)
        token = sign_auth_token(settings, directory.id)
        redirect = "/pending" if directory.status == UserStatus.PENDING else "/"
        return AuthOk(redirect=redirect, token=token)
    if user.status == UserStatus.REJECTED:
        await _jitter(settings)
        return AuthError("登录失败，请核对用户名和密码", 401)
    if not verify_password(body.password, user.password_hash):
        await _jitter(settings)
        return AuthError("登录失败，请核对用户名和密码", 401)
    token = sign_auth_token(settings, str(user.id))
    redirect = "/pending" if user.status == UserStatus.PENDING else "/"
    return AuthOk(redirect=redirect, token=token)


async def user_from_id(session: AsyncSession, user_id: str) -> User | None:
    try:
        parsed = uuid.UUID(user_id)
    except ValueError:
        return None
    return await session.get(User, parsed)
