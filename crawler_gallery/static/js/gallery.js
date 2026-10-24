import { copyToClipboard, downloadImageDirect, showToast, truncateString } from './utils.js';

export class GalleryManager {
  constructor(lightbox) {
    this.lightbox = lightbox;
    this.container = document.getElementById('gallery-container');
    this.emptyState = document.getElementById('gallery-empty-state');
    this.countBadge = document.getElementById('gallery-count-badge');
    this.selectedCountBadge = document.getElementById('selected-count-badge');
    this.searchInput = document.getElementById('gallery-search-input');
    this.btnSelectAll = document.getElementById('btn-select-all');
    this.btnDownloadSelected = document.getElementById('btn-download-selected');
    this.btnExportUrls = document.getElementById('btn-export-urls');
    this.btnClearGallery = document.getElementById('btn-clear-gallery');

    this.allImages = [];
    this.filteredImages = [];
    this.selectedUrls = new Set();
    this.currentViewMode = 'masonry-view';
    this.currentFormatFilter = 'ALL';
    this.searchQuery = '';

    this.initEvents();
  }

  initEvents() {
    // Layout switches
    document.querySelectorAll('.layout-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setViewMode(btn.dataset.layout);
      });
    });

    // Format filter pills
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.currentFormatFilter = pill.dataset.format || 'ALL';
        this.applyFilterAndRender();
      });
    });

    // Search input
    this.searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.applyFilterAndRender();
    });

    // Select all / deselect all
    this.btnSelectAll?.addEventListener('click', () => {
      if (this.selectedUrls.size === this.filteredImages.length && this.filteredImages.length > 0) {
        this.selectedUrls.clear();
      } else {
        this.filteredImages.forEach(img => this.selectedUrls.add(img.url));
      }
      this.updateSelectionUI();
    });

    // Download Selected as ZIP
    this.btnDownloadSelected?.addEventListener('click', async () => {
      const urlsToDownload = this.selectedUrls.size > 0 
        ? Array.from(this.selectedUrls)
        : this.filteredImages.map(img => img.url);

      if (urlsToDownload.length === 0) {
        showToast('No images to download', 'error');
        return;
      }

      showToast(`Generating ZIP package for ${urlsToDownload.length} images...`, 'info', 5000);

      try {
        const response = await fetch('/api/export-zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: urlsToDownload })
        });

        if (!response.ok) throw new Error('ZIP generation failed');

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `crawled_images_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
        showToast('ZIP downloaded successfully!', 'success');
      } catch (err) {
        showToast('Failed to export ZIP archive: ' + err.message, 'error');
      }
    });

    // Export URLs as TXT
    this.btnExportUrls?.addEventListener('click', () => {
      const urls = this.filteredImages.map(i => i.url).join('\n');
      if (!urls) {
        showToast('No URLs to export', 'error');
        return;
      }
      const blob = new Blob([urls], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `image_urls_${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast(`Exported ${this.filteredImages.length} image URLs to TXT`, 'success');
    });

    // Clear Gallery
    this.btnClearGallery?.addEventListener('click', () => {
      if (confirm('Clear all crawled images from current gallery view?')) {
        this.clear();
      }
    });
  }

  setViewMode(mode) {
    this.currentViewMode = mode;
    this.container.className = `gallery-grid ${mode}`;
  }

  clear() {
    this.allImages = [];
    this.filteredImages = [];
    this.selectedUrls.clear();
    this.container.innerHTML = '';
    this.updateSelectionUI();
    this.updateCounters();
    this.emptyState.style.display = 'flex';
  }

  addImages(newImages) {
    if (!newImages || newImages.length === 0) return;

    const added = [];
    for (const img of newImages) {
      if (!this.allImages.some(existing => existing.url === img.url)) {
        this.allImages.push(img);
        added.push(img);
      }
    }

    if (added.length > 0) {
      this.applyFilterAndRender();
    }
  }

  applyFilterAndRender() {
    this.filteredImages = this.allImages.filter(item => {
      // Format filter
      if (this.currentFormatFilter !== 'ALL') {
        if (item.format !== this.currentFormatFilter) return false;
      }

      // Search query
      if (this.searchQuery) {
        const query = this.searchQuery;
        const matchesAlt = (item.alt || '').toLowerCase().includes(query);
        const matchesUrl = item.url.toLowerCase().includes(query);
        const matchesPage = (item.source_page || '').toLowerCase().includes(query);
        if (!matchesAlt && !matchesUrl && !matchesPage) return false;
      }

      return true;
    });

    this.lightbox.setImages(this.filteredImages);
    this.render();
    this.updateCounters();
  }

  updateCounters() {
    if (this.countBadge) {
      this.countBadge.textContent = `${this.filteredImages.length} / ${this.allImages.length}`;
    }
    if (this.filteredImages.length === 0) {
      this.emptyState.style.display = 'flex';
    } else {
      this.emptyState.style.display = 'none';
    }
  }

  updateSelectionUI() {
    if (this.selectedCountBadge) {
      this.selectedCountBadge.textContent = `${this.selectedUrls.size} selected`;
      this.selectedCountBadge.style.display = this.selectedUrls.size > 0 ? 'inline-block' : 'none';
    }

    // Toggle card selected classes
    document.querySelectorAll('.image-card').forEach(card => {
      const url = card.dataset.url;
      if (this.selectedUrls.has(url)) {
        card.classList.add('selected');
        const checkIcon = card.querySelector('.card-select-checkbox');
        if (checkIcon) checkIcon.innerHTML = '✓';
      } else {
        card.classList.remove('selected');
        const checkIcon = card.querySelector('.card-select-checkbox');
        if (checkIcon) checkIcon.innerHTML = '';
      }
    });

    if (this.btnSelectAll) {
      this.btnSelectAll.textContent = 
        this.selectedUrls.size === this.filteredImages.length && this.filteredImages.length > 0
          ? 'Deselect All'
          : 'Select All';
    }
  }

  render() {
    this.container.innerHTML = '';

    this.filteredImages.forEach((item, index) => {
      const card = this.createImageCard(item, index);
      this.container.appendChild(card);
    });

    this.updateSelectionUI();
  }

  createImageCard(item, index) {
    const card = document.createElement('div');
    card.className = `image-card ${this.selectedUrls.has(item.url) ? 'selected' : ''}`;
    card.dataset.url = item.url;
    card.dataset.index = index;

    const filename = item.url.split('/').pop().split('?')[0] || 'Image';
    const isSelected = this.selectedUrls.has(item.url);

    card.innerHTML = `
      <div class="card-select-checkbox" title="Select for batch action">${isSelected ? '✓' : ''}</div>
      <span class="card-format-tag">${item.format || 'IMG'}</span>
      <span class="card-resolution-tag" id="res-${index}">Measuring...</span>

      <div class="card-media-wrap loading" id="wrap-${index}">
        <img alt="${escapeHtml(item.alt || filename)}" loading="lazy" />
      </div>

      <div class="card-action-overlay">
        <div style="display:flex; justify-content:flex-end;">
          <button class="overlay-action-btn copy-btn" title="Copy direct image URL">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            URL
          </button>
        </div>

        <button class="overlay-center-btn" title="Open in Lightbox">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
        </button>

        <div class="overlay-bottom-bar">
          <span style="font-size: 0.72rem; color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;">
            ${escapeHtml(truncateString(item.alt || filename, 22))}
          </span>
          <button class="overlay-action-btn download-btn" title="Download Image">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
        </div>
      </div>
    `;

    const imgEl = card.querySelector('img');
    const wrapEl = card.querySelector('.card-media-wrap');
    const resEl = card.querySelector('.card-resolution-tag');

    // Progressive image loading with multi-tier CORS/hotlink proxy fallback
    let proxyStage = 0;
    const tryLoad = (srcUrl) => {
      imgEl.src = srcUrl;
      imgEl.onload = () => {
        wrapEl.classList.remove('loading');
        if (imgEl.naturalWidth && imgEl.naturalHeight) {
          resEl.textContent = `${imgEl.naturalWidth} × ${imgEl.naturalHeight}`;
        } else {
          resEl.textContent = 'Loaded';
        }
      };

      imgEl.onerror = () => {
        if (proxyStage === 0) {
          proxyStage = 1;
          tryLoad(`/api/proxy-image?url=${encodeURIComponent(item.url)}`);
        } else if (proxyStage === 1) {
          proxyStage = 2;
          tryLoad(`https://api.allorigins.win/raw?url=${encodeURIComponent(item.url)}`);
        } else {
          // If all proxies failed, show clean placeholder
          wrapEl.classList.remove('loading');
          wrapEl.classList.add('failed');
          wrapEl.innerHTML = `
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            <span style="margin-top:6px; font-size:0.7rem;">Protected Link</span>
          `;
          resEl.textContent = 'Blocked';
        }
      };
    };

    tryLoad(item.url);

    // Event handlers
    const selectCheck = card.querySelector('.card-select-checkbox');
    selectCheck.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.selectedUrls.has(item.url)) {
        this.selectedUrls.delete(item.url);
      } else {
        this.selectedUrls.add(item.url);
      }
      this.updateSelectionUI();
    });

    const copyBtn = card.querySelector('.copy-btn');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(item.url);
    });

    const downloadBtn = card.querySelector('.download-btn');
    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadImageDirect(item.url);
    });

    card.addEventListener('click', () => {
      this.lightbox.open(index);
    });

    return card;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
