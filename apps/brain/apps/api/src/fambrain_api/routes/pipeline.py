from __future__ import annotations

import orjson
from fambrain_agentflow.pipeline.stream import iter_pipeline_events
from fambrain_agentflow.types import PipelineStreamBody
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from fambrain_api.deps import ensure_active, require_actor

router = APIRouter(prefix="/pipeline")


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


class CancelBody(BaseModel):
    turn_id: str = Field(alias="turnId")
    conversation_id: str | None = Field(default=None, alias="conversationId")
    reason: str = "cancelled"

    model_config = {"populate_by_name": True}


@router.post("/stream")
async def stream(request: Request) -> StreamingResponse:
    raw = await request.json()
    try:
        body = PipelineStreamBody.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=format_validation_error(exc)) from exc
    user = await require_actor(request)
    ensure_active(user)
    if body.context.actor_user_id != str(user.id):
        raise HTTPException(status_code=403, detail="无权以该用户身份调用 Agent")

    async def events():
        async for name, payload in iter_pipeline_events(
            body.history,
            body.context,
            request.app.state.chat,
            request.app.state.turns,
        ):
            data = orjson.dumps(payload).decode()
            yield f"event: {name}\ndata: {data}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream; charset=utf-8",
        headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive"},
    )


@router.post("/cancel")
async def cancel(request: Request) -> JSONResponse:
    raw = await request.json()
    try:
        body = CancelBody.model_validate(raw)
    except ValidationError as exc:
        return JSONResponse({"error": format_validation_error(exc)}, status_code=400)
    if body.reason not in ("cancelled", "superseded"):
        return JSONResponse({"error": "reason 不合法"}, status_code=400)
    user = await require_actor(request)
    entry = request.app.state.turns.get(body.turn_id)
    if entry is None:
        return JSONResponse(
            {"ok": True, "aborted": False, "turnId": body.turn_id, "reason": body.reason}
        )
    if entry.actor_user_id != str(user.id):
        return JSONResponse({"error": "无权取消该 turn"}, status_code=403)
    if body.conversation_id and body.conversation_id != entry.conversation_id:
        return JSONResponse({"error": "turn 与会话不匹配"}, status_code=403)
    aborted = request.app.state.turns.cancel(body.turn_id, body.reason)
    return JSONResponse(
        {"ok": True, "aborted": aborted, "turnId": body.turn_id, "reason": body.reason}
    )


@router.post("/pause")
async def pause(request: Request) -> JSONResponse:
    raw = await request.json()
    try:
        body = CancelBody.model_validate(raw)
    except ValidationError as exc:
        return JSONResponse({"error": format_validation_error(exc)}, status_code=400)
    user = await require_actor(request)
    entry = request.app.state.turns.get(body.turn_id)
    if entry is None:
        return JSONResponse({"ok": True, "paused": False, "turnId": body.turn_id})
    if entry.actor_user_id != str(user.id):
        return JSONResponse({"error": "无权暂停该 turn"}, status_code=403)
    if body.conversation_id and body.conversation_id != entry.conversation_id:
        return JSONResponse({"error": "turn 与会话不匹配"}, status_code=403)
    paused = request.app.state.turns.pause(body.turn_id)
    return JSONResponse({"ok": True, "paused": paused, "turnId": body.turn_id})
