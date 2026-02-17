"""
HTML parser — extracts links, title, metadata from fetched pages.
"""
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlparse

from bs4 import BeautifulSoup


@dataclass
class ParseResult:
    url: str
    title: Optional[str]
    links: list[tuple[str, str]]  # (href, anchor_text)
    meta_description: Optional[str] = None
    canonical_url: Optional[str] = None
    lang: Optional[str] = None
    word_count: int = 0
    error: Optional[str] = None


def parse_html(url: str, content: bytes, encoding: str = "utf-8") -> ParseResult:
    try:
        html = content.decode(encoding, errors="replace")
        soup = BeautifulSoup(html, "lxml")
    except Exception as e:
        return ParseResult(url=url, title=None, links=[], error=str(e))

    # Title
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else None

    # Meta description
    meta_desc = soup.find("meta", attrs={"name": "description"})
    description = meta_desc.get("content", "").strip() if meta_desc else None

    # Canonical
    canonical_tag = soup.find("link", rel="canonical")
    canonical = canonical_tag.get("href") if canonical_tag else None

    # Language
    html_tag = soup.find("html")
    lang = html_tag.get("lang") if html_tag else None

    # Word count (rough)
    text = soup.get_text(separator=" ", strip=True)
    word_count = len(text.split())

    # Extract links
    links = []
    base_tag = soup.find("base", href=True)
    base_href = base_tag.get("href", url) if base_tag else url

    for a_tag in soup.find_all("a", href=True):
        href = a_tag.get("href", "").strip()
        anchor = a_tag.get_text(strip=True)[:200]

        # Skip javascript:, mailto:, tel:, etc.
        if href.startswith(("javascript:", "mailto:", "tel:", "#", "data:")):
            continue

        links.append((href, anchor))

    return ParseResult(
        url=url,
        title=title,
        links=links,
        meta_description=description,
        canonical_url=canonical,
        lang=lang,
        word_count=word_count,
    )
