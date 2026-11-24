/**
 * KAI TỒ REVIEW – CORE CANVAS EDITOR ENGINE (editor.js)
 * Xử lý hiển thị Canvas, quản lý Layer, tương tác kéo thả / phóng to / xoay / crop.
 */

class KaiToEditor {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    // Kích thước logic mặc định (9:16 Full HD)
    this.canvasWidth = 1080;
    this.canvasHeight = 1920;
    this.aspectRatio = '9:16';

    // Danh sách lớp (index 0 là lớp dưới cùng, index cuối là lớp trên cùng)
    this.layers = [];
    this.selectedLayerId = null;

    // Trạng thái timeline & phát lại
    this.currentTime = 0;
    this.totalDuration = 10;
    this.isPlaying = false;
    this._lastFrameTs = 0;

    // Thu phóng khung nhìn xem trước
    this.zoomMode = 'fit'; // 'fit' hoặc 'manual'
    this.manualZoom = 1;

    // Trạng thái thao tác chuột / cảm ứng trên canvas
    this.interaction = null; // { mode: 'move'|'resize'|'rotate', handle, startX, startY, origLayer }
    this.snapLines = { x: null, y: null };

    // Callbacks báo cho UI cập nhật
    this.onChange = null;
    this.onTimeUpdate = null;

    this.resizeCanvasResolution(1080, 1920, '9:16');
    this._bindCanvasEvents();
    this._startRenderLoop();
  }

  /* =========================================================
     QUẢN LÝ ĐỘ PHÂN GIẢI & THU PHÓNG KHUNG NHÌN
     ========================================================= */
  resizeCanvasResolution(width, height, ratioKey = 'custom') {
    // Đảm bảo kích thước chẵn để tương thích chuẩn mã hóa H.264 MP4
    this.canvasWidth = Math.max(200, Math.round(width / 2) * 2);
    this.canvasHeight = Math.max(200, Math.round(height / 2) * 2);
    this.aspectRatio = ratioKey;

    this.canvas.width = this.canvasWidth;
    this.canvas.height = this.canvasHeight;

    this.updateViewportScale();
    this.render();
    this._emitChange();
  }

  updateViewportScale() {
    const viewport = document.getElementById('canvasViewport');
    if (!viewport) return;

    const pad = 40;
    const availW = Math.max(200, viewport.clientWidth - pad);
    const availH = Math.max(200, viewport.clientHeight - pad);

    let scale;
    if (this.zoomMode === 'fit') {
      scale = Math.min(availW / this.canvasWidth, availH / this.canvasHeight);
      scale = Math.min(scale, 1); // Không phóng vỡ ảnh quá 100% khi fit
      this.manualZoom = scale;
    } else {
      scale = this.manualZoom;
    }

    this.displayScale = scale;
    this.canvas.style.width = `${Math.round(this.canvasWidth * scale)}px`;
    this.canvas.style.height = `${Math.round(this.canvasHeight * scale)}px`;

    const label = document.getElementById('zoomLabel');
    if (label) {
      label.textContent = this.zoomMode === 'fit'
        ? `Vừa (${Math.round(scale * 100)}%)`
        : `${Math.round(scale * 100)}%`;
    }
  }

  setZoom(mode, delta = 0) {
    if (mode === 'fit') {
      this.zoomMode = 'fit';
    } else {
      this.zoomMode = 'manual';
      this.manualZoom = Math.min(2, Math.max(0.1, this.manualZoom + delta));
    }
    this.updateViewportScale();
  }

  /* =========================================================
     THÊM / XÓA / SẮP XẾP LỚP (LAYERS)
     ========================================================= */
  _genId() {
    return 'layer_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  createBaseLayer(partial) {
    return {
      id: this._genId(),
      name: 'Layer',
      type: 'image', // 'image' | 'video' | 'text'
      isBackground: false,
      x: 0,
      y: 0,
      width: 400,
      height: 400,
      rotation: 0,
      opacity: 100,
      borderRadius: 0,
      keepAspect: true,
      crop: { top: 0, bottom: 0, left: 0, right: 0 },
      visible: true,
      locked: false,
      startTime: 0,
      endTime: this.totalDuration,
      mediaStart: 0,
      // Dữ liệu media (không lưu vào JSON)
      element: null,
      file: null,
      objectUrl: null,
      fileName: '',
      naturalWidth: 0,
      naturalHeight: 0,
      duration: 0,
      volume: 100,
      muted: false,
      // Lưu vị trí ban đầu để Reset
      initialState: null,
      // Dữ liệu văn bản
      text: '',
      fontSize: 64,
      fontFamily: 'Segoe UI, Arial, sans-serif',
      textColor: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 4,
      bgColor: '#e50914',
      bgTransparent: true,
      ...partial
    };
  }

  /**
   * Thêm hoặc thay ảnh nền (luôn nằm ở lớp dưới cùng index 0)
   */
  addBackgroundImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // Xóa ảnh nền cũ nếu đã có
        const existingIdx = this.layers.findIndex(l => l.isBackground);
        if (existingIdx !== -1) {
          this._revokeLayerUrl(this.layers[existingIdx]);
          this.layers.splice(existingIdx, 1);
        }

        // Tính kích thước Cover lấp đầy khung canvas
        const fit = this._calcFitRect(img.naturalWidth, img.naturalHeight, 'cover');

        const layer = this.createBaseLayer({
          name: `Ảnh nền: ${file.name}`,
          type: 'image',
          isBackground: true,
          x: fit.x,
          y: fit.y,
          width: fit.width,
          height: fit.height,
          element: img,
          file,
          objectUrl: url,
          fileName: file.name,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          startTime: 0,
          endTime: this.totalDuration
        });
        layer.initialState = { x: fit.x, y: fit.y, width: fit.width, height: fit.height, rotation: 0 };

        this.layers.unshift(layer);
        this.selectedLayerId = layer.id;
        this.render();
        this._emitChange();
        resolve(layer);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Không thể đọc file ảnh. Hãy kiểm tra định dạng JPG/PNG/WEBP.'));
      };
      img.src = url;
    });
  }

  /**
   * Thêm lớp Video MP4 độc lập
   */
  addVideoLayer(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.src = url;
      video.crossOrigin = 'anonymous';
      video.playsInline = true;
      video.preload = 'auto';
      video.muted = false;

      video.onloadedmetadata = () => {
        const vw = video.videoWidth || 720;
        const vh = video.videoHeight || 1280;
        const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 10;

        // Đặt kích thước ban đầu chiếm khoảng 65% khung hình và căn giữa để dễ kéo thả
        const maxW = this.canvasWidth * 0.72;
        const maxH = this.canvasHeight * 0.65;
        const scale = Math.min(maxW / vw, maxH / vh);
        const w = Math.round(vw * scale);
        const h = Math.round(vh * scale);
        const x = Math.round((this.canvasWidth - w) / 2);
        const y = Math.round((this.canvasHeight - h) / 2);

        // Nếu video dài hơn tổng thời lượng hiện tại, tự mở rộng tổng thời lượng
        const videoCount = this.layers.filter(l => l.type === 'video').length;
        if (videoCount === 0 || dur > this.totalDuration) {
          this.setTotalDuration(Number(dur.toFixed(1)));
        }

        const layer = this.createBaseLayer({
          name: `Video ${videoCount + 1}: ${file.name}`,
          type: 'video',
          x, y, width: w, height: h,
          element: video,
          file,
          objectUrl: url,
          fileName: file.name,
          naturalWidth: vw,
          naturalHeight: vh,
          duration: dur,
          startTime: 0,
          endTime: Number(dur.toFixed(1))
        });
        layer.initialState = { x, y, width: w, height: h, rotation: 0 };

        this.layers.push(layer);
        this.selectedLayerId = layer.id;

        // Đảm bảo hiển thị ngay khung hình đầu tiên
        video.currentTime = 0.01;
        video.addEventListener('seeked', () => this.render(), { once: true });

        this._emitChange();
        resolve(layer);
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Không thể đọc video này. Hãy dùng file MP4 chuẩn H.264.'));
      };
    });
  }

  /**
   * Thêm lớp Văn bản lên ảnh
   */
  addTextLayer(text = 'KAI TỒ REVIEW') {
    const w = Math.round(this.canvasWidth * 0.75);
    const h = 140;
    const x = Math.round((this.canvasWidth - w) / 2);
    const y = Math.round(this.canvasHeight * 0.14);

    const textCount = this.layers.filter(l => l.type === 'text').length + 1;
    const layer = this.createBaseLayer({
      name: `Văn bản ${textCount}`,
      type: 'text',
      x, y, width: w, height: h,
      text,
      fontSize: Math.round(this.canvasWidth * 0.065),
      keepAspect: false,
      startTime: 0,
      endTime: this.totalDuration
    });
    layer.initialState = { x, y, width: w, height: h, rotation: 0 };

    this.layers.push(layer);
    this.selectedLayerId = layer.id;
    this.render();
    this._emitChange();
    return layer;
  }

  /**
   * Thay file ảnh / video cho lớp đang chọn mà vẫn giữ nguyên vị trí & hiệu ứng
   */
  replaceLayerMedia(layerId, file) {
    const layer = this.getLayerById(layerId);
    if (!layer) return Promise.reject(new Error('Không tìm thấy lớp.'));

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);

      if (layer.type === 'image') {
        const img = new Image();
        img.onload = () => {
          this._revokeLayerUrl(layer);
          layer.element = img;
          layer.file = file;
          layer.objectUrl = url;
          layer.fileName = file.name;
          layer.naturalWidth = img.naturalWidth;
          layer.naturalHeight = img.naturalHeight;
          layer.name = layer.isBackground ? `Ảnh nền: ${file.name}` : file.name;
          this.render();
          this._emitChange();
          resolve(layer);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('File ảnh không hợp lệ.'));
        };
        img.src = url;
      } else if (layer.type === 'video') {
        const video = document.createElement('video');
        video.src = url;
        video.crossOrigin = 'anonymous';
        video.playsInline = true;
        video.preload = 'auto';
        video.onloadedmetadata = () => {
          this._revokeLayerUrl(layer);
          layer.element = video;
          layer.file = file;
          layer.objectUrl = url;
          layer.fileName = file.name;
          layer.naturalWidth = video.videoWidth || 720;
          layer.naturalHeight = video.videoHeight || 1280;
          layer.duration = isFinite(video.duration) ? video.duration : 10;
          if (layer.endTime > layer.startTime + layer.duration) {
            layer.endTime = Number((layer.startTime + layer.duration).toFixed(1));
          }
          video.currentTime = Math.max(0, this.currentTime - layer.startTime);
          video.addEventListener('seeked', () => this.render(), { once: true });
          this._emitChange();
          resolve(layer);
        };
        video.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('File video không hợp lệ.'));
        };
      } else {
        URL.revokeObjectURL(url);
        reject(new Error('Lớp văn bản không cần thay file media.'));
      }
    });
  }

  getLayerById(id) {
    return this.layers.find(l => l.id === id) || null;
  }

  getSelectedLayer() {
    return this.getLayerById(this.selectedLayerId);
  }

  selectLayer(id) {
    this.selectedLayerId = id;
    this.render();
    this._emitChange();
  }

  deleteLayer(id) {
    const idx = this.layers.findIndex(l => l.id === id);
    if (idx === -1) return;
    const layer = this.layers[idx];
    if (layer.type === 'video' && layer.element) {
      layer.element.pause();
    }
    this._revokeLayerUrl(layer);
    this.layers.splice(idx, 1);

    if (this.selectedLayerId === id) {
      this.selectedLayerId = this.layers.length ? this.layers[this.layers.length - 1].id : null;
    }
    this.render();
    this._emitChange();
  }

  moveLayerOrder(id, direction) {
    // direction: +1 (lên trên), -1 (xuống dưới)
    const idx = this.layers.findIndex(l => l.id === id);
    if (idx === -1) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= this.layers.length) return;

    const [moved] = this.layers.splice(idx, 1);
    this.layers.splice(targetIdx, 0, moved);
    this.render();
    this._emitChange();
  }

  applyFitMode(layer, mode) {
    if (!layer || !mode) return;
    const nw = layer.naturalWidth || layer.width;
    const nh = layer.naturalHeight || layer.height;

    if (mode === 'cover' || mode === 'contain') {
      const rect = this._calcFitRect(nw, nh, mode);
      layer.x = rect.x;
      layer.y = rect.y;
      layer.width = rect.width;
      layer.height = rect.height;
      layer.rotation = 0;
    } else if (mode === 'original') {
      const cx = layer.x + layer.width / 2;
      const cy = layer.y + layer.height / 2;
      const ratio = nw / nh;
      layer.height = Math.round(layer.width / ratio);
      layer.x = Math.round(cx - layer.width / 2);
      layer.y = Math.round(cy - layer.height / 2);
    } else {
      const ratios = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3 };
      if (ratios[mode]) {
        const cx = layer.x + layer.width / 2;
        const cy = layer.y + layer.height / 2;
        layer.height = Math.round(layer.width / ratios[mode]);
        layer.x = Math.round(cx - layer.width / 2);
        layer.y = Math.round(cy - layer.height / 2);
      }
    }
    this.render();
    this._emitChange();
  }

  _calcFitRect(nw, nh, mode) {
    const cw = this.canvasWidth;
    const ch = this.canvasHeight;
    const scale = mode === 'cover'
      ? Math.max(cw / nw, ch / nh)
      : Math.min(cw / nw, ch / nh);
    const width = Math.round(nw * scale);
    const height = Math.round(nh * scale);
    return {
      width,
      height,
      x: Math.round((cw - width) / 2),
      y: Math.round((ch - height) / 2)
    };
  }

  _revokeLayerUrl(layer) {
    if (layer && layer.objectUrl) {
      URL.revokeObjectURL(layer.objectUrl);
      layer.objectUrl = null;
    }
  }

  resetAll() {
    this.pause();
    this.layers.forEach(l => {
      if (l.type === 'video' && l.element) l.element.pause();
      this._revokeLayerUrl(l);
    });
    this.layers = [];
    this.selectedLayerId = null;
    this.currentTime = 0;
    this.totalDuration = 10;
    this.render();
    this._emitChange();
  }

  /* =========================================================
     PHÁT / TẠM DỪNG / ĐỒNG BỘ TIMELINE
     ========================================================= */
  setTotalDuration(sec) {
    const oldDur = this.totalDuration;
    this.totalDuration = Math.max(1, Math.min(3600, Number(sec) || 10));
    // Tự kéo dài ảnh nền & văn bản nếu trước đó chúng chạy hết dự án
    this.layers.forEach(l => {
      if (l.isBackground || (l.type !== 'video' && Math.abs(l.endTime - oldDur) < 0.2)) {
        l.endTime = this.totalDuration;
      }
    });
    if (this.currentTime > this.totalDuration) {
      this.seek(this.totalDuration);
    }
    this._emitChange();
  }

  play() {
    if (this.isPlaying) return;
    if (this.currentTime >= this.totalDuration - 0.05) {
      this.currentTime = 0;
    }
    this.isPlaying = true;
    this._lastFrameTs = performance.now();
    this._syncVideosToCurrentTime(true);
    this._emitChange();
  }

  pause() {
    this.isPlaying = false;
    this.layers.forEach(l => {
      if (l.type === 'video' && l.element && !l.element.paused) {
        l.element.pause();
      }
    });
    this._emitChange();
  }

  togglePlay() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  seek(timeSec) {
    this.currentTime = Math.max(0, Math.min(this.totalDuration, timeSec));
    this._syncVideosToCurrentTime(this.isPlaying, true);
    this.render();
    if (this.onTimeUpdate) this.onTimeUpdate(this.currentTime);
  }

  _syncVideosToCurrentTime(shouldPlay, forceSeek = false) {
    for (const layer of this.layers) {
      if (layer.type !== 'video' || !layer.element) continue;
      const vid = layer.element;
      const isActive = layer.visible &&
        this.currentTime >= layer.startTime &&
        this.currentTime <= layer.endTime;

      vid.muted = !!layer.muted;
      vid.volume = Math.max(0, Math.min(1, (layer.volume ?? 100) / 100));

      if (isActive) {
        const localTime = Math.max(0, this.currentTime - layer.startTime + (layer.mediaStart || 0));
        if (localTime <= layer.duration) {
          if (forceSeek || Math.abs(vid.currentTime - localTime) > 0.28) {
            try { vid.currentTime = Math.min(localTime, Math.max(0, layer.duration - 0.03)); } catch (_) {}
          }
          if (shouldPlay && vid.paused) {
            vid.play().catch(() => {});
          } else if (!shouldPlay && !vid.paused) {
            vid.pause();
          }
        } else if (!vid.paused) {
          vid.pause();
        }
      } else {
        if (!vid.paused) vid.pause();
      }
    }
  }

  _startRenderLoop() {
    const tick = (now) => {
      if (this.isPlaying) {
        const dt = (now - this._lastFrameTs) / 1000;
        this._lastFrameTs = now;
        this.currentTime += dt;

        if (this.currentTime >= this.totalDuration) {
          this.currentTime = this.totalDuration;
          this.pause();
        } else {
          this._syncVideosToCurrentTime(true, false);
        }
        if (this.onTimeUpdate) this.onTimeUpdate(this.currentTime);
      }
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* =========================================================
     VẼ CANVAS (DÙNG CHUNG CHO XEM TRƯỚC & XUẤT MP4)
     ========================================================= */
  render() {
    this.renderScene(this.ctx, this.currentTime, false);

    // Ẩn/hiện gợi ý khi chưa có lớp nào
    const hint = document.getElementById('emptyCanvasHint');
    if (hint) hint.classList.toggle('hidden', this.layers.length > 0);
  }

  /**
   * Hàm vẽ chuẩn hóa dùng chung cho cả Preview và Video Export
   * Đảm bảo ảnh xuất MP4 khớp 100% với những gì người dùng thấy
   */
  renderScene(ctx, timeSec, isExport = false) {
    ctx.save();
    // Nền đen chuẩn video
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

    // Vẽ từng lớp từ dưới lên trên
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      if (timeSec < layer.startTime || timeSec > layer.endTime) continue;
      this.drawSingleLayer(ctx, layer);
    }

    // Khi xem trước, vẽ khung viền chọn đối tượng & đường gióng căn giữa
    if (!isExport) {
      this._drawSnapGuides(ctx);
      const selected = this.getSelectedLayer();
      if (selected && selected.visible) {
        this._drawSelectionBox(ctx, selected);
      }
    }
    ctx.restore();
  }

  drawSingleLayer(ctx, layer) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (layer.opacity ?? 100) / 100));

    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((layer.rotation * Math.PI) / 180);

    const halfW = layer.width / 2;
    const halfH = layer.height / 2;
    const radius = Math.min(layer.borderRadius || 0, halfW, halfH);

    // Cắt bo góc bằng clipping path
    this._roundedRectPath(ctx, -halfW, -halfH, layer.width, layer.height, radius);
    ctx.clip();

    if ((layer.type === 'image' || layer.type === 'video') && layer.element) {
      const el = layer.element;
      const ready = layer.type === 'image' ? el.complete : el.readyState >= 2;
      if (ready) {
        const nw = layer.naturalWidth || (layer.type === 'image' ? el.naturalWidth : el.videoWidth) || layer.width;
        const nh = layer.naturalHeight || (layer.type === 'image' ? el.naturalHeight : el.videoHeight) || layer.height;

        const c = layer.crop || { top: 0, bottom: 0, left: 0, right: 0 };
        const sx = (c.left / 100) * nw;
        const sy = (c.top / 100) * nh;
        const sw = Math.max(1, nw - ((c.left + c.right) / 100) * nw);
        const sh = Math.max(1, nh - ((c.top + c.bottom) / 100) * nh);

        ctx.drawImage(el, sx, sy, sw, sh, -halfW, -halfH, layer.width, layer.height);
      }
    } else if (layer.type === 'text') {
      if (!layer.bgTransparent && layer.bgColor) {
        ctx.fillStyle = layer.bgColor;
        ctx.fillRect(-halfW, -halfH, layer.width, layer.height);
      }
      ctx.font = `700 ${layer.fontSize}px ${layer.fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const lines = (layer.text || '').split('\n');
      const lineHeight = layer.fontSize * 1.2;
      const startY = -((lines.length - 1) * lineHeight) / 2;

      lines.forEach((line, i) => {
        const ly = startY + i * lineHeight;
        if (layer.strokeWidth > 0) {
          ctx.lineWidth = layer.strokeWidth * 2;
          ctx.strokeStyle = layer.strokeColor || '#000000';
          ctx.lineJoin = 'round';
          ctx.strokeText(line, 0, ly);
        }
        ctx.fillStyle = layer.textColor || '#ffffff';
        ctx.fillText(line, 0, ly);
      });
    } else if (!layer.element) {
      // Placeholder khi mở dự án chưa nạp lại file
      ctx.fillStyle = '#22222c';
      ctx.fillRect(-halfW, -halfH, layer.width, layer.height);
      ctx.fillStyle = '#e50914';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`Chưa nạp file: ${layer.fileName}`, 0, 0);
    }

    ctx.restore();
  }

  _roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (r <= 0) {
      ctx.rect(x, y, w, h);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
    }
    ctx.closePath();
  }

  /* =========================================================
     KHUNG CHỌN ĐỐI TƯỢNG & ĐIỂM KÉO (4 GÓC + XOAY)
     ========================================================= */
  _getHandleMetrics() {
    const inv = 1 / (this.displayScale || 0.5);
    return {
      size: Math.max(10, 12 * inv),
      hitRadius: Math.max(18, 22 * inv),
      rotateOffset: Math.max(36, 42 * inv),
      lineWidth: Math.max(2, 2.5 * inv)
    };
  }

  _drawSelectionBox(ctx, layer) {
    const m = this._getHandleMetrics();
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    const halfW = layer.width / 2;
    const halfH = layer.height / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((layer.rotation * Math.PI) / 180);

    // Khung viền đỏ (nét đứt nếu đang khóa)
    ctx.strokeStyle = layer.locked ? '#f59e0b' : '#e50914';
    ctx.lineWidth = m.lineWidth;
    if (layer.locked) ctx.setLineDash([m.size, m.size * 0.7]);
    ctx.strokeRect(-halfW, -halfH, layer.width, layer.height);
    ctx.setLineDash([]);

    if (!layer.locked) {
      // Đường nối đến chấm xoay phía trên
      ctx.beginPath();
      ctx.moveTo(0, -halfH);
      ctx.lineTo(0, -halfH - m.rotateOffset);
      ctx.stroke();

      // Chấm xoay hình tròn
      ctx.beginPath();
      ctx.arc(0, -halfH - m.rotateOffset, m.size * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = '#e50914';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = m.lineWidth * 0.8;
      ctx.stroke();

      // 4 điểm kéo góc (vuông trắng viền đỏ)
      const corners = [
        [-halfW, -halfH],
        [halfW, -halfH],
        [halfW, halfH],
        [-halfW, halfH]
      ];
      corners.forEach(([hx, hy]) => {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#e50914';
        ctx.lineWidth = m.lineWidth;
        ctx.fillRect(hx - m.size / 2, hy - m.size / 2, m.size, m.size);
        ctx.strokeRect(hx - m.size / 2, hy - m.size / 2, m.size, m.size);
      });
    }

    ctx.restore();
  }

  _drawSnapGuides(ctx) {
    const m = this._getHandleMetrics();
    ctx.save();
    ctx.strokeStyle = 'rgba(229, 9, 20, 0.85)';
    ctx.lineWidth = m.lineWidth * 0.8;
    ctx.setLineDash([12, 8]);

    if (this.snapLines.x !== null) {
      ctx.beginPath();
      ctx.moveTo(this.snapLines.x, 0);
      ctx.lineTo(this.snapLines.x, this.canvasHeight);
      ctx.stroke();
    }
    if (this.snapLines.y !== null) {
      ctx.beginPath();
      ctx.moveTo(0, this.snapLines.y);
      ctx.lineTo(this.canvasWidth, this.snapLines.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* =========================================================
     TƯƠNG TÁC KÉO THẢ, PHÓNG TO/THU NHỎ, XOAY TRỰC TIẾP
     ========================================================= */
  _toCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * this.canvasWidth,
      y: ((clientY - rect.top) / rect.height) * this.canvasHeight
    };
  }

  _worldToLocal(layer, px, py) {
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    const rad = (-layer.rotation * Math.PI) / 180;
    const dx = px - cx;
    const dy = py - cy;
    return {
      x: dx * Math.cos(rad) - dy * Math.sin(rad),
      y: dx * Math.sin(rad) + dy * Math.cos(rad)
    };
  }

  _hitTestHandle(layer, px, py) {
    if (!layer || layer.locked || !layer.visible) return null;
    const local = this._worldToLocal(layer, px, py);
    const halfW = layer.width / 2;
    const halfH = layer.height / 2;
    const m = this._getHandleMetrics();

    // Kiểm tra điểm xoay
    if (Math.hypot(local.x, local.y - (-halfH - m.rotateOffset)) <= m.hitRadius) {
      return 'rotate';
    }

    // Kiểm tra 4 góc
    const corners = {
      tl: [-halfW, -halfH],
      tr: [halfW, -halfH],
      br: [halfW, halfH],
      bl: [-halfW, halfH]
    };
    for (const [key, [hx, hy]] of Object.entries(corners)) {
      if (Math.hypot(local.x - hx, local.y - hy) <= m.hitRadius) {
        return key;
      }
    }
    return null;
  }

  _hitTestLayer(px, py) {
    // Kiểm tra từ lớp trên cùng xuống lớp dưới cùng
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (!layer.visible) continue;
      if (this.currentTime < layer.startTime || this.currentTime > layer.endTime) continue;

      const local = this._worldToLocal(layer, px, py);
      if (Math.abs(local.x) <= layer.width / 2 && Math.abs(local.y) <= layer.height / 2) {
        return layer;
      }
    }
    return null;
  }

  _bindCanvasEvents() {
    const onPointerDown = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const pt = this._toCanvasCoords(e);

      // 1. Kiểm tra có nhấn trúng các điểm kéo góc / xoay của lớp đang chọn không
      const selected = this.getSelectedLayer();
      if (selected) {
        const handle = this._hitTestHandle(selected, pt.x, pt.y);
        if (handle) {
          e.preventDefault();
          const cx = selected.x + selected.width / 2;
          const cy = selected.y + selected.height / 2;
          this.interaction = {
            mode: handle === 'rotate' ? 'rotate' : 'resize',
            handle,
            layer: selected,
            startX: pt.x,
            startY: pt.y,
            centerX: cx,
            centerY: cy,
            startAngle: Math.atan2(pt.y - cy, pt.x - cx),
            orig: {
              x: selected.x,
              y: selected.y,
              width: selected.width,
              height: selected.height,
              rotation: selected.rotation
            }
          };
          return;
        }
      }

      // 2. Kiểm tra nhấn trúng lớp nào
      const hit = this._hitTestLayer(pt.x, pt.y);
      if (hit) {
        e.preventDefault();
        this.selectedLayerId = hit.id;
        if (!hit.locked) {
          this.interaction = {
            mode: 'move',
            layer: hit,
            startX: pt.x,
            startY: pt.y,
            orig: { x: hit.x, y: hit.y }
          };
        }
        this._emitChange();
      } else {
        this.selectedLayerId = null;
        this._emitChange();
      }
    };

    const onPointerMove = (e) => {
      const pt = this._toCanvasCoords(e);

      // Cập nhật hình con trỏ chuột khi rê qua điểm kéo
      if (!this.interaction) {
        const sel = this.getSelectedLayer();
        const h = sel ? this._hitTestHandle(sel, pt.x, pt.y) : null;
        if (h === 'rotate') this.canvas.style.cursor = 'grab';
        else if (h === 'tl' || h === 'br') this.canvas.style.cursor = 'nwse-resize';
        else if (h === 'tr' || h === 'bl') this.canvas.style.cursor = 'nesw-resize';
        else if (this._hitTestLayer(pt.x, pt.y)) this.canvas.style.cursor = 'move';
        else this.canvas.style.cursor = 'default';
        return;
      }

      e.preventDefault();
      const { mode, handle, layer, startX, startY, orig } = this.interaction;

      if (mode === 'move') {
        let nx = Math.round(orig.x + (pt.x - startX));
        let ny = Math.round(orig.y + (pt.y - startY));

        // Tự hút căn giữa khung hình (Snap to center)
        const snapThreshold = 14;
        const centerX = nx + layer.width / 2;
        const centerY = ny + layer.height / 2;
        this.snapLines.x = null;
        this.snapLines.y = null;

        if (Math.abs(centerX - this.canvasWidth / 2) < snapThreshold) {
          nx = Math.round((this.canvasWidth - layer.width) / 2);
          this.snapLines.x = this.canvasWidth / 2;
        }
        if (Math.abs(centerY - this.canvasHeight / 2) < snapThreshold) {
          ny = Math.round((this.canvasHeight - layer.height) / 2);
          this.snapLines.y = this.canvasHeight / 2;
        }

        layer.x = nx;
        layer.y = ny;
      } else if (mode === 'rotate') {
        const { centerX, centerY, startAngle } = this.interaction;
        const currAngle = Math.atan2(pt.y - centerY, pt.x - centerX);
        let deg = orig.rotation + ((currAngle - startAngle) * 180) / Math.PI;
        // Hút nhẹ vào các góc chẵn 0, 90, 180, -90
        for (const snapDeg of [-180, -90, 0, 90, 180]) {
          if (Math.abs(deg - snapDeg) < 3) deg = snapDeg;
        }
        layer.rotation = Math.round(deg);
      } else if (mode === 'resize') {
        // Chuyển độ dời chuột vào hệ trục đã xoay của đối tượng
        const rad = (-orig.rotation * Math.PI) / 180;
        const dxW = pt.x - startX;
        const dyW = pt.y - startY;
        const ldx = dxW * Math.cos(rad) - dyW * Math.sin(rad);
        const ldy = dxW * Math.sin(rad) + dyW * Math.cos(rad);

        let newW = orig.width;
        let newH = orig.height;
        const signX = (handle === 'tr' || handle === 'br') ? 1 : -1;
        const signY = (handle === 'bl' || handle === 'br') ? 1 : -1;

        newW = Math.max(24, orig.width + ldx * signX * 2);
        newH = Math.max(24, orig.height + ldy * signY * 2);

        if (layer.keepAspect) {
          const ratio = orig.width / orig.height;
          if (Math.abs(ldx) >= Math.abs(ldy)) {
            newH = Math.max(24, newW / ratio);
          } else {
            newW = Math.max(24, newH * ratio);
          }
        }

        const cx = orig.x + orig.width / 2;
        const cy = orig.y + orig.height / 2;
        layer.width = Math.round(newW);
        layer.height = Math.round(newH);
        layer.x = Math.round(cx - layer.width / 2);
        layer.y = Math.round(cy - layer.height / 2);
      }

      this._emitChange(true);
    };

    const onPointerUp = () => {
      if (this.interaction) {
        this.interaction = null;
        this.snapLines = { x: null, y: null };
        this._emitChange();
      }
    };

    this.canvas.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    this.canvas.addEventListener('touchstart', onPointerDown, { passive: false });
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);

    window.addEventListener('resize', () => this.updateViewportScale());
  }

  _emitChange(lightweight = false) {
    if (this.onChange) this.onChange(lightweight);
  }
}

window.KaiToEditor = KaiToEditor;
