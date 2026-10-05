from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str
    blocks: list[dict] | None = None


class ResumePayload(BaseModel):
    kind: Literal["vault_action"]
    job_id: str = Field(alias="jobId", min_length=1)
    prompt: str | None = None
    name: str | None = Field(default=None, max_length=120)

    model_config = {"populate_by_name": True}


class TurnAttachment(BaseModel):
    file_name: str = Field(alias="fileName")
    title: str
    text: str
    format: str | None = None
    text_length: int | None = Field(default=None, alias="textLength")

    model_config = {"populate_by_name": True}


class PipelineContext(BaseModel):
    actor_user_id: str = Field(alias="actorUserId", min_length=1)
    corpus_user_id: str = Field(alias="corpusUserId", min_length=1)
    display_name: str = Field(alias="displayName", min_length=1)
    conversation_id: str = Field(alias="conversationId", min_length=1)
    turn_id: str | None = Field(default=None, alias="turnId")
    resume: ResumePayload | None = None
    attachment_batch_id: str | None = Field(default=None, alias="attachmentBatchId")
    turn_attachments: list[TurnAttachment] | None = Field(default=None, alias="turnAttachments")

    model_config = {"populate_by_name": True}


class PipelineStreamBody(BaseModel):
    history: list[ChatTurn] = Field(min_length=1)
    context: PipelineContext


class IntakeDecision(BaseModel):
    route: Literal["clarify", "chitchat", "answer"] = "clarify"
    reply: str = ""

    @classmethod
    def from_payload(cls, payload: object) -> IntakeDecision:
        if not isinstance(payload, dict):
            return cls(route="clarify", reply="")
        route = payload.get("route")
        if route not in ("clarify", "chitchat", "answer"):
            route = "clarify"
        reply = payload.get("reply")
        return cls(route=route, reply=reply if isinstance(reply, str) else "")


def latest_user_text(history: list[ChatTurn]) -> str:
    for turn in reversed(history):
        if turn.role == "user" and turn.content.strip():
            return turn.content.strip()
    return ""
