import os
import json
import uuid
from typing import Dict, List, Optional
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .crawler import WebImageCrawler
from .proxy import stream_proxied_image
from .zip_exporter import create_images_zip

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = FastAPI(title="Web Image Crawler & Gallery", version="1.0.0")

# Enable CORS for maximum flexibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active crawlers map: session_id -> WebImageCrawler
active_crawlers: Dict[str, WebImageCrawler] = {}

class ZipExportRequest(BaseModel):
    urls: List[str]

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h1>Crawler Gallery UI Initializing...</h1>")

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "Crawler Gallery", "version": "1.0.0"}

@app.get("/api/crawl/stream")
async def stream_crawl(
    url: str = Query(..., description="Target webpage URL to crawl"),
    depth: int = Query(1, ge=0, le=4, description="Crawl depth (0 = single page)"),
    max_pages: int = Query(20, ge=1, le=100, description="Max pages to crawl"),
    same_domain: bool = Query(True, description="Restrict links to the same domain"),
    concurrency: int = Query(4, ge=1, le=8, description="Concurrent HTTP requests"),
    include_meta: bool = Query(True, description="Include OpenGraph and Twitter banner images"),
    session_id: Optional[str] = Query(None, description="Optional client session identifier")
):
    if not session_id:
        session_id = str(uuid.uuid4())

    crawler = WebImageCrawler(
        start_url=url,
        max_depth=depth,
        max_pages=max_pages,
        same_domain_only=same_domain,
        concurrency=concurrency,
        include_meta_images=include_meta
    )
    active_crawlers[session_id] = crawler

    async def sse_event_generator():
        try:
            # First send session_id
            yield f"event: session\ndata: {json.dumps({'session_id': session_id})}\n\n"
            
            async for update in crawler.crawl_stream():
                event_type = update.get("event", "message")
                data_payload = json.dumps(update.get("data", {}))
                yield f"event: {event_type}\ndata: {data_payload}\n\n"
        finally:
            # Clean up active crawler when connection closes
            if session_id in active_crawlers:
                del active_crawlers[session_id]

    return StreamingResponse(
        sse_event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Content-Type": "text/event-stream; charset=utf-8",
        }
    )

@app.post("/api/crawl/stop")
async def stop_crawl(session_id: str = Query(...)):
    crawler = active_crawlers.get(session_id)
    if not crawler:
        return {"status": "not_found", "message": "No active crawl found with this session ID"}
    crawler.stop()
    return {"status": "stopping", "message": "Crawl cancellation requested"}

@app.get("/api/proxy-image")
async def proxy_image(url: str = Query(..., description="Target image URL to fetch")):
    return await stream_proxied_image(url)

@app.post("/api/export-zip")
async def export_zip(req: ZipExportRequest):
    if not req.urls:
        raise HTTPException(status_code=400, detail="No URLs provided")
    return await create_images_zip(req.urls, max_images=150)

# Mount static files for assets
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
