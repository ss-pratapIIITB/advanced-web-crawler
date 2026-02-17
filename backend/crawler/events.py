"""
Redis Stream-based event bus.
Every state transition in the crawler emits an event here.
The API server tails this stream and broadcasts to WebSocket clients.
"""
import json
from datetime import datetime
from typing import AsyncIterator
import redis.asyncio as aioredis
from backend.config import settings
from backend.models.events import CrawlEvent, EventType


class EventBus:
    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client
        self.stream = settings.redis_stream_key

    async def emit(self, event: CrawlEvent) -> str:
        payload = event.model_dump(mode="json")
        # Flatten for Redis stream (all values must be strings)
        flat = {k: json.dumps(v) if not isinstance(v, str) else v
                for k, v in payload.items() if v is not None}
        msg_id = await self.redis.xadd(self.stream, flat, maxlen=50_000, approximate=True)
        return msg_id

    async def tail(
        self,
        last_id: str = "$",
        block_ms: int = 500,
        count: int = 100,
    ) -> AsyncIterator[CrawlEvent]:
        """Async generator that yields new events as they arrive."""
        current_id = last_id
        while True:
            messages = await self.redis.xread(
                {self.stream: current_id},
                block=block_ms,
                count=count,
            )
            if messages:
                for _, entries in messages:
                    for msg_id, data in entries:
                        current_id = msg_id
                        try:
                            parsed = {k: _try_parse(v) for k, v in data.items()}
                            yield CrawlEvent.model_validate(parsed)
                        except Exception:
                            pass

    async def read_history(
        self,
        job_id: str,
        start: str = "0",
        count: int = 500,
    ) -> list[CrawlEvent]:
        """Read historical events for a job (for dashboard on connect)."""
        events = []
        messages = await self.redis.xrange(self.stream, start, "+", count=count)
        for _, data in messages:
            try:
                parsed = {k: _try_parse(v) for k, v in data.items()}
                ev = CrawlEvent.model_validate(parsed)
                if ev.job_id == job_id:
                    events.append(ev)
            except Exception:
                pass
        return events


def _try_parse(v: str):
    try:
        return json.loads(v)
    except (json.JSONDecodeError, TypeError):
        return v


_bus: EventBus | None = None


def get_event_bus(redis_client: aioredis.Redis) -> EventBus:
    return EventBus(redis_client)
