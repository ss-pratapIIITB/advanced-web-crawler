"""
Async HTTP fetcher with retry, timeout, and size limiting.
Optionally uses Playwright for JS-rendered pages.
"""
import asyncio
import time
from dataclasses import dataclass
from typing import Optional

import aiohttp
from aiohttp import ClientSession, TCPConnector
from fake_useragent import UserAgent
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from backend.config import settings
from backend.models.events import DiscardReason

_ua = UserAgent()


@dataclass
class FetchResult:
    url: str
    final_url: str
    status_code: int
    content_type: str
    content: Optional[bytes]
    headers: dict
    duration_ms: float
    is_js_rendered: bool = False
    error: Optional[str] = None
    discard_reason: Optional[DiscardReason] = None


class Fetcher:
    def __init__(self, timeout: int = None, max_size: int = None):
        self.timeout = aiohttp.ClientTimeout(total=timeout or settings.request_timeout)
        self.max_size = max_size or settings.max_content_size
        self._session: Optional[ClientSession] = None

    async def __aenter__(self):
        connector = TCPConnector(
            limit=200,
            limit_per_host=10,
            ttl_dns_cache=300,
            enable_cleanup_closed=True,
        )
        self._session = ClientSession(
            connector=connector,
            timeout=self.timeout,
            headers={"User-Agent": _ua.random},
        )
        return self

    async def __aexit__(self, *_):
        if self._session:
            await self._session.close()

    async def fetch(self, url: str, use_playwright: bool = False) -> FetchResult:
        if use_playwright:
            return await self._fetch_playwright(url)
        return await self._fetch_http(url)

    async def _fetch_http(self, url: str) -> FetchResult:
        start = time.monotonic()
        try:
            async with self._session.get(
                url,
                allow_redirects=True,
                max_redirects=5,
                ssl=False,
            ) as resp:
                content_type = resp.headers.get("Content-Type", "")
                content_length = int(resp.headers.get("Content-Length", 0) or 0)

                if content_length > self.max_size:
                    return FetchResult(
                        url=url, final_url=str(resp.url),
                        status_code=resp.status, content_type=content_type,
                        content=None, headers=dict(resp.headers),
                        duration_ms=(time.monotonic() - start) * 1000,
                        error="Content too large",
                        discard_reason=DiscardReason.TOO_LARGE,
                    )

                # Stream content with size cap
                chunks = []
                total = 0
                async for chunk in resp.content.iter_chunked(8192):
                    total += len(chunk)
                    if total > self.max_size:
                        return FetchResult(
                            url=url, final_url=str(resp.url),
                            status_code=resp.status, content_type=content_type,
                            content=None, headers=dict(resp.headers),
                            duration_ms=(time.monotonic() - start) * 1000,
                            error="Content too large (streamed)",
                            discard_reason=DiscardReason.TOO_LARGE,
                        )
                    chunks.append(chunk)

                content = b"".join(chunks)
                return FetchResult(
                    url=url, final_url=str(resp.url),
                    status_code=resp.status, content_type=content_type,
                    content=content, headers=dict(resp.headers),
                    duration_ms=(time.monotonic() - start) * 1000,
                )

        except asyncio.TimeoutError:
            return FetchResult(
                url=url, final_url=url, status_code=0,
                content_type="", content=None, headers={},
                duration_ms=(time.monotonic() - start) * 1000,
                error="Timeout", discard_reason=DiscardReason.TIMEOUT,
            )
        except aiohttp.ClientError as e:
            return FetchResult(
                url=url, final_url=url, status_code=0,
                content_type="", content=None, headers={},
                duration_ms=(time.monotonic() - start) * 1000,
                error=str(e), discard_reason=DiscardReason.CONNECTION_ERROR,
            )

    async def _fetch_playwright(self, url: str) -> FetchResult:
        """Use Playwright for JS-heavy pages."""
        start = time.monotonic()
        try:
            from playwright.async_api import async_playwright
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page()
                await page.set_extra_http_headers({"User-Agent": _ua.random})

                response = await page.goto(url, wait_until="networkidle", timeout=30_000)
                content = await page.content()
                await browser.close()

                return FetchResult(
                    url=url, final_url=page.url,
                    status_code=response.status if response else 200,
                    content_type="text/html",
                    content=content.encode("utf-8") if content else None,
                    headers={},
                    duration_ms=(time.monotonic() - start) * 1000,
                    is_js_rendered=True,
                )
        except Exception as e:
            return FetchResult(
                url=url, final_url=url, status_code=0,
                content_type="", content=None, headers={},
                duration_ms=(time.monotonic() - start) * 1000,
                error=str(e), discard_reason=DiscardReason.CONNECTION_ERROR,
            )
