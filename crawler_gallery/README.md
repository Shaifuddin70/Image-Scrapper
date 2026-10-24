# ✦ PrismCrawl — Deep Web Image Crawler & Visual Gallery

PrismCrawl is an ultra-modern, high-performance web application designed to recursively crawl websites, extract high-resolution imagery across multiple levels of links, and present them in a responsive visual gallery with real-time streaming, anti-hotlink CORS proxies, batch download, and an interactive lightbox.

---

## 🌟 Key Features

### 1. 🕷️ Asynchronous Recursive Web Crawler
- **Recursive Depth Traversal**: Follows child hyperlinks from depth 0 (single page) up to depth 3+.
- **Comprehensive Image Extraction**:
  - `<img>` tags (`src`, lazy-loaded `data-src`, `data-original`, and `srcset` high-res variants).
  - `<picture>` / `<source srcset>` modern web containers.
  - Inline CSS `background-image: url(...)` styles.
  - OpenGraph & Twitter meta tags (`og:image`, `twitter:image`).
  - Direct image links (`<a href="...jpg|png|webp|svg">`).
- **Domain Scope Control**: Restricts links to the same domain/subdomain to avoid drifting into ad networks or external tracking domains.
- **Real-Time Server-Sent Events (SSE)**: Streams images, queue sizes, and page scans directly to the browser as they are discovered.

### 2. 🛡️ Anti-Hotlink & CORS Image Proxy
- Websites with Referer checks or missing CORS headers are seamlessly proxied through `/api/proxy-image?url=...`.
- Client-side error detection automatically falls back to the proxy so that no images display broken placeholder icons.

### 3. 🎨 Modern, Responsive Gallery UI
- **Multiple Layout Modes**:
  - **Masonry View**: Dynamic Pinterest-style staggered columns preserving natural image proportions.
  - **Uniform Grid View**: Structured, high-density square thumbnails.
  - **Cinematic Showcase View**: Large previews with rich metadata.
- **Live Telemetry & Activity HUD**:
  - Real-time counters: Images Discovered, Pages Scanned, Queue Size, Elapsed Time.
  - Live Radar strip showing the currently processed URL.
  - Collapsible terminal drawer displaying crawler events and errors.
- **Smart Filtering & Search**:
  - Search by alt text, filename, or domain.
  - Format filter pills: JPEG, PNG, WEBP, SVG, GIF.
- **Interactive Lightbox Modal**:
  - Fullscreen view with smooth zoom in/out (`+`, `-`, `1:1`).
  - Arrow key navigation (`←`, `→`, `Esc`).
  - Dimension and format inspector.
  - One-click copy direct URL and download image.
- **Batch Operations**:
  - Select all / individual card selection.
  - Download selected images as a compressed ZIP file.
  - Export all direct image URLs as a TXT file.

---

## 🚀 Quick Start

### 1. Run the Application
Open a terminal in the project directory and run:
```bash
python run.py
```
Or double-click `start.bat` on Windows.

### 2. Open in Browser
Navigate to:
```
http://127.0.0.1:8000
```

### 4. Deploying to Vercel ⚡
This project is pre-configured for Vercel with:
- `vercel.json` routing both the Python backend and static frontend.
- `api/index.py` serverless function adapter.
- Automatic **Client-Side Resilient Fallback Engine** to overcome Vercel's 10-15s serverless function timeout and cloud datacenter IP blocks (Cloudflare 403 blocks).

Simply push this repository to GitHub and import it into your Vercel Dashboard. Vercel will automatically build and deploy it!

---

## 📁 Project Architecture

```
f:/Projects/crawler_gallery/
  ├── api/
  │   └── index.py             # Vercel Serverless Function entrypoint
  ├── app/
  │   ├── __init__.py
  │   ├── main.py              # FastAPI server, SSE stream, CORS, static routes
  │   ├── crawler.py           # Async recursive crawler engine & HTML parser
  │   ├── proxy.py             # Anti-hotlink & CORS image streaming proxy
  │   └── zip_exporter.py      # Concurrent ZIP packaging for bulk download
  ├── static/
  │   ├── index.html           # Modern single-page application structure
  │   ├── css/
  │   │   └── style.css        # Glassmorphic dark theme, responsive grid, animations
  │   └── js/
  │       ├── app.js           # Main controller, SSE event stream listener
  │       ├── clientCrawler.js # Resilient client-side fallback crawler
  │       ├── gallery.js       # Gallery manager, layout switcher, card rendering
  │       ├── lightbox.js      # Fullscreen interactive lightbox modal
  │       └── utils.js         # Toasts, clipboard copy, file downloads
  ├── vercel.json              # Vercel deployment configuration
  ├── requirements.txt         # Dependencies
  ├── run.py                   # Port-detecting application launcher
  └── start.bat                # Windows quick launcher
```
