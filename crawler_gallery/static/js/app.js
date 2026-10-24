import { GalleryManager } from './gallery.js';
import { Lightbox } from './lightbox.js';
import { formatSeconds, showToast, truncateString } from './utils.js';

class CrawlerApp {
  constructor() {
    this.lightbox = new Lightbox();
    this.gallery = new GalleryManager(this.lightbox);

    // Form elements
    this.form = document.getElementById('crawl-form');
    this.urlInput = document.getElementById('crawl-url-input');
    this.clearInputBtn = document.getElementById('clear-url-btn');
    this.btnStart = document.getElementById('btn-start-crawl');
    this.btnStop = document.getElementById('btn-stop-crawl');
    this.statusBadge = document.getElementById('app-status-badge');
    this.statusText = document.getElementById('app-status-text');

    // Settings
    this.settingsToggle = document.getElementById('toggle-settings-btn');
    this.settingsDrawer = document.getElementById('settings-drawer');
    this.depthInput = document.getElementById('crawl-depth');
    this.depthValue = document.getElementById('depth-val');
    this.maxPagesInput = document.getElementById('crawl-max-pages');
    this.maxPagesValue = document.getElementById('max-pages-val');
    this.sameDomainToggle = document.getElementById('crawl-same-domain');
    this.metaImagesToggle = document.getElementById('crawl-meta-images');

    // Telemetry & logs
    this.telemetryPanel = document.getElementById('telemetry-panel');
    this.statImages = document.getElementById('stat-total-images');
    this.statPages = document.getElementById('stat-pages-scanned');
    this.statQueue = document.getElementById('stat-queue-size');
    this.statTime = document.getElementById('stat-crawl-time');
    this.currentScrapeUrl = document.getElementById('current-scrape-url');
    this.terminalToggle = document.getElementById('toggle-terminal-btn');
    this.terminalLogs = document.getElementById('terminal-logs');

    // State
    this.eventSource = null;
    this.currentSessionId = null;
    this.crawlStartTime = null;
    this.crawlTimerInterval = null;
    this.isCrawling = false;

    this.init();
  }

  init() {
    this.initFormEvents();
    this.initSettingsEvents();
    this.initTerminalToggle();
  }

  initFormEvents() {
    // Input clear button visibility
    this.urlInput?.addEventListener('input', () => {
      this.clearInputBtn.style.display = this.urlInput.value ? 'block' : 'none';
    });

    this.clearInputBtn?.addEventListener('click', () => {
      this.urlInput.value = '';
      this.clearInputBtn.style.display = 'none';
      this.urlInput.focus();
    });

    // Form submit / Start crawl
    this.form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.startCrawl();
    });

    // Stop crawl
    this.btnStop?.addEventListener('click', () => {
      this.stopCrawl();
    });
  }

  initSettingsEvents() {
    // Drawer open/close
    this.settingsToggle?.addEventListener('click', () => {
      const isOpen = this.settingsDrawer.classList.toggle('open');
      this.settingsToggle.classList.toggle('open', isOpen);
    });

    // Sliders
    this.depthInput?.addEventListener('input', (e) => {
      const val = e.target.value;
      let label = `Depth ${val}`;
      if (val === '0') label = '0 (Single Page)';
      else if (val === '1') label = '1 (Page + Direct Links)';
      else if (val === '2') label = '2 (2 Levels Deep)';
      else label = `${val} (Deep Crawl)`;
      this.depthValue.textContent = label;
    });

    this.maxPagesInput?.addEventListener('input', (e) => {
      this.maxPagesValue.textContent = `${e.target.value} Pages`;
    });
  }

  initTerminalToggle() {
    this.terminalToggle?.addEventListener('click', () => {
      const isOpen = this.terminalLogs.classList.toggle('open');
      this.terminalToggle.textContent = isOpen ? 'Hide Activity Log ▲' : 'Show Activity Log ▼';
    });
  }

  logTerminal(text, type = 'info') {
    if (!this.terminalLogs) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    entry.innerHTML = `
      <span class="log-time">[${timeStr}]</span>
      <span class="log-event-${type}">${escapeHtml(text)}</span>
    `;

    this.terminalLogs.appendChild(entry);
    this.terminalLogs.scrollTop = this.terminalLogs.scrollHeight;
  }

  startCrawl() {
    const rawUrl = this.urlInput.value.trim();
    if (!rawUrl) {
      showToast('Please enter a website URL', 'error');
      this.urlInput.focus();
      return;
    }

    let targetUrl = rawUrl;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
      this.urlInput.value = targetUrl;
    }

    if (this.isCrawling) {
      this.stopCrawl();
    }

    // Reset Gallery if desired or append?
    // Let's clear gallery for a fresh session
    this.gallery.clear();
    this.terminalLogs.innerHTML = '';

    // Params
    const depth = this.depthInput.value;
    const maxPages = this.maxPagesInput.value;
    const sameDomain = this.sameDomainToggle.checked;
    const includeMeta = this.metaImagesToggle.checked;

    // Build SSE URL
    const query = new URLSearchParams({
      url: targetUrl,
      depth: depth,
      max_pages: maxPages,
      same_domain: sameDomain ? 'true' : 'false',
      include_meta: includeMeta ? 'true' : 'false'
    });

    const sseUrl = `/api/crawl/stream?${query.toString()}`;

    // Update UI state to Crawling
    this.setCrawlerState(true);
    this.logTerminal(`Starting recursive crawl on: ${targetUrl}`, 'info');
    this.logTerminal(`Config: Depth=${depth}, MaxPages=${maxPages}, SameDomain=${sameDomain}`, 'info');

    this.eventSource = new EventSource(sseUrl);

    this.eventSource.addEventListener('session', (e) => {
      try {
        const data = JSON.parse(e.data);
        this.currentSessionId = data.session_id;
      } catch (err) {}
    });

    this.eventSource.addEventListener('init', (e) => {
      try {
        const data = JSON.parse(e.data);
        showToast(`Connected to crawler engine for ${data.start_domain}`, 'info');
      } catch (err) {}
    });

    this.eventSource.addEventListener('page_start', (e) => {
      try {
        const data = JSON.parse(e.data);
        this.currentScrapeUrl.textContent = truncateString(data.url, 60);
        this.currentScrapeUrl.title = data.url;
        this.statPages.textContent = `${data.pages_crawled} / ${this.maxPagesInput.value}`;
        this.statQueue.textContent = `${data.queue_size} in queue`;
        this.logTerminal(`Scraping page [Depth ${data.depth}]: ${data.url}`, 'info');
      } catch (err) {}
    });

    this.eventSource.addEventListener('images_found', (e) => {
      try {
        const data = JSON.parse(e.data);
        this.gallery.addImages(data.images);
        this.statImages.textContent = data.total_images;
        this.logTerminal(`Discovered ${data.images.length} new images on ${data.page_url}`, 'success');
      } catch (err) {}
    });

    this.eventSource.addEventListener('page_done', (e) => {
      try {
        const data = JSON.parse(e.data);
        this.statPages.textContent = `${data.pages_crawled} / ${this.maxPagesInput.value}`;
        this.statQueue.textContent = `${data.queue_size} in queue`;
      } catch (err) {}
    });

    this.eventSource.addEventListener('page_error', (e) => {
      try {
        const data = JSON.parse(e.data);
        this.logTerminal(`Page error on ${data.url}: ${data.error}`, 'warn');
      } catch (err) {}
    });

    this.eventSource.addEventListener('complete', (e) => {
      try {
        const data = JSON.parse(e.data);
        this.logTerminal(`Crawl completed! Total ${data.total_images} images gathered across ${data.pages_crawled} pages.`, 'success');
        showToast(`🎉 Crawl finished! Found ${data.total_images} images.`, 'success', 6000);
      } catch (err) {}
      this.finishCrawl('completed');
    });

    this.eventSource.addEventListener('stopped', (e) => {
      this.logTerminal('Crawl cancelled by user.', 'warn');
      showToast('Crawl stopped.', 'info');
      this.finishCrawl('ready');
    });

    this.eventSource.addEventListener('error', (e) => {
      if (this.isCrawling) {
        this.logTerminal('Connection closed or completed.', 'info');
        this.finishCrawl('completed');
      }
    });
  }

  async stopCrawl() {
    if (!this.isCrawling) return;

    if (this.currentSessionId) {
      try {
        await fetch(`/api/crawl/stop?session_id=${encodeURIComponent(this.currentSessionId)}`, {
          method: 'POST'
        });
      } catch (err) {}
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.finishCrawl('ready');
  }

  finishCrawl(finalStatus = 'completed') {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.setCrawlerState(false, finalStatus);
  }

  setCrawlerState(isCrawling, statusMode = 'crawling') {
    this.isCrawling = isCrawling;

    if (isCrawling) {
      this.btnStart.style.display = 'none';
      this.btnStop.style.display = 'inline-flex';
      this.statusBadge.className = 'status-badge active';
      this.statusText.textContent = 'Crawling...';
      this.telemetryPanel.classList.add('visible');

      // Start elapsed timer
      this.crawlStartTime = Date.now();
      clearInterval(this.crawlTimerInterval);
      this.crawlTimerInterval = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - this.crawlStartTime) / 1000);
        this.statTime.textContent = formatSeconds(elapsedSec);
      }, 1000);
    } else {
      this.btnStart.style.display = 'inline-flex';
      this.btnStop.style.display = 'none';
      clearInterval(this.crawlTimerInterval);

      if (statusMode === 'completed') {
        this.statusBadge.className = 'status-badge completed';
        this.statusText.textContent = 'Crawl Finished';
      } else {
        this.statusBadge.className = 'status-badge';
        this.statusText.textContent = 'Engine Ready';
      }
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Bootstrap on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new CrawlerApp();
});
