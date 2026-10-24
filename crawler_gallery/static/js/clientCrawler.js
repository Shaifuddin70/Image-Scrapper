/**
 * Client-Side Resilient Web Crawler Engine
 * Enables image crawling and link traversal directly in the browser.
 * Bypasses cloud datacenter IP blocks, Vercel function timeouts, and CORS limits
 * using multi-tier proxies and client-side DOM parsing.
 */

const CORS_PROXIES = [
  (url) => `/api/proxy-image?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`
];

const NON_HTML_EXTENSIONS = [
  '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z', '.exe', '.bin',
  '.mp3', '.mp4', '.avi', '.mkv', '.mov', '.wav',
  '.docx', '.xlsx', '.pptx', '.csv', '.json', '.xml'
];

const IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif', '.bmp', '.ico'
];

export class ClientCrawler {
  constructor(options = {}) {
    this.startUrl = options.url;
    this.maxDepth = parseInt(options.depth || 1, 10);
    this.maxPages = parseInt(options.maxPages || 15, 10);
    this.sameDomainOnly = options.sameDomain !== false;
    this.includeMeta = options.includeMeta !== false;

    this.onInit = options.onInit || (() => {});
    this.onPageStart = options.onPageStart || (() => {});
    this.onImagesFound = options.onImagesFound || (() => {});
    this.onPageDone = options.onPageDone || (() => {});
    this.onPageError = options.onPageError || (() => {});
    this.onComplete = options.onComplete || (() => {});

    this.visitedUrls = new Set();
    this.seenImages = new Set();
    this.isStopped = false;

    try {
      this.startOrigin = new URL(this.startUrl).origin;
      this.startHost = new URL(this.startUrl).hostname.toLowerCase();
    } catch (e) {
      this.startOrigin = '';
      this.startHost = '';
    }
  }

  stop() {
    this.isStopped = true;
  }

  isAllowedDomain(targetUrl) {
    if (!this.sameDomainOnly) return true;
    try {
      const host = new URL(targetUrl).hostname.toLowerCase();
      return host === this.startHost || host.endsWith('.' + this.startHost) || this.startHost.endsWith('.' + host);
    } catch (e) {
      return false;
    }
  }

  isCrawlableLink(url) {
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return false;
    try {
      const path = new URL(url).pathname.toLowerCase();
      if (NON_HTML_EXTENSIONS.some(ext => path.endsWith(ext))) return false;
      if (IMAGE_EXTENSIONS.some(ext => path.endsWith(ext))) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  guessFormat(url) {
    try {
      const path = new URL(url).pathname.toLowerCase();
      for (const ext of ['.jpg', '.jpeg']) {
        if (path.endsWith(ext)) return 'JPEG';
      }
      for (const ext of ['.png', '.webp', '.gif', '.svg', '.avif', '.bmp']) {
        if (path.endsWith(ext)) return ext.slice(1).toUpperCase();
      }
    } catch (e) {}
    return 'IMAGE';
  }

  async fetchPageHtml(targetUrl) {
    // Try multiple proxy tiers
    for (const makeProxyUrl of CORS_PROXIES) {
      if (this.isStopped) return null;
      try {
        const proxyUrl = makeProxyUrl(targetUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 9000);

        const resp = await fetch(proxyUrl, {
          signal: controller.signal,
          headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' }
        });
        clearTimeout(timeoutId);

        if (resp.ok) {
          const text = await resp.text();
          if (text && text.length > 100) {
            return text;
          }
        }
      } catch (err) {
        // Try next proxy
      }
    }
    throw new Error('All fetch proxies failed or were blocked');
  }

  parseImagesAndLinks(html, pageUrl) {
    const images = [];
    const childLinks = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // 1. <img> tags
    doc.querySelectorAll('img').forEach(img => {
      const candidates = [
        img.getAttribute('src'),
        img.getAttribute('data-src'),
        img.getAttribute('data-original'),
        img.getAttribute('data-lazy-src'),
        img.getAttribute('data-full-url')
      ];

      // Check srcset
      const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      if (srcset) {
        const parts = srcset.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length > 0) {
          const lastCandidate = parts[parts.length - 1].split(' ')[0];
          candidates.unshift(lastCandidate);
        }
      }

      const alt = img.getAttribute('alt') || img.getAttribute('title') || 'Image';

      for (const raw of candidates) {
        if (!raw || raw.startsWith('data:image')) continue;
        try {
          const abs = new URL(raw, pageUrl).href.split('#')[0];
          if (!this.seenImages.has(abs) && (abs.startsWith('http://') || abs.startsWith('https://'))) {
            this.seenImages.add(abs);
            images.push({
              url: abs,
              source_page: pageUrl,
              alt: alt.trim(),
              format: this.guessFormat(abs),
              type: 'img'
            });
            break;
          }
        } catch (e) {}
      }
    });

    // 2. <picture> <source srcset>
    doc.querySelectorAll('picture source[srcset]').forEach(source => {
      const srcset = source.getAttribute('srcset');
      if (srcset) {
        const parts = srcset.split(',').map(s => s.trim()).filter(Boolean);
        if (parts.length > 0) {
          const candidate = parts[parts.length - 1].split(' ')[0];
          try {
            const abs = new URL(candidate, pageUrl).href.split('#')[0];
            if (!this.seenImages.has(abs) && (abs.startsWith('http://') || abs.startsWith('https://'))) {
              this.seenImages.add(abs);
              images.push({
                url: abs,
                source_page: pageUrl,
                alt: 'Picture source element',
                format: this.guessFormat(abs),
                type: 'picture'
              });
            }
          } catch (e) {}
        }
      }
    });

    // 3. Meta OpenGraph / Twitter cards
    if (this.includeMeta) {
      doc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach(meta => {
        const content = meta.getAttribute('content');
        if (content) {
          try {
            const abs = new URL(content.trim(), pageUrl).href.split('#')[0];
            if (!this.seenImages.has(abs) && (abs.startsWith('http://') || abs.startsWith('https://'))) {
              this.seenImages.add(abs);
              images.push({
                url: abs,
                source_page: pageUrl,
                alt: 'Meta Card Banner',
                format: this.guessFormat(abs),
                type: 'meta'
              });
            }
          } catch (e) {}
        }
      });
    }

    // 4. Direct <a> links to image files
    doc.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      try {
        const abs = new URL(href.trim(), pageUrl).href.split('#')[0];
        const path = new URL(abs).pathname.toLowerCase();
        if (IMAGE_EXTENSIONS.some(ext => path.endsWith(ext))) {
          if (!this.seenImages.has(abs)) {
            this.seenImages.add(abs);
            images.push({
              url: abs,
              source_page: pageUrl,
              alt: a.textContent.trim() || 'Linked Image',
              format: this.guessFormat(abs),
              type: 'link'
            });
          }
        } else if (this.isCrawlableLink(abs) && this.isAllowedDomain(abs)) {
          if (!this.visitedUrls.has(abs)) {
            childLinks.push(abs);
          }
        }
      } catch (e) {}
    });

    return { images, childLinks };
  }

  async start() {
    this.onInit({
      start_url: this.startUrl,
      start_domain: this.startHost,
      max_depth: this.maxDepth,
      max_pages: this.maxPages
    });

    const queue = [{ url: this.startUrl, depth: 0 }];
    let pagesCrawled = 0;
    let totalImages = 0;

    while (queue.length > 0 && pagesCrawled < this.maxPages && !this.isStopped) {
      const { url: currentUrl, depth } = queue.shift();

      if (this.visitedUrls.has(currentUrl)) continue;
      this.visitedUrls.add(currentUrl);

      this.onPageStart({
        url: currentUrl,
        depth: depth,
        pages_crawled: pagesCrawled,
        queue_size: queue.length,
        total_images: totalImages
      });

      try {
        const html = await this.fetchPageHtml(currentUrl);
        if (!html) throw new Error('No HTML content returned');

        pagesCrawled++;
        const { images, childLinks } = this.parseImagesAndLinks(html, currentUrl);

        if (images.length > 0) {
          totalImages += images.length;
          this.onImagesFound({
            page_url: currentUrl,
            images: images,
            total_images: totalImages
          });
        }

        // Enqueue child links
        if (depth < this.maxDepth && !this.isStopped) {
          for (const link of childLinks) {
            if (!this.visitedUrls.has(link) && !queue.some(q => q.url === link)) {
              if (queue.length + pagesCrawled < this.maxPages * 2) {
                queue.push({ url: link, depth: depth + 1 });
              }
            }
          }
        }

        this.onPageDone({
          url: currentUrl,
          pages_crawled: pagesCrawled,
          queue_size: queue.length,
          total_images: totalImages
        });

      } catch (err) {
        this.onPageError({
          url: currentUrl,
          error: err.message || 'Failed to fetch',
          depth: depth
        });
      }

      // Small async yield
      await new Promise(r => setTimeout(r, 100));
    }

    this.onComplete({
      pages_crawled: pagesCrawled,
      total_images: totalImages
    });
  }
}
