from __future__ import annotations

from contextlib import asynccontextmanager

import uvicorn
from fambrain_agentflow.chat.client import ChatCompleter, build_chat
from fambrain_agentflow.execution.turns import TurnRegistry
from fambrain_kernel.config import Settings, get_settings
from fambrain_kernel.logging import configure_logging
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from fambrain_api.routes.documents import router as documents_router
from fambrain_api.routes.enumeration import router as enumeration_router
from fambrain_api.routes.health import router as health_router
from fambrain_api.routes.pipeline import router as pipeline_router


def create_app(settings: Settings | None = None, chat: ChatCompleter | None = None) -> FastAPI:
    resolved = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        configure_logging(resolved.environment)
        app.state.turns = TurnRegistry()
        app.state.settings = resolved
        app.state.chat = chat or build_chat(resolved)
        yield

    app = FastAPI(title="FamBrain", lifespan=lifespan)
    app.state.settings = resolved

    @app.exception_handler(HTTPException)
    async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "请求失败"
        return JSONResponse({"error": detail}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": "字段校验失败"}, status_code=400)

    app.include_router(health_router)
    app.include_router(documents_router)
    app.include_router(enumeration_router)
    app.include_router(pipeline_router)
    return app


app = create_app()


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "fambrain_api.main:app",
        host=settings.brain_py_host,
        port=settings.brain_py_port,
        factory=False,
    )
