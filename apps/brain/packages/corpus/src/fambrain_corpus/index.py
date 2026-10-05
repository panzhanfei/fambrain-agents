from __future__ import annotations

import httpx
from fambrain_kernel.config import get_settings

from fambrain_corpus.chunks import CorpusChunk, split_markdown
from fambrain_corpus.embed import embed_texts
from fambrain_corpus.paths import is_noise_path, repo_path, user_corpus_root
from fambrain_corpus.qdrant import (
    DENSE_VECTOR_NAME,
    DENSE_VECTOR_SIZE,
    SPARSE_VECTOR_NAME,
    corpus_collection_name,
    point_id_from_key,
)
from fambrain_corpus.sparse import text_to_sparse_vector


def load_chunks(corpus_user_id: str) -> list[CorpusChunk]:
    root = user_corpus_root(corpus_user_id)
    if not root.is_dir():
        return []
    chunks: list[CorpusChunk] = []
    for path in sorted(root.rglob("*.md")):
        relative = repo_path(path)
        if is_noise_path(relative) or path.name.startswith("_"):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        chunks.extend(split_markdown(corpus_user_id, relative, text, path.name))
    return chunks


def _ensure_collection(client: httpx.Client, collection: str) -> None:
    base = get_settings().resolved_qdrant_url
    client.delete(f"{base}/collections/{collection}")
    created = client.put(
        f"{base}/collections/{collection}",
        json={
            "vectors": {DENSE_VECTOR_NAME: {"size": DENSE_VECTOR_SIZE, "distance": "Cosine"}},
            "sparse_vectors": {SPARSE_VECTOR_NAME: {"modifier": "idf"}},
        },
    )
    created.raise_for_status()
    for field in ("path", "docKind"):
        client.put(
            f"{base}/collections/{collection}/index",
            json={"field_name": field, "field_schema": "keyword"},
        )


def index_user_corpus(corpus_user_id: str, *, batch_size: int = 16) -> dict:
    collection = corpus_collection_name(corpus_user_id)
    chunks = load_chunks(corpus_user_id)
    if not chunks:
        return {"corpusUserId": corpus_user_id, "collection": collection, "chunkCount": 0, "status": "accepted"}
    with httpx.Client(timeout=120) as client:
        _ensure_collection(client, collection)
        base = get_settings().resolved_qdrant_url
        for start in range(0, len(chunks), batch_size):
            batch = chunks[start : start + batch_size]
            vectors = embed_texts([chunk.body for chunk in batch])
            points = []
            for chunk, dense in zip(batch, vectors, strict=False):
                sparse = text_to_sparse_vector(chunk.path, chunk.title, chunk.body)
                points.append(
                    {
                        "id": point_id_from_key(f"{corpus_user_id}:{chunk.path}:{chunk.chunk_index}"),
                        "vector": {
                            DENSE_VECTOR_NAME: dense,
                            SPARSE_VECTOR_NAME: sparse.as_query(),
                        },
                        "payload": {
                            "path": chunk.path,
                            "title": chunk.title,
                            "body": chunk.body,
                            "corpusUserId": corpus_user_id,
                            "chunkIndex": chunk.chunk_index,
                            "docKind": chunk.doc_kind,
                        },
                    }
                )
            written = client.put(
                f"{base}/collections/{collection}/points",
                json={"points": points},
                params={"wait": "true"},
            )
            written.raise_for_status()
    return {
        "corpusUserId": corpus_user_id,
        "collection": collection,
        "chunkCount": len(chunks),
        "status": "indexed",
    }
