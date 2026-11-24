/**
 * KAI TỒ REVIEW – REAL MP4 VIDEO EXPORTER (video-export.js)
 * Xuất video MP4 hoàn chỉnh trên trình duyệt bằng WebCodecs + mp4-muxer (có trộn âm thanh AAC).
 * Tự động chuyển phương án dự phòng MediaRecorder nếu trình duyệt không hỗ trợ WebCodecs.
 */

class KaiToExporter {
  constructor(editor) {
    this.editor = editor;
    this.cancelled = false;
    this.isExporting = false;
  }

  /**
   * Kiểm tra trình duyệt có hỗ trợ xuất MP4 WebCodecs (H.264 + AAC) hay không
   */
  async detectCapabilities() {
    const hasMp4Muxer = typeof window.Mp4Muxer !== 'undefined';
    const hasWebCodecs = typeof window.VideoEncoder !== 'undefined' && typeof window.VideoFrame !== 'undefined';

    if (hasMp4Muxer && hasWebCodecs) {
      const avcCodec = await this._pickSupportedAvcCodec(1280, 720, 30);
      if (avcCodec) {
        const hasAudioEncoder = typeof window.AudioEncoder !== 'undefined' &&
          (await this._isAacSupported());
        return {
          mode: 'webcodecs',
          avcCodec,
          hasAudioEncoder,
          message: `✅ Sẵn sàng xuất MP4 chuẩn H.264${hasAudioEncoder ? ' + Âm thanh AAC' : ''} (Tăng tốc phần cứng GPU WebCodecs).`
        };
      }
    }

    if (typeof window.MediaRecorder !== 'undefined') {
      const mp4Mime = MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : 'video/webm');
      return {
        mode: 'mediarecorder',
        mimeType: mp4Mime,
        message: `⚠️ Trình duyệt này không hỗ trợ WebCodecs MP4. Hệ thống sẽ dùng bộ ghi dự phòng (${mp4Mime.includes('mp4') ? 'MP4' : 'WebM'} thời gian thực). Khuyên dùng Chrome, Edge hoặc Cốc Cốc bản mới nhất để xuất MP4 nhanh nhất.`
      };
    }

    return {
      mode: 'unsupported',
      message: '❌ Trình duyệt hiện tại không hỗ trợ mã hóa video. Vui lòng mở website bằng Google Chrome, Microsoft Edge hoặc Cốc Cốc trên máy tính.'
    };
  }

  async _pickSupportedAvcCodec(width, height, fps) {
    // Danh sách cấu hình H.264 phổ biến từ High -> Main -> Baseline
    const candidates = ['avc1.64002a', 'avc1.4d002a', 'avc1.640028', 'avc1.420028', 'avc1.42001f'];
    for (const codec of candidates) {
      try {
        const res = await VideoEncoder.isConfigSupported({
          codec,
          width,
          height,
          bitrate: 6_000_000,
          framerate: fps,
          hardwareAcceleration: 'prefer-hardware'
        });
        if (res.supported) return codec;
      } catch (_) {}
    }
    return null;
  }

  async _isAacSupported() {
    try {
      const res = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128_000
      });
      return !!res.supported;
    } catch (_) {
      return false;
    }
  }

  /**
   * Tính kích thước xuất chẵn pixel theo độ phân giải đích (720p hoặc 1080p)
   */
  _calcExportDimensions(shortEdgeTarget) {
    const cw = this.editor.canvasWidth;
    const ch = this.editor.canvasHeight;
    const scale = shortEdgeTarget / Math.min(cw, ch);
    const width = Math.max(2, Math.round((cw * scale) / 2) * 2);
    const height = Math.max(2, Math.round((ch * scale) / 2) * 2);
    return { width, height };
  }

  cancel() {
    this.cancelled = true;
  }

  /**
   * Hàm xuất video chính
   */
  async exportVideo({ resolution = 1080, fps = 30, includeAudio = true, onProgress }) {
    if (this.isExporting) return;
    if (this.editor.layers.length === 0) {
      throw new Error('Chưa có ảnh hoặc video nào để xuất!');
    }

    this.isExporting = true;
    this.cancelled = false;
    this.editor.pause();

    const caps = await this.detectCapabilities();
    const { width, height } = this._calcExportDimensions(Number(resolution));

    try {
      if (caps.mode === 'webcodecs') {
        const blob = await this._exportWithWebCodecs({
          width, height, fps: Number(fps), includeAudio: includeAudio && caps.hasAudioEncoder, onProgress
        });
        this._downloadBlob(blob, `KAI_TO_REVIEW_${width}x${height}_${Date.now()}.mp4`);
        return { format: 'mp4' };
      } else if (caps.mode === 'mediarecorder') {
        const blob = await this._exportWithMediaRecorder({
          width, height, fps: Number(fps), includeAudio, mimeType: caps.mimeType, onProgress
        });
        const ext = caps.mimeType.includes('mp4') ? 'mp4' : 'webm';
        this._downloadBlob(blob, `KAI_TO_REVIEW_${width}x${height}_${Date.now()}.${ext}`);
        return { format: ext };
      } else {
        throw new Error(caps.message);
      }
    } finally {
      this.isExporting = false;
      this.editor.seek(this.editor.currentTime);
    }
  }

  /* =========================================================
     PHƯƠNG ÁN 1: WEBCODECS + MP4-MUXER (CHUẨN MP4 H.264 + AAC)
     ========================================================= */
  async _exportWithWebCodecs({ width, height, fps, includeAudio, onProgress }) {
    const duration = this.editor.totalDuration;
    const totalFrames = Math.max(1, Math.ceil(duration * fps));
    const frameDurationUs = Math.round(1_000_000 / fps);

    const avcCodec = await this._pickSupportedAvcCodec(width, height, fps);
    if (!avcCodec) {
      throw new Error(`GPU/Trình duyệt không hỗ trợ mã hóa H.264 ở kích thước ${width}x${height}. Hãy thử chọn 720p.`);
    }

    // Bước 1: Giải mã & trộn âm thanh từ các lớp video (nếu có)
    let mixedAudioBuffer = null;
    if (includeAudio) {
      onProgress?.(3, 'Đang trộn âm thanh các lớp video...');
      mixedAudioBuffer = await this._mixAudioTracks(duration);
    }

    if (this.cancelled) throw new Error('Đã hủy quá trình xuất video.');

    // Bước 2: Khởi tạo bộ đóng gói MP4
    const muxerConfig = {
      target: new window.Mp4Muxer.ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width,
        height
      },
      fastStart: 'in-memory'
    };

    if (mixedAudioBuffer) {
      muxerConfig.audio = {
        codec: 'aac',
        numberOfChannels: 2,
        sampleRate: 48000
      };
    }

    const muxer = new window.Mp4Muxer.Muxer(muxerConfig);

    // Bước 3: Mã hóa âm thanh AAC trước (nhanh, chỉ tốn ~1 giây)
    if (mixedAudioBuffer) {
      onProgress?.(8, 'Đang mã hóa âm thanh AAC...');
      await this._encodeAudioBuffer(mixedAudioBuffer, muxer);
    }

    if (this.cancelled) throw new Error('Đã hủy quá trình xuất video.');

    // Bước 4: Khởi tạo VideoEncoder H.264
    let encoderError = null;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (err) => { encoderError = err; }
    });

    const bitrate = Math.min(width, height) >= 1080 ? 8_000_000 : 4_500_000;
    videoEncoder.configure({
      codec: avcCodec,
      width,
      height,
      bitrate,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware'
    });

    // Canvas xuất riêng biệt theo đúng độ phân giải 720p/1080p
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const exportCtx = exportCanvas.getContext('2d', { alpha: false });
    const scaleX = width / this.editor.canvasWidth;
    const scaleY = height / this.editor.canvasHeight;

    // Tạo bản sao phần tử video độc lập để tua khung hình mượt, không làm giật UI
    const exportVideos = await this._cloneVideoElementsForExport();

    try {
      for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
        if (this.cancelled) throw new Error('Đã hủy quá trình xuất video.');
        if (encoderError) throw encoderError;

        const t = frameIdx / fps;

        // Tua đồng bộ tất cả lớp video đang hiển thị ở thời điểm t
        await this._seekExportVideos(exportVideos, t);

        // Vẽ khung hình lên canvas xuất
        exportCtx.save();
        exportCtx.scale(scaleX, scaleY);
        this._renderExportFrame(exportCtx, t, exportVideos);
        exportCtx.restore();

        // Đưa khung hình vào bộ mã hóa H.264
        const frame = new VideoFrame(exportCanvas, {
          timestamp: frameIdx * frameDurationUs,
          duration: frameDurationUs
        });

        const isKeyFrame = frameIdx % (fps * 2) === 0;
        videoEncoder.encode(frame, { keyFrame: isKeyFrame });
        frame.close(); // Giải phóng bộ nhớ VRAM/RAM ngay lập tức

        // Chống tràn bộ nhớ hàng đợi nếu GPU đang nén
        while (videoEncoder.encodeQueueSize > 8) {
          await new Promise(r => setTimeout(r, 8));
        }

        // Cập nhật thanh tiến trình
        if (frameIdx % 3 === 0 || frameIdx === totalFrames - 1) {
          const pct = 10 + Math.round(((frameIdx + 1) / totalFrames) * 86);
          onProgress?.(pct, `Đang mã hóa khung hình ${frameIdx + 1}/${totalFrames}...`);
        }
      }

      onProgress?.(97, 'Đang hoàn tất và đóng gói file MP4...');
      await videoEncoder.flush();
      videoEncoder.close();
      muxer.finalize();

      onProgress?.(100, 'Xuất video MP4 thành công!');
      return new Blob([muxer.target.buffer], { type: 'video/mp4' });
    } finally {
      // Dọn dẹp bộ nhớ video tạm
      exportVideos.forEach(({ video }) => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      });
      if (videoEncoder.state !== 'closed') {
        try { videoEncoder.close(); } catch (_) {}
      }
    }
  }

  /**
   * Trộn âm thanh toàn bộ các lớp video có tiếng bằng OfflineAudioContext
   */
  async _mixAudioTracks(totalDuration) {
    const audioLayers = this.editor.layers.filter(
      l => l.type === 'video' && l.visible && !l.muted && (l.volume ?? 100) > 0 && l.file
    );
    if (audioLayers.length === 0) return null;

    const sampleRate = 48000;
    const totalSamples = Math.ceil(totalDuration * sampleRate);
    const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);
    let addedCount = 0;

    for (const layer of audioLayers) {
      try {
        const arrayBuf = await layer.file.arrayBuffer();
        const decoded = await offlineCtx.decodeAudioData(arrayBuf.slice(0));
        const source = offlineCtx.createBufferSource();
        source.buffer = decoded;

        const gainNode = offlineCtx.createGain();
        gainNode.gain.value = Math.max(0, Math.min(1, (layer.volume ?? 100) / 100));

        source.connect(gainNode);
        gainNode.connect(offlineCtx.destination);

        const playDur = Math.max(0, Math.min(layer.endTime - layer.startTime, decoded.duration));
        if (playDur > 0) {
          source.start(layer.startTime, layer.mediaStart || 0, playDur);
          addedCount++;
        }
      } catch (err) {
        // Video không có kênh âm thanh hoặc định dạng âm thanh lạ -> bỏ qua âm thanh lớp này
        console.warn(`Bỏ qua âm thanh lớp ${layer.name}:`, err);
      }
    }

    if (addedCount === 0) return null;
    return await offlineCtx.startRendering();
  }

  /**
   * Mã hóa AudioBuffer (PCM) sang AAC cho MP4
   */
  async _encodeAudioBuffer(audioBuffer, muxer) {
    const sampleRate = audioBuffer.sampleRate;
    const channels = Math.min(2, audioBuffer.numberOfChannels);
    const totalFrames = audioBuffer.length;

    let audioErr = null;
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (err) => { audioErr = err; }
    });

    audioEncoder.configure({
      codec: 'mp4a.40.2',
      sampleRate,
      numberOfChannels: 2,
      bitrate: 128_000
    });

    const left = audioBuffer.getChannelData(0);
    const right = channels > 1 ? audioBuffer.getChannelData(1) : left;
    const chunkSize = 4096;

    for (let offset = 0; offset < totalFrames; offset += chunkSize) {
      if (audioErr) throw audioErr;
      const frames = Math.min(chunkSize, totalFrames - offset);
      const planar = new Float32Array(frames * 2);
      planar.set(left.subarray(offset, offset + frames), 0);
      planar.set(right.subarray(offset, offset + frames), frames);

      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data: planar
      });

      audioEncoder.encode(audioData);
      audioData.close();
    }

    await audioEncoder.flush();
    audioEncoder.close();
  }

  async _cloneVideoElementsForExport() {
    const map = new Map();
    const videoLayers = this.editor.layers.filter(l => l.type === 'video' && l.visible && l.objectUrl);

    for (const layer of videoLayers) {
      const vid = document.createElement('video');
      vid.src = layer.objectUrl;
      vid.muted = true;
      vid.playsInline = true;
      vid.preload = 'auto';

      await new Promise((resolve) => {
        if (vid.readyState >= 2) return resolve();
        vid.onloadeddata = () => resolve();
        vid.onerror = () => resolve();
        setTimeout(resolve, 4000);
      });
      map.set(layer.id, { layer, video: vid });
    }
    return map;
  }

  async _seekExportVideos(exportVideos, timeSec) {
    const tasks = [];
    exportVideos.forEach(({ layer, video }) => {
      if (timeSec < layer.startTime || timeSec > layer.endTime) return;
      const target = Math.min(
        Math.max(0, timeSec - layer.startTime + (layer.mediaStart || 0)),
        Math.max(0, (layer.duration || video.duration || 0) - 0.03)
      );
      if (Math.abs(video.currentTime - target) < 0.005 && video.readyState >= 2) return;

      tasks.push(new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          video.removeEventListener('seeked', finish);
          resolve();
        };
        video.addEventListener('seeked', finish, { once: true });
        try { video.currentTime = target; } catch (_) { finish(); }
        setTimeout(finish, 1200); // Chống treo nếu khung bị lỗi
      }));
    });
    if (tasks.length) await Promise.all(tasks);
  }

  _renderExportFrame(ctx, timeSec, exportVideos) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, this.editor.canvasWidth, this.editor.canvasHeight);

    for (const layer of this.editor.layers) {
      if (!layer.visible) continue;
      if (timeSec < layer.startTime || timeSec > layer.endTime) continue;

      if (layer.type === 'video' && exportVideos.has(layer.id)) {
        const tempLayer = { ...layer, element: exportVideos.get(layer.id).video };
        this.editor.drawSingleLayer(ctx, tempLayer);
      } else {
        this.editor.drawSingleLayer(ctx, layer);
      }
    }
  }

  /* =========================================================
     PHƯƠNG ÁN 2 (DỰ PHÒNG): MEDIARECORDER THỜI GIAN THỰC
     ========================================================= */
  async _exportWithMediaRecorder({ width, height, fps, includeAudio, mimeType, onProgress }) {
    const duration = this.editor.totalDuration;
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const exportCtx = exportCanvas.getContext('2d');
    const scaleX = width / this.editor.canvasWidth;
    const scaleY = height / this.editor.canvasHeight;

    const stream = exportCanvas.captureStream(fps);
    const chunks = [];
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 6_000_000
    });

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const donePromise = new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    this.editor.seek(0);
    recorder.start(250);
    this.editor.play();

    const startWall = performance.now();
    await new Promise((resolve, reject) => {
      const loop = () => {
        if (this.cancelled) {
          this.editor.pause();
          recorder.stop();
          return reject(new Error('Đã hủy xuất video.'));
        }
        const elapsed = (performance.now() - startWall) / 1000;
        exportCtx.save();
        exportCtx.scale(scaleX, scaleY);
        this.editor.renderScene(exportCtx, this.editor.currentTime, true);
        exportCtx.restore();

        const pct = Math.min(99, Math.round((elapsed / duration) * 100));
        onProgress?.(pct, `Đang ghi thời gian thực (${elapsed.toFixed(1)}s / ${duration.toFixed(1)}s)...`);

        if (elapsed >= duration || !this.editor.isPlaying) {
          this.editor.pause();
          recorder.stop();
          resolve();
        } else {
          requestAnimationFrame(loop);
        }
      };
      requestAnimationFrame(loop);
    });

    onProgress?.(100, 'Hoàn tất xuất video!');
    return await donePromise;
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

window.KaiToExporter = KaiToExporter;
