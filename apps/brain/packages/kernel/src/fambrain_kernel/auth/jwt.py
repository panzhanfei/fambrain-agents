from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt

from fambrain_kernel.config import Settings


def sign_auth_token(settings: Settings, user_id: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + timedelta(seconds=settings.token_max_age_sec),
    }
    return jwt.encode(payload, settings.resolved_jwt_secret, algorithm="HS256")


def verify_auth_token(settings: Settings, raw: str) -> str:
    payload = jwt.decode(
        raw,
        settings.resolved_jwt_secret,
        algorithms=["HS256"],
        leeway=90,
    )
    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise jwt.InvalidTokenError("invalid token subject")
    return subject
