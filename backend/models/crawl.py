from sqlalchemy import Column, String, Integer, Float, DateTime, Text, ForeignKey, Boolean, Enum as SAEnum
from sqlalchemy.orm import relationship, DeclarativeBase
from datetime import datetime
from .events import URLStatus, DiscardReason
import uuid


class Base(DeclarativeBase):
    pass


def _uuid():
    return str(uuid.uuid4())


class CrawlJob(Base):
    __tablename__ = "crawl_jobs"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    seed_urls = Column(Text, nullable=False)  # JSON array
    status = Column(String, default="created")
    config = Column(Text)  # JSON config blob

    max_depth = Column(Integer, default=3)
    max_pages = Column(Integer, default=10_000)
    allowed_domains = Column(Text)  # JSON array, null = any
    url_pattern = Column(String)    # regex filter

    urls_queued = Column(Integer, default=0)
    urls_fetched = Column(Integer, default=0)
    urls_discarded = Column(Integer, default=0)
    urls_error = Column(Integer, default=0)
    bytes_downloaded = Column(Integer, default=0)
    pages_per_second = Column(Float, default=0.0)

    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime)
    completed_at = Column(DateTime)

    pages = relationship("CrawledPage", back_populates="job")
    discards = relationship("DiscardedURL", back_populates="job")


class CrawledPage(Base):
    __tablename__ = "crawled_pages"

    id = Column(String, primary_key=True, default=_uuid)
    job_id = Column(String, ForeignKey("crawl_jobs.id"), nullable=False)
    url = Column(String, nullable=False, index=True)
    parent_url = Column(String)
    depth = Column(Integer, default=0)

    status_code = Column(Integer)
    content_type = Column(String)
    content_length = Column(Integer)
    title = Column(String)
    fetch_duration_ms = Column(Float)
    links_found = Column(Integer, default=0)
    is_js_rendered = Column(Boolean, default=False)

    fetched_at = Column(DateTime, default=datetime.utcnow)

    job = relationship("CrawlJob", back_populates="pages")
    outgoing_links = relationship("CrawlLink", foreign_keys="CrawlLink.source_id", back_populates="source")


class DiscardedURL(Base):
    __tablename__ = "discarded_urls"

    id = Column(String, primary_key=True, default=_uuid)
    job_id = Column(String, ForeignKey("crawl_jobs.id"), nullable=False)
    url = Column(String, nullable=False, index=True)
    parent_url = Column(String)
    depth = Column(Integer, default=0)
    reason = Column(String)
    detail = Column(String)
    discarded_at = Column(DateTime, default=datetime.utcnow)

    job = relationship("CrawlJob", back_populates="discards")


class CrawlLink(Base):
    __tablename__ = "crawl_links"

    id = Column(String, primary_key=True, default=_uuid)
    job_id = Column(String, ForeignKey("crawl_jobs.id"), nullable=False)
    source_id = Column(String, ForeignKey("crawled_pages.id"), nullable=False)
    target_url = Column(String, nullable=False)
    anchor_text = Column(String)

    source = relationship("CrawledPage", foreign_keys=[source_id], back_populates="outgoing_links")
