from __future__ import annotations

import hashlib

import httpx
from fambrain_kernel.config import get_settings

DENSE_VECTOR_NAME = "dense"
SPARSE_VECTOR_NAME = "sparse"
DENSE_VECTOR_SIZE = 768
EMBEDDING_MODEL = "nomic-embed-text"


def corpus_collection_name(corpus_user_id: str) -> str:
    return f"fambrain_corpus_{corpus_user_id}"


def memory_collection_name() -> str:
    return get_settings().mem0_collection


def point_id_from_key(key: str) -> str:
    hex_id = hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]
    return f"{hex_id[:8]}-{hex_id[8:12]}-{hex_id[12:16]}-{hex_id[16:20]}-{hex_id[20:32]}"


def qdrant_ready(timeout: float = 2.0) -> bool:
    try:
        response = httpx.get(f"{get_settings().resolved_qdrant_url}/readyz", timeout=timeout)
    except httpx.HTTPError:
        return False
    return response.status_code == 200


def collection_exists(name: str, timeout: float = 2.0) -> bool:
    try:
        response = httpx.get(
            f"{get_settings().resolved_qdrant_url}/collections/{name}",
            timeout=timeout,
        )
    except httpx.HTTPError:
        return False
    return response.status_code == 200
