"""
URL Frontier backed by Redis.
- Priority queue via ZADD (score = depth, lower = higher priority)
- Deduplication via Redis SET with bloom filter fallback
- Per-domain politeness via TTL keys
- URL state tracking (queued / fetching / done / discarded)
"""
import hashlib
import time
from typing import Optional
import redis.asyncio as aioredis
from backend.config import settings


URL_QUEUED = "queued"
URL_FETCHING = "fetching"
URL_DONE = "done"
URL_DISCARDED = "discarded"


def _url_hash(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


class URLFrontier:
    def __init__(self, redis: aioredis.Redis, job_id: str):
        self.redis = redis
        self.job_id = job_id
        self._frontier_key = f"frontier:{job_id}"
        self._seen_key = f"seen:{job_id}"
        self._state_key = f"url_state:{job_id}"
        self._domain_key = f"domain_ts:{job_id}"
        self._stats_key = f"stats:{job_id}"

    async def add(self, url: str, depth: int, parent_url: Optional[str] = None) -> bool:
        """Add URL to frontier. Returns True if accepted, False if duplicate."""
        h = _url_hash(url)
        is_new = await self.redis.sadd(self._seen_key, h)
        if not is_new:
            return False

        score = depth * 1000 + time.time() % 1000
        pipe = self.redis.pipeline()
        pipe.zadd(self._frontier_key, {url: score})
        pipe.hset(self._state_key, url, URL_QUEUED)
        pipe.hincrby(self._stats_key, "queued", 1)
        await pipe.execute()
        return True

    async def add_many(self, urls: list[tuple[str, int, Optional[str]]]) -> int:
        """Batch add. Returns count of newly accepted URLs."""
        accepted = 0
        pipe = self.redis.pipeline()
        hashes = [_url_hash(u) for u, _, _ in urls]

        # Check which are new in one pipeline
        for h in hashes:
            pipe.sadd(self._seen_key, h)
        results = await pipe.execute()

        pipe = self.redis.pipeline()
        for (url, depth, _), is_new in zip(urls, results):
            if is_new:
                score = depth * 1000 + time.time() % 1000
                pipe.zadd(self._frontier_key, {url: score})
                pipe.hset(self._state_key, url, URL_QUEUED)
                accepted += 1

        if accepted:
            pipe.hincrby(self._stats_key, "queued", accepted)
            await pipe.execute()
        return accepted

    async def next_batch(self, count: int = 10) -> list[tuple[str, float]]:
        """Pop a batch of URLs from the frontier. Returns (url, score) pairs."""
        # Atomically pop lowest-score (= shallowest depth) URLs
        pipe = self.redis.pipeline()
        pipe.zpopmin(self._frontier_key, count)
        results = await pipe.execute()
        urls = results[0]  # list of (url, score)

        if urls:
            pipe = self.redis.pipeline()
            for url, _ in urls:
                pipe.hset(self._state_key, url, URL_FETCHING)
            await pipe.execute()

        return urls

    async def mark_done(self, url: str):
        pipe = self.redis.pipeline()
        pipe.hset(self._state_key, url, URL_DONE)
        pipe.hincrby(self._stats_key, "done", 1)
        await pipe.execute()

    async def mark_discarded(self, url: str):
        pipe = self.redis.pipeline()
        pipe.hset(self._state_key, url, URL_DISCARDED)
        pipe.hincrby(self._stats_key, "discarded", 1)
        await pipe.execute()

    async def mark_error(self, url: str):
        pipe = self.redis.pipeline()
        pipe.hset(self._state_key, url, "error")
        pipe.hincrby(self._stats_key, "error", 1)
        await pipe.execute()

    async def check_domain_politeness(self, domain: str) -> float:
        """Returns seconds to wait before crawling domain. 0 = crawl now."""
        key = f"{self._domain_key}:{domain}"
        ttl = await self.redis.pttl(key)
        if ttl <= 0:
            return 0.0
        return ttl / 1000.0

    async def touch_domain(self, domain: str, delay_ms: int = None):
        """Mark domain as recently crawled."""
        if delay_ms is None:
            delay_ms = int(settings.politeness_delay * 1000)
        key = f"{self._domain_key}:{domain}"
        await self.redis.set(key, "1", px=delay_ms)

    async def get_stats(self) -> dict:
        stats = await self.redis.hgetall(self._stats_key)
        depth = await self.redis.zcard(self._frontier_key)
        return {
            "queued_total": int(stats.get("queued", 0)),
            "done": int(stats.get("done", 0)),
            "discarded": int(stats.get("discarded", 0)),
            "error": int(stats.get("error", 0)),
            "frontier_depth": depth,
        }

    async def size(self) -> int:
        return await self.redis.zcard(self._frontier_key)

    async def is_empty(self) -> bool:
        return await self.size() == 0

    async def clear(self):
        pipe = self.redis.pipeline()
        pipe.delete(self._frontier_key)
        pipe.delete(self._seen_key)
        pipe.delete(self._state_key)
        pipe.delete(self._stats_key)
        await pipe.execute()
