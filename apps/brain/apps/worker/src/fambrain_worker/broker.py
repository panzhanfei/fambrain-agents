from __future__ import annotations

from fambrain_kernel.config import get_settings
from taskiq import AsyncBroker, InMemoryBroker


def create_broker(redis_url: str) -> AsyncBroker:
    if redis_url.strip():
        from taskiq_redis import ListQueueBroker

        return ListQueueBroker(redis_url.strip())
    return InMemoryBroker()


broker = create_broker(get_settings().redis_url)
