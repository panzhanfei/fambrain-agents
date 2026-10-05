from __future__ import annotations

from dataclasses import dataclass

import httpx
from fambrain_kernel.config import get_settings

from fambrain_corpus.embed import embed_query
from fambrain_corpus.paths import is_noise_path
from fambrain_corpus.qdrant import (
    DENSE_VECTOR_NAME,
    SPARSE_VECTOR_NAME,
    collection_exists,
    corpus_collection_name,
)
from fambrain_corpus.sparse import text_to_sparse_vector


@dataclass(frozen=True)
class HybridHit:
    path: str
    title: str
    body: str
    score: float
    doc_kind: str | None
    recall_source: str


def _filter(doc_kinds: list[str] | None) -> dict | None:
    if not doc_kinds:
        return None
    return {"must": [{"key": "docKind", "match": {"any": doc_kinds}}]}


def _hits(points: list[dict], source: str) -> list[HybridHit]:
    rows: list[HybridHit] = []
    for point in points:
        payload = point.get("payload") or {}
        path = str(payload.get("path") or "")
        if not path or is_noise_path(path):
            continue
        rows.append(
            HybridHit(
                path=path,
                title=str(payload.get("title") or ""),
                body=str(payload.get("body") or ""),
                score=float(point.get("score") or 0),
                doc_kind=payload.get("docKind") if isinstance(payload.get("docKind"), str) else None,
                recall_source=source,
            )
        )
    if source == "hybrid" and rows:
        peak = max(row.score for row in rows)
        if peak > 0:
            rows = [
                HybridHit(
                    path=row.path,
                    title=row.title,
                    body=row.body,
                    score=row.score / peak,
                    doc_kind=row.doc_kind,
                    recall_source=row.recall_source,
                )
                for row in rows
            ]
    return rows


def search_hybrid(
    corpus_user_id: str,
    *,
    vector_query: str,
    sparse_query: str,
    top_k: int = 6,
    doc_kinds: list[str] | None = None,
    rrf_k: int = 60,
    rrf_weights: tuple[float, float] = (0.85, 1.2),
) -> list[HybridHit]:
    collection = corpus_collection_name(corpus_user_id)
    if not collection_exists(collection):
        return []
    sparse = text_to_sparse_vector(sparse_query)
    sparse_ok = bool(sparse.indices)
    dense: list[float] = []
    if vector_query.strip():
        try:
            dense = embed_query(vector_query)
        except httpx.HTTPError:
            dense = []
    dense_ok = bool(dense)
    if not dense_ok and not sparse_ok:
        return []
    query_filter = _filter(doc_kinds)
    prefetch_k = max(top_k * 2, top_k)
    url = f"{get_settings().resolved_qdrant_url}/collections/{collection}/points/query"
    if dense_ok and sparse_ok:
        prefetch = [
            {"query": dense, "using": DENSE_VECTOR_NAME, "limit": prefetch_k},
            {"query": sparse.as_query(), "using": SPARSE_VECTOR_NAME, "limit": prefetch_k},
        ]
        if query_filter:
            for item in prefetch:
                item["filter"] = query_filter
        body: dict = {
            "prefetch": prefetch,
            "query": {"rrf": {"k": rrf_k, "weights": list(rrf_weights)}},
            "limit": top_k,
            "with_payload": True,
        }
        source = "hybrid"
    elif dense_ok:
        body = {
            "query": dense,
            "using": DENSE_VECTOR_NAME,
            "limit": top_k,
            "with_payload": True,
        }
        source = "vector"
    else:
        body = {
            "query": sparse.as_query(),
            "using": SPARSE_VECTOR_NAME,
            "limit": top_k,
            "with_payload": True,
        }
        source = "sparse"
    if query_filter:
        body["filter"] = query_filter
    try:
        response = httpx.post(url, json=body, timeout=20)
        if response.status_code >= 400 and source == "hybrid":
            body["query"] = {"fusion": "rrf"}
            response = httpx.post(url, json=body, timeout=20)
        response.raise_for_status()
    except httpx.HTTPError:
        return []
    payload = response.json()
    result = payload.get("result") if isinstance(payload.get("result"), dict) else payload
    points = result.get("points") or []
    return _hits(points, source)
