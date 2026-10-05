from __future__ import annotations

import json

import pytest
from fambrain_agentflow.chat.client import ScriptedChat
from fambrain_agentflow.types import IntakeDecision
from fambrain_api.main import create_app
from fambrain_kernel.auth.national_id import is_valid_chinese_resident_id
from fambrain_kernel.config import Settings
from httpx import ASGITransport, AsyncClient


def valid_national_id() -> str:
    base = "11010119900101001"
    for char in "0123456789X":
        candidate = base + char
        if is_valid_chinese_resident_id(candidate):
            return candidate
    raise RuntimeError("no valid national id")


def alt_national_id() -> str:
    base = "11010119920202001"
    for char in "0123456789X":
        candidate = base + char
        if is_valid_chinese_resident_id(candidate):
            return candidate
    raise RuntimeError("no valid national id")


@pytest.fixture
async def app(tmp_path):
    settings = Settings(
        environment="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        db_create_all=True,
        jwt_secret="test-secret-key-must-be-32-bytes-long",
        auth_failure_jitter_min_ms=0,
        auth_failure_jitter_max_ms=0,
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


def register_payload(username: str, national_id: str) -> dict:
    return {
        "username": username,
        "password": "password-1",
        "nationalId": national_id,
        "displayName": "展飞",
        "relationToPrincipal": "本人",
    }


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
