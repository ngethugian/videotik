/**
 * KAI TỒ REVIEW – REAL MP4 EXPORTER (video-export.js)
 * Ghép ảnh nền cố định + video + âm thanh gốc thành file .MP4 chuẩn H.264/AAC trực tiếp trên trình duyệt.
 */

class AutoVideoExporter {
  constructor(composer) {
    this.composer = composer;
    this.isExporting = false;
    this.cancelled = false;
  }

  /**
   * Kiểm tra trình duyệt có hỗ trợ xuất MP4 WebCodecs (H.264 + AAC) hay không
   */
  async checkSupport() {
    const hasMuxer = typeof window.Mp4Muxer !== 'undefined';
    const hasWebCodecs = typeof window.VideoEncoder !== 'undefined' && typeof window.VideoFrame !== 'undefined';

    if (hasMuxer && hasWebCodecs) {
      const avcCodec = await this._pickAvcCodec(1080, 1920, 30);
      if (avcCodec) {
        const hasAac = typeof window.AudioEncoder !== 'undefined' && (await this._checkAacSupport());
        return {
          mode: 'webcodecs',
          hasAac,
          label: '✅ Sẵn sàng xuất MP4 H.264 (Tăng tốc GPU)',
          ok: true
        };
      }
    }

    if (typeof window.MediaRecorder !== 'undefined') {
      const mimeType = MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : 'video/webm');
      return {
        mode: 'mediarecorder',
        mimeType,
        label: '⚠️ Chế độ dự phòng (Khuyên dùng Chrome/Edge/Cốc Cốc mới)',
        ok: false
      };
    }

    return {
      mode: 'unsupported',
      label: '❌ Trình duyệt không hỗ trợ xuất video',
      ok: false
    };
  }

  async _pickAvcCodec(width, height, fps) {
    const codecs = ['avc1.64002a', 'avc1.4d002a', 'avc1.640028', 'avc1.420028', 'avc1.42001f'];
    for (const codec of codecs) {
      try {
        const res = await VideoEncoder.isConfigSupported({
          codec,
          width,
          height,
          bitrate: 7_500_000,
          framerate: fps,
          hardwareAcceleration: 'prefer-hardware'
        });
        if (res.supported) return codec;
      } catch (_) {}
    }
    return null;
  }

  async _checkAacSupport() {
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

  cancel() {
    this.cancelled = true;
  }

  /**
   * Tính độ phân giải xuất chẵn pixel theo đúng tỷ lệ ảnh nền gốc (1080p hoặc 720p)
   */
  _getOutputSize(quality) {
    const shortEdge = Number(quality) === 720 ? 720 : 1080;
    const ratio = this.composer.height / this.composer.width;
    const width = Math.round(shortEdge / 2) * 2;
    const height = Math.round((width * ratio) / 2) * 2;
    return { width, height };
  }

  /**
   * Tạo file MP4 hoàn chỉnh và trả về { blob, filename, format }
   */
  async createMp4({ quality = 1080, fps = 30, onProgress }) {
    if (this.isExporting) return null;
    if (!this.composer.bgLoaded) {
      throw new Error('Không tìm thấy ảnh nền assets/background.png.');
    }
    if (!this.composer.videoLoaded || !this.composer.videoFile) {
      throw new Error('Vui lòng tải video MP4 đầu vào trước khi tạo video.');
    }

    this.isExporting = true;
    this.cancelled = false;
    this.composer.pausePreview();

    const support = await this.checkSupport();
    const { width, height } = this._getOutputSize(quality);

    try {
      if (support.mode === 'webcodecs') {
        const blob = await this._renderWithWebCodecs({
          width,
          height,
          fps,
          includeAudio: support.hasAac,
          onProgress
        });
        return {
          blob,
          format: 'mp4',
          filename: `KAI_TO_REVIEW_${quality}p_${Date.now()}.mp4`
        };
      } else if (support.mode === 'mediarecorder') {
        const blob = await this._renderWithMediaRecorder({
          width,
          height,
          fps,
          mimeType: support.mimeType,
          onProgress
        });
        const ext = support.mimeType.includes('mp4') ? 'mp4' : 'webm';
        return {
          blob,
          format: ext,
          filename: `KAI_TO_REVIEW_${quality}p_${Date.now()}.${ext}`
        };
      } else {
        throw new Error('Trình duyệt không hỗ trợ xuất MP4. Hãy mở website bằng Chrome, Edge hoặc Cốc Cốc phiên bản mới.');
      }
    } finally {
      this.isExporting = false;
    }
  }

  /* =========================================================
     PHƯƠNG ÁN CHÍNH: WEBCODECS (H.264 + AAC) + MP4-MUXER
     ========================================================= */
  async _renderWithWebCodecs({ width, height, fps, includeAudio, onProgress }) {
    const duration = this.composer.videoEl.duration;
    if (!isFinite(duration) || duration <= 0) {
      throw new Error('Không xác định được thời lượng video đầu vào.');
    }

    const totalFrames = Math.max(1, Math.ceil(duration * fps));
    const frameDurationUs = Math.round(1_000_000 / fps);
    const avcCodec = await this._pickAvcCodec(width, height, fps);

    if (!avcCodec) {
      throw new Error(`Trình duyệt không hỗ trợ mã hóa H.264 ở mức ${width}×${height}. Hãy thử chuyển sang 720p.`);
    }

    // Bước 1: Giải mã âm thanh gốc của video
    let audioBuffer = null;
    if (includeAudio) {
      onProgress?.(3, 'Đang tách âm thanh gốc của video...');
      audioBuffer = await this._decodeOriginalAudio(this.composer.videoFile, duration);
    }

    if (this.cancelled) throw new Error('Đã hủy quá trình tạo video.');

    // Bước 2: Khởi tạo bộ đóng gói MP4
    const muxerConfig = {
      target: new window.Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width, height },
      fastStart: 'in-memory'
    };
    if (audioBuffer) {
      muxerConfig.audio = {
        codec: 'aac',
        numberOfChannels: 2,
        sampleRate: 48000
      };
    }

    const muxer = new window.Mp4Muxer.Muxer(muxerConfig);

    // Bước 3: Mã hóa âm thanh sang AAC
    if (audioBuffer) {
      onProgress?.(8, 'Đang mã hóa âm thanh AAC...');
      await this._encodeAacAudio(audioBuffer, muxer);
      audioBuffer = null; // Giải phóng RAM ngay sau khi mã hóa âm thanh
    }

    if (this.cancelled) throw new Error('Đã hủy quá trình tạo video.');

    // Bước 4: Khởi tạo VideoEncoder H.264 (ưu tiên GPU phần cứng)
    let encodeError = null;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (err) => { encodeError = err; }
    });

    const bitrate = width >= 1080 ? 8_000_000 : 4_500_000;
    videoEncoder.configure({
      codec: avcCodec,
      width,
      height,
      bitrate,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware'
    });

    // Canvas xuất độc lập đúng độ phân giải 1080p/720p
    const offCanvas = document.createElement('canvas');
    offCanvas.width = width;
    offCanvas.height = height;
    const offCtx = offCanvas.getContext('2d', { alpha: false });

    // Tạo phần tử video riêng để tua khung hình mượt mà không làm giật giao diện
    const workerVideo = document.createElement('video');
    workerVideo.src = this.composer.videoUrl;
    workerVideo.muted = true;
    workerVideo.playsInline = true;
    workerVideo.preload = 'auto';

    await new Promise((resolve, reject) => {
      workerVideo.onloadeddata = () => resolve();
      workerVideo.onerror = () => reject(new Error('Không thể đọc luồng hình ảnh video để xuất.'));
    });

    try {
      for (let i = 0; i < totalFrames; i++) {
        if (this.cancelled) throw new Error('Đã hủy quá trình tạo video.');
        if (encodeError) throw encodeError;

        const targetTime = Math.min(i / fps, Math.max(0, duration - 0.02));
        await this._seekVideo(workerVideo, targetTime);

        // Vẽ ảnh nền gốc + video đúng vùng bên phải lên canvas xuất
        this.composer.composeFrame(offCtx, width, height, workerVideo, true);

        // Đưa khung hình vào bộ mã hóa H.264
        const frame = new VideoFrame(offCanvas, {
          timestamp: i * frameDurationUs,
          duration: frameDurationUs
        });

        videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close(); // Giải phóng bộ nhớ VRAM/RAM ngay lập tức

        // Tránh quá tải hàng đợi khi GPU đang nén
        while (videoEncoder.encodeQueueSize > 8) {
          await new Promise(r => setTimeout(r, 8));
        }

        if (i % 3 === 0 || i === totalFrames - 1) {
          const pct = 10 + Math.round(((i + 1) / totalFrames) * 86);
          onProgress?.(pct, `Đang ghép & mã hóa khung hình ${i + 1}/${totalFrames}...`);
        }
      }

      onProgress?.(97, 'Đang đóng gói file MP4 hoàn chỉnh...');
      await videoEncoder.flush();
      videoEncoder.close();
      muxer.finalize();

      onProgress?.(100, 'Tạo video MP4 hoàn tất!');
      return new Blob([muxer.target.buffer], { type: 'video/mp4' });
    } catch (err) {
      // Bắt lỗi phổ biến khi mở file:// trực tiếp thay vì GitHub Pages
      if (err && err.name === 'SecurityError') {
        throw new Error('Lỗi bảo mật trình duyệt (Tainted Canvas) do mở trực tiếp file HTML từ ổ cứng. Hãy đưa website lên GitHub Pages hoặc mở qua Live Server để xuất MP4.');
      }
      throw err;
    } finally {
      workerVideo.pause();
      workerVideo.removeAttribute('src');
      workerVideo.load();
      if (videoEncoder.state !== 'closed') {
        try { videoEncoder.close(); } catch (_) {}
      }
    }
  }

  async _decodeOriginalAudio(file, duration) {
    try {
      const arrayBuf = await file.arrayBuffer();
      const sampleRate = 48000;
      const totalSamples = Math.ceil(duration * sampleRate);
      const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);
      const decoded = await offlineCtx.decodeAudioData(arrayBuf.slice(0));

      const source = offlineCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(offlineCtx.destination);
      source.start(0);

      return await offlineCtx.startRendering();
    } catch (err) {
      // Nếu video gốc không có âm thanh, tiếp tục xuất phần hình ảnh bình thường
      console.warn('Video không có kênh âm thanh hoặc không giải mã được âm thanh:', err);
      return null;
    }
  }

  async _encodeAacAudio(audioBuffer, muxer) {
    const sampleRate = audioBuffer.sampleRate;
    const totalFrames = audioBuffer.length;
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;

    let audioErr = null;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (err) => { audioErr = err; }
    });

    encoder.configure({
      codec: 'mp4a.40.2',
      sampleRate,
      numberOfChannels: 2,
      bitrate: 128_000
    });

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

      encoder.encode(audioData);
      audioData.close();
    }

    await encoder.flush();
    encoder.close();
  }

  _seekVideo(videoEl, timeSec) {
    if (Math.abs(videoEl.currentTime - timeSec) < 0.004 && videoEl.readyState >= 2) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        videoEl.removeEventListener('seeked', finish);
        resolve();
      };
      videoEl.addEventListener('seeked', finish, { once: true });
      try { videoEl.currentTime = timeSec; } catch (_) { finish(); }
      setTimeout(finish, 1200);
    });
  }

  /* =========================================================
     PHƯƠNG ÁN DỰ PHÒNG: MEDIARECORDER THỜI GIAN THỰC
     ========================================================= */
  async _renderWithMediaRecorder({ width, height, fps, mimeType, onProgress }) {
    const vid = this.composer.videoEl;
    const duration = vid.duration;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = width;
    offCanvas.height = height;
    const offCtx = offCanvas.getContext('2d', { alpha: false });

    const canvasStream = offCanvas.captureStream(fps);
    // Cố gắng lấy thêm âm thanh từ phần tử video nếu trình duyệt hỗ trợ captureStream
    if (typeof vid.captureStream === 'function') {
      const vidStream = vid.captureStream();
      vidStream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
    }

    const chunks = [];
    const recorder = new MediaRecorder(canvasStream, {
      mimeType,
      videoBitsPerSecond: 6_000_000
    });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const donePromise = new Promise(resolve => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    vid.currentTime = 0;
    recorder.start(250);
    await vid.play();

    await new Promise((resolve, reject) => {
      const drawLoop = () => {
        if (this.cancelled) {
          vid.pause();
          recorder.stop();
          return reject(new Error('Đã hủy tạo video.'));
        }
        this.composer.composeFrame(offCtx, width, height, vid, true);
        const pct = Math.min(99, Math.round((vid.currentTime / duration) * 100));
        onProgress?.(pct, `Đang ghi video (${vid.currentTime.toFixed(1)}s / ${duration.toFixed(1)}s)...`);

        if (vid.ended || vid.currentTime >= duration - 0.05) {
          vid.pause();
          recorder.stop();
          resolve();
        } else {
          requestAnimationFrame(drawLoop);
        }
      };
      requestAnimationFrame(drawLoop);
    });

    onProgress?.(100, 'Tạo video hoàn tất!');
    return await donePromise;
  }
}

window.AutoVideoExporter = AutoVideoExporter;
