import asyncio
import re
import urllib.parse
from typing import Set, Dict, List, Optional, AsyncGenerator
import aiohttp
from bs4 import BeautifulSoup

# Standard desktop Chrome browser headers to avoid WAF blocks
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Sec-Ch-Ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif", ".bmp", ".ico", ".tiff"
}

NON_HTML_EXTENSIONS = {
    ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z", ".exe", ".bin",
    ".mp3", ".mp4", ".avi", ".mkv", ".mov", ".wav", ".flac",
    ".docx", ".xlsx", ".pptx", ".odt", ".csv", ".json", ".xml"
}

def is_valid_http_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False

def clean_url(url: str) -> str:
    """Normalize url by removing fragment and redundant whitespace."""
    if not url:
        return ""
    url = url.strip()
    parsed = urllib.parse.urlsplit(url)
    # Strip hash fragments
    cleaned = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    return cleaned

def is_image_url(url: str) -> bool:
    """Check if the URL path ends with a known image extension."""
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.lower()
    return any(path.endswith(ext) for ext in IMAGE_EXTENSIONS)

def extract_srcset_urls(srcset: str, base_url: str) -> List[str]:
    """Parse srcset attributes and return absolute image URLs."""
    urls = []
    if not srcset:
        return urls
    parts = [p.strip() for p in srcset.split(",") if p.strip()]
    for part in parts:
        tokens = part.split()
        if tokens:
            candidate = tokens[0].strip()
            if candidate and not candidate.startswith("data:"):
                abs_url = urllib.parse.urljoin(base_url, candidate)
                urls.append(clean_url(abs_url))
    return urls

def extract_css_bg_urls(style_str: str, base_url: str) -> List[str]:
    """Extract urls from CSS background or background-image properties."""
    urls = []
    if not style_str:
        return urls
    matches = re.findall(r'url\(\s*[\'"]?([^\'")]+)[\'"]?\s*\)', style_str, re.IGNORECASE)
    for m in matches:
        m = m.strip()
        if m and not m.startswith("data:"):
            abs_url = urllib.parse.urljoin(base_url, m)
            urls.append(clean_url(abs_url))
    return urls

def guess_format(url: str) -> str:
    """Guess image format from URL."""
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.lower()
    for ext in (".jpg", ".jpeg"):
        if path.endswith(ext):
            return "JPEG"
    for ext in (".png", ".webp", ".gif", ".svg", ".avif", ".bmp", ".ico"):
        if path.endswith(ext):
            return ext[1:].upper()
    return "IMAGE"

class WebImageCrawler:
    def __init__(
        self,
        start_url: str,
        max_depth: int = 1,
        max_pages: int = 20,
        same_domain_only: bool = True,
        concurrency: int = 4,
        include_meta_images: bool = True,
        request_timeout: int = 12
    ):
        self.start_url = clean_url(start_url)
        self.max_depth = max(0, min(max_depth, 4))
        self.max_pages = max(1, min(max_pages, 100))
        self.same_domain_only = same_domain_only
        self.concurrency = max(1, min(concurrency, 8))
        self.include_meta_images = include_meta_images
        self.request_timeout = request_timeout

        self.start_domain = urllib.parse.urlparse(self.start_url).netloc.lower()
        self.visited_urls: Set[str] = set()
        self.seen_images: Set[str] = set()
        self.stopped = False

    def stop(self):
        """Signal crawler to stop."""
        self.stopped = True

    def is_allowed_domain(self, target_url: str) -> bool:
        if not self.same_domain_only:
            return True
        try:
            target_domain = urllib.parse.urlparse(target_url).netloc.lower()
            return (
                target_domain == self.start_domain
                or target_domain.endswith("." + self.start_domain)
                or self.start_domain.endswith("." + target_domain)
            )
        except Exception:
            return False

    def is_crawlable_link(self, url: str) -> bool:
        """Check if URL points to an HTML document rather than a binary file or anchor."""
        if not is_valid_http_url(url):
            return False
        parsed = urllib.parse.urlparse(url)
        path = parsed.path.lower()
        if any(path.endswith(ext) for ext in NON_HTML_EXTENSIONS):
            return False
        if any(path.endswith(ext) for ext in IMAGE_EXTENSIONS):
            return False
        return True

    def parse_images_from_html(self, html: str, page_url: str) -> List[Dict]:
        """Extract all candidate images with rich metadata."""
        images = []
        soup = BeautifulSoup(html, "html.parser")

        # 1. <img> tags
        for img in soup.find_all("img"):
            src_candidates = [
                img.get("src"),
                img.get("data-src"),
                img.get("data-original"),
                img.get("data-lazy-src"),
                img.get("data-zoom-src"),
                img.get("data-full-url"),
                img.get("data-hi-res-src"),
            ]
            
            # Also check srcset for high-res versions
            srcset = img.get("srcset") or img.get("data-srcset")
            if srcset:
                srcset_urls = extract_srcset_urls(srcset, page_url)
                if srcset_urls:
                    # Pick highest resolution candidate (often last in srcset)
                    src_candidates.insert(0, srcset_urls[-1])

            alt_text = (img.get("alt") or "").strip()
            title = (img.get("title") or "").strip()

            for raw_src in src_candidates:
                if not raw_src:
                    continue
                raw_src = raw_src.strip()
                if raw_src.startswith("data:image"):
                    continue
                abs_url = urllib.parse.urljoin(page_url, raw_src)
                abs_url = clean_url(abs_url)
                if is_valid_http_url(abs_url) and abs_url not in self.seen_images:
                    self.seen_images.add(abs_url)
                    images.append({
                        "url": abs_url,
                        "source_page": page_url,
                        "alt": alt_text or title or "Image",
                        "title": title,
                        "format": guess_format(abs_url),
                        "type": "img"
                    })
                    break

        # 2. <picture> <source srcset="...">
        for picture in soup.find_all("picture"):
            for source in picture.find_all("source"):
                srcset = source.get("srcset")
                if srcset:
                    for src in extract_srcset_urls(srcset, page_url):
                        if src not in self.seen_images and is_valid_http_url(src):
                            self.seen_images.add(src)
                            images.append({
                                "url": src,
                                "source_page": page_url,
                                "alt": "Picture element source",
                                "title": "",
                                "format": guess_format(src),
                                "type": "picture"
                            })

        # 3. Inline style background-image
        for el in soup.find_all(style=True):
            style_str = el.get("style", "")
            for bg_url in extract_css_bg_urls(style_str, page_url):
                if bg_url not in self.seen_images and is_valid_http_url(bg_url):
                    self.seen_images.add(bg_url)
                    images.append({
                        "url": bg_url,
                        "source_page": page_url,
                        "alt": "Background image",
                        "title": "",
                        "format": guess_format(bg_url),
                        "type": "background"
                    })

        # 4. OpenGraph and Twitter meta cards
        if self.include_meta_images:
            for meta in soup.find_all("meta"):
                prop = meta.get("property", "").lower()
                name = meta.get("name", "").lower()
                content = meta.get("content", "")
                if (prop in ("og:image", "og:image:url", "og:image:secure_url") or name in ("twitter:image", "twitter:image:src")) and content:
                    abs_url = clean_url(urllib.parse.urljoin(page_url, content.strip()))
                    if is_valid_http_url(abs_url) and abs_url not in self.seen_images:
                        self.seen_images.add(abs_url)
                        images.append({
                            "url": abs_url,
                            "source_page": page_url,
                            "alt": f"Meta banner ({prop or name})",
                            "title": "",
                            "format": guess_format(abs_url),
                            "type": "meta"
                        })

        # 5. Direct <a> link to an image file
        for a in soup.find_all("a", href=True):
            href = a.get("href", "").strip()
            if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                continue
            abs_url = clean_url(urllib.parse.urljoin(page_url, href))
            if is_valid_http_url(abs_url) and is_image_url(abs_url) and abs_url not in self.seen_images:
                self.seen_images.add(abs_url)
                images.append({
                    "url": abs_url,
                    "source_page": page_url,
                    "alt": a.get_text(strip=True) or "Linked Image",
                    "title": "",
                    "format": guess_format(abs_url),
                    "type": "link"
                })

        return images

    def extract_child_links(self, html: str, page_url: str) -> List[str]:
        """Extract outgoing links to follow for recursive crawl."""
        child_links = []
        soup = BeautifulSoup(html, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a.get("href", "").strip()
            if not href or href.startswith(("#", "javascript:", "mailto:", "tel:", "whatsapp:")):
                continue
            abs_url = clean_url(urllib.parse.urljoin(page_url, href))
            if self.is_crawlable_link(abs_url) and self.is_allowed_domain(abs_url):
                if abs_url not in self.visited_urls:
                    child_links.append(abs_url)
        return child_links

    async def crawl_stream(self) -> AsyncGenerator[Dict, None]:
        """Breadth-First Search async crawl generator streaming events."""
        if not is_valid_http_url(self.start_url):
            yield {
                "event": "error",
                "data": {"message": f"Invalid start URL: {self.start_url}"}
            }
            return

        yield {
            "event": "init",
            "data": {
                "start_url": self.start_url,
                "start_domain": self.start_domain,
                "max_depth": self.max_depth,
                "max_pages": self.max_pages,
                "same_domain_only": self.same_domain_only
            }
        }

        # Queue of tuples: (url, depth)
        queue: List[tuple] = [(self.start_url, 0)]
        pages_crawled_count = 0
        total_images_count = 0

        # Create a single persistent aiohttp ClientSession
        timeout = aiohttp.ClientTimeout(total=self.request_timeout)
        connector = aiohttp.TCPConnector(ssl=False, limit_per_host=self.concurrency)

        async with aiohttp.ClientSession(timeout=timeout, connector=connector, headers=DEFAULT_HEADERS) as session:
            while queue and pages_crawled_count < self.max_pages and not self.stopped:
                current_url, depth = queue.pop(0)

                if current_url in self.visited_urls:
                    continue
                self.visited_urls.add(current_url)

                yield {
                    "event": "page_start",
                    "data": {
                        "url": current_url,
                        "depth": depth,
                        "pages_crawled": pages_crawled_count,
                        "queue_size": len(queue),
                        "total_images": total_images_count
                    }
                }

                try:
                    async with session.get(current_url, allow_redirects=True) as response:
                        if response.status >= 400:
                            yield {
                                "event": "page_error",
                                "data": {
                                    "url": current_url,
                                    "error": f"HTTP {response.status} {response.reason or 'Error'}",
                                    "depth": depth
                                }
                            }
                            continue

                        content_type = response.headers.get("Content-Type", "").lower()
                        if "text/html" not in content_type and "application/xhtml" not in content_type:
                            # Not an HTML page (might be image, binary, or API response)
                            if any(content_type.startswith(f"image/{ext}") for ext in ("jpeg", "png", "webp", "gif", "svg", "avif")):
                                if current_url not in self.seen_images:
                                    self.seen_images.add(current_url)
                                    total_images_count += 1
                                    yield {
                                        "event": "images_found",
                                        "data": {
                                            "page_url": current_url,
                                            "images": [{
                                                "url": current_url,
                                                "source_page": current_url,
                                                "alt": "Direct image response",
                                                "title": "",
                                                "format": guess_format(current_url),
                                                "type": "direct"
                                            }],
                                            "total_images": total_images_count
                                        }
                                    }
                            continue

                        html_text = await response.text(errors="ignore")
                        pages_crawled_count += 1

                        # Extract images
                        images = self.parse_images_from_html(html_text, str(response.url))
                        if images:
                            total_images_count += len(images)
                            yield {
                                "event": "images_found",
                                "data": {
                                    "page_url": str(response.url),
                                    "images": images,
                                    "total_images": total_images_count,
                                    "new_count": len(images)
                                }
                            }

                        # Extract and enqueue child links if within max_depth
                        if depth < self.max_depth and not self.stopped:
                            child_links = self.extract_child_links(html_text, str(response.url))
                            for link in child_links:
                                if link not in self.visited_urls and not any(l[0] == link for l in queue):
                                    if len(queue) + pages_crawled_count < self.max_pages * 3:
                                        queue.append((link, depth + 1))

                        yield {
                            "event": "page_done",
                            "data": {
                                "url": str(response.url),
                                "status": response.status,
                                "depth": depth,
                                "pages_crawled": pages_crawled_count,
                                "queue_size": len(queue),
                                "total_images": total_images_count
                            }
                        }

                except Exception as e:
                    yield {
                        "event": "page_error",
                        "data": {
                            "url": current_url,
                            "error": str(e),
                            "depth": depth
                        }
                    }

                # Brief async pause to be polite to the event loop
                await asyncio.sleep(0.05)

        # Finished or stopped
        if self.stopped:
            yield {
                "event": "stopped",
                "data": {
                    "reason": "Cancelled by user",
                    "pages_crawled": pages_crawled_count,
                    "total_images": total_images_count
                }
            }
        else:
            yield {
                "event": "complete",
                "data": {
                    "pages_crawled": pages_crawled_count,
                    "total_images": total_images_count,
                    "queue_exhausted": len(queue) == 0
                }
            }
