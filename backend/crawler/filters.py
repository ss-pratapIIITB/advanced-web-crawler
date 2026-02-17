"""
URL and content filters.
Each filter returns (allowed: bool, reason: DiscardReason | None, detail: str | None)
"""
import re
from typing import Optional
from urllib.parse import urlparse, urljoin
import tldextract

from backend.models.events import DiscardReason

FilterResult = tuple[bool, Optional[DiscardReason], Optional[str]]

BINARY_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".tar", ".gz", ".rar", ".7z",
    ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
    ".exe", ".dmg", ".pkg", ".deb", ".rpm",
    ".woff", ".woff2", ".ttf", ".eot",
    ".css", ".js", ".json", ".xml",
}


class URLFilter:
    def __init__(
        self,
        allowed_domains: Optional[list[str]] = None,
        url_pattern: Optional[str] = None,
        max_depth: int = 10,
        max_url_length: int = 2048,
    ):
        self.allowed_domains = set(allowed_domains) if allowed_domains else None
        self.url_pattern = re.compile(url_pattern) if url_pattern else None
        self.max_depth = max_depth
        self.max_url_length = max_url_length

    def check(self, url: str, depth: int, base_url: str = "") -> FilterResult:
        # Length check
        if len(url) > self.max_url_length:
            return False, DiscardReason.INVALID_URL, "URL too long"

        # Parse URL
        try:
            parsed = urlparse(url)
        except Exception as e:
            return False, DiscardReason.INVALID_URL, str(e)

        # Must be http(s)
        if parsed.scheme not in ("http", "https"):
            return False, DiscardReason.INVALID_URL, f"Unsupported scheme: {parsed.scheme}"

        # Must have a host
        if not parsed.netloc:
            return False, DiscardReason.INVALID_URL, "No host"

        # Binary extension
        path = parsed.path.lower()
        for ext in BINARY_EXTENSIONS:
            if path.endswith(ext):
                return False, DiscardReason.BAD_CONTENT_TYPE, f"Binary extension: {ext}"

        # Fragment-only difference (treat as same page)
        # Already handled by normalization upstream

        # Max depth
        if depth > self.max_depth:
            return False, DiscardReason.MAX_DEPTH, f"Depth {depth} > max {self.max_depth}"

        # Domain restriction
        if self.allowed_domains:
            ext = tldextract.extract(url)
            registered = f"{ext.domain}.{ext.suffix}"
            if registered not in self.allowed_domains and parsed.netloc not in self.allowed_domains:
                return False, DiscardReason.WRONG_DOMAIN, f"Domain {registered} not in allowlist"

        # URL pattern
        if self.url_pattern and not self.url_pattern.search(url):
            return False, DiscardReason.FILTER_RULE, "URL did not match pattern"

        return True, None, None


class ContentFilter:
    def __init__(
        self,
        allowed_content_types: Optional[list[str]] = None,
        max_content_size: int = 10 * 1024 * 1024,
    ):
        self.allowed_types = allowed_content_types
        self.max_size = max_content_size

    def check_headers(self, content_type: str, content_length: Optional[int]) -> FilterResult:
        if self.allowed_types:
            ct = content_type.split(";")[0].strip().lower()
            if not any(ct.startswith(t) for t in self.allowed_types):
                return False, DiscardReason.BAD_CONTENT_TYPE, f"Content-Type: {ct}"

        if content_length and content_length > self.max_size:
            return False, DiscardReason.TOO_LARGE, f"Content-Length {content_length} > {self.max_size}"

        return True, None, None


def normalize_url(url: str, base: str = "") -> Optional[str]:
    """Normalize and absolutize a URL. Returns None if invalid."""
    try:
        if base:
            url = urljoin(base, url)
        parsed = urlparse(url)
        # Strip fragment
        normalized = parsed._replace(fragment="").geturl()
        # Ensure no trailing ?
        if normalized.endswith("?"):
            normalized = normalized[:-1]
        return normalized
    except Exception:
        return None
