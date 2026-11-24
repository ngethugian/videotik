/**
 * KAI TỒ REVIEW – AUTO VIDEO COMPOSER ENGINE (video-composer.js)
 * Tự động tìm ảnh nền cố định (background.png ở thư mục gốc hoặc assets/)
 * và ghép video vào đúng vùng trống bên phải.
 */

class AutoVideoComposer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    // Vùng trống bên phải cố định theo đúng ảnh nền gốc
    this.videoSlot = {
      xRatio: 0.475,
      yRatio: 0.21,
      wRatio: 0.50,
      hRatio: 0.73
    };

    this.bgImage = null;
    this.bgLoaded = false;

    this.videoEl = null;
    this.videoFile = null;
    this.videoUrl = null;
    this.videoLoaded = false;

    this.width = 1080;
    this.height = 1920;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.onTimeUpdate = null;
    this._startPreviewLoop();
  }

  /**
   * Tìm ảnh nền ở cả thư mục gốc (background.png) lẫn thư mục assets/
   */
  async loadFixedBackground() {
    const paths = [
      './background.png',
      './background.jpg',
      './background.jpeg',
      './assets/background.png',
      './assets/background.jpg',
      './assets/background.jpeg'
    ];

    for (const src of paths) {
      try {
        const img = await this._loadImage(src);
        this.bgImage = img;
        this.bgLoaded = true;

        const targetW = 1080;
        const targetH = Math.round((targetW * (img.naturalHeight / img.naturalWidth)) / 2) * 2;
        this.width = targetW;
        this.height = targetH;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.renderPreview();
        return true;
      } catch (_) {
        // Thử đường dẫn kế tiếp
      }
    }

    this.bgLoaded = false;
    return false;
  }

  _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Không nạp được ảnh: ${src}`));
      img.src = src;
    });
  }

  /**
   * Nạp file/Blob video MP4 (từ máy tính hoặc vừa tải tự động từ link TikTok)
   */
  loadVideoFile(file) {
    return new Promise((resolve, reject) => {
      this._releaseVideoMemory();

      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.src = url;
      video.playsInline = true;
      video.preload = 'auto';
      video.muted = false;

      video.onloadedmetadata = () => {
        if (!video.videoWidth || !video.videoHeight) {
          URL.revokeObjectURL(url);
          return reject(new Error('File không có luồng hình ảnh hợp lệ. Hãy chọn file MP4 chuẩn H.264.'));
        }

        this.videoEl = video;
        this.videoFile = file;
        this.videoUrl = url;
        this.videoLoaded = true;

        video.currentTime = 0.05;
        video.addEventListener('seeked', () => this.renderPreview(), { once: true });

        resolve({
          name: file.name || 'tiktok_video.mp4',
          width: video.videoWidth,
          height: video.videoHeight,
          duration: isFinite(video.duration) ? video.duration : 0,
          sizeBytes: file.size || 0
        });
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Trình duyệt không đọc được file video này. Hãy dùng file MP4 chuẩn H.264/AAC.'));
      };
    });
  }

  _releaseVideoMemory() {
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
      this.videoEl = null;
    }
    if (this.videoUrl) {
      URL.revokeObjectURL(this.videoUrl);
      this.videoUrl = null;
    }
    this.videoFile = null;
    this.videoLoaded = false;
  }

  computeVideoRect(canvasW, canvasH, videoW, videoH) {
    const slotX = canvasW * this.videoSlot.xRatio;
    const slotY = canvasH * this.videoSlot.yRatio;
    const slotW = canvasW * this.videoSlot.wRatio;
    const slotH = canvasH * this.videoSlot.hRatio;

    const scale = Math.min(slotW / videoW, slotH / videoH);
    const drawW = Math.round(videoW * scale);
    const drawH = Math.round(videoH * scale);
    const drawX = Math.round(slotX + (slotW - drawW) / 2);
    const drawY = Math.round(slotY + (slotH - drawH) / 2);

    return { x: drawX, y: drawY, w: drawW, h: drawH, slotX, slotY, slotW, slotH };
  }

  composeFrame(ctx, targetW, targetH, videoSource = this.videoEl, isExport = false) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    if (this.bgLoaded && this.bgImage) {
      ctx.drawImage(this.bgImage, 0, 0, targetW, targetH);
    }

    if (videoSource && videoSource.readyState >= 2 && videoSource.videoWidth > 0) {
      const rect = this.computeVideoRect(
        targetW,
        targetH,
        videoSource.videoWidth,
        videoSource.videoHeight
      );
      ctx.drawImage(videoSource, rect.x, rect.y, rect.w, rect.h);
    } else if (!isExport) {
      const sx = targetW * this.videoSlot.xRatio;
      const sy = targetH * this.videoSlot.yRatio;
      const sw = targetW * this.videoSlot.wRatio;
      const sh = targetH * this.videoSlot.hRatio;

      ctx.save();
      ctx.strokeStyle = 'rgba(229, 9, 20, 0.45)';
      ctx.lineWidth = Math.max(3, targetW * 0.004);
      ctx.setLineDash([18, 12]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(229, 9, 20, 0.75)';
      ctx.font = `700 ${Math.round(targetW * 0.032)}px Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('VÙNG TỰ ĐỘNG', sx + sw / 2, sy + sh / 2 - 22);
      ctx.fillText('GHÉP VIDEO', sx + sw / 2, sy + sh / 2 + 22);
      ctx.restore();
    }
  }

  renderPreview() {
    this.composeFrame(this.ctx, this.width, this.height, this.videoEl, false);
  }

  togglePlayPreview() {
    if (!this.videoLoaded || !this.videoEl) return false;
    if (this.videoEl.paused) {
      if (this.videoEl.ended) this.videoEl.currentTime = 0;
      this.videoEl.play().catch(() => {});
      return true;
    } else {
      this.videoEl.pause();
      return false;
    }
  }

  pausePreview() {
    if (this.videoEl && !this.videoEl.paused) {
      this.videoEl.pause();
    }
  }

  restartPreview() {
    if (!this.videoEl) return;
    this.videoEl.currentTime = 0;
    this.renderPreview();
  }

  _startPreviewLoop() {
    const tick = () => {
      if (this.videoLoaded && this.videoEl) {
        if (!this.videoEl.paused && !this.videoEl.ended) {
          this.renderPreview();
        }
        if (this.onTimeUpdate) {
          this.onTimeUpdate(this.videoEl.currentTime || 0, this.videoEl.duration || 0, !this.videoEl.paused);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

window.AutoVideoComposer = AutoVideoComposer;
