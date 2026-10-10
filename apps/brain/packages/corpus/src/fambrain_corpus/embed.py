from __future__ import annotations

import httpx
from fambrain_kernel.config import get_settings

from fambrain_corpus.qdrant import DENSE_VECTOR_SIZE, EMBEDDING_MODEL


def _model() -> str:
    configured = get_settings().ollama_embed_model.strip()
    return configured or EMBEDDING_MODEL


def embed_texts(texts: list[str], *, timeout: float = 60) -> list[list[float]]:
    if not texts:
        return []
    settings = get_settings()
    response = httpx.post(
        f"{settings.resolved_ollama_base_url}/api/embed",
        json={"model": _model(), "input": texts},
        timeout=timeout,
    )
    response.raise_for_status()
    vectors = response.json().get("embeddings") or []
    embedded = [list(vector) for vector in vectors]
    model = _model()
    for vector in embedded:
        if len(vector) != DENSE_VECTOR_SIZE:
            raise RuntimeError(
                f"模型 {model} 返回 {len(vector)} 维，集合需要 {DENSE_VECTOR_SIZE} 维"
            )
    return embedded


def embed_query(text: str, *, timeout: float = 120) -> list[float]:
    vectors = embed_texts([text], timeout=timeout)
    return vectors[0] if vectors else []
