/**
 * KAI TỒ REVIEW – REAL MP4 EXPORTER (video-export.js)
 * Tách và ghép nguyên bản luồng âm thanh AAC gốc từ MP4/TikTok (không cần AudioEncoder),
 * đảm bảo xuất video MP4 có đầy đủ hình + tiếng trên cả iPhone (Safari), Android và Windows.
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
   * Kiểm tra bộ mã hóa hình ảnh H.264 (không phụ thuộc AudioEncoder trên iPhone)
   */
  async checkSupport() {
    const hasMuxer = typeof window.Mp4Muxer !== 'undefined';
    const hasWebCodecs = typeof window.VideoEncoder !== 'undefined' && typeof window.VideoFrame !== 'undefined';

    if (hasMuxer && hasWebCodecs) {
      const avcCodec = await this._pickAvcCodec(720, 1280, 24);
      if (avcCodec) {
        const aacConfig = await this._pickAacConfig();
        return {
          mode: 'webcodecs',
          aacConfig,
          label: this.isIOS
            ? '✅ Sẵn sàng xuất MP4 iPhone (Giữ nguyên âm thanh gốc)'
            : (this.isMobile
              ? '✅ Sẵn sàng xuất MP4 (Hình + Âm thanh gốc)'
              : '✅ Sẵn sàng xuất MP4 H.264 + AAC (GPU)'),
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
        label: '⚠️ Chế độ dự phòng (Khuyên dùng Safari/Chrome bản mới)',
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

  async _pickAacConfig() {
    if (typeof window.AudioEncoder === 'undefined') return null;
    const sampleRates = this.isIOS ? [44100, 48000] : [48000, 44100];
    for (const sampleRate of sampleRates) {
      try {
        const cfg = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: 128_000 };
        const res = await AudioEncoder.isConfigSupported(cfg);
        if (res.supported) return cfg;
      } catch (_) {}
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
     TÁCH NGUYÊN BẢN LUỒNG ÂM THANH AAC TỪ FILE MP4 / MOV GỐC
     (Chạy 100% bằng JS thuần - hoạt động trên mọi iPhone Safari)
     ========================================================= */
  _extractAacFromMp4(arrayBuffer) {
    try {
      if (!arrayBuffer || arrayBuffer.byteLength < 16) return null;
      const view = new DataView(arrayBuffer);
      const totalLen = arrayBuffer.byteLength;

      const readFourCC = (pos) =>
        String.fromCharCode(
          view.getUint8(pos),
          view.getUint8(pos + 1),
          view.getUint8(pos + 2),
          view.getUint8(pos + 3)
        );

      const findBoxes = (start, end, targetType) => {
        const result = [];
        let pos = start;
        while (pos + 8 <= end) {
          let size = view.getUint32(pos);
          const type = readFourCC(pos + 4);
          let headerSize = 8;

          if (size === 1) {
            if (pos + 16 > end) break;
            size = view.getUint32(pos + 8) * 4294967296 + view.getUint32(pos + 12);
            headerSize = 16;
          } else if (size === 0) {
            size = end - pos;
          }

          if (size < headerSize || pos + size > end) break;
          if (!targetType || type === targetType) {
            result.push({ type, start: pos, dataStart: pos + headerSize, end: pos + size });
          }
          pos += size;
        }
        return result;
      };

      const moov = findBoxes(0, totalLen, 'moov')[0];
      if (!moov) return null;

      const traks = findBoxes(moov.dataStart, moov.end, 'trak');
      for (const trak of traks) {
        const mdia = findBoxes(trak.dataStart, trak.end, 'mdia')[0];
        if (!mdia) continue;

        const hdlr = findBoxes(mdia.dataStart, mdia.end, 'hdlr')[0];
        if (!hdlr || hdlr.dataStart + 12 > hdlr.end) continue;
        if (readFourCC(hdlr.dataStart + 8) !== 'soun') continue;

        // Đọc timescale của track âm thanh từ mdhd
        const mdhd = findBoxes(mdia.dataStart, mdia.end, 'mdhd')[0];
        if (!mdhd) continue;
        const mdhdVer = view.getUint8(mdhd.dataStart);
        const timescale = mdhdVer === 1
          ? view.getUint32(mdhd.dataStart + 20)
          : view.getUint32(mdhd.dataStart + 12);
        if (!timescale) continue;

        const minf = findBoxes(mdia.dataStart, mdia.end, 'minf')[0];
        if (!minf) continue;
        const stbl = findBoxes(minf.dataStart, minf.end, 'stbl')[0];
        if (!stbl) continue;

        const stsd = findBoxes(stbl.dataStart, stbl.end, 'stsd')[0];
        const stts = findBoxes(stbl.dataStart, stbl.end, 'stts')[0];
        const stsz = findBoxes(stbl.dataStart, stbl.end, 'stsz')[0];
        const stsc = findBoxes(stbl.dataStart, stbl.end, 'stsc')[0];
        const stco = findBoxes(stbl.dataStart, stbl.end, 'stco')[0];
        const co64 = findBoxes(stbl.dataStart, stbl.end, 'co64')[0];
        if (!stsd || !stts || !stsz || !stsc || (!stco && !co64)) continue;

        // Đọc thông tin mp4a + esds (AudioSpecificConfig)
        const entryStart = stsd.dataStart + 8;
        if (entryStart + 36 > stsd.end) continue;
        const entrySize = view.getUint32(entryStart);
        const entryType = readFourCC(entryStart + 4);
        if (entryType !== 'mp4a') continue;

        const entryEnd = Math.min(stsd.end, entryStart + entrySize);
        const p = entryStart + 8;
        const audioVer = view.getUint16(p + 8);

        let channels = view.getUint16(p + 16) || 2;
        let sampleRate = view.getUint16(p + 24) || timescale;
        let childStart = p + 28;

        if (audioVer === 1) {
          childStart = p + 44;
        } else if (audioVer === 2 && p + 64 <= entryEnd) {
          const srFloat = view.getFloat64(p + 28);
          if (srFloat > 0) sampleRate = Math.round(srFloat);
          channels = view.getUint32(p + 36) || channels;
          childStart = p + 64;
        }

        // Tìm box esds trực tiếp hoặc nằm bên trong box wave (hay gặp ở video quay từ iPhone .MOV)
        let esds = findBoxes(childStart, entryEnd, 'esds')[0];
        if (!esds) {
          const wave = findBoxes(childStart, entryEnd, 'wave')[0];
          if (wave) {
            esds = findBoxes(wave.dataStart, wave.end, 'esds')[0];
          }
        }

        const freqTable = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
        let description = null;

        if (esds && esds.dataStart + 4 < esds.end) {
          description = this._parseEsdsConfig(view, arrayBuffer, esds.dataStart + 4, esds.end);
        }

        if (description && description.length >= 2) {
          const aot = (description[0] >> 3) & 0x1f;
          const freqIdx = ((description[0] & 0x07) << 1) | ((description[1] >> 7) & 0x01);
          const chanCfg = (description[1] >> 3) & 0x0f;
          if (aot === 2 && freqIdx < freqTable.length) {
            sampleRate = freqTable[freqIdx];
          }
          if (chanCfg >= 1 && chanCfg <= 6) {
            channels = chanCfg;
          }
        } else {
          // Tự tạo 2 byte AudioSpecificConfig chuẩn AAC-LC nếu file bị thiếu esds
          let freqIdx = freqTable.indexOf(sampleRate);
          if (freqIdx === -1) freqIdx = 4; // 44100 Hz
          const b0 = (2 << 3) | ((freqIdx >> 1) & 0x07);
          const b1 = ((freqIdx & 0x01) << 7) | ((channels & 0x0f) << 3);
          description = new Uint8Array([b0, b1]);
        }

        // Đọc bảng thời lượng từng mẫu (stts)
        const sttsCount = view.getUint32(stts.dataStart + 4);
        const sttsEntries = [];
        for (let i = 0; i < sttsCount; i++) {
          const base = stts.dataStart + 8 + i * 8;
          if (base + 8 > stts.end) break;
          sttsEntries.push({
            count: view.getUint32(base),
            delta: view.getUint32(base + 4)
          });
        }

        // Đọc kích thước từng mẫu (stsz)
        const defaultSampleSize = view.getUint32(stsz.dataStart + 4);
        const sampleCount = view.getUint32(stsz.dataStart + 8);
        if (sampleCount === 0) continue;

        const getSampleSize = (idx) =>
          defaultSampleSize !== 0
            ? defaultSampleSize
            : view.getUint32(stsz.dataStart + 12 + idx * 4);

        // Đọc phân bổ mẫu vào chunk (stsc)
        const stscCount = view.getUint32(stsc.dataStart + 4);
        const stscEntries = [];
        for (let i = 0; i < stscCount; i++) {
          const base = stsc.dataStart + 8 + i * 12;
          if (base + 12 > stsc.end) break;
          stscEntries.push({
            firstChunk: view.getUint32(base),
            samplesPerChunk: view.getUint32(base + 4)
          });
        }
        if (stscEntries.length === 0) continue;

        // Đọc vị trí byte các chunk (stco / co64)
        const chunkOffsets = [];
        if (stco) {
          const chunkCount = view.getUint32(stco.dataStart + 4);
          for (let i = 0; i < chunkCount; i++) {
            chunkOffsets.push(view.getUint32(stco.dataStart + 8 + i * 4));
          }
        } else {
          const chunkCount = view.getUint32(co64.dataStart + 4);
          for (let i = 0; i < chunkCount; i++) {
            const base = co64.dataStart + 8 + i * 8;
            chunkOffsets.push(view.getUint32(base) * 4294967296 + view.getUint32(base + 4));
          }
        }

        // Trích xuất từng gói âm thanh AAC thô kèm mốc thời gian chính xác
        const samples = [];
        let sampleIdx = 0;
        let stscIdx = 0;
        let sttsIdx = 0;
        let sttsUsed = 0;
        let dts = 0;

        for (let c = 0; c < chunkOffsets.length && sampleIdx < sampleCount; c++) {
          const chunkNum = c + 1;
          while (stscIdx + 1 < stscEntries.length && stscEntries[stscIdx + 1].firstChunk <= chunkNum) {
            stscIdx++;
          }

          const samplesInChunk = stscEntries[stscIdx].samplesPerChunk;
          let bytePos = chunkOffsets[c];

          for (let j = 0; j < samplesInChunk && sampleIdx < sampleCount; j++) {
            const sz = getSampleSize(sampleIdx);
            while (sttsIdx < sttsEntries.length && sttsUsed >= sttsEntries[sttsIdx].count) {
              sttsIdx++;
              sttsUsed = 0;
            }
            const delta = sttsIdx < sttsEntries.length ? sttsEntries[sttsIdx].delta : 1024;
            sttsUsed++;

            if (sz > 0 && bytePos + sz <= totalLen) {
              samples.push({
                data: new Uint8Array(arrayBuffer, bytePos, sz),
                timestampUs: Math.round((dts / timescale) * 1_000_000),
                durationUs: Math.max(1, Math.round((delta / timescale) * 1_000_000))
              });
            }

            bytePos += sz;
            dts += delta;
            sampleIdx++;
          }
        }

        if (samples.length > 0) {
          return { channels, sampleRate, description, samples };
        }
      }
    } catch (err) {
      console.warn('Không đọc trực tiếp được track AAC từ MP4:', err);
    }
    return null;
  }

  _parseEsdsConfig(view, arrayBuffer, start, end) {
    const readLen = (pos) => {
      let len = 0;
      let count = 0;
      while (count < 4 && pos + count < end) {
        const b = view.getUint8(pos + count);
        count++;
        len = (len << 7) | (b & 0x7f);
        if ((b & 0x80) === 0) break;
      }
      return { len, nextPos: pos + count };
    };

    const walk = (pos, limit) => {
      while (pos + 2 < limit) {
        const tag = view.getUint8(pos++);
        const { len, nextPos } = readLen(pos);
        pos = nextPos;
        const descrEnd = Math.min(limit, pos + len);

        if (tag === 0x03) {
          // ES_DescrTag
          if (pos + 3 > descrEnd) break;
          pos += 2; // ES_ID
          const flags = view.getUint8(pos++);
          if (flags & 0x80) pos += 2;
          if (flags & 0x40) {
            const urlLen = view.getUint8(pos++);
            pos += urlLen;
          }
          if (flags & 0x20) pos += 2;
          const found = walk(pos, descrEnd);
          if (found) return found;
        } else if (tag === 0x04) {
          // DecoderConfigDescrTag
          if (pos + 13 > descrEnd) break;
          const found = walk(pos + 13, descrEnd);
          if (found) return found;
        } else if (tag === 0x05) {
          // DecSpecificInfoTag -> AudioSpecificConfig
          if (len > 0 && pos + len <= limit) {
            return new Uint8Array(arrayBuffer.slice(pos, pos + len));
          }
        }
        pos = descrEnd;
      }
      return null;
    };

    return walk(start, end);
  }

  _addRawAacToMuxer(muxer, rawAac, durationSec) {
    const maxAudioUs = Math.ceil(durationSec * 1_000_000) + 300_000;
    const decoderConfig = {
      codec: 'mp4a.40.2',
      numberOfChannels: rawAac.channels,
      sampleRate: rawAac.sampleRate,
      description: rawAac.description
    };

    let lastTs = -1;
    let added = 0;

    for (let i = 0; i < rawAac.samples.length; i++) {
      const s = rawAac.samples[i];
      if (s.timestampUs > maxAudioUs) break;

      const ts = s.timestampUs <= lastTs ? lastTs + 1 : s.timestampUs;
      lastTs = ts;
      const meta = added === 0 ? { decoderConfig } : undefined;

      // Tạo đối tượng chunk tương thích cả khi Safari không có sẵn lớp EncodedAudioChunk
      let chunk = null;
      if (typeof window.EncodedAudioChunk !== 'undefined') {
        try {
          chunk = new EncodedAudioChunk({
            type: 'key',
            timestamp: ts,
            duration: s.durationUs,
            data: s.data
          });
        } catch (_) {
          chunk = null;
        }
      }

      if (!chunk) {
        chunk = {
          type: 'key',
          timestamp: ts,
          duration: s.durationUs,
          byteLength: s.data.byteLength,
          copyTo(dest) {
            if (dest instanceof ArrayBuffer) {
              new Uint8Array(dest).set(s.data);
            } else if (ArrayBuffer.isView(dest)) {
              new Uint8Array(dest.buffer, dest.byteOffset, dest.byteLength).set(s.data);
            }
          }
        };
      }

      try {
        muxer.addAudioChunk(chunk, meta);
      } catch (_) {
        muxer.addAudioChunkRaw(s.data, 'key', ts, meta);
      }
      added++;
    }
    return added;
  }

  /* =========================================================
     PHƯƠNG ÁN CHÍNH: WEBCODECS VIDEO H.264 + GIỮ NGUYÊN ÂM THANH AAC
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

    // Bước 1: Ưu tiên tách thẳng luồng âm thanh AAC gốc từ file MP4/TikTok (không cần AudioEncoder)
    onProgress?.(3, 'Đang tách âm thanh gốc từ video...');
    let rawAac = null;
    try {
      const fileBuf = await this.composer.videoFile.arrayBuffer();
      rawAac = this._extractAacFromMp4(fileBuf);
    } catch (_) {}

    // Nếu không phải file MP4-AAC (ví dụ WebM) thì thử nén lại bằng AudioEncoder nếu máy có hỗ trợ
    let fallbackAudioBuffer = null;
    if (!rawAac && aacConfig) {
      fallbackAudioBuffer = await this._decodeOriginalAudio(
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

    if (rawAac) {
      muxerConfig.audio = {
        codec: 'aac',
        numberOfChannels: rawAac.channels,
        sampleRate: rawAac.sampleRate
      };
    } else if (fallbackAudioBuffer && aacConfig) {
      muxerConfig.audio = {
        codec: 'aac',
        numberOfChannels: 2,
        sampleRate: aacConfig.sampleRate
      };
    }

    const muxer = new window.Mp4Muxer.Muxer(muxerConfig);

    // Bước 3: Đưa âm thanh vào file MP4
    let hasSoundInOutput = false;
    if (rawAac) {
      onProgress?.(8, `Đang ghép nguyên bản âm thanh gốc (${rawAac.sampleRate} Hz)...`);
      const added = this._addRawAacToMuxer(muxer, rawAac, duration);
      hasSoundInOutput = added > 0;
      rawAac = null;
    } else if (fallbackAudioBuffer && aacConfig) {
      onProgress?.(8, 'Đang mã hóa âm thanh AAC...');
      await this._encodeAacAudio(fallbackAudioBuffer, aacConfig, muxer);
      hasSoundInOutput = true;
      fallbackAudioBuffer = null;
    }

    if (this.cancelled) throw new Error('Đã hủy quá trình tạo video.');

    // Bước 4: Mã hóa hình ảnh H.264 chuẩn AVCC cho iPhone & Windows
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
          const audioTag = hasSoundInOutput ? 'có âm thanh' : 'không có tiếng gốc';
          onProgress?.(pct, `Đang ghép hình (${audioTag}) ${i + 1}/${totalFrames}...`);
        }
      }

      onProgress?.(97, 'Đang đóng gói file MP4 hoàn chỉnh...');
      await videoEncoder.flush();
      videoEncoder.close();

      if (encodedChunksCount === 0) {
        throw new Error('Không mã hóa được khung hình nào trên thiết bị này.');
      }

      muxer.finalize();

      onProgress?.(
        100,
        hasSoundInOutput
          ? 'Tạo video MP4 thành công (Đã giữ nguyên âm thanh gốc)!'
          : 'Tạo video MP4 hoàn tất (Video đầu vào không có kênh âm thanh AAC).'
      );
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

  async _decodeOriginalAudio(file, duration, targetSampleRate) {
    let audioCtx = null;
    try {
      const arrayBuf = await file.arrayBuffer();
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtxClass();

      const decoded = await new Promise((resolve, reject) => {
        const res = audioCtx.decodeAudioData(arrayBuf.slice(0), resolve, reject);
        if (res && typeof res.then === 'function') res.then(resolve).catch(reject);
      });
      if (!decoded || decoded.length === 0) return null;

      const totalSamples = Math.max(1, Math.ceil(duration * targetSampleRate));
      const offlineCtx = new OfflineAudioContext(2, totalSamples, targetSampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(offlineCtx.destination);
      source.start(0);

      return await offlineCtx.startRendering();
    } catch (_) {
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
     PHƯƠNG ÁN DỰ PHÒNG: MEDIARECORDER
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

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioCtxClass();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
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

    if (audioCtx) {
      try { await audioCtx.close(); } catch (_) {}
    }

    onProgress?.(100, 'Tạo video hoàn tất!');
    return await donePromise;
  }
}

window.AutoVideoExporter = AutoVideoExporter;
