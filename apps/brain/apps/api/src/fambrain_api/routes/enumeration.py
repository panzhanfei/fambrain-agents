from __future__ import annotations

from typing import Literal

from fambrain_agentflow.corpus.search import list_corpus_entries
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError

from fambrain_api.deps import ensure_active, require_actor

router = APIRouter()


class EnumerationBody(BaseModel):
    corpus_user_id: str = Field(alias="corpusUserId", min_length=1)
    list_kind: Literal["project", "experience"] = Field(alias="listKind")
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, alias="pageSize", ge=1, le=50)

    model_config = {"populate_by_name": True}


@router.post("/enumeration/list")
async def enumeration_list(request: Request) -> JSONResponse:
    raw = await request.json()
    try:
        body = EnumerationBody.model_validate(raw)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail="字段校验失败") from exc
    user = await require_actor(request)
    ensure_active(user)
    hits = list_corpus_entries(body.corpus_user_id, body.list_kind)
    start = (body.page - 1) * body.page_size
    page = hits[start : start + body.page_size]
    return JSONResponse(
        {
            "listKind": body.list_kind,
            "page": body.page,
            "pageSize": body.page_size,
            "total": len(hits),
            "hasMore": start + body.page_size < len(hits),
            "items": [
                {"path": hit.path, "excerpt": hit.excerpt, "title": hit.path.rsplit("/", 1)[-1].removesuffix(".md")}
                for hit in page
            ],
        }
    )
