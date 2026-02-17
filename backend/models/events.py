from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field
from datetime import datetime
import uuid


class EventType(str, Enum):
    # URL lifecycle
    URL_DISCOVERED = "url_discovered"
    URL_QUEUED = "url_queued"
    URL_DEQUEUED = "url_dequeued"
    URL_FETCHING = "url_fetching"
    URL_FETCHED = "url_fetched"
    URL_PARSING = "url_parsing"
    URL_PARSED = "url_parsed"
    URL_STORED = "url_stored"
    URL_DISCARDED = "url_discarded"
    URL_ERROR = "url_error"

    # Worker lifecycle
    WORKER_ONLINE = "worker_online"
    WORKER_OFFLINE = "worker_offline"
    WORKER_IDLE = "worker_idle"
    WORKER_BUSY = "worker_busy"
    WORKER_HEARTBEAT = "worker_heartbeat"

    # Job lifecycle
    JOB_CREATED = "job_created"
    JOB_STARTED = "job_started"
    JOB_PAUSED = "job_paused"
    JOB_RESUMED = "job_resumed"
    JOB_COMPLETED = "job_completed"
    JOB_FAILED = "job_failed"

    # Metrics
    METRICS_UPDATE = "metrics_update"


class DiscardReason(str, Enum):
    DUPLICATE = "duplicate"
    ROBOTS_TXT = "robots_txt"
    MAX_DEPTH = "max_depth"
    MAX_PAGES = "max_pages"
    WRONG_DOMAIN = "wrong_domain"
    BAD_CONTENT_TYPE = "bad_content_type"
    HTTP_ERROR = "http_error"
    TIMEOUT = "timeout"
    TOO_LARGE = "too_large"
    INVALID_URL = "invalid_url"
    FILTER_RULE = "filter_rule"
    PARSE_ERROR = "parse_error"
    CONNECTION_ERROR = "connection_error"


class URLStatus(str, Enum):
    QUEUED = "queued"
    FETCHING = "fetching"
    FETCHED = "fetched"
    PARSING = "parsing"
    DONE = "done"
    DISCARDED = "discarded"
    ERROR = "error"


class WorkerState(BaseModel):
    worker_id: str
    hostname: str
    pid: int
    current_url: Optional[str] = None
    current_job_id: Optional[str] = None
    status: str = "idle"
    urls_processed: int = 0
    errors: int = 0
    bytes_downloaded: int = 0
    started_at: datetime = Field(default_factory=datetime.utcnow)
    last_heartbeat: datetime = Field(default_factory=datetime.utcnow)


class CrawlEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_type: EventType
    job_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    worker_id: Optional[str] = None

    # URL fields
    url: Optional[str] = None
    parent_url: Optional[str] = None
    depth: Optional[int] = None
    status_code: Optional[int] = None
    content_type: Optional[str] = None
    content_length: Optional[int] = None
    links_found: Optional[int] = None
    fetch_duration_ms: Optional[float] = None
    status: Optional[URLStatus] = None

    # Discard info
    discard_reason: Optional[DiscardReason] = None
    discard_detail: Optional[str] = None

    # Worker info
    worker_state: Optional[WorkerState] = None

    # Metrics snapshot
    metrics: Optional[dict[str, Any]] = None

    # Graph edge — source → target (for visualization)
    source_url: Optional[str] = None
    target_url: Optional[str] = None

    def to_redis_dict(self) -> dict[str, str]:
        data = self.model_dump(mode="json", exclude_none=True)
        return {k: str(v) for k, v in data.items()}
