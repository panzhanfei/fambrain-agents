from __future__ import annotations

import uuid

from fambrain_kernel.db.ids import new_id
from fambrain_kernel.db.models import Conversation
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from fambrain_api.deps import ensure_active, require_user

router = APIRouter(prefix="/conversations")


class CreateConversation(BaseModel):
    title: str = Field(default="新对话", max_length=200)


def _dump(row: Conversation) -> dict:
    return {
        "id": str(row.id),
        "title": row.title,
        "pinned": row.pinned,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("")
async def list_conversations(request: Request) -> JSONResponse:
    async with request.app.state.session_factory() as session:
        user = await require_user(request, session)
        ensure_active(user)
        rows = (
            await session.scalars(
                select(Conversation)
                .where(Conversation.user_id == user.id)
                .order_by(Conversation.pinned.desc(), Conversation.updated_at.desc())
            )
        ).all()
    return JSONResponse({"conversations": [_dump(row) for row in rows]})


@router.post("")
async def create_conversation(request: Request) -> JSONResponse:
    payload: dict = {}
    if await request.body():
        raw = await request.json()
        if isinstance(raw, dict):
            payload = raw
    body = CreateConversation.model_validate(payload)
    async with request.app.state.session_factory() as session:
        user = await require_user(request, session)
        ensure_active(user)
        row = Conversation(id=new_id(), user_id=user.id, title=body.title.strip() or "新对话")
        session.add(row)
        await session.commit()
        await session.refresh(row)
        dumped = _dump(row)
    return JSONResponse(dumped, status_code=201)


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: uuid.UUID, request: Request) -> JSONResponse:
    async with request.app.state.session_factory() as session:
        user = await require_user(request, session)
        ensure_active(user)
        row = await session.get(Conversation, conversation_id)
        if row is None or row.user_id != user.id:
            return JSONResponse({"error": "会话不存在"}, status_code=404)
        dumped = _dump(row)
    return JSONResponse(dumped)
