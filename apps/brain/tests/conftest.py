from __future__ import annotations

import json
import sqlite3

import pytest
from fambrain_agentflow.chat.client import ScriptedChat
from fambrain_agentflow.types import IntakeDecision
from fambrain_api.main import create_app
from fambrain_kernel.auth.directory import ensure_account_db, prisma_sqlite_path
from fambrain_kernel.auth.jwt import sign_auth_token
from fambrain_kernel.config import Settings
from httpx import ASGITransport, AsyncClient


def seed_active_user(user_id: str = "user-1") -> str:
    path = prisma_sqlite_path()
    assert path is not None
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            INSERT INTO User (id, username, passwordHash, displayName, role, status, corpusUserId)
            VALUES (?, ?, '', '展飞', 'ADMIN', 'ACTIVE', ?)
            """,
            (user_id, user_id, user_id),
        )
    return user_id


def bearer(app, user_id: str) -> dict[str, str]:
    token = sign_auth_token(app.state.settings, user_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def app(tmp_path, monkeypatch):
    database = tmp_path / "dev.db"
    monkeypatch.setenv("DATABASE_URL", f"file:{database}")
    ensure_account_db()
    settings = Settings(
        environment="test",
        jwt_secret="test-secret-key-must-be-32-bytes-long",
        redis_url="",
        chat_provider="ollama",
    )
    chat = ScriptedChat(IntakeDecision(route="answer", reply=""), "测试回答")
    application = create_app(settings, chat=chat)
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


def parse_sse(raw: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for block in raw.replace("\r\n", "\n").split("\n\n"):
        if not block.strip():
            continue
        event = "message"
        data = ""
        for line in block.split("\n"):
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            if line.startswith("data:"):
                data = line.split(":", 1)[1].strip()
        if data:
            events.append((event, json.loads(data)))
    return events
