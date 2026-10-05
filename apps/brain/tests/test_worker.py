from fambrain_agentflow.corpus.qdrant import corpus_collection_name
from fambrain_worker.broker import create_broker
from fambrain_worker.tasks.corpus import index_corpus_job
from taskiq import InMemoryBroker


def test_empty_redis_uses_memory_broker():
    broker = create_broker("")
    assert isinstance(broker, InMemoryBroker)


async def test_index_job_names_collection():
    result = await index_corpus_job("abc")
    assert result["status"] == "accepted"
    assert result["collection"] == corpus_collection_name("abc")
