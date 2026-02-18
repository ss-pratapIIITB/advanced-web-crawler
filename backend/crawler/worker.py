"""
Celery worker tasks.
Each worker processes URLs from the Redis frontier, emits events at every step,
and stores results to the database. Multiple workers can run on separate machines.

Queue architecture
------------------
URLs are routed to domain-sharded queues: crawl.0 … crawl.{N-1}
  domain → shard = md5(domain) % NUM_DOMAIN_QUEUES

This means:
  • Different domains process fully in parallel (no I/O head-of-line blocking)
  • Same domain always hits the same shard → politeness delay works correctly
  • Scale horizontally by adding workers assigned to any subset of shards
"""
import asyncio
import hashlib
import json
import os
import socket
import time
from datetime import datetime
from typing import Optional

import redis
from celery import Celery
from celery.signals import worker_ready, worker_shutdown
from celery.utils.log import get_task_logger

from backend.config import settings
from backend.models.events import (
    CrawlEvent, EventType, URLStatus, DiscardReason, WorkerState
)
from backend.crawler.filters import URLFilter, ContentFilter, normalize_url
from backend.crawler.parser import parse_html

logger = get_task_logger(__name__)

# ── Domain-sharded queue routing ───────────────────────────────────────────────

def get_domain_queue(url: str) -> str:
    """Return the domain-sharded queue name for a URL."""
    domain = _get_domain(url)
    shard = int(hashlib.md5(domain.encode()).hexdigest(), 16) % settings.num_domain_queues
    return f"crawl.{shard}"

def get_queue_shard(url: str) -> int:
    domain = _get_domain(url)
    return int(hashlib.md5(domain.encode()).hexdigest(), 16) % settings.num_domain_queues

# All domain shard queue names (workers subscribe to all of them by default)
ALL_CRAWL_QUEUES = [f"crawl.{i}" for i in range(settings.num_domain_queues)]

app = Celery("crawler")
app.config_from_object({
    "broker_url": settings.celery_broker_url,
    "result_backend": settings.celery_result_backend,
    "task_serializer": "json",
    "accept_content": ["json"],
    "result_serializer": "json",
    "timezone": "UTC",
    "worker_prefetch_multiplier": settings.worker_prefetch_multiplier,
    "task_acks_late": True,
    "task_reject_on_worker_lost": True,
    "worker_max_tasks_per_child": 500,
    # Declare all domain shard queues
    "task_queues": {q: {"exchange": q, "routing_key": q} for q in ALL_CRAWL_QUEUES},
})

# Sync Redis client for workers (Celery is sync)
_redis: Optional[redis.Redis] = None
_worker_id: Optional[str] = None


def get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def get_worker_id() -> str:
    global _worker_id
    if _worker_id is None:
        _worker_id = f"{socket.gethostname()}-{os.getpid()}"
    return _worker_id


def emit_sync(event: CrawlEvent):
    r = get_redis()
    payload = event.model_dump(mode="json")
    flat = {k: json.dumps(v) if not isinstance(v, str) else v
            for k, v in payload.items() if v is not None}
    r.xadd(settings.redis_stream_key, flat, maxlen=50_000, approximate=True)


def update_worker_state(state: dict):
    r = get_redis()
    wid = get_worker_id()
    r.hset(settings.redis_workers_key, wid, json.dumps(state))
    r.expire(settings.redis_workers_key, 30)  # auto-expire if worker dies


@worker_ready.connect
def on_worker_ready(**kwargs):
    wid = get_worker_id()
    state = {
        "worker_id": wid,
        "hostname": socket.gethostname(),
        "pid": os.getpid(),
        "status": "idle",
        "urls_processed": 0,
        "errors": 0,
        "bytes_downloaded": 0,
        "started_at": datetime.utcnow().isoformat(),
        "last_heartbeat": datetime.utcnow().isoformat(),
    }
    update_worker_state(state)
    # We can't emit to a specific job here, use a sentinel job_id
    emit_sync(CrawlEvent(
        event_type=EventType.WORKER_ONLINE,
        job_id="__system__",
        worker_id=wid,
        worker_state=WorkerState(**state),
    ))


@worker_shutdown.connect
def on_worker_shutdown(**kwargs):
    wid = get_worker_id()
    r = get_redis()
    r.hdel(settings.redis_workers_key, wid)
    emit_sync(CrawlEvent(
        event_type=EventType.WORKER_OFFLINE,
        job_id="__system__",
        worker_id=wid,
    ))


@app.task(bind=True, name="crawler.process_url", max_retries=settings.max_retries)
def process_url(
    self,
    job_id: str,
    url: str,
    depth: int,
    parent_url: Optional[str],
    job_config: dict,
):
    """
    Main crawl task. Processes a single URL through the full pipeline:
    fetch → filter content → parse → extract links → store → queue new URLs

    Each URL is routed to a domain-sharded queue (crawl.N) so that slow I/O
    on one domain never blocks work on a different domain.
    """
    wid = get_worker_id()
    r = get_redis()
    domain = _get_domain(url)
    shard = get_queue_shard(url)

    # --- Worker heartbeat ---
    state_json = r.hget(settings.redis_workers_key, wid)
    worker_state = json.loads(state_json) if state_json else {}
    worker_state.update({
        "status": "busy",
        "current_url": url,
        "current_job_id": job_id,
        "last_heartbeat": datetime.utcnow().isoformat(),
    })
    update_worker_state(worker_state)

    # Track domain as active
    r.hset(f"domain_active:{job_id}", domain, wid)

    # Emit: fetching started
    emit_sync(CrawlEvent(
        event_type=EventType.URL_FETCHING,
        job_id=job_id,
        url=url,
        parent_url=parent_url,
        depth=depth,
        status=URLStatus.FETCHING,
        worker_id=wid,
        domain=domain,
        queue_shard=shard,
    ))

    # --- Robots.txt check ---
    if job_config.get("respect_robots", True):
        allowed = _check_robots(url, r, job_id)
        if not allowed:
            _discard(url, depth, parent_url, job_id, wid,
                     DiscardReason.ROBOTS_TXT, "Blocked by robots.txt", r,
                     domain=domain, shard=shard)
            _idle_worker(wid, worker_state, r, domain, job_id)
            return

    # --- Domain politeness ---
    domain_key = f"domain_ts:{job_id}:{_get_domain(url)}"
    ttl = r.pttl(domain_key)
    if ttl > 0:
        time.sleep(ttl / 1000.0)

    # --- Fetch ---
    start = time.monotonic()
    try:
        result = asyncio.run(_async_fetch(url, job_config.get("use_playwright", False)))
    except Exception as e:
        logger.error(f"Fetch error {url}: {e}")
        _discard(url, depth, parent_url, job_id, wid,
                 DiscardReason.CONNECTION_ERROR, str(e), r,
                 domain=domain, shard=shard)
        _idle_worker(wid, worker_state, r, domain, job_id)
        return

    fetch_ms = (time.monotonic() - start) * 1000

    # Touch domain politeness
    delay_ms = int(job_config.get("politeness_delay", settings.politeness_delay) * 1000)
    r.set(domain_key, "1", px=delay_ms)

    # --- HTTP error check ---
    if result.discard_reason:
        _discard(url, depth, parent_url, job_id, wid,
                 result.discard_reason, result.error or "", r,
                 domain=domain, shard=shard)
        _idle_worker(wid, worker_state, r, domain, job_id)
        return

    if result.status_code >= 400:
        _discard(url, depth, parent_url, job_id, wid,
                 DiscardReason.HTTP_ERROR, f"HTTP {result.status_code}", r,
                 domain=domain, shard=shard)
        _idle_worker(wid, worker_state, r, domain, job_id)
        return

    # --- Content type filter ---
    content_filter = ContentFilter(
        allowed_content_types=job_config.get("allowed_content_types",
                                              settings.allowed_content_types),
        max_content_size=job_config.get("max_content_size", settings.max_content_size),
    )
    ok, reason, detail = content_filter.check_headers(
        result.content_type, len(result.content) if result.content else 0
    )
    if not ok:
        _discard(url, depth, parent_url, job_id, wid, reason, detail, r,
                 domain=domain, shard=shard)
        _idle_worker(wid, worker_state, r, domain, job_id)
        return

    # Emit: fetched
    emit_sync(CrawlEvent(
        event_type=EventType.URL_FETCHED,
        job_id=job_id,
        url=url,
        parent_url=parent_url,
        depth=depth,
        status_code=result.status_code,
        content_type=result.content_type,
        content_length=len(result.content) if result.content else 0,
        fetch_duration_ms=fetch_ms,
        worker_id=wid,
        status=URLStatus.FETCHED,
        domain=domain,
        queue_shard=shard,
    ))

    # --- Parse ---
    emit_sync(CrawlEvent(
        event_type=EventType.URL_PARSING,
        job_id=job_id,
        url=url,
        depth=depth,
        worker_id=wid,
        status=URLStatus.PARSING,
        domain=domain,
        queue_shard=shard,
    ))

    try:
        parse_result = parse_html(result.final_url, result.content)
    except Exception as e:
        _discard(url, depth, parent_url, job_id, wid,
                 DiscardReason.PARSE_ERROR, str(e), r,
                 domain=domain, shard=shard)
        _idle_worker(wid, worker_state, r, domain, job_id)
        return

    # --- Store page ---
    _store_page(
        job_id=job_id,
        url=url,
        parent_url=parent_url,
        depth=depth,
        status_code=result.status_code,
        content_type=result.content_type,
        content_length=len(result.content) if result.content else 0,
        title=parse_result.title,
        fetch_ms=fetch_ms,
        links_found=len(parse_result.links),
        is_js=result.is_js_rendered,
        r=r,
    )

    # --- Discover new URLs ---
    url_filter = URLFilter(
        allowed_domains=job_config.get("allowed_domains"),
        url_pattern=job_config.get("url_pattern"),
        max_depth=job_config.get("max_depth", settings.max_depth),
    )

    new_depth = depth + 1
    accepted_count = 0
    frontier_key = f"frontier:{job_id}"
    seen_key = f"seen:{job_id}"

    pipe = r.pipeline()
    for href, anchor in parse_result.links:
        abs_url = normalize_url(href, result.final_url)
        if not abs_url:
            continue

        ok_url, reason, detail = url_filter.check(abs_url, new_depth, result.final_url)
        if not ok_url:
            # Emit discard for discovered-but-filtered links
            emit_sync(CrawlEvent(
                event_type=EventType.URL_DISCARDED,
                job_id=job_id,
                url=abs_url,
                parent_url=url,
                depth=new_depth,
                discard_reason=reason,
                discard_detail=detail,
                worker_id=wid,
                status=URLStatus.DISCARDED,
            ))
            continue

        # Check max pages
        done_count = int(r.hget(f"stats:{job_id}", "done") or 0)
        if done_count >= job_config.get("max_pages", settings.max_pages):
            break

        # Dedup
        url_hash = _hash_url(abs_url)
        is_new = r.sadd(seen_key, url_hash)
        child_domain = _get_domain(abs_url)
        child_shard = get_queue_shard(abs_url)

        if not is_new:
            emit_sync(CrawlEvent(
                event_type=EventType.URL_DISCARDED,
                job_id=job_id,
                url=abs_url,
                parent_url=url,
                depth=new_depth,
                discard_reason=DiscardReason.DUPLICATE,
                discard_detail="Already seen",
                worker_id=wid,
                status=URLStatus.DISCARDED,
                domain=child_domain,
                queue_shard=child_shard,
            ))
            continue

        # Queue to domain-sharded queue
        score = new_depth * 1000 + time.time() % 1000
        r.zadd(frontier_key, {abs_url: score})
        r.hincrby(f"stats:{job_id}", "queued", 1)
        r.hincrby(f"domain_stats:{job_id}", f"{child_domain}:queued", 1)
        accepted_count += 1

        target_queue = get_domain_queue(abs_url)

        emit_sync(CrawlEvent(
            event_type=EventType.URL_QUEUED,
            job_id=job_id,
            url=abs_url,
            parent_url=url,
            depth=new_depth,
            worker_id=wid,
            status=URLStatus.QUEUED,
            source_url=url,
            target_url=abs_url,
            domain=child_domain,
            queue_shard=child_shard,
        ))

        # Route to domain-sharded queue — parallel I/O across domains
        process_url.apply_async(
            args=[job_id, abs_url, new_depth, url, job_config],
            queue=target_queue,
            priority=new_depth,
        )

    # Mark done
    r.hset(f"url_state:{job_id}", url, "done")
    r.hincrby(f"stats:{job_id}", "done", 1)
    # Per-domain done + latency
    r.hincrby(f"domain_stats:{job_id}", f"{domain}:done", 1)
    r.hincrby(f"domain_stats:{job_id}", f"{domain}:latency_sum", int(fetch_ms))
    r.hincrby(f"domain_stats:{job_id}", f"{domain}:latency_count", 1)

    emit_sync(CrawlEvent(
        event_type=EventType.URL_STORED,
        job_id=job_id,
        url=url,
        parent_url=parent_url,
        depth=depth,
        links_found=len(parse_result.links),
        worker_id=wid,
        status=URLStatus.DONE,
        domain=domain,
        queue_shard=shard,
    ))

    # Update worker stats
    worker_state["urls_processed"] = worker_state.get("urls_processed", 0) + 1
    worker_state["bytes_downloaded"] = (
        worker_state.get("bytes_downloaded", 0) + (len(result.content) if result.content else 0)
    )
    _idle_worker(wid, worker_state, r, domain, job_id)


# ── Heartbeat task ─────────────────────────────────────────────────────────────

@app.task(name="crawler.heartbeat")
def worker_heartbeat():
    wid = get_worker_id()
    r = get_redis()
    state_json = r.hget(settings.redis_workers_key, wid)
    if state_json:
        state = json.loads(state_json)
        state["last_heartbeat"] = datetime.utcnow().isoformat()
        update_worker_state(state)
        emit_sync(CrawlEvent(
            event_type=EventType.WORKER_HEARTBEAT,
            job_id="__system__",
            worker_id=wid,
            worker_state=WorkerState(**state),
        ))


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _async_fetch(url: str, use_playwright: bool = False):
    from backend.crawler.fetcher import Fetcher
    async with Fetcher() as fetcher:
        return await fetcher.fetch(url, use_playwright=use_playwright)


def _discard(url, depth, parent_url, job_id, wid, reason, detail, r,
             domain=None, shard=None):
    emit_sync(CrawlEvent(
        event_type=EventType.URL_DISCARDED,
        job_id=job_id,
        url=url,
        parent_url=parent_url,
        depth=depth,
        discard_reason=reason,
        discard_detail=detail,
        worker_id=wid,
        status=URLStatus.DISCARDED,
        domain=domain,
        queue_shard=shard,
    ))
    r.hset(f"url_state:{job_id}", url, "discarded")
    r.hincrby(f"stats:{job_id}", "discarded", 1)


def _idle_worker(wid, state, r, domain=None, job_id=None):
    state.update({
        "status": "idle",
        "current_url": None,
        "last_heartbeat": datetime.utcnow().isoformat(),
    })
    update_worker_state(state)
    # Mark domain as no longer active under this worker
    if domain and job_id:
        r.hdel(f"domain_active:{job_id}", domain)


def _store_page(job_id, url, parent_url, depth, status_code, content_type,
                content_length, title, fetch_ms, links_found, is_js, r):
    import sqlite3
    # Fast sync insert via sqlite3 directly (avoids asyncio in Celery context)
    # In production, use PostgreSQL with a sync driver
    try:
        db_url = settings.database_url.replace("sqlite+aiosqlite:///", "")
        conn = sqlite3.connect(db_url)
        conn.execute("""
            INSERT OR IGNORE INTO crawled_pages
            (id, job_id, url, parent_url, depth, status_code, content_type,
             content_length, title, fetch_duration_ms, links_found, is_js_rendered, fetched_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
        """, (
            _uuid(), job_id, url, parent_url, depth, status_code, content_type,
            content_length, title, fetch_ms, links_found, 1 if is_js else 0
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"DB store error: {e}")


def _check_robots(url: str, r: redis.Redis, job_id: str) -> bool:
    """Simple robots.txt check with Redis caching."""
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        cache_key = f"robots:{parsed.netloc}"

        cached = r.get(cache_key)
        if cached is None:
            import urllib.request
            try:
                with urllib.request.urlopen(robots_url, timeout=5) as resp:
                    content = resp.read().decode("utf-8", errors="replace")
            except Exception:
                content = ""
            r.setex(cache_key, 3600, content)
        else:
            content = cached

        if not content:
            return True

        # Parse robots.txt for disallowed paths
        ua = "*"
        disallowed = []
        current_agent = None
        for line in content.splitlines():
            line = line.strip()
            if line.lower().startswith("user-agent:"):
                current_agent = line.split(":", 1)[1].strip()
            elif line.lower().startswith("disallow:") and current_agent in ("*", "Crawlerbot"):
                path = line.split(":", 1)[1].strip()
                if path:
                    disallowed.append(path)

        path = urlparse(url).path
        for d in disallowed:
            if path.startswith(d):
                return False
        return True
    except Exception:
        return True


def _get_domain(url: str) -> str:
    from urllib.parse import urlparse
    return urlparse(url).netloc


def _hash_url(url: str) -> str:
    import hashlib
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def _uuid() -> str:
    import uuid
    return str(uuid.uuid4())


# Periodic heartbeat beat schedule
app.conf.beat_schedule = {
    "worker-heartbeat": {
        "task": "crawler.heartbeat",
        "schedule": 5.0,
    },
}
