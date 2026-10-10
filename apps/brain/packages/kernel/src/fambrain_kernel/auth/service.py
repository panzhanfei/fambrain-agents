"""Account registration and login."""

from __future__ import annotations

import asyncio
import random
import sqlite3
from dataclasses import dataclass

from pydantic import ValidationError

from fambrain_kernel.auth.directory import (
    count_users,
    first_active_admin_id,
    insert_user,
    lookup_national_id,
    lookup_username,
)
from fambrain_kernel.auth.jwt import sign_auth_token
from fambrain_kernel.auth.passwords import hash_password, verify_password
from fambrain_kernel.auth.rate_limit import WindowLimiter
from fambrain_kernel.auth.roles import UserRole, UserStatus
from fambrain_kernel.auth.schemas import LoginBody, RegisterBody
from fambrain_kernel.config import Settings

_LIMITER = WindowLimiter()


@dataclass(frozen=True)
class AuthOk:
    """Successful auth response."""

    redirect: str
    token: str
    bootstrap: bool = False


@dataclass(frozen=True)
class AuthError:
    """Rejected auth response."""

    error: str
    status: int
    retry_after_sec: int | None = None


def format_validation_error(exc: ValidationError) -> str:
    """Join field validation messages into one string."""
    parts: list[str] = []
    for item in exc.errors():
        message = str(item["msg"])
        prefix = "Value error, "
        if message.startswith(prefix):
            message = message[len(prefix) :]
        parts.append(message)
    return "；".join(parts) or "字段校验失败"


def _taken_account(national_id: str, username: str) -> AuthError | None:
    """Return a conflict when the national id or username is already registered."""
    if lookup_national_id(national_id) is not None:
        return AuthError("该身份证号已在系统中注册", 409)
    if lookup_username(username) is not None:
        return AuthError("该用户名已被注册", 409)
    return None


def _duplicate_account(exc: sqlite3.IntegrityError) -> AuthError:
    """Map a unique-constraint failure to the field that collided."""
    if "nationalId" in str(exc):
        return AuthError("该身份证号已在系统中注册", 409)
    return AuthError("该用户名已被注册", 409)


async def _jitter(settings: Settings) -> None:
    """Delay a failed login to blunt password guessing."""
    low = settings.auth_failure_jitter_min_ms
    high = max(settings.auth_failure_jitter_max_ms, low)
    if high <= 0:
        return
    delay_ms = random.randint(low, high)
    await asyncio.sleep(delay_ms / 1000)


async def register_user(
    settings: Settings,
    raw: object,
    ip_key: str,
) -> AuthOk | AuthError:
    """Register a member, or the first admin when no accounts exist."""
    allowed, retry = _LIMITER.allow(f"register:{ip_key}", max_hits=12, window_s=3600)
    if not allowed:
        return AuthError("注册次数过多，请稍后再试", 429, retry)
    try:
        body = RegisterBody.model_validate(raw)
    except ValidationError as exc:
        return AuthError(format_validation_error(exc), 400)

    taken = _taken_account(body.national_id, body.username)
    if taken is not None:
        return taken

    bootstrap = count_users() == 0
    principal_id = None if bootstrap else first_active_admin_id()
    try:
        user = insert_user(
            username=body.username,
            password_hash=hash_password(body.password),
            national_id=body.national_id,
            display_name=body.display_name,
            relation_to_principal=body.relation_to_principal,
            role=UserRole.ADMIN if bootstrap else UserRole.MEMBER,
            status=UserStatus.ACTIVE if bootstrap else UserStatus.PENDING,
            corpus_user_id=principal_id,
        )
    except sqlite3.IntegrityError as exc:
        return _duplicate_account(exc)
    token = sign_auth_token(settings, user.id)
    return AuthOk(redirect="/" if bootstrap else "/pending", token=token, bootstrap=bootstrap)


async def login_user(
    settings: Settings,
    raw: object,
    ip_key: str,
) -> AuthOk | AuthError:
    """Sign in with a username and password."""
    allowed, retry = _LIMITER.allow(f"login:{ip_key}", max_hits=40, window_s=15 * 60)
    if not allowed:
        return AuthError("登录尝试过于频繁，请稍后再试", 429, retry)
    try:
        body = LoginBody.model_validate(raw)
    except ValidationError:
        return AuthError("用户名或密码无效", 400)
    user = lookup_username(body.username)
    if user is None or user.status == UserStatus.REJECTED:
        await _jitter(settings)
        return AuthError("登录失败，请核对用户名和密码", 401)
    if not verify_password(body.password, user.password_hash):
        await _jitter(settings)
        return AuthError("登录失败，请核对用户名和密码", 401)
    token = sign_auth_token(settings, user.id)
    redirect = "/pending" if user.status == UserStatus.PENDING else "/"
    return AuthOk(redirect=redirect, token=token)
