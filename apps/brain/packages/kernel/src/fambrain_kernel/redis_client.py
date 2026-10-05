from __future__ import annotations

from redis.asyncio import Redis


async def ping_redis(url: str) -> bool:
    client = Redis.from_url(url)
    try:
        return bool(await client.ping())
    finally:
        await client.aclose()
