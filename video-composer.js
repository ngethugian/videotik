/**
 * KAI TỒ REVIEW – AUTO VIDEO COMPOSER ENGINE (video-composer.js)
 * Nạp ảnh nền cố định (assets/background.png) và tự động đặt video vào vùng trống bên phải.
 */

class AutoVideoComposer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    // Vùng trống bên phải cố định theo đúng ảnh nền gốc (tính theo tỷ lệ 0.0 -> 1.0):
    // - Tránh chữ "XEM PHUN Ở TỬ SỈU" phía trên (kết thúc ở ~16% chiều cao)
    // - Tránh chữ "me:" và bàn tay nhân vật 3D bên trái (kết thúc ở ~45% chiều rộng)
    this.videoSlot = {
      xRatio: 0.475, // Bắt đầu từ 47.5% chiều rộng
      yRatio: 0.21,  // Bắt đầu từ 21% chiều cao
      wRatio: 0.50,  // Chiếm 50% chiều rộng (đến 97.5%, chừa lề phải 2.5%)
      hRatio: 0.73   // Chiếm 73% chiều cao (đến 94%, chừa lề dưới 6%)
    };

    // Ảnh nền gốc cố định
    this.bgImage = null;
    this.bgLoaded = false;

    // Video đầu vào
    this.videoEl = null;
    this.videoFile = null;
    this.videoUrl = null;
    this.videoLoaded = false;

    // Kích thước Canvas xem trước (mặc định 9:16 chuẩn 1080x1920, sẽ tự khớp tỷ lệ ảnh nền gốc)
    this.width = 1080;
    this.height = 1920;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.onTimeUpdate = null;
    this._startPreviewLoop();
  }

  /**
   * Nạp ảnh nền cố định từ assets/background.png
   * (Tự thử thêm assets/background.jpg nếu người dùng quên đổi đuôi file)
   */
  async loadFixedBackground() {
    const paths = ['assets/background.png', 'assets/background.jpg', 'assets/background.jpeg'];

    for (const src of paths) {
      try {
        const img = await this._loadImage(src);
        this.bgImage = img;
        this.bgLoaded = true;

        // Giữ nguyên 100% tỷ lệ khung hình ảnh nền gốc, chuẩn hóa chiều rộng 1080p chẵn pixel
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
   * Nạp file video MP4 từ máy tính và tự động đưa vào vùng bên phải
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

        // Hiển thị ngay khung hình đầu tiên lên ảnh nền
        video.currentTime = 0.05;
        video.addEventListener('seeked', () => this.renderPreview(), { once: true });

        resolve({
          name: file.name,
          width: video.videoWidth,
          height: video.videoHeight,
          duration: isFinite(video.duration) ? video.duration : 0,
          sizeBytes: file.size
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
   * Tính tọa độ & kích thước tự động để video nằm gọn, căn giữa trong vùng bên phải
   * và giữ nguyên 100% tỷ lệ khung hình gốc (không méo, không kéo giãn)
   */
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

  /**
   * Hàm vẽ khung hình hợp nhất (dùng chung cho cả Xem trước và Xuất MP4)
   * Đảm bảo file MP4 xuất ra giống 100% bản xem trước.
   */
  composeFrame(ctx, targetW, targetH, videoSource = this.videoEl, isExport = false) {
    // 1. Nền trắng dự phòng
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    // 2. Vẽ nguyên bản 100% ảnh nền gốc cố định (không cắt, không biến dạng)
    if (this.bgLoaded && this.bgImage) {
      ctx.drawImage(this.bgImage, 0, 0, targetW, targetH);
    }

    // 3. Vẽ video vào đúng vùng bên phải
    if (videoSource && videoSource.readyState >= 2 && videoSource.videoWidth > 0) {
      const rect = this.computeVideoRect(
        targetW,
        targetH,
        videoSource.videoWidth,
        videoSource.videoHeight
      );
      ctx.drawImage(videoSource, rect.x, rect.y, rect.w, rect.h);
    } else if (!isExport) {
      // Khung nét đứt nhẹ trên bản xem trước khi người dùng chưa tải video lên
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
