"""
WebSocket hub. Each browser connection gets a ConnectionManager slot.
The event tailer goroutine reads from Redis Streams and fans out to all
connected clients, optionally filtered by job_id.
"""
import asyncio
import json
import logging
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect
import redis.asyncio as aioredis

from backend.config import settings
from backend.models.events import CrawlEvent, EventType

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        # job_id → set of websockets (None = all jobs)
        self._connections: dict[Optional[str], set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, job_id: Optional[str] = None):
        await ws.accept()
        async with self._lock:
            key = job_id
            if key not in self._connections:
                self._connections[key] = set()
            self._connections[key].add(ws)
        logger.info(f"WS connected job={job_id} total={self.count()}")

    async def disconnect(self, ws: WebSocket, job_id: Optional[str] = None):
        async with self._lock:
            s = self._connections.get(job_id, set())
            s.discard(ws)

    async def broadcast(self, event: CrawlEvent):
        """Fan out event to all relevant connections."""
        payload = event.model_dump_json()
        dead = []

        async with self._lock:
            # Send to subscribers of this specific job
            for key in (event.job_id, None):
                for ws in list(self._connections.get(key, [])):
                    try:
                        await ws.send_text(payload)
                    except Exception:
                        dead.append((key, ws))

        # Clean up dead connections
        for key, ws in dead:
            async with self._lock:
                self._connections.get(key, set()).discard(ws)

    def count(self) -> int:
        return sum(len(v) for v in self._connections.values())


manager = ConnectionManager()


async def event_tailer(redis_url: str):
    """Background task that tails Redis Stream and broadcasts to WS clients."""
    r = aioredis.from_url(redis_url, decode_responses=True)
    last_id = "$"

    while True:
        try:
            messages = await r.xread(
                {settings.redis_stream_key: last_id},
                block=500,
                count=100,
            )
            if messages:
                for _, entries in messages:
                    for msg_id, data in entries:
                        last_id = msg_id
                        try:
                            parsed = {k: _try_parse(v) for k, v in data.items()}
                            event = CrawlEvent.model_validate(parsed)
                            if manager.count() > 0:
                                await manager.broadcast(event)
                        except Exception as e:
                            logger.debug(f"Event parse error: {e}")
        except Exception as e:
            logger.warning(f"Tailer error: {e}")
            await asyncio.sleep(1)


def _try_parse(v: str):
    try:
        return json.loads(v)
    except (json.JSONDecodeError, TypeError):
        return v
