from __future__ import annotations

from fambrain_corpus.doc_kind import kinds_for_query
from fambrain_corpus.hybrid import search_hybrid
from fambrain_corpus.lexical import CorpusHit, search_lexical


def search_corpus(
    corpus_user_id: str,
    search_query: str,
    *,
    query_type: str = "default",
    topics: list[str] | None = None,
    limit: int = 6,
) -> list[CorpusHit]:
    """Qdrant dense+sparse RRF when the collection is online; otherwise scan markdown."""

    allowed = kinds_for_query(query_type, topics)
    doc_kinds = sorted(allowed) if allowed else None
    topic_text = " ".join(topics or [])
    try:
        hybrid_hits = search_hybrid(
            corpus_user_id,
            vector_query=" ".join(part for part in (search_query, topic_text) if part),
            sparse_query=search_query,
            top_k=limit,
            doc_kinds=doc_kinds,
        )
    except Exception:
        hybrid_hits = []
    if hybrid_hits:
        return [
            CorpusHit(path=hit.path, excerpt=hit.body.replace("\n", " ")[:500], score=hit.score or 1.0)
            for hit in hybrid_hits
        ]
    return search_lexical(
        corpus_user_id,
        search_query,
        query_type=query_type,
        topics=topics,
        limit=limit,
    )
