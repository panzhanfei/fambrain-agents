from __future__ import annotations

from fambrain_kernel.auth.directory import account_ping
from fambrain_kernel.redis_client import ping_redis
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> JSONResponse:
    settings = request.app.state.settings
    database_ping = account_ping()
    redis_ping: bool | None = None
    if settings.redis_configured and settings.redis_url.strip():
        try:
            redis_ping = await ping_redis(settings.redis_url.strip())
        except Exception:
            redis_ping = False
    return JSONResponse(
        {
            "ok": True,
            "service": "fambrain-brain",
            "database": {"ping": database_ping},
            "redis": {
                "configured": settings.redis_configured,
                "ping": redis_ping,
            },
            "langSmith": {
                "enabled": settings.langsmith_enabled,
                "project": settings.langsmith_project,
                "apiKeyConfigured": bool(
                    settings.langsmith_api_key.strip() or settings.langchain_api_key.strip()
                ),
            },
            "chatProvider": settings.chat_provider,
        }
    )
