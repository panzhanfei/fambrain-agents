"""原文库 txt → corpus markdown，并按 path 增量更新向量。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import httpx
from fambrain_kernel.config import get_settings

from fambrain_corpus.doc_kind import infer_doc_kind
from fambrain_corpus.embed import embed_texts
from fambrain_corpus.paths import user_corpus_root
from fambrain_corpus.qdrant import (
    DENSE_VECTOR_NAME,
    DENSE_VECTOR_SIZE,
    SPARSE_VECTOR_NAME,
    corpus_collection_name,
    point_id_from_key,
)
from fambrain_corpus.sparse import text_to_sparse_vector

_IMPORTS = Path("personal") / "imports" / "workspace"


@dataclass(frozen=True)
class CorpusSyncResult:
    ok: bool
    detail: str


def normalize_workspace_rel(raw: str) -> str | None:
    rel = raw.replace("\\", "/").strip().lstrip("./").lstrip("/")
    while "//" in rel:
        rel = rel.replace("//", "/")
    rel = rel.rstrip("/")
    if not rel or not rel.lower().endswith(".txt"):
        return None
    parts = rel.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return None
    return rel


def workspace_markdown(workspace_rel: str, txt_body: str) -> str:
    base = Path(workspace_rel).name
    title = base[:-4] if base.lower().endswith(".txt") else base
    body = txt_body.replace("\r\n", "\n").replace("\r", "\n").rstrip()
    return f"# {title}\n\n{body}\n"


def corpus_md_repo_path(corpus_user_id: str, workspace_rel: str) -> str | None:
    rel = normalize_workspace_rel(workspace_rel)
    if rel is None:
        return None
    stem = rel[:-4]
    return f"users/{corpus_user_id}/corpus/personal/imports/workspace/{stem}.md"


def corpus_md_path(corpus_user_id: str, workspace_rel: str) -> Path | None:
    rel = normalize_workspace_rel(workspace_rel)
    if rel is None:
        return None
    return user_corpus_root(corpus_user_id) / _IMPORTS / f"{rel[:-4]}.md"


def materialize_workspace_txt(
    corpus_user_id: str,
    workspace_rel: str,
    *,
    txt_body: str,
    transport: httpx.BaseTransport | None = None,
) -> CorpusSyncResult:
    """写入语料 markdown，再只替换这一篇的向量。"""
    repo_path = corpus_md_repo_path(corpus_user_id, workspace_rel)
    md_path = corpus_md_path(corpus_user_id, workspace_rel)
    if repo_path is None or md_path is None:
        return CorpusSyncResult(False, "语料路径无效")
    markdown = workspace_markdown(workspace_rel, txt_body)
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(markdown, encoding="utf-8")
    try:
        vectors = embed_texts([markdown], timeout=180)
    except Exception as exc:
        return CorpusSyncResult(False, f"语料已写入，向量未更新：{_error_text(exc)}")
    if not vectors:
        return CorpusSyncResult(False, "语料已写入，向量未更新：嵌入结果为空")
    title = Path(workspace_rel).name
    if title.lower().endswith(".txt"):
        title = title[:-4]
    source_path = f"vault/originals/workspace/{normalize_workspace_rel(workspace_rel)}"
    point = {
        "id": point_id_from_key(f"{corpus_user_id}:{repo_path}:0"),
        "vector": {
            DENSE_VECTOR_NAME: vectors[0],
            SPARSE_VECTOR_NAME: text_to_sparse_vector(repo_path, title, markdown).as_query(),
        },
        "payload": {
            "path": repo_path,
            "sourcePath": source_path,
            "title": title,
            "body": markdown,
            "corpusUserId": corpus_user_id,
            "chunkIndex": 0,
            "docKind": infer_doc_kind(repo_path, markdown),
        },
    }
    collection = corpus_collection_name(corpus_user_id)
    try:
        with httpx.Client(transport=transport, timeout=120) as client:
            _ensure_collection(client, collection)
            _delete_points_by_path(client, collection, repo_path)
            written = client.put(
                _collection_url(collection) + "/points",
                json={"points": [point]},
                params={"wait": "true"},
            )
            written.raise_for_status()
    except Exception as exc:
        return CorpusSyncResult(False, f"语料已写入，向量未更新：{_error_text(exc)}")
    return CorpusSyncResult(True, "已写入语料并更新向量库")


def purge_workspace_txts(
    corpus_user_id: str,
    workspace_rels: list[str],
    *,
    transport: httpx.BaseTransport | None = None,
) -> CorpusSyncResult:
    """删掉这些 txt 对应的 markdown 和向量。"""
    if not workspace_rels:
        return CorpusSyncResult(True, "没有需要清理的语料")
    errors: list[str] = []
    collection = corpus_collection_name(corpus_user_id)
    with httpx.Client(transport=transport, timeout=120) as client:
        for rel in workspace_rels:
            repo_path = corpus_md_repo_path(corpus_user_id, rel)
            md_path = corpus_md_path(corpus_user_id, rel)
            if repo_path is None or md_path is None:
                errors.append(f"{rel} 语料路径无效")
                continue
            md_path.unlink(missing_ok=True)
            _remove_empty_parents(md_path.parent, user_corpus_root(corpus_user_id) / _IMPORTS)
            try:
                _delete_points_by_path(client, collection, repo_path)
            except Exception as exc:
                errors.append(f"{rel} 向量未删除：{_error_text(exc)}")
    if errors:
        return CorpusSyncResult(False, "；".join(errors))
    return CorpusSyncResult(True, "已删除对应语料与向量")


def _collection_url(collection: str) -> str:
    return f"{get_settings().resolved_qdrant_url}/collections/{collection}"


def _ensure_collection(client: httpx.Client, collection: str) -> None:
    url = _collection_url(collection)
    existing = client.get(url)
    if existing.status_code == 404:
        created = client.put(
            url,
            json={
                "vectors": {DENSE_VECTOR_NAME: {"size": DENSE_VECTOR_SIZE, "distance": "Cosine"}},
                "sparse_vectors": {SPARSE_VECTOR_NAME: {"modifier": "idf"}},
            },
        )
        created.raise_for_status()
    else:
        existing.raise_for_status()
    for field in ("path", "docKind", "sourcePath"):
        indexed = client.put(
            f"{url}/index",
            json={"field_name": field, "field_schema": "keyword"},
        )
        if indexed.status_code in {400, 409}:
            continue
        indexed.raise_for_status()


def _delete_points_by_path(client: httpx.Client, collection: str, repo_path: str) -> None:
    deleted = client.post(
        f"{_collection_url(collection)}/points/delete",
        params={"wait": "true"},
        json={"filter": {"must": [{"key": "path", "match": {"value": repo_path}}]}},
    )
    if deleted.status_code == 404:
        return
    deleted.raise_for_status()


def _remove_empty_parents(start: Path, stop: Path) -> None:
    current = start.resolve()
    boundary = stop.resolve()
    while current != boundary and boundary in current.parents:
        try:
            current.rmdir()
        except OSError:
            return
        current = current.parent


def _error_text(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        text = exc.response.text.strip().replace("\n", " ")
        if text:
            return text[:240]
    return str(exc)[:240]
