from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Redis
    redis_url: str = "redis://localhost:6379/0"
    redis_stream_key: str = "crawl_events"
    redis_frontier_key: str = "url_frontier"
    redis_seen_key: str = "url_seen"
    redis_workers_key: str = "worker_status"

    # Database
    database_url: str = "sqlite+aiosqlite:///./crawler.db"

    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Crawl defaults
    max_depth: int = 3
    max_pages: int = 10_000
    concurrency: int = 16
    request_timeout: int = 30
    politeness_delay: float = 1.0  # seconds between requests to same domain
    max_retries: int = 3

    # Content
    max_content_size: int = 10 * 1024 * 1024  # 10 MB
    allowed_content_types: list[str] = [
        "text/html",
        "application/xhtml+xml",
        "application/xml",
        "text/xml",
    ]

    # Scaling
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"
    worker_prefetch_multiplier: int = 1

    # Domain-sharded queues — parallel I/O across domains
    # Each domain hashes to one of these shards so politeness is maintained
    # per domain while different domains crawl fully in parallel.
    num_domain_queues: int = 16

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
