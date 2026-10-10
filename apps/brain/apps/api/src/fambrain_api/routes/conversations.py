from __future__ import annotations

import sqlite3

from fambrain_kernel.auth.directory import get_conversation, insert_conversation, list_conversations
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from fambrain_api.deps import ensure_active, require_user

router = APIRouter(prefix="/conversations")


class CreateConversation(BaseModel):
    title: str = Field(default="新对话", max_length=200)


def _dump(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "pinned": bool(row["pinned"]),
        "createdAt": row["createdAt"],
        "updatedAt": row["updatedAt"],
    }


@router.get("")
async def list_conversation_rows(request: Request) -> JSONResponse:
    user = await require_user(request)
    ensure_active(user)
    rows = list_conversations(user.id)
    return JSONResponse({"conversations": [_dump(row) for row in rows]})


@router.post("")
async def create_conversation(request: Request) -> JSONResponse:
    payload: dict = {}
    if await request.body():
        raw = await request.json()
        if isinstance(raw, dict):
            payload = raw
    body = CreateConversation.model_validate(payload)
    user = await require_user(request)
    ensure_active(user)
    row = insert_conversation(user.id, body.title.strip() or "新对话")
    return JSONResponse(_dump(row), status_code=201)


@router.get("/{conversation_id}")
async def get_conversation_row(conversation_id: str, request: Request) -> JSONResponse:
    user = await require_user(request)
    ensure_active(user)
    row = get_conversation(conversation_id)
    if row is None or row["userId"] != user.id:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    return JSONResponse(_dump(row))
