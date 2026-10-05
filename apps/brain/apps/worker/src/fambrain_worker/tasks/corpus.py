from __future__ import annotations

from fambrain_corpus import corpus_collection_name, index_user_corpus

from fambrain_worker.broker import broker


async def index_corpus_job(corpus_user_id: str) -> dict:
    """Rebuild fambrain_corpus_<userId> from that user's markdown."""

    try:
        return index_user_corpus(corpus_user_id)
    except Exception as exc:
        return {
            "corpusUserId": corpus_user_id,
            "collection": corpus_collection_name(corpus_user_id),
            "status": "accepted",
            "error": str(exc),
        }


broker.register_task(index_corpus_job, task_name="index_corpus")
