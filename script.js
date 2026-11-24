/**
 * KAI TỒ REVIEW – AUTO VIDEO COMPOSER UI CONTROLLER (script.js)
 * Hỗ trợ tự động lấy video từ link TikTok để ghép thẳng vào ảnh nền + dự phòng tải file MP4.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const composer = new AutoVideoComposer('previewCanvas');
  const exporter = new AutoVideoExporter(composer);

  const codecBadge = document.getElementById('codecBadge');
  const bgErrorOverlay = document.getElementById('bgErrorOverlay');
  const tiktokUrlInput = document.getElementById('tiktokUrlInput');
  const btnConfirmLink = document.getElementById('btnConfirmLink');
  const tiktokFeedback = document.getElementById('tiktokFeedback');
  const tiktokEmbedWrap = document.getElementById('tiktokEmbedWrap');

  const btnUploadMp4 = document.getElementById('btnUploadMp4');
  const mp4FileInput = document.getElementById('mp4FileInput');
  const videoMetaBox = document.getElementById('videoMetaBox');
  const metaFileName = document.getElementById('metaFileName');
  const metaResolution = document.getElementById('metaResolution');
  const metaDuration = document.getElementById('metaDuration');
  const metaSize = document.getElementById('metaSize');
  const memoryWarning = document.getElementById('memoryWarning');

  const exportQuality = document.getElementById('exportQuality');
  const btnCreateVideo = document.getElementById('btnCreateVideo');
  const btnCancelExport = document.getElementById('btnCancelExport');
  const progressSection = document.getElementById('progressSection');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressStatus = document.getElementById('progressStatus');
  const progressPercent = document.getElementById('progressPercent');
  const exportResultMessage = document.getElementById('exportResultMessage');
  const btnDownloadMp4 = document.getElementById('btnDownloadMp4');

  const btnPlayPreview = document.getElementById('btnPlayPreview');
  const btnRestartPreview = document.getElementById('btnRestartPreview');
  const previewTime = document.getElementById('previewTime');

  let outputDownloadUrl = null;
  let outputFilename = 'KAI_TO_REVIEW.mp4';

  function clearPreviousOutput() {
    if (outputDownloadUrl) {
      URL.revokeObjectURL(outputDownloadUrl);
      outputDownloadUrl = null;
    }
    btnDownloadMp4.classList.add('hidden');
    exportResultMessage.classList.add('hidden');
  }

  function showBox(el, type, html) {
    el.className = `feedback-box ${type}`;
    el.innerHTML = html;
    el.classList.remove('hidden');
  }

  function formatSec(sec) {
    const s = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }

  /**
   * Hàm dùng chung: nạp file MP4 (từ máy hoặc từ TikTok) vào khung xem trước bên phải
   */
  async function attachVideoToComposer(file, sourceLabel) {
    clearPreviousOutput();
    memoryWarning.classList.add('hidden');
    tiktokEmbedWrap.classList.add('hidden');
    tiktokEmbedWrap.innerHTML = '';

    const info = await composer.loadVideoFile(file);
    const sizeMB = info.sizeBytes / (1024 * 1024);

    metaFileName.textContent = info.name;
    metaResolution.textContent = `${info.width} × ${info.height}`;
    metaDuration.textContent = `${info.duration.toFixed(1)} giây`;
    metaSize.textContent = `${sizeMB.toFixed(1)} MB`;
    videoMetaBox.classList.remove('hidden');

    if (sizeMB > 250 || info.duration > 300) {
      memoryWarning.textContent =
        `⚠️ Video khá nặng (${sizeMB.toFixed(0)} MB, ${Math.round(info.duration)}s). ` +
        `Nên đóng bớt tab khác hoặc chọn 720p để xuất nhanh hơn.`;
      memoryWarning.classList.remove('hidden');
    }

    btnPlayPreview.disabled = false;
    btnRestartPreview.disabled = false;
    btnCreateVideo.disabled = !composer.bgLoaded;

    showBox(
      tiktokFeedback,
      'success',
      `✅ ${sourceLabel} Đã tự động ghép video vào đúng vùng bên phải! Bấm <b>Phát thử</b> hoặc bấm <b>TẠO VIDEO</b> ngay.`
    );
  }

  /* =========================================================
     1. KHỞI TẠO: NẠP ẢNH NỀN CỐ ĐỊNH & KIỂM TRA CODEC
     ========================================================= */
  const [bgOk, support] = await Promise.all([
    composer.loadFixedBackground(),
    exporter.checkSupport()
  ]);

  if (!bgOk) {
    bgErrorOverlay.classList.remove('hidden');
  }

  codecBadge.textContent = support.label;
  codecBadge.className = `codec-badge ${support.ok ? 'ok' : 'warn'}`;

  /* =========================================================
     2. DÁN LINK TIKTOK -> TỰ LẤY MP4 VÀ GHÉP THẲNG LÊN ẢNH NỀN
     ========================================================= */
  btnConfirmLink.addEventListener('click', async () => {
    const rawUrl = tiktokUrlInput.value.trim();
    tiktokEmbedWrap.classList.add('hidden');
    tiktokEmbedWrap.innerHTML = '';

    if (!rawUrl) {
      showBox(tiktokFeedback, 'error', 'Vui lòng dán đường link video TikTok vào ô trên.');
      return;
    }

    const isTikTokDomain = /^https?:\/\/(www\.|m\.|vt\.|vm\.)?tiktok\.com\/.+/i.test(rawUrl);
    if (!isTikTokDomain) {
      showBox(
        tiktokFeedback,
        'error',
        '❌ Link không hợp lệ. Link phải thuộc tên miền <b>tiktok.com</b>.'
      );
      return;
    }

    btnConfirmLink.disabled = true;
    btnConfirmLink.textContent = 'Đang lấy video...';
    showBox(tiktokFeedback, 'info', '⏳ Đang phân tích link TikTok và tự động kéo luồng MP4 vào khung ghép...');

    let directMp4Url = '';
    let videoId = '';

    try {
      // Gọi cổng API công khai miễn phí lấy link MP4 không logo
      const apiRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(rawUrl)}&hd=1`);
      if (!apiRes.ok) throw new Error('Cổng lấy video TikTok tạm thời không phản hồi.');

      const data = await apiRes.json();
      if (data.code !== 0 || !data.data) {
        throw new Error(data.msg || 'Không tìm thấy video (link có thể đang để riêng tư hoặc là bài đăng ảnh).');
      }

      videoId = data.data.id || String(Date.now());
      directMp4Url = data.data.hdplay || data.data.play || data.data.wmplay || '';
      if (directMp4Url.startsWith('/')) {
        directMp4Url = 'https://www.tikwm.com' + directMp4Url;
      }

      if (!directMp4Url) {
        throw new Error('Link này không phải video MP4 (có thể là bài đăng ảnh trượt TikTok).');
      }

      showBox(tiktokFeedback, 'info', '⏳ Đã nhận diện video TikTok! Đang tải dữ liệu vào khung ghép bên phải...');

      // Tải luồng MP4 trực tiếp vào bộ nhớ trình duyệt (không cần lưu về máy người dùng)
      const videoRes = await fetch(directMp4Url);
      if (!videoRes.ok) {
        throw new Error('Trình duyệt bị chặn tải trực tiếp luồng MP4 này (CORS).');
      }

      const blob = await videoRes.blob();
      if (!blob || blob.size < 10000) {
        throw new Error('Dữ liệu video trả về không đầy đủ.');
      }

      const file = new File([blob], `tiktok_${videoId}.mp4`, { type: 'video/mp4' });
      await attachVideoToComposer(file, 'Lấy video TikTok thành công!');
    } catch (err) {
      // Nếu cổng API hoặc trình duyệt chặn CORS -> hiện link tải nhanh 1 chạm dự phòng
      let fallbackHtml = `⚠️ <b>Chưa tự kéo thẳng được video:</b> ${err.message}<br>`;
      if (directMp4Url) {
        fallbackHtml += `👉 <a href="${directMp4Url}" target="_blank" rel="noopener" style="color:#4ade80;font-weight:700;">Bấm vào đây để lưu nhanh file MP4 này</a>, rồi bấm nút <b>"Tải video MP4 từ máy tính"</b> bên dưới để ghép ngay.`;
      } else {
        fallbackHtml += `Hãy thử lại sau vài giây hoặc bấm nút <b>"Tải video MP4 từ máy tính"</b> bên dưới.`;
      }
      showBox(tiktokFeedback, 'error', fallbackHtml);
    } finally {
      btnConfirmLink.disabled = false;
      btnConfirmLink.textContent = 'Xác nhận link';
    }
  });

  /* =========================================================
     3. NẠP FILE VIDEO MP4 TỪ MÁY TÍNH (DỰ PHÒNG)
     ========================================================= */
  btnUploadMp4.addEventListener('click', () => mp4FileInput.click());

  mp4FileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      await attachVideoToComposer(file, 'Đã tải file từ máy tính!');
    } catch (err) {
      showBox(tiktokFeedback, 'error', '❌ ' + err.message);
    }

    mp4FileInput.value = '';
  });

  /* =========================================================
     4. ĐIỀU KHIỂN XEM TRƯỚC
     ========================================================= */
  btnPlayPreview.addEventListener('click', () => {
    const playing = composer.togglePlayPreview();
    btnPlayPreview.textContent = playing ? '⏸ Tạm dừng' : '▶ Phát thử';
  });

  btnRestartPreview.addEventListener('click', () => {
    composer.restartPreview();
  });

  composer.onTimeUpdate = (curr, total, isPlaying) => {
    previewTime.textContent = `${formatSec(curr)} / ${formatSec(total)}`;
    btnPlayPreview.textContent = isPlaying ? '⏸ Tạm dừng' : '▶ Phát thử';
  };

  /* =========================================================
     5 & 6. TẠO VIDEO MP4 & THANH TIẾN TRÌNH
     ========================================================= */
  btnCreateVideo.addEventListener('click', async () => {
    clearPreviousOutput();

    btnCreateVideo.disabled = true;
    btnUploadMp4.disabled = true;
    btnConfirmLink.disabled = true;
    exportQuality.disabled = true;
    btnCancelExport.classList.remove('hidden');
    progressSection.classList.remove('hidden');
    progressBarFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressStatus.textContent = 'Đang khởi tạo bộ mã hóa...';

    try {
      const result = await exporter.createMp4({
        quality: exportQuality.value,
        fps: 30,
        onProgress: (pct, msg) => {
          progressBarFill.style.width = `${pct}%`;
          progressPercent.textContent = `${pct}%`;
          progressStatus.textContent = msg;
        }
      });

      if (result && result.blob) {
        outputDownloadUrl = URL.createObjectURL(result.blob);
        outputFilename = result.filename;
        const outSizeMB = (result.blob.size / (1024 * 1024)).toFixed(2);

        btnDownloadMp4.textContent = `⬇️ TẢI VIDEO ${result.format.toUpperCase()} (${outSizeMB} MB)`;
        btnDownloadMp4.classList.remove('hidden');

        showBox(
          exportResultMessage,
          'success',
          `🎉 Tạo video thành công! File <b>${outputFilename}</b> (${outSizeMB} MB) đã sẵn sàng. Nhấn nút màu xanh bên dưới để tải về máy.`
        );
      }
    } catch (err) {
      showBox(exportResultMessage, 'error', '❌ ' + err.message);
      progressStatus.textContent = 'Quá trình tạo video bị dừng.';
    } finally {
      btnCreateVideo.disabled = false;
      btnUploadMp4.disabled = false;
      btnConfirmLink.disabled = false;
      exportQuality.disabled = false;
      btnCancelExport.classList.add('hidden');
    }
  });

  btnCancelExport.addEventListener('click', () => {
    exporter.cancel();
    progressStatus.textContent = 'Đang hủy...';
  });

  /* =========================================================
     7. NÚT TẢI VIDEO MP4 VỀ MÁY TÍNH
     ========================================================= */
  btnDownloadMp4.addEventListener('click', () => {
    if (!outputDownloadUrl) return;
    const a = document.createElement('a');
    a.href = outputDownloadUrl;
    a.download = outputFilename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  window.addEventListener('beforeunload', () => {
    clearPreviousOutput();
  });
});
