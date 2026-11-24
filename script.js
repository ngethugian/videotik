/**
 * KAI TỒ REVIEW – AUTO VIDEO COMPOSER UI CONTROLLER (script.js)
 */

document.addEventListener('DOMContentLoaded', async () => {
  const composer = new AutoVideoComposer('previewCanvas');
  const exporter = new AutoVideoExporter(composer);

  // Phần tử giao diện
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

  // Lưu file MP4 đã tạo xong để nút TẢI VIDEO MP4 sử dụng (và giải phóng khi tạo lại)
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
     2. XỬ LÝ Ô NHẬP LINK TIKTOK (MINH BẠCH, KHÔNG GIẢ LẬP)
     ========================================================= */
  btnConfirmLink.addEventListener('click', () => {
    const rawUrl = tiktokUrlInput.value.trim();
    tiktokEmbedWrap.classList.add('hidden');
    tiktokEmbedWrap.innerHTML = '';

    if (!rawUrl) {
      showBox(tiktokFeedback, 'error', 'Vui lòng dán đường link video TikTok vào ô trên.');
      return;
    }

    // Kiểm tra định dạng link TikTok hợp lệ
    const isTikTokDomain = /^https?:\/\/(www\.|m\.|vt\.|vm\.)?tiktok\.com\/.+/i.test(rawUrl);
    if (!isTikTokDomain) {
      showBox(
        tiktokFeedback,
        'error',
        '❌ Đường link không hợp lệ. Link phải thuộc tên miền <b>tiktok.com</b> (ví dụ: https://www.tiktok.com/@tenkenh/video/123456...).'
      );
      return;
    }

    // Kiểm tra xem có lấy được Video ID để nhúng TikTok Embed xem trước không
    const idMatch = rawUrl.match(/\/video\/(\d+)/i);
    if (idMatch) {
      const videoId = idMatch[1];
      tiktokEmbedWrap.innerHTML = `
        <iframe
          src="https://www.tiktok.com/embed/v2/${videoId}"
          allow="autoplay; encrypted-media"
          allowfullscreen
          title="TikTok Embed">
        </iframe>`;
      tiktokEmbedWrap.classList.remove('hidden');

      showBox(
        tiktokFeedback,
        'info',
        '✅ Đã nhận diện link TikTok hợp lệ và hiển thị khung nhúng xem trước.<br>' +
        '<b>Lưu ý kỹ thuật:</b> TikTok chỉ cho phép phát video nhúng, không cung cấp trực tiếp luồng file MP4 cho trình duyệt ghép xuất do cơ chế bảo vệ bản quyền (CORS). ' +
        'Vui lòng <b>tải file MP4 của video này từ máy tính</b> bằng nút màu đỏ bên dưới để hệ thống tự động ghép vào ảnh nền và xuất MP4.'
      );
    } else {
      // Link rút gọn vt.tiktok.com / vm.tiktok.com không chứa ID trực tiếp
      showBox(
        tiktokFeedback,
        'info',
        '⚠️ Link TikTok dạng rút gọn không cho phép trình duyệt truy cập trực tiếp luồng video để ghép xuất MP4. ' +
        'Hãy bấm nút <b>"Tải video MP4 từ máy tính"</b> bên dưới để chọn file video bạn đã lưu.'
      );
    }
  });

  /* =========================================================
     3. NẠP FILE VIDEO MP4 TỪ MÁY TÍNH -> TỰ ĐỘNG GHÉP NGAY
     ========================================================= */
  btnUploadMp4.addEventListener('click', () => mp4FileInput.click());

  mp4FileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    clearPreviousOutput();
    memoryWarning.classList.add('hidden');
    tiktokEmbedWrap.classList.add('hidden');
    tiktokEmbedWrap.innerHTML = '';

    try {
      const info = await composer.loadVideoFile(file);
      const sizeMB = info.sizeBytes / (1024 * 1024);

      metaFileName.textContent = info.name;
      metaResolution.textContent = `${info.width} × ${info.height}`;
      metaDuration.textContent = `${info.duration.toFixed(1)} giây`;
      metaSize.textContent = `${sizeMB.toFixed(1)} MB`;
      videoMetaBox.classList.remove('hidden');

      // Cảnh báo nếu video quá lớn hoặc quá dài
      if (sizeMB > 250 || info.duration > 300) {
        memoryWarning.textContent =
          `⚠️ Video khá nặng (${sizeMB.toFixed(0)} MB, ${Math.round(info.duration)}s). ` +
          `Quá trình xuất trên trình duyệt sẽ tốn thời gian và RAM hơn bình thường; khuyên đóng bớt các tab khác hoặc chọn mức 720p nếu cần xuất nhanh.`;
        memoryWarning.classList.remove('hidden');
      }

      btnPlayPreview.disabled = false;
      btnRestartPreview.disabled = false;
      btnCreateVideo.disabled = !composer.bgLoaded;

      showBox(
        tiktokFeedback,
        'success',
        '✅ Đã tự động ghép video vào đúng vùng bên phải của ảnh nền! Bạn có thể bấm <b>Phát thử</b> hoặc bấm <b>TẠO VIDEO</b> ngay.'
      );
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

  // Giải phóng bộ nhớ khi đóng trang
  window.addEventListener('beforeunload', () => {
    clearPreviousOutput();
  });
});
