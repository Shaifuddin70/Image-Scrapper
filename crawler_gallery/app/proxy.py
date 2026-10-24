import urllib.parse
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
import aiohttp

PROXY_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 "
        "PrismCrawl/1.0 (ImageGalleryCrawler; +https://prismcrawl.local)"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
}

async def stream_proxied_image(image_url: str):
    """
    Fetch image remotely with spoofed headers (bypassing hotlink/Referer protection)
    and stream back directly to the client with CORS allowed.
    """
    if not image_url or not image_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Invalid image URL")

    parsed = urllib.parse.urlparse(image_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    request_headers = PROXY_HEADERS.copy()
    request_headers["Referer"] = origin + "/"
    request_headers["Origin"] = origin

    timeout = aiohttp.ClientTimeout(total=15)
    connector = aiohttp.TCPConnector(ssl=False)

    try:
        session = aiohttp.ClientSession(timeout=timeout, connector=connector)
        resp = await session.get(image_url, headers=request_headers, allow_redirects=True)

        if resp.status >= 400:
            await resp.release()
            await session.close()
            raise HTTPException(status_code=resp.status, detail=f"Target server returned HTTP {resp.status}")

        content_type = resp.headers.get("Content-Type", "image/jpeg")

        async def content_generator():
            try:
                async for chunk in resp.content.iter_chunked(64 * 1024):
                    yield chunk
            finally:
                await resp.release()
                await session.close()

        return StreamingResponse(
            content_generator(),
            media_type=content_type,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=86400",
                "Content-Disposition": f'inline; filename="{parsed.path.split("/")[-1] or "image"}"',
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to proxy image: {str(e)}")
