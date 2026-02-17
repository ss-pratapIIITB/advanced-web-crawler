"""
REST API routes for job management, metrics, and data retrieval.
"""
import json
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, HttpUrl
import redis.asyncio as aioredis
from sqlalchemy import select, func

from backend.config import settings
from backend.models.crawl import CrawlJob, CrawledPage, DiscardedURL
from backend.models.events import CrawlEvent, EventType, URLStatus
from backend.storage.database import get_session
from backend.crawler.worker import process_url

router = APIRouter()


# ── Request/Response models ───────────────────────────────────────────────────

class CreateJobRequest(BaseModel):
    name: str
    seed_urls: list[str]
    max_depth: int = 3
    max_pages: int = 10_000
    allowed_domains: Optional[list[str]] = None
    url_pattern: Optional[str] = None
    politeness_delay: float = 1.0
    respect_robots: bool = True
    use_playwright: bool = False
    allowed_content_types: Optional[list[str]] = None


class JobResponse(BaseModel):
    id: str
    name: str
    status: str
    seed_urls: list[str]
    max_depth: int
    max_pages: int
    urls_queued: int
    urls_fetched: int
    urls_discarded: int
    urls_error: int
    bytes_downloaded: int
    pages_per_second: float
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


# ── Job endpoints ──────────────────────────────────────────────────────────────

@router.post("/jobs", response_model=JobResponse, status_code=201)
async def create_job(req: CreateJobRequest):
    import uuid
    job_id = str(uuid.uuid4())

    async with get_session() as session:
        job = CrawlJob(
            id=job_id,
            name=req.name,
            seed_urls=json.dumps(req.seed_urls),
            max_depth=req.max_depth,
            max_pages=req.max_pages,
            allowed_domains=json.dumps(req.allowed_domains) if req.allowed_domains else None,
            url_pattern=req.url_pattern,
            config=json.dumps(req.model_dump()),
            status="created",
        )
        session.add(job)

    return JobResponse(
        id=job_id, name=req.name, status="created",
        seed_urls=req.seed_urls, max_depth=req.max_depth,
        max_pages=req.max_pages, urls_queued=0, urls_fetched=0,
        urls_discarded=0, urls_error=0, bytes_downloaded=0,
        pages_per_second=0.0, created_at=datetime.utcnow(),
        started_at=None, completed_at=None,
    )


@router.post("/jobs/{job_id}/start")
async def start_job(job_id: str):
    async with get_session() as session:
        result = await session.execute(select(CrawlJob).where(CrawlJob.id == job_id))
        job = result.scalar_one_or_none()
        if not job:
            raise HTTPException(404, "Job not found")
        if job.status not in ("created", "paused"):
            raise HTTPException(400, f"Cannot start job in status: {job.status}")

        job.status = "running"
        job.started_at = datetime.utcnow()

        seed_urls = json.loads(job.seed_urls)
        config = json.loads(job.config) if job.config else {}
        config.update({
            "max_depth": job.max_depth,
            "max_pages": job.max_pages,
            "allowed_domains": json.loads(job.allowed_domains) if job.allowed_domains else None,
            "url_pattern": job.url_pattern,
        })

    # Seed the frontier via Redis + dispatch Celery tasks
    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    import hashlib, time
    for url in seed_urls:
        url_hash = hashlib.sha256(url.encode()).hexdigest()[:16]
        await r.sadd(f"seen:{job_id}", url_hash)
        score = 0 * 1000 + time.time() % 1000
        await r.zadd(f"frontier:{job_id}", {url: score})
        await r.hincrby(f"stats:{job_id}", "queued", 1)

        # Emit queued event
        from backend.crawler.events import EventBus
        bus = EventBus(r)
        await bus.emit(CrawlEvent(
            event_type=EventType.JOB_STARTED,
            job_id=job_id,
        ))
        await bus.emit(CrawlEvent(
            event_type=EventType.URL_QUEUED,
            job_id=job_id,
            url=url,
            depth=0,
            status=URLStatus.QUEUED,
        ))

        # Dispatch worker task
        process_url.apply_async(
            args=[job_id, url, 0, None, config],
            queue="crawl",
        )

    await r.aclose()
    return {"status": "started", "job_id": job_id, "seeds": len(seed_urls)}


@router.post("/jobs/{job_id}/pause")
async def pause_job(job_id: str):
    async with get_session() as session:
        result = await session.execute(select(CrawlJob).where(CrawlJob.id == job_id))
        job = result.scalar_one_or_none()
        if not job:
            raise HTTPException(404, "Job not found")
        job.status = "paused"
    return {"status": "paused"}


@router.post("/jobs/{job_id}/stop")
async def stop_job(job_id: str):
    async with get_session() as session:
        result = await session.execute(select(CrawlJob).where(CrawlJob.id == job_id))
        job = result.scalar_one_or_none()
        if not job:
            raise HTTPException(404, "Job not found")
        job.status = "stopped"
        job.completed_at = datetime.utcnow()

    # Clear frontier
    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    await r.delete(f"frontier:{job_id}")
    await r.aclose()
    return {"status": "stopped"}


@router.get("/jobs", response_model=list[JobResponse])
async def list_jobs():
    async with get_session() as session:
        result = await session.execute(select(CrawlJob).order_by(CrawlJob.created_at.desc()))
        jobs = result.scalars().all()

    return [_job_to_response(j) for j in jobs]


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    async with get_session() as session:
        result = await session.execute(select(CrawlJob).where(CrawlJob.id == job_id))
        job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Job not found")

    # Enrich with live Redis stats
    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    stats = await r.hgetall(f"stats:{job_id}")
    await r.aclose()

    resp = _job_to_response(job)
    if stats:
        resp.urls_queued = int(stats.get("queued", resp.urls_queued))
        resp.urls_fetched = int(stats.get("done", resp.urls_fetched))
        resp.urls_discarded = int(stats.get("discarded", resp.urls_discarded))
    return resp


@router.get("/jobs/{job_id}/pages")
async def get_pages(
    job_id: str,
    limit: int = Query(50, le=500),
    offset: int = 0,
):
    async with get_session() as session:
        result = await session.execute(
            select(CrawledPage)
            .where(CrawledPage.job_id == job_id)
            .order_by(CrawledPage.fetched_at.desc())
            .limit(limit)
            .offset(offset)
        )
        pages = result.scalars().all()
    return [
        {
            "url": p.url, "parent_url": p.parent_url, "depth": p.depth,
            "status_code": p.status_code, "title": p.title,
            "content_type": p.content_type, "links_found": p.links_found,
            "fetch_duration_ms": p.fetch_duration_ms, "fetched_at": p.fetched_at,
        }
        for p in pages
    ]


@router.get("/jobs/{job_id}/discards")
async def get_discards(
    job_id: str,
    limit: int = Query(100, le=1000),
    reason: Optional[str] = None,
):
    async with get_session() as session:
        q = select(DiscardedURL).where(DiscardedURL.job_id == job_id)
        if reason:
            q = q.where(DiscardedURL.reason == reason)
        q = q.order_by(DiscardedURL.discarded_at.desc()).limit(limit)
        result = await session.execute(q)
        discards = result.scalars().all()
    return [
        {
            "url": d.url, "parent_url": d.parent_url, "depth": d.depth,
            "reason": d.reason, "detail": d.detail, "discarded_at": d.discarded_at,
        }
        for d in discards
    ]


@router.get("/jobs/{job_id}/graph")
async def get_graph(job_id: str, limit: int = Query(500, le=2000)):
    """Return URL graph as nodes + edges for visualization."""
    async with get_session() as session:
        result = await session.execute(
            select(CrawledPage)
            .where(CrawledPage.job_id == job_id)
            .limit(limit)
        )
        pages = result.scalars().all()

    nodes = []
    edges = []
    seen_nodes = set()

    for p in pages:
        if p.url not in seen_nodes:
            nodes.append({
                "id": p.url, "label": _short_url(p.url),
                "depth": p.depth, "status": "done",
                "status_code": p.status_code, "title": p.title,
            })
            seen_nodes.add(p.url)
        if p.parent_url and p.parent_url != p.url:
            edges.append({"source": p.parent_url, "target": p.url})

    return {"nodes": nodes, "edges": edges}


@router.get("/workers")
async def get_workers():
    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    workers_raw = await r.hgetall(settings.redis_workers_key)
    await r.aclose()
    workers = []
    for wid, state_json in workers_raw.items():
        try:
            workers.append(json.loads(state_json))
        except Exception:
            pass
    return workers


@router.get("/jobs/{job_id}/metrics")
async def get_metrics(job_id: str):
    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    stats = await r.hgetall(f"stats:{job_id}")
    frontier_size = await r.zcard(f"frontier:{job_id}")
    await r.aclose()
    return {
        "queued_total": int(stats.get("queued", 0)),
        "done": int(stats.get("done", 0)),
        "discarded": int(stats.get("discarded", 0)),
        "error": int(stats.get("error", 0)),
        "frontier_depth": frontier_size,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _job_to_response(job: CrawlJob) -> JobResponse:
    return JobResponse(
        id=job.id, name=job.name, status=job.status,
        seed_urls=json.loads(job.seed_urls),
        max_depth=job.max_depth, max_pages=job.max_pages,
        urls_queued=job.urls_queued, urls_fetched=job.urls_fetched,
        urls_discarded=job.urls_discarded, urls_error=job.urls_error,
        bytes_downloaded=job.bytes_downloaded,
        pages_per_second=job.pages_per_second,
        created_at=job.created_at, started_at=job.started_at,
        completed_at=job.completed_at,
    )


def _short_url(url: str) -> str:
    from urllib.parse import urlparse
    p = urlparse(url)
    path = p.path[:40] if len(p.path) > 40 else p.path
    return f"{p.netloc}{path}"
