/**
 * KAI TỒ REVIEW – REAL MP4 EXPORTER (video-export.js)
 * Xuất MP4 chuẩn H.264 + âm thanh gốc AAC trên cả iPhone (Safari), Android và Windows.
 */

class AutoVideoExporter {
  constructor(composer) {
    this.composer = composer;
    this.isExporting = false;
    this.cancelled = false;
    this.isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.isMobile = this.isIOS || /Android|Mobile/i.test(navigator.userAgent);
  }

  /**
   * Kiểm tra cấu hình mã hóa H.264 và âm thanh AAC tương thích thiết bị
   */
  async checkSupport() {
    const hasMuxer = typeof window.Mp4Muxer !== 'undefined';
    const hasWebCodecs = typeof window.VideoEncoder !== 'undefined' && typeof window.VideoFrame !== 'undefined';

    if (hasMuxer && hasWebCodecs) {
      const avcCodec = await this._pickAvcCodec(720, 1280, 24);
      if (avcCodec) {
        const aacConfig = await this._pickAacConfig();
        if (aacConfig) {
          return {
            mode: 'webcodecs',
            aacConfig,
            label: this.isIOS
              ? '✅ Sẵn sàng xuất MP4 iPhone (Hình + Âm thanh AAC)'
              : (this.isMobile
                ? '✅ Sẵn sàng xuất MP4 (Hình + Âm thanh)'
                : '✅ Sẵn sàng xuất MP4 H.264 + AAC (GPU)'),
            ok: true
          };
        }
      }
    }

    // Nếu trình duyệt không hỗ trợ AudioEncoder AAC nhưng có MediaRecorder MP4 (ví dụ iOS cũ)
    if (typeof window.MediaRecorder !== 'undefined') {
      const mimeType = MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
          ? 'video/webm;codecs=vp9,opus'
          : 'video/webm');
      return {
        mode: 'mediarecorder',
        mimeType,
        label: '✅ Sẵn sàng xuất video kèm âm thanh (Chế độ tương thích)',
        ok: true
      };
    }

    return {
      mode: 'unsupported',
      label: '❌ Trình duyệt không hỗ trợ xuất video',
      ok: false
    };
  }

  async _pickAvcCodec(width, height, fps) {
    const codecs = this.isIOS
      ? ['avc1.4d002a', 'avc1.4d001f', 'avc1.42001f', 'avc1.64002a']
      : ['avc1.64002a', 'avc1.4d002a', 'avc1.640028', 'avc1.420028', 'avc1.42001f'];

    for (const codec of codecs) {
      try {
        const res = await VideoEncoder.isConfigSupported({
          codec,
          width,
          height,
          bitrate: 5_000_000,
          framerate: fps,
          avc: { format: 'avc' }
        });
        if (res.supported) return codec;
      } catch (_) {}
    }
    return null;
  }

  /**
   * Tự động dò tần số âm thanh AAC mà thiết bị hỗ trợ (iPhone dùng 44100Hz, PC dùng 48000Hz)
   */
  async _pickAacConfig() {
    if (typeof window.AudioEncoder === 'undefined') return null;

    const sampleRates = this.isIOS ? [44100, 48000] : [48000, 44100];
    const bitrates = [128_000, 96_000];

    for (const sampleRate of sampleRates) {
      for (const bitrate of bitrates) {
        try {
          const cfg = {
            codec: 'mp4a.40.2',
            sampleRate,
            numberOfChannels: 2,
            bitrate
          };
          const res = await AudioEncoder.isConfigSupported(cfg);
          if (res.supported) return cfg;
        } catch (_) {}
      }
    }
    return null;
  }

  cancel() {
    this.cancelled = true;
  }

  _getOutputSize(quality) {
    const shortEdge = Number(quality) === 720 ? 720 : 1080;
    const ratio = this.composer.height / this.composer.width;
    const width = Math.round(shortEdge / 2) * 2;
    const height = Math.round((width * ratio) / 2) * 2;
    return { width, height };
  }

  async createMp4({ quality = 1080, fps = 30, onProgress }) {
    if (this.isExporting) return null;
    if (!this.composer.bgLoaded) {
      throw new Error('Không tìm thấy ảnh nền cố định (background.png).');
    }
    if (!this.composer.videoLoaded || !this.composer.videoFile) {
      throw new Error('Vui lòng nạp video trước khi tạo video.');
    }

    this.isExporting = true;
    this.cancelled = false;
    this.composer.pausePreview();

    const effectiveFps = this.isMobile ? 24 : fps;
    const support = await this.checkSupport();
    const { width, height } = this._getOutputSize(quality);

    try {
      if (support.mode === 'webcodecs') {
        const blob = await this._renderWithWebCodecs({
          width,
          height,
          fps: effectiveFps,
          aacConfig: support.aacConfig,
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
          fps: effectiveFps,
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
        throw new Error('Trình duyệt không hỗ trợ xuất MP4. Hãy mở website bằng Safari (iPhone) hoặc Chrome/Cốc Cốc.');
      }
    } finally {
      this.isExporting = false;
    }
  }

  /* =========================================================
     PHƯƠNG ÁN CHÍNH: WEBCODECS (H.264 AVCC + AAC) + MP4-MUXER
     ========================================================= */
  async _renderWithWebCodecs({ width, height, fps, aacConfig, onProgress }) {
    const duration = this.composer.videoEl.duration;
    if (!isFinite(duration) || duration <= 0) {
      throw new Error('Không xác định được thời lượng video đầu vào.');
    }

    const totalFrames = Math.max(1, Math.ceil(duration * fps));
    const frameDurationUs = Math.round(1_000_000 / fps);
    const avcCodec = await this._pickAvcCodec(width, height, fps);

    if (!avcCodec) {
      throw new Error(`Thiết bị không hỗ trợ mã hóa H.264 ở mức ${width}×${height}. Hãy chọn HD 720p.`);
    }

    // Bước 1: Giải mã và chuẩn hóa âm thanh gốc của video theo đúng sampleRate hỗ trợ
    let audioBuffer = null;
    if (aacConfig) {
      onProgress?.(3, 'Đang tách âm thanh gốc của video...');
      audioBuffer = await this._decodeOriginalAudio(
        this.composer.videoFile,
        duration,
        aacConfig.sampleRate
      );
    }

    if (this.cancelled) throw new Error('Đã hủy quá trình tạo video.');

    // Bước 2: Khởi tạo bộ đóng gói MP4
    const muxerConfig = {
      target: new window.Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width, height },
      fastStart: 'in-memory'
    };
    if (audioBuffer && aacConfig) {
      muxerConfig.audio = {
        codec: 'aac',
        numberOfChannels: 2,
        sampleRate: aacConfig.sampleRate
      };
    }
    const muxer = new window.Mp4Muxer.Muxer(muxerConfig);

    // Bước 3: Mã hóa âm thanh AAC vào file MP4
    if (audioBuffer && aacConfig) {
      onProgress?.(8, 'Đang ghép âm thanh AAC...');
      await this._encodeAacAudio(audioBuffer, aacConfig, muxer);
      audioBuffer = null;
    }

    if (this.cancelled) throw new Error('Đã hủy quá trình tạo video.');

    // Bước 4: Khởi tạo VideoEncoder H.264 chuẩn AVCC
    let encodeError = null;
    let encodedChunksCount = 0;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        encodedChunksCount++;
        muxer.addVideoChunk(chunk, meta);
      },
      error: (err) => { encodeError = err; }
    });

    const bitrate = this.isMobile
      ? (width >= 1080 ? 5_000_000 : 3_200_000)
      : (width >= 1080 ? 8_000_000 : 4_500_000);

    const encoderConfig = {
      codec: avcCodec,
      width,
      height,
      bitrate,
      framerate: fps,
      avc: { format: 'avc' }
    };
    if (!this.isIOS) {
      encoderConfig.hardwareAcceleration = 'prefer-hardware';
    }
    videoEncoder.configure(encoderConfig);

    const offCanvas = document.createElement('canvas');
    offCanvas.width = width;
    offCanvas.height = height;
    const offCtx = offCanvas.getContext('2d', { alpha: false });

    const workerVideo = document.createElement('video');
    workerVideo.src = this.composer.videoUrl;
    workerVideo.muted = true;
    workerVideo.playsInline = true;
    workerVideo.setAttribute('playsinline', '');
    workerVideo.setAttribute('muted', '');
    workerVideo.preload = 'auto';
    workerVideo.style.cssText = 'position:fixed;right:0;bottom:0;width:4px;height:4px;opacity:0.01;pointer-events:none;z-index:-1;';
    document.body.appendChild(workerVideo);

    await new Promise((resolve, reject) => {
      if (workerVideo.readyState >= 2) return resolve();
      workerVideo.onloadeddata = () => resolve();
      workerVideo.onerror = () => reject(new Error('Không thể đọc luồng hình ảnh video để xuất.'));
    });

    try {
      for (let i = 0; i < totalFrames; i++) {
        if (this.cancelled) throw new Error('Đã hủy quá trình tạo video.');
        if (encodeError) throw encodeError;

        const targetTime = Math.min(i / fps, Math.max(0, duration - 0.02));
        await this._seekVideo(workerVideo, targetTime);

        if (this.isIOS) {
          await new Promise(r => requestAnimationFrame(r));
        }

        this.composer.composeFrame(offCtx, width, height, workerVideo, true);

        const frame = new VideoFrame(offCanvas, {
          timestamp: i * frameDurationUs,
          duration: frameDurationUs
        });

        videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();

        while (videoEncoder.encodeQueueSize > 6) {
          await new Promise(r => setTimeout(r, 8));
        }

        if (i % 3 === 0 || i === totalFrames - 1) {
          const pct = 10 + Math.round(((i + 1) / totalFrames) * 86);
          onProgress?.(pct, `Đang ghép hình & tiếng ${i + 1}/${totalFrames}...`);
        }
      }

      onProgress?.(97, 'Đang đóng gói file MP4 hoàn chỉnh...');
      await videoEncoder.flush();
      videoEncoder.close();

      if (encodedChunksCount === 0) {
        throw new Error('Không mã hóa được khung hình nào trên thiết bị này.');
      }

      muxer.finalize();

      onProgress?.(100, 'Tạo video MP4 hoàn tất!');
      return new Blob([muxer.target.buffer], { type: 'video/mp4' });
    } catch (err) {
      if (err && err.name === 'SecurityError') {
        throw new Error('Lỗi bảo mật trình duyệt (Tainted Canvas). Hãy mở website qua đường link GitHub Pages.');
      }
      throw err;
    } finally {
      workerVideo.pause();
      workerVideo.removeAttribute('src');
      workerVideo.load();
      workerVideo.remove();
      if (videoEncoder.state !== 'closed') {
        try { videoEncoder.close(); } catch (_) {}
      }
    }
  }

  /**
   * Giải mã âm thanh gốc từ file MP4/TikTok bằng AudioContext + OfflineAudioContext
   */
  async _decodeOriginalAudio(file, duration, targetSampleRate) {
    let audioCtx = null;
    try {
      const arrayBuf = await file.arrayBuffer();
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtxClass();

      const decoded = await new Promise((resolve, reject) => {
        const res = audioCtx.decodeAudioData(arrayBuf.slice(0), resolve, reject);
        if (res && typeof res.then === 'function') {
          res.then(resolve).catch(reject);
        }
      });

      if (!decoded || decoded.length === 0) return null;

      // Chuyển đổi về đúng stereo 2 kênh và tần số targetSampleRate (44100Hz trên iPhone)
      const totalSamples = Math.max(1, Math.ceil(duration * targetSampleRate));
      const offlineCtx = new OfflineAudioContext(2, totalSamples, targetSampleRate);

      const source = offlineCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(offlineCtx.destination);
      source.start(0);

      return await offlineCtx.startRendering();
    } catch (err) {
      console.warn('Không tách được âm thanh từ video gốc:', err);
      return null;
    } finally {
      if (audioCtx && typeof audioCtx.close === 'function') {
        try { await audioCtx.close(); } catch (_) {}
      }
    }
  }

  async _encodeAacAudio(audioBuffer, aacConfig, muxer) {
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
      bitrate: aacConfig.bitrate || 128_000
    });

    const chunkSize = 2048;
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
     PHƯƠNG ÁN DỰ PHÒNG: MEDIARECORDER CÓ THU ÂM THANH
     ========================================================= */
  async _renderWithMediaRecorder({ width, height, fps, mimeType, onProgress }) {
    const vid = this.composer.videoEl;
    const duration = vid.duration;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = width;
    offCanvas.height = height;
    const offCtx = offCanvas.getContext('2d', { alpha: false });

    const canvasStream = offCanvas.captureStream(fps);
    let audioCtx = null;

    // Thu âm thanh trực tiếp qua AudioContext (hoạt động trên cả iOS Safari)
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtxClass();
      const source = audioCtx.createMediaElementSource(vid);
      const dest = audioCtx.createMediaStreamDestination();
      source.connect(dest);
      source.connect(audioCtx.destination);
      dest.stream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
    } catch (_) {
      if (typeof vid.captureStream === 'function') {
        const vidStream = vid.captureStream();
        vidStream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
      }
    }

    const chunks = [];
    const recorder = new MediaRecorder(canvasStream, {
      mimeType,
      videoBitsPerSecond: 4_500_000
    });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const donePromise = new Promise(resolve => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    vid.muted = false;
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
        onProgress?.(pct, `Đang ghi hình & âm thanh (${vid.currentTime.toFixed(1)}s / ${duration.toFixed(1)}s)...`);

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

    if (audioCtx) {
      try { await audioCtx.close(); } catch (_) {}
    }

    onProgress?.(100, 'Tạo video hoàn tất!');
    return await donePromise;
  }
}

window.AutoVideoExporter = AutoVideoExporter;
