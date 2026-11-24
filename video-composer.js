/**
 * KAI TỒ REVIEW – AUTO VIDEO COMPOSER ENGINE (video-composer.js)
 * - Tự động tìm ảnh nền cố định (background.png ở thư mục gốc hoặc assets/).
 * - Video dọc: giữ nguyên bình thường.
 * - Video ngang: tự động chuyển sang khung dọc 9:16 (không méo hình).
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

    // CHẾ ĐỘ CHUYỂN VIDEO NGANG -> DỌC 9:16:
    // 'crop'   = Tự cắt lấy phần giữa thành video dọc 9:16 sắc nét (Mặc định)
    // 'blur'   = Giữ nguyên hết chiều ngang ở giữa + tự tạo nền mờ trên dưới thành khung dọc 9:16
    // 'rotate' = Xoay ngang thành dọc 90 độ
    this.landscapeMode = 'crop';

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

  /**
   * Tính khung hiển thị căn giữa trong vùng bên phải theo tỷ lệ mong muốn
   */
  computeVideoRect(canvasW, canvasH, targetRatioW, targetRatioH) {
    const slotX = canvasW * this.videoSlot.xRatio;
    const slotY = canvasH * this.videoSlot.yRatio;
    const slotW = canvasW * this.videoSlot.wRatio;
    const slotH = canvasH * this.videoSlot.hRatio;

    const scale = Math.min(slotW / targetRatioW, slotH / targetRatioH);
    const drawW = Math.round(targetRatioW * scale);
    const drawH = Math.round(targetRatioH * scale);
    const drawX = Math.round(slotX + (slotW - drawW) / 2);
    const drawY = Math.round(slotY + (slotH - drawH) / 2);

    return { x: drawX, y: drawY, w: drawW, h: drawH, slotX, slotY, slotW, slotH };
  }

  /**
   * Vẽ video ngang đã được chuyển sang khung dọc 9:16
   */
  _drawLandscapeAsVertical(ctx, videoSource, targetW, targetH) {
    const vw = videoSource.videoWidth;
    const vh = videoSource.videoHeight;

    // Tạo khung dọc chuẩn 9:16 nằm gọn và căn giữa trong vùng bên phải
    const box = this.computeVideoRect(targetW, targetH, 9, 16);

    ctx.save();
    // Giới hạn vùng vẽ gọn trong khung dọc 9:16
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();

    if (this.landscapeMode === 'blur') {
      // Kiểu 1: Nền mờ lấp đầy khung dọc 9:16 + video ngang sắc nét giữ đủ hình ở giữa
      const srcCoverW = vh * (box.w / box.h);
      const srcCoverX = (vw - srcCoverW) / 2;
      const pad = 24;

      ctx.save();
      ctx.filter = 'blur(18px) brightness(0.75)';
      ctx.drawImage(
        videoSource,
        srcCoverX, 0, srcCoverW, vh,
        box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2
      );
      ctx.restore();

      const fgW = box.w;
      const fgH = Math.round(fgW * (vh / vw));
      const fgY = Math.round(box.y + (box.h - fgH) / 2);
      ctx.drawImage(videoSource, 0, 0, vw, vh, box.x, fgY, fgW, fgH);
    } else if (this.landscapeMode === 'rotate') {
      // Kiểu 2: Xoay video ngang 90 độ thành video dọc
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const rotScale = Math.min(box.h / vw, box.w / vh);
      const rw = vw * rotScale;
      const rh = vh * rotScale;

      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(videoSource, -rw / 2, -rh / 2, rw, rh);
    } else {
      // Kiểu mặc định ('crop'): Tự cắt phần giữa của video ngang thành dọc 9:16 đầy khung
      const srcW = vh * (box.w / box.h);
      const srcX = (vw - srcW) / 2;
      ctx.drawImage(videoSource, srcX, 0, srcW, vh, box.x, box.y, box.w, box.h);
    }

    ctx.restore();
  }

  composeFrame(ctx, targetW, targetH, videoSource = this.videoEl, isExport = false) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    if (this.bgLoaded && this.bgImage) {
      ctx.drawImage(this.bgImage, 0, 0, targetW, targetH);
    }

    if (videoSource && videoSource.readyState >= 2 && videoSource.videoWidth > 0) {
      const vw = videoSource.videoWidth;
      const vh = videoSource.videoHeight;

      if (vw > vh) {
        // Video ngang -> tự động chuyển sang khung dọc 9:16
        this._drawLandscapeAsVertical(ctx, videoSource, targetW, targetH);
      } else {
        // Video dọc hoặc vuông -> hiển thị bình thường
        const rect = this.computeVideoRect(targetW, targetH, vw, vh);
        ctx.drawImage(videoSource, rect.x, rect.y, rect.w, rect.h);
      }
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
