from __future__ import annotations

import httpx
from fambrain_corpus.embed import embed_query
from fambrain_corpus.qdrant import (
    DENSE_VECTOR_NAME,
    DENSE_VECTOR_SIZE,
    collection_exists,
    memory_collection_name,
    point_id_from_key,
)
from fambrain_kernel.config import get_settings


def _dense_size(client: httpx.Client, collection: str) -> int | None:
    response = client.get(f"{get_settings().resolved_qdrant_url}/collections/{collection}")
    if response.status_code != 200:
        return None
    vectors = response.json().get("result", {}).get("config", {}).get("params", {}).get("vectors")
    if not isinstance(vectors, dict):
        return None
    if "size" in vectors:
        return int(vectors["size"])
    named = vectors.get(DENSE_VECTOR_NAME)
    if isinstance(named, dict) and "size" in named:
        return int(named["size"])
    return None


def reset_memory_collection() -> None:
    collection = memory_collection_name()
    httpx.delete(
        f"{get_settings().resolved_qdrant_url}/collections/{collection}",
        timeout=30,
    )


def _ensure(client: httpx.Client, collection: str) -> None:
    size = _dense_size(client, collection) if collection_exists(collection) else None
    if size == DENSE_VECTOR_SIZE:
        return
    base = get_settings().resolved_qdrant_url
    if size is not None:
        client.delete(f"{base}/collections/{collection}")
    created = client.put(
        f"{base}/collections/{collection}",
        json={"vectors": {DENSE_VECTOR_NAME: {"size": DENSE_VECTOR_SIZE, "distance": "Cosine"}}},
    )
    created.raise_for_status()
    client.put(
        f"{base}/collections/{collection}/index",
        json={"field_name": "userId", "field_schema": "keyword"},
    )


def add_user_memory(user_id: str, text: str, metadata: dict | None = None) -> None:
    settings = get_settings()
    trimmed = text.strip()
    if not trimmed or not settings.mem0_on:
        return
    vector = embed_query(trimmed)
    if not vector:
        return
    collection = memory_collection_name()
    with httpx.Client(timeout=30) as client:
        _ensure(client, collection)
        point = {
            "id": point_id_from_key(f"{user_id}:{trimmed}"),
            "vector": {DENSE_VECTOR_NAME: vector},
            "payload": {
                "userId": user_id,
                "memory": trimmed,
                "source": "explicit_remember",
                **(metadata or {}),
            },
        }
        written = client.put(
            f"{settings.resolved_qdrant_url}/collections/{collection}/points",
            json={"points": [point]},
            params={"wait": "true"},
        )
        written.raise_for_status()


def search_user_memories(user_id: str, query: str, *, limit: int = 5) -> list[str]:
    settings = get_settings()
    if not settings.mem0_on or not query.strip():
        return []
    collection = memory_collection_name()
    if not collection_exists(collection):
        return []
    try:
        vector = embed_query(query)
    except httpx.HTTPError:
        return []
    if not vector:
        return []
    response = httpx.post(
        f"{settings.resolved_qdrant_url}/collections/{collection}/points/query",
        json={
            "query": vector,
            "using": DENSE_VECTOR_NAME,
            "limit": limit,
            "with_payload": True,
            "filter": {"must": [{"key": "userId", "match": {"value": user_id}}]},
        },
        timeout=20,
    )
    if response.status_code >= 400:
        return []
    payload = response.json()
    result = payload.get("result") if isinstance(payload.get("result"), dict) else payload
    points = result.get("points") or []
    texts: list[str] = []
    for point in points:
        memory = (point.get("payload") or {}).get("memory")
        if isinstance(memory, str) and memory.strip():
            texts.append(memory.strip())
    return texts
