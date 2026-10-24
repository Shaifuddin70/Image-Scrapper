import io
import re
import urllib.parse
import zipfile
import aiohttp
from typing import List
from fastapi.responses import StreamingResponse

SAFE_FILENAME_RE = re.compile(r'[^a-zA-Z0-9_\-\.]')

def sanitize_filename(name: str, fallback: str) -> str:
    cleaned = SAFE_FILENAME_RE.sub('_', name).strip('._')
    return cleaned if cleaned else fallback

async def create_images_zip(image_urls: List[str], max_images: int = 100) -> StreamingResponse:
    """Download up to max_images concurrently and package them into a downloadable ZIP."""
    urls = [u for u in image_urls if u.startswith(("http://", "https://"))][:max_images]
    
    zip_buffer = io.BytesIO()
    timeout = aiohttp.ClientTimeout(total=20)
    connector = aiohttp.TCPConnector(ssl=False)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "image/*,*/*;q=0.8"
    }

    async with aiohttp.ClientSession(timeout=timeout, connector=connector, headers=headers) as session:
        with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            for idx, url in enumerate(urls, start=1):
                try:
                    parsed = urllib.parse.urlparse(url)
                    raw_filename = parsed.path.split("/")[-1] or f"image_{idx}"
                    if "." not in raw_filename:
                        raw_filename += ".jpg"
                    
                    filename = sanitize_filename(raw_filename, f"image_{idx}.jpg")
                    # Ensure unique filenames in ZIP
                    filename = f"{idx:03d}_{filename}"

                    ref_headers = headers.copy()
                    ref_headers["Referer"] = f"{parsed.scheme}://{parsed.netloc}/"

                    async with session.get(url, headers=ref_headers, allow_redirects=True) as resp:
                        if resp.status == 200:
                            data = await resp.read()
                            if len(data) > 100:  # Valid image data
                                zf.writestr(filename, data)
                except Exception:
                    # Ignore single failed image in batch zip
                    continue

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="crawled_images_gallery.zip"',
            "Content-Length": str(zip_buffer.getbuffer().nbytes)
        }
    )
