import { copyToClipboard, downloadImageDirect, showToast } from './utils.js';

export class Lightbox {
  constructor() {
    this.modal = document.getElementById('lightbox-modal');
    this.imgElement = document.getElementById('lightbox-image');
    this.counterEl = document.getElementById('lightbox-counter');
    this.titleEl = document.getElementById('lightbox-title');
    this.metaDimEl = document.getElementById('lightbox-meta-dim');
    this.metaFormatEl = document.getElementById('lightbox-meta-format');
    this.metaSourceLink = document.getElementById('lightbox-meta-source');
    this.metaDirectLink = document.getElementById('lightbox-meta-direct');

    this.btnPrev = document.getElementById('lightbox-btn-prev');
    this.btnNext = document.getElementById('lightbox-btn-next');
    this.btnClose = document.getElementById('lightbox-btn-close');
    this.btnZoomIn = document.getElementById('lightbox-btn-zoom-in');
    this.btnZoomOut = document.getElementById('lightbox-btn-zoom-out');
    this.btnZoomReset = document.getElementById('lightbox-btn-zoom-reset');
    this.btnCopyUrl = document.getElementById('lightbox-btn-copy');
    this.btnDownload = document.getElementById('lightbox-btn-download');

    this.imagesList = [];
    this.currentIndex = 0;
    this.currentZoom = 1;

    this.initEvents();
  }

  initEvents() {
    this.btnClose?.addEventListener('click', () => this.close());
    this.btnPrev?.addEventListener('click', (e) => { e.stopPropagation(); this.prev(); });
    this.btnNext?.addEventListener('click', (e) => { e.stopPropagation(); this.next(); });

    this.btnZoomIn?.addEventListener('click', () => this.zoom(0.25));
    this.btnZoomOut?.addEventListener('click', () => this.zoom(-0.25));
    this.btnZoomReset?.addEventListener('click', () => this.resetZoom());

    this.btnCopyUrl?.addEventListener('click', () => {
      const item = this.getCurrentItem();
      if (item) copyToClipboard(item.url);
    });

    const mobileCopyBtn = document.getElementById('mobile-lightbox-copy');
    mobileCopyBtn?.addEventListener('click', () => {
      const item = this.getCurrentItem();
      if (item) copyToClipboard(item.url);
    });

    this.btnDownload?.addEventListener('click', () => {
      const item = this.getCurrentItem();
      if (item) downloadImageDirect(item.url);
    });

    const mobileDownloadBtn = document.getElementById('mobile-lightbox-download');
    mobileDownloadBtn?.addEventListener('click', () => {
      const item = this.getCurrentItem();
      if (item) downloadImageDirect(item.url);
    });

    // Close on backdrop click
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target.id === 'lightbox-stage') {
        this.close();
      }
    });

    // Keyboard navigation
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowLeft') this.prev();
      else if (e.key === 'ArrowRight') this.next();
      else if (e.key === '+' || e.key === '=') this.zoom(0.25);
      else if (e.key === '-') this.zoom(-0.25);
    });

    // Mobile Touch Swipe Navigation & Double-Tap Zoom
    let touchStartX = 0;
    let touchStartY = 0;
    let lastTapTime = 0;

    const stage = document.getElementById('lightbox-stage');
    if (stage) {
      stage.addEventListener('touchstart', (e) => {
        if (!this.isOpen() || e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      stage.addEventListener('touchend', (e) => {
        if (!this.isOpen() || !e.changedTouches || e.changedTouches.length === 0) return;
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;

        // Double tap detection
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTapTime;
        if (tapLength < 300 && tapLength > 50 && Math.abs(diffX) < 20 && Math.abs(diffY) < 20) {
          // Double tap to toggle zoom between 1x and 2x
          if (this.currentZoom > 1.2) {
            this.resetZoom();
          } else {
            this.currentZoom = 2.0;
            this.applyZoom();
          }
          lastTapTime = currentTime;
          return;
        }
        lastTapTime = currentTime;

        // Horizontal swipe detection (minimum 45px swipe)
        if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.4 && this.currentZoom <= 1.1) {
          if (diffX < 0) {
            // Swiped Left -> Next image
            this.next();
          } else {
            // Swiped Right -> Previous image
            this.prev();
          }
        }
      }, { passive: true });
    }
  }

  setImages(list) {
    this.imagesList = list;
  }

  isOpen() {
    return this.modal?.classList.contains('active');
  }

  open(index = 0) {
    if (!this.imagesList || this.imagesList.length === 0) return;
    this.currentIndex = Math.max(0, Math.min(index, this.imagesList.length - 1));
    this.resetZoom();
    this.render();
    this.modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.modal?.classList.remove('active');
    document.body.style.overflow = '';
  }

  prev() {
    if (this.imagesList.length <= 1) return;
    this.currentIndex = (this.currentIndex - 1 + this.imagesList.length) % this.imagesList.length;
    this.resetZoom();
    this.render();
  }

  next() {
    if (this.imagesList.length <= 1) return;
    this.currentIndex = (this.currentIndex + 1) % this.imagesList.length;
    this.resetZoom();
    this.render();
  }

  getCurrentItem() {
    return this.imagesList[this.currentIndex] || null;
  }

  zoom(delta) {
    this.currentZoom = Math.max(0.5, Math.min(3.0, this.currentZoom + delta));
    this.applyZoom();
  }

  resetZoom() {
    this.currentZoom = 1;
    this.applyZoom();
  }

  applyZoom() {
    if (this.imgElement) {
      this.imgElement.style.transform = `scale(${this.currentZoom})`;
      this.imgElement.style.transition = 'transform 0.15s ease-out';
    }
  }

  render() {
    const item = this.getCurrentItem();
    if (!item) return;

    this.counterEl.textContent = `${this.currentIndex + 1} / ${this.imagesList.length}`;
    this.titleEl.textContent = item.alt || item.url.split('/').pop().split('?')[0] || 'Image';
    this.titleEl.title = item.url;

    // Set preview image with multi-tier proxy fallback
    this.imgElement.src = '';
    let proxyStage = 0;
    const tryLoadLightbox = (srcUrl) => {
      const tempImg = new Image();
      tempImg.onload = () => {
        this.imgElement.src = srcUrl;
        if (tempImg.naturalWidth && tempImg.naturalHeight) {
          this.metaDimEl.textContent = `${tempImg.naturalWidth} × ${tempImg.naturalHeight}`;
        }
      };
      tempImg.onerror = () => {
        if (proxyStage === 0) {
          proxyStage = 1;
          tryLoadLightbox(`/api/proxy-image?url=${encodeURIComponent(item.url)}`);
        } else if (proxyStage === 1) {
          proxyStage = 2;
          tryLoadLightbox(`https://api.allorigins.win/raw?url=${encodeURIComponent(item.url)}`);
        } else {
          this.imgElement.src = item.url;
          this.metaDimEl.textContent = 'Hotlink Protected';
        }
      };
      tempImg.src = srcUrl;
    };

    tryLoadLightbox(item.url);

    this.metaFormatEl.textContent = item.format || 'IMAGE';
    
    if (this.metaSourceLink) {
      this.metaSourceLink.href = item.source_page || '#';
      this.metaSourceLink.textContent = item.source_page ? (new URL(item.source_page)).hostname : 'Origin';
    }

    if (this.metaDirectLink) {
      this.metaDirectLink.href = item.url;
    }
  }
}
