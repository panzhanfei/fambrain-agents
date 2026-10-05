from __future__ import annotations

import tempfile
from pathlib import Path

from fambrain_agentflow.ingest.attachments import StagedFile, stage_batch
from fambrain_agentflow.ingest.docling import parse_to_markdown
from fambrain_corpus.index import index_user_corpus
from fambrain_corpus.paths import corpus_import_dir, vault_uploads_root
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from fambrain_api.deps import ensure_active, require_actor

router = APIRouter(prefix="/documents")

_CATEGORIES = {"personal", "projects", "experience"}


def _safe_name(name: str) -> str:
    cleaned = Path(name).name.replace("..", "")
    return cleaned or "upload.bin"


async def _read_uploads(form) -> list[tuple[str, bytes]]:
    files: list[tuple[str, bytes]] = []
    for item in form.getlist("files"):
        if not hasattr(item, "read"):
            continue
        payload = await item.read()
        if not payload:
            continue
        files.append((_safe_name(getattr(item, "filename", "") or "upload.bin"), payload))
    return files


def _text_of(name: str, payload: bytes) -> str:
    suffix = Path(name).suffix.lower()
    with tempfile.NamedTemporaryFile(suffix=suffix or ".bin", delete=False) as handle:
        handle.write(payload)
        path = Path(handle.name)
    try:
        return parse_to_markdown(path)
    finally:
        path.unlink(missing_ok=True)


@router.post("/extract")
async def extract(request: Request) -> JSONResponse:
    user = await require_actor(request)
    ensure_active(user)
    form = await request.form()
    uploads = await _read_uploads(form)
    if not uploads:
        raise HTTPException(status_code=400, detail="请至少上传 1 个文件（字段名 files）")
    staged: list[StagedFile] = []
    for name, payload in uploads:
        try:
            text = _text_of(name, payload).strip()
            if not text:
                staged.append(StagedFile(file_name=name, ok=False, error="未能从附件提取有效文本"))
            else:
                staged.append(
                    StagedFile(
                        file_name=name,
                        ok=True,
                        text=text,
                        format=Path(name).suffix.lower().lstrip("."),
                    )
                )
        except Exception as exc:
            staged.append(StagedFile(file_name=name, ok=False, error=str(exc) or "附件文字抽取失败"))
    batch = stage_batch(str(user.id), staged)
    ok_count = sum(1 for item in staged if item.ok)
    body = {
        "batchId": batch.batch_id,
        "okCount": ok_count,
        "failCount": len(staged) - ok_count,
        "files": [
            {
                "fileName": item.file_name,
                "ok": item.ok,
                "text": item.text if item.ok else "",
                "textLength": len(item.text),
                "format": item.format,
                "error": item.error,
            }
            for item in staged
        ],
    }
    if ok_count == 0:
        first = next((item.error for item in staged if item.error), "未能从附件提取有效文本")
        return JSONResponse({**body, "error": first}, status_code=422)
    return JSONResponse(body)


@router.post("/upload")
async def upload(request: Request) -> JSONResponse:
    user = await require_actor(request)
    ensure_active(user)
    form = await request.form()
    uploads = await _read_uploads(form)
    if not uploads:
        raise HTTPException(status_code=400, detail="请至少上传 1 个文件（字段名 files）")
    corpus_user_id = str(form.get("corpusUserId") or user.corpus_user_id or user.id)
    category = str(form.get("category") or "personal")
    if category not in _CATEGORIES:
        category = "personal"
    index_after = str(form.get("indexAfter") or "true").lower() != "false"
    vault = vault_uploads_root(corpus_user_id)
    imported = corpus_import_dir(corpus_user_id, category)
    vault.mkdir(parents=True, exist_ok=True)
    imported.mkdir(parents=True, exist_ok=True)
    files = []
    for name, payload in uploads:
        (vault / name).write_bytes(payload)
        ok = True
        error = None
        try:
            text = _text_of(name, payload).strip()
            if text:
                markdown_name = name if name.lower().endswith(".md") else f"{Path(name).stem}.md"
                (imported / markdown_name).write_text(text, encoding="utf-8")
        except Exception as exc:
            ok = False
            error = str(exc)
        files.append({"fileName": name, "ok": ok, "category": category, "error": error})
    indexed = False
    index_error = None
    if index_after and any(item["ok"] for item in files):
        try:
            index_user_corpus(corpus_user_id)
            indexed = True
        except Exception as exc:
            index_error = str(exc)
    return JSONResponse(
        {
            "corpusUserId": corpus_user_id,
            "actorUserId": str(user.id),
            "files": files,
            "indexed": indexed,
            "indexError": index_error,
            "categorySummary": {category: sum(1 for item in files if item["ok"])},
        }
    )
