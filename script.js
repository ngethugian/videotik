/**
 * KAI TỒ REVIEW – MAIN UI CONTROLLER (script.js)
 * Kết nối toàn bộ giao diện, bảng thuộc tính, Layers, Timeline, TikTok Embed và Xuất MP4.
 */

document.addEventListener('DOMContentLoaded', () => {
  const editor = new KaiToEditor('editorCanvas');
  const exporter = new KaiToExporter(editor);
  const projectManager = new KaiToProjectManager(editor);

  /* =========================================================
     TIỆN ÍCH THÔNG BÁO & ĐỊNH DẠNG THỜI GIAN
     ========================================================= */
  function showToast(msg) {
    const box = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  function formatTime(sec) {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const rem = (s % 60).toFixed(1).padStart(4, '0');
    return `${String(m).padStart(2, '0')}:${rem}`;
  }

  function checkMemoryUsage() {
    let totalBytes = 0;
    editor.layers.forEach(l => {
      if (l.file) totalBytes += l.file.size;
    });
    const totalMB = totalBytes / (1024 * 1024);
    const banner = document.getElementById('memoryWarningBanner');
    const text = document.getElementById('memoryWarningText');
    if (totalMB > 300) {
      text.textContent = `⚠️ Tổng dung lượng file media hiện tại là ${totalMB.toFixed(0)} MB. Khuyên đóng bớt tab trình duyệt và chọn xuất 720p nếu máy thiếu RAM.`;
      banner.classList.remove('hidden');
    }
  }

  document.getElementById('btnDismissWarning').addEventListener('click', () => {
    document.getElementById('memoryWarningBanner').classList.add('hidden');
  });

  /* =========================================================
     1. THANH CÔNG CỤ BÊN TRÁI (ẢNH NỀN, VIDEO, TIKTOK, TEXT)
     ========================================================= */
  const inputBgImage = document.getElementById('inputBgImage');
  document.getElementById('btnUploadBg').addEventListener('click', () => inputBgImage.click());

  inputBgImage.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await editor.addBackgroundImage(file);
      showToast(`Đã tải ảnh nền: ${file.name}`);
      checkMemoryUsage();
    } catch (err) {
      showToast('❌ ' + err.message);
    }
    inputBgImage.value = '';
  });

  const inputVideoFile = document.getElementById('inputVideoFile');
  document.getElementById('btnUploadVideo').addEventListener('click', () => inputVideoFile.click());

  inputVideoFile.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      try {
        await editor.addVideoLayer(file);
        showToast(`Đã thêm video: ${file.name}`);
      } catch (err) {
        showToast('❌ ' + err.message);
      }
    }
    checkMemoryUsage();
    inputVideoFile.value = '';
  });

  document.getElementById('btnAddText').addEventListener('click', () => {
    editor.addTextLayer('KAI TỒ REVIEW');
    showToast('Đã thêm lớp văn bản mới.');
  });

  // Tỷ lệ khung hình
  const selectAspectRatio = document.getElementById('selectAspectRatio');
  const customSizeGroup = document.getElementById('customSizeGroup');
  const inputCanvasW = document.getElementById('inputCanvasW');
  const inputCanvasH = document.getElementById('inputCanvasH');

  selectAspectRatio.addEventListener('change', () => {
    const val = selectAspectRatio.value;
    if (val === 'custom') {
      customSizeGroup.classList.remove('hidden');
      inputCanvasW.value = editor.canvasWidth;
      inputCanvasH.value = editor.canvasHeight;
      return;
    }
    customSizeGroup.classList.add('hidden');
    const presets = {
      '9:16': [1080, 1920],
      '16:9': [1920, 1080],
      '1:1': [1080, 1080]
    };
    const [w, h] = presets[val];
    editor.resizeCanvasResolution(w, h, val);
    // Tự căn lại ảnh nền cho khớp khung mới
    const bg = editor.layers.find(l => l.isBackground);
    if (bg) editor.applyFitMode(bg, 'cover');
    showToast(`Đã đổi tỷ lệ khung hình sang ${val} (${w}×${h}).`);
  });

  document.getElementById('btnApplyCustomSize').addEventListener('click', () => {
    const w = parseInt(inputCanvasW.value, 10) || 1080;
    const h = parseInt(inputCanvasH.value, 10) || 1920;
    editor.resizeCanvasResolution(w, h, 'custom');
    showToast(`Đã áp dụng khung hình ${editor.canvasWidth}×${editor.canvasHeight}.`);
  });

  // Thu phóng vùng xem trước
  document.getElementById('btnZoomIn').addEventListener('click', () => editor.setZoom('manual', 0.1));
  document.getElementById('btnZoomOut').addEventListener('click', () => editor.setZoom('manual', -0.1));
  document.getElementById('btnZoomFit').addEventListener('click', () => editor.setZoom('fit'));

  /* =========================================================
     XỬ LÝ DÁN LINK TIKTOK (EMBED + KIỂM TRA LỖI)
     ========================================================= */
  const inputTiktokUrl = document.getElementById('inputTiktokUrl');
  const tiktokStatus = document.getElementById('tiktokStatus');
  const tiktokPreviewBox = document.getElementById('tiktokPreviewBox');
  const tiktokIframeContainer = document.getElementById('tiktokIframeContainer');

  document.getElementById('btnAddTiktok').addEventListener('click', () => {
    const url = inputTiktokUrl.value.trim();
    if (!url) {
      tiktokStatus.className = 'status-note error';
      tiktokStatus.textContent = 'Vui lòng dán đường link video TikTok.';
      return;
    }

    // Kiểm tra link chuẩn chứa ID video TikTok
    const match = url.match(/tiktok\.com\/.*\/video\/(\d+)/i) || url.match(/\/video\/(\d+)/i);
    if (!match) {
      tiktokStatus.className = 'status-note error';
      tiktokStatus.textContent = 'Không thể nhúng link rút gọn (vt.tiktok.com) hoặc link sai định dạng. Hãy mở link trên trình duyệt để lấy link đầy đủ có dạng tiktok.com/@ten/video/123..., hoặc tải video MP4 lên trực tiếp.';
      return;
    }

    const videoId = match[1];
    tiktokStatus.className = 'status-note ok';
    tiktokStatus.textContent = `Đã nhận diện video TikTok ID: ${videoId}. Đang mở khung nhúng...`;

    tiktokIframeContainer.innerHTML = `
      <iframe
        src="https://www.tiktok.com/embed/v2/${videoId}"
        allow="autoplay; encrypted-media"
        allowfullscreen
        title="TikTok Embed Preview">
      </iframe>`;
    tiktokPreviewBox.classList.remove('hidden');
  });

  document.getElementById('btnCloseTiktok').addEventListener('click', () => {
    tiktokPreviewBox.classList.add('hidden');
    tiktokIframeContainer.innerHTML = '';
  });

  document.getElementById('btnTiktokToMp4').addEventListener('click', () => {
    tiktokPreviewBox.classList.add('hidden');
    inputVideoFile.click();
  });

  /* =========================================================
     2. BẢNG THUỘC TÍNH BÊN PHẢI (BINDING HAI CHIỀU)
     ========================================================= */
  const propsUI = {
    noSel: document.getElementById('noSelectionMsg'),
    content: document.getElementById('propsContent'),
    badge: document.getElementById('propLayerTypeBadge'),
    name: document.getElementById('propLayerName'),
    lockBtn: document.getElementById('btnLockLayer'),
    x: document.getElementById('propX'),
    y: document.getElementById('propY'),
    w: document.getElementById('propW'),
    h: document.getElementById('propH'),
    keepAspect: document.getElementById('propKeepAspect'),
    fitGroup: document.getElementById('propFitGroup'),
    fitMode: document.getElementById('propFitMode'),
    rot: document.getElementById('propRotation'),
    rotRange: document.getElementById('propRotationRange'),
    opa: document.getElementById('propOpacity'),
    opaRange: document.getElementById('propOpacityRange'),
    rad: document.getElementById('propRadius'),
    radRange: document.getElementById('propRadiusRange'),
    cropGroup: document.getElementById('propCropGroup'),
    cropTop: document.getElementById('propCropTop'),
    cropTopR: document.getElementById('propCropTopRange'),
    cropBottom: document.getElementById('propCropBottom'),
    cropBottomR: document.getElementById('propCropBottomRange'),
    cropLeft: document.getElementById('propCropLeft'),
    cropLeftR: document.getElementById('propCropLeftRange'),
    cropRight: document.getElementById('propCropRight'),
    cropRightR: document.getElementById('propCropRightRange'),
    videoGroup: document.getElementById('propVideoGroup'),
    vol: document.getElementById('propVolume'),
    volRange: document.getElementById('propVolumeRange'),
    muted: document.getElementById('propMuted'),
    vidDur: document.getElementById('propVideoDuration'),
    startTime: document.getElementById('propStartTime'),
    endTime: document.getElementById('propEndTime'),
    textGroup: document.getElementById('propTextGroup'),
    textContent: document.getElementById('propTextContent'),
    fontSize: document.getElementById('propFontSize'),
    strokeWidth: document.getElementById('propStrokeWidth'),
    textColor: document.getElementById('propTextColor'),
    strokeColor: document.getElementById('propStrokeColor'),
    textBg: document.getElementById('propTextBg'),
    textBgTrans: document.getElementById('propTextBgTransparent')
  };

  function syncPropertiesPanel() {
    const layer = editor.getSelectedLayer();
    if (!layer) {
      propsUI.noSel.classList.remove('hidden');
      propsUI.content.classList.add('hidden');
      propsUI.badge.classList.add('hidden');
      return;
    }

    propsUI.noSel.classList.add('hidden');
    propsUI.content.classList.remove('hidden');
    propsUI.badge.classList.remove('hidden');

    const typeLabels = { image: 'ẢNH', video: 'VIDEO', text: 'VĂN BẢN' };
    propsUI.badge.textContent = typeLabels[layer.type] || 'LAYER';
    propsUI.name.textContent = layer.name;
    propsUI.lockBtn.textContent = layer.locked ? '🔒 Đã khóa' : '🔓 Khóa';

    propsUI.x.value = Math.round(layer.x);
    propsUI.y.value = Math.round(layer.y);
    propsUI.w.value = Math.round(layer.width);
    propsUI.h.value = Math.round(layer.height);
    propsUI.keepAspect.checked = !!layer.keepAspect;

    propsUI.rot.value = Math.round(layer.rotation);
    propsUI.rotRange.value = Math.max(-180, Math.min(180, Math.round(layer.rotation)));

    propsUI.opa.value = Math.round(layer.opacity);
    propsUI.opaRange.value = Math.round(layer.opacity);

    propsUI.rad.value = Math.round(layer.borderRadius);
    propsUI.radRange.value = Math.min(200, Math.round(layer.borderRadius));

    // Hiện/ẩn nhóm thuộc tính theo loại lớp
    const isMedia = layer.type === 'image' || layer.type === 'video';
    propsUI.cropGroup.classList.toggle('hidden', !isMedia);
    propsUI.fitGroup.classList.toggle('hidden', !isMedia);
    propsUI.videoGroup.classList.toggle('hidden', layer.type !== 'video');
    propsUI.textGroup.classList.toggle('hidden', layer.type !== 'text');
    document.getElementById('btnReplaceMedia').classList.toggle('hidden', !isMedia);

    if (isMedia) {
      propsUI.cropTop.value = propsUI.cropTopR.value = layer.crop.top;
      propsUI.cropBottom.value = propsUI.cropBottomR.value = layer.crop.bottom;
      propsUI.cropLeft.value = propsUI.cropLeftR.value = layer.crop.left;
      propsUI.cropRight.value = propsUI.cropRightR.value = layer.crop.right;
    }

    if (layer.type === 'video') {
      propsUI.vol.value = propsUI.volRange.value = layer.volume;
      propsUI.muted.checked = !!layer.muted;
      propsUI.vidDur.textContent = `${layer.duration.toFixed(1)}s`;
    }

    if (layer.type === 'text') {
      propsUI.textContent.value = layer.text;
      propsUI.fontSize.value = layer.fontSize;
      propsUI.strokeWidth.value = layer.strokeWidth;
      propsUI.textColor.value = layer.textColor;
      propsUI.strokeColor.value = layer.strokeColor;
      propsUI.textBg.value = layer.bgColor;
      propsUI.textBgTrans.checked = !!layer.bgTransparent;
    }

    propsUI.startTime.value = Number(layer.startTime.toFixed(1));
    propsUI.endTime.value = Number(layer.endTime.toFixed(1));
  }

  function updateSelected(fn, rebuildTimeline = false) {
    const layer = editor.getSelectedLayer();
    if (!layer) return;
    fn(layer);
    editor.render();
    if (rebuildTimeline) {
      renderTimelineTracks();
      renderLayersList();
    }
    projectManager.autoSaveDraft();
  }

  // Nút thao tác nhanh
  propsUI.lockBtn.addEventListener('click', () => {
    updateSelected(l => { l.locked = !l.locked; }, true);
    syncPropertiesPanel();
  });

  document.getElementById('btnCenterH').addEventListener('click', () => {
    updateSelected(l => {
      if (l.locked) return;
      l.x = Math.round((editor.canvasWidth - l.width) / 2);
    });
    syncPropertiesPanel();
  });

  document.getElementById('btnCenterV').addEventListener('click', () => {
    updateSelected(l => {
      if (l.locked) return;
      l.y = Math.round((editor.canvasHeight - l.height) / 2);
    });
    syncPropertiesPanel();
  });

  document.getElementById('btnResetTransform').addEventListener('click', () => {
    updateSelected(l => {
      if (l.initialState) {
        l.x = l.initialState.x;
        l.y = l.initialState.y;
        l.width = l.initialState.width;
        l.height = l.initialState.height;
        l.rotation = l.initialState.rotation || 0;
      }
      l.opacity = 100;
      l.borderRadius = 0;
      l.crop = { top: 0, bottom: 0, left: 0, right: 0 };
    });
    syncPropertiesPanel();
    showToast('Đã đưa đối tượng về vị trí & kích thước ban đầu.');
  });

  // Thay file media của lớp đang chọn
  const inputReplaceMedia = document.getElementById('inputReplaceMedia');
  document.getElementById('btnReplaceMedia').addEventListener('click', () => {
    const l = editor.getSelectedLayer();
    if (!l) return;
    inputReplaceMedia.accept = l.type === 'image' ? 'image/jpeg,image/png,image/webp' : 'video/mp4,video/webm,video/quicktime';
    inputReplaceMedia.click();
  });
  inputReplaceMedia.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const l = editor.getSelectedLayer();
    if (!file || !l) return;
    try {
      await editor.replaceLayerMedia(l.id, file);
      showToast(`Đã thay file thành: ${file.name}`);
      checkMemoryUsage();
    } catch (err) {
      showToast('❌ ' + err.message);
    }
    inputReplaceMedia.value = '';
  });

  // Nút nhích Trái / Phải / Lên / Xuống
  const nudge = (dx, dy) => {
    updateSelected(l => {
      if (l.locked) return;
      l.x += dx;
      l.y += dy;
    });
    syncPropertiesPanel();
  };
  document.getElementById('btnNudgeLeft').addEventListener('click', () => nudge(-5, 0));
  document.getElementById('btnNudgeRight').addEventListener('click', () => nudge(5, 0));
  document.getElementById('btnNudgeUp').addEventListener('click', () => nudge(0, -5));
  document.getElementById('btnNudgeDown').addEventListener('click', () => nudge(0, 5));

  // Nhập X, Y, W, H
  propsUI.x.addEventListener('input', () => updateSelected(l => { if (!l.locked) l.x = Number(propsUI.x.value) || 0; }));
  propsUI.y.addEventListener('input', () => updateSelected(l => { if (!l.locked) l.y = Number(propsUI.y.value) || 0; }));
  propsUI.w.addEventListener('input', () => {
    updateSelected(l => {
      if (l.locked) return;
      const val = Math.max(20, Number(propsUI.w.value) || 20);
      if (l.keepAspect && l.height > 0) {
        const ratio = l.width / l.height;
        l.height = Math.max(20, Math.round(val / ratio));
        propsUI.h.value = l.height;
      }
      l.width = val;
    });
  });
  propsUI.h.addEventListener('input', () => {
    updateSelected(l => {
      if (l.locked) return;
      const val = Math.max(20, Number(propsUI.h.value) || 20);
      if (l.keepAspect && l.width > 0) {
        const ratio = l.width / l.height;
        l.width = Math.max(20, Math.round(val * ratio));
        propsUI.w.value = l.width;
      }
      l.height = val;
    });
  });
  propsUI.keepAspect.addEventListener('change', () => updateSelected(l => { l.keepAspect = propsUI.keepAspect.checked; }));

  propsUI.fitMode.addEventListener('change', () => {
    const l = editor.getSelectedLayer();
    if (l && propsUI.fitMode.value) {
      editor.applyFitMode(l, propsUI.fitMode.value);
      propsUI.fitMode.value = '';
      syncPropertiesPanel();
    }
  });

  // Đồng bộ cặp Slider + Input số
  function bindSliderPair(rangeEl, numEl, setter) {
    rangeEl.addEventListener('input', () => {
      numEl.value = rangeEl.value;
      updateSelected(l => setter(l, Number(rangeEl.value)));
    });
    numEl.addEventListener('input', () => {
      rangeEl.value = numEl.value;
      updateSelected(l => setter(l, Number(numEl.value)));
    });
  }

  bindSliderPair(propsUI.rotRange, propsUI.rot, (l, v) => { if (!l.locked) l.rotation = v; });
  bindSliderPair(propsUI.opaRange, propsUI.opa, (l, v) => { l.opacity = Math.max(0, Math.min(100, v)); });
  bindSliderPair(propsUI.radRange, propsUI.rad, (l, v) => { l.borderRadius = Math.max(0, v); });
  bindSliderPair(propsUI.cropTopR, propsUI.cropTop, (l, v) => { l.crop.top = Math.max(0, Math.min(45, v)); });
  bindSliderPair(propsUI.cropBottomR, propsUI.cropBottom, (l, v) => { l.crop.bottom = Math.max(0, Math.min(45, v)); });
  bindSliderPair(propsUI.cropLeftR, propsUI.cropLeft, (l, v) => { l.crop.left = Math.max(0, Math.min(45, v)); });
  bindSliderPair(propsUI.cropRightR, propsUI.cropRight, (l, v) => { l.crop.right = Math.max(0, Math.min(45, v)); });
  bindSliderPair(propsUI.volRange, propsUI.vol, (l, v) => {
    l.volume = Math.max(0, Math.min(100, v));
    if (l.element) l.element.volume = l.volume / 100;
  });

  document.getElementById('btnResetCrop').addEventListener('click', () => {
    updateSelected(l => { l.crop = { top: 0, bottom: 0, left: 0, right: 0 }; });
    syncPropertiesPanel();
  });

  propsUI.muted.addEventListener('change', () => {
    updateSelected(l => {
      l.muted = propsUI.muted.checked;
      if (l.element) l.element.muted = l.muted;
    });
  });

  // Điểm bắt đầu / kết thúc lớp
  propsUI.startTime.addEventListener('change', () => {
    updateSelected(l => {
      const val = Math.max(0, Math.min(l.endTime - 0.1, Number(propsUI.startTime.value) || 0));
      l.startTime = Number(val.toFixed(1));
    }, true);
  });
  propsUI.endTime.addEventListener('change', () => {
    updateSelected(l => {
      const maxEnd = editor.totalDuration;
      const val = Math.max(l.startTime + 0.1, Math.min(maxEnd, Number(propsUI.endTime.value) || maxEnd));
      l.endTime = Number(val.toFixed(1));
    }, true);
  });

  // Văn bản
  propsUI.textContent.addEventListener('input', () => updateSelected(l => { l.text = propsUI.textContent.value; }));
  propsUI.fontSize.addEventListener('input', () => updateSelected(l => { l.fontSize = Math.max(10, Number(propsUI.fontSize.value) || 40); }));
  propsUI.strokeWidth.addEventListener('input', () => updateSelected(l => { l.strokeWidth = Math.max(0, Number(propsUI.strokeWidth.value) || 0); }));
  propsUI.textColor.addEventListener('input', () => updateSelected(l => { l.textColor = propsUI.textColor.value; }));
  propsUI.strokeColor.addEventListener('input', () => updateSelected(l => { l.strokeColor = propsUI.strokeColor.value; }));
  propsUI.textBg.addEventListener('input', () => updateSelected(l => { l.bgColor = propsUI.textBg.value; }));
  propsUI.textBgTrans.addEventListener('change', () => updateSelected(l => { l.bgTransparent = propsUI.textBgTrans.checked; }));

  /* =========================================================
     3. QUẢN LÝ DANH SÁCH CÁC LỚP (LAYERS)
     ========================================================= */
  const layersListEl = document.getElementById('layersList');

  function renderLayersList() {
    layersListEl.innerHTML = '';
    if (editor.layers.length === 0) {
      layersListEl.innerHTML = '<div class="hint-text" style="text-align:center; padding:12px;">Chưa có lớp nào.</div>';
      return;
    }

    // Hiển thị lớp trên cùng ở đầu danh sách (giống Photoshop/Premiere)
    const reversed = [...editor.layers].reverse();
    reversed.forEach((layer) => {
      const item = document.createElement('div');
      item.className = 'layer-item' + (layer.id === editor.selectedLayerId ? ' active' : '');

      const icon = layer.type === 'image' ? '🖼️' : (layer.type === 'video' ? '🎞️' : '🔤');
      item.innerHTML = `
        <div class="layer-info">
          <span>${icon}</span>
          <span class="layer-name" title="${layer.name}">${layer.name}</span>
        </div>
        <div class="layer-controls">
          <button class="layer-ctrl-btn ${layer.visible ? '' : 'off'}" data-act="vis" title="Ẩn / Hiện lớp">${layer.visible ? '👁️' : '🚫'}</button>
          <button class="layer-ctrl-btn ${layer.locked ? '' : 'off'}" data-act="lock" title="Khóa / Mở khóa">${layer.locked ? '🔒' : '🔓'}</button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        const act = e.target.dataset.act;
        if (act === 'vis') {
          e.stopPropagation();
          layer.visible = !layer.visible;
          if (!layer.visible && layer.type === 'video' && layer.element) layer.element.pause();
          editor.render();
          renderLayersList();
          return;
        }
        if (act === 'lock') {
          e.stopPropagation();
          layer.locked = !layer.locked;
          editor.render();
          renderLayersList();
          syncPropertiesPanel();
          return;
        }
        editor.selectLayer(layer.id);
      });

      layersListEl.appendChild(item);
    });
  }

  document.getElementById('btnLayerUp').addEventListener('click', () => {
    if (editor.selectedLayerId) editor.moveLayerOrder(editor.selectedLayerId, +1);
  });
  document.getElementById('btnLayerDown').addEventListener('click', () => {
    if (editor.selectedLayerId) editor.moveLayerOrder(editor.selectedLayerId, -1);
  });
  document.getElementById('btnLayerDelete').addEventListener('click', () => {
    if (!editor.selectedLayerId) return;
    editor.deleteLayer(editor.selectedLayerId);
    showToast('Đã xóa lớp.');
  });

  /* =========================================================
     4. TIMELINE & ĐIỀU KHIỂN PHÁT VIDEO
     ========================================================= */
  const btnPlayPause = document.getElementById('btnPlayPause');
  const timeCurrentEl = document.getElementById('timeCurrent');
  const timeTotalEl = document.getElementById('timeTotal');
  const inputTotalDuration = document.getElementById('inputTotalDuration');
  const timelineRuler = document.getElementById('timelineRuler');
  const timelineTracks = document.getElementById('timelineTracks');
  const timelinePlayhead = document.getElementById('timelinePlayhead');

  btnPlayPause.addEventListener('click', () => editor.togglePlay());
  document.getElementById('btnToStart').addEventListener('click', () => editor.seek(0));
  document.getElementById('btnSeekBack').addEventListener('click', () => editor.seek(editor.currentTime - 2));
  document.getElementById('btnSeekFwd').addEventListener('click', () => editor.seek(editor.currentTime + 2));

  inputTotalDuration.addEventListener('change', () => {
    editor.setTotalDuration(Number(inputTotalDuration.value));
  });

  function updatePlayheadUI(sec) {
    timeCurrentEl.textContent = formatTime(sec);
    const pct = editor.totalDuration > 0 ? (sec / editor.totalDuration) * 100 : 0;
    timelinePlayhead.style.left = `${Math.max(0, Math.min(100, pct))}%`;
  }

  function renderTimelineRuler() {
    timelineRuler.innerHTML = '';
    const dur = editor.totalDuration;
    const step = dur <= 15 ? 1 : (dur <= 60 ? 5 : (dur <= 180 ? 15 : 30));
    for (let t = 0; t <= dur; t += step) {
      const tick = document.createElement('div');
      tick.className = 'ruler-tick';
      tick.style.left = `${(t / dur) * 100}%`;
      tick.textContent = `${t}s`;
      timelineRuler.appendChild(tick);
    }
  }

  function renderTimelineTracks() {
    timelineTracks.innerHTML = '';
    const dur = editor.totalDuration;
    const reversed = [...editor.layers].reverse();

    reversed.forEach(layer => {
      const row = document.createElement('div');
      row.className = 'timeline-track-row';

      const clip = document.createElement('div');
      clip.className = `timeline-clip type-${layer.type}` + (layer.id === editor.selectedLayerId ? ' active' : '');
      const leftPct = (layer.startTime / dur) * 100;
      const widthPct = Math.max(1.5, ((layer.endTime - layer.startTime) / dur) * 100);
      clip.style.left = `${leftPct}%`;
      clip.style.width = `${widthPct}%`;
      clip.innerHTML = `
        <div class="clip-handle left" title="Kéo đổi điểm bắt đầu"></div>
        <span>${layer.name}</span>
        <div class="clip-handle right" title="Kéo đổi điểm kết thúc"></div>
      `;

      // Kéo thanh clip trên timeline để dời thời gian hoặc cắt điểm đầu/cuối
      clip.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        editor.selectLayer(layer.id);
        const mode = e.target.classList.contains('left') ? 'start'
          : (e.target.classList.contains('right') ? 'end' : 'move');
        const startX = e.clientX;
        const trackW = row.getBoundingClientRect().width;
        const origStart = layer.startTime;
        const origEnd = layer.endTime;
        const origLen = origEnd - origStart;

        const onMove = (ev) => {
          const dt = ((ev.clientX - startX) / trackW) * dur;
          if (mode === 'move') {
            let ns = Math.max(0, Math.min(dur - origLen, origStart + dt));
            layer.startTime = Number(ns.toFixed(1));
            layer.endTime = Number((ns + origLen).toFixed(1));
          } else if (mode === 'start') {
            let ns = Math.max(0, Math.min(origEnd - 0.2, origStart + dt));
            layer.startTime = Number(ns.toFixed(1));
          } else if (mode === 'end') {
            let ne = Math.max(origStart + 0.2, Math.min(dur, origEnd + dt));
            if (layer.type === 'video' && layer.duration > 0) {
              ne = Math.min(ne, layer.startTime + layer.duration);
            }
            layer.endTime = Number(ne.toFixed(1));
          }
          clip.style.left = `${(layer.startTime / dur) * 100}%`;
          clip.style.width = `${Math.max(1.5, ((layer.endTime - layer.startTime) / dur) * 100)}%`;
          syncPropertiesPanel();
          editor.render();
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      row.appendChild(clip);
      timelineTracks.appendChild(row);
    });
  }

  // Kéo/nhấn trên thước thời gian để tua
  let scrubbing = false;
  function scrubFromEvent(e) {
    const rect = timelineRuler.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    editor.seek(pct * editor.totalDuration);
  }
  timelineRuler.addEventListener('mousedown', (e) => {
    scrubbing = true;
    scrubFromEvent(e);
  });
  window.addEventListener('mousemove', (e) => { if (scrubbing) scrubFromEvent(e); });
  window.addEventListener('mouseup', () => { scrubbing = false; });

  /* =========================================================
     5. LƯU / MỞ / ĐẶT LẠI DỰ ÁN
     ========================================================= */
  document.getElementById('btnSaveProject').addEventListener('click', () => {
    projectManager.downloadProjectFile();
    showToast('Đã lưu file cấu hình dự án (.json) về máy tính!');
  });

  const inputLoadProject = document.getElementById('inputLoadProject');
  const relinkModal = document.getElementById('relinkModal');
  const relinkList = document.getElementById('relinkList');

  document.getElementById('btnLoadProject').addEventListener('click', () => inputLoadProject.click());

  inputLoadProject.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const missingLayers = await projectManager.loadProjectFile(file);
      selectAspectRatio.value = editor.aspectRatio;
      showToast('Đã mở dự án thành công!');

      if (missingLayers.length > 0) {
        relinkList.innerHTML = '';
        missingLayers.forEach(layer => {
          const row = document.createElement('div');
          row.className = 'relink-item';
          row.innerHTML = `
            <div style="min-width:0;">
              <div style="font-weight:600;">${layer.name}</div>
              <div class="mini-label">File gốc: ${layer.fileName || 'Chưa rõ'}</div>
            </div>
            <label class="btn btn-primary btn-xs" style="cursor:pointer;">
              Chọn file
              <input type="file" hidden accept="${layer.type === 'image' ? 'image/*' : 'video/*'}" />
            </label>
          `;
          const fileInp = row.querySelector('input');
          fileInp.addEventListener('change', async (ev) => {
            const f = ev.target.files[0];
            if (!f) return;
            await editor.replaceLayerMedia(layer.id, f);
            row.querySelector('label').textContent = '✅ Đã nạp';
            row.querySelector('label').className = 'btn btn-dark btn-xs';
          });
          relinkList.appendChild(row);
        });
        relinkModal.classList.remove('hidden');
      }
    } catch (err) {
      showToast('❌ ' + err.message);
    }
    inputLoadProject.value = '';
  });

  document.getElementById('btnCloseRelink').addEventListener('click', () => relinkModal.classList.add('hidden'));
  document.getElementById('btnDoneRelink').addEventListener('click', () => relinkModal.classList.add('hidden'));

  document.getElementById('btnResetProject').addEventListener('click', () => {
    if (confirm('Bạn có chắc muốn xóa toàn bộ dự án hiện tại để làm lại từ đầu?')) {
      editor.resetAll();
      showToast('Đã đặt lại toàn bộ dự án.');
    }
  });

  /* =========================================================
     6. MODAL XUẤT VIDEO MP4
     ========================================================= */
  const exportModal = document.getElementById('exportModal');
  const exportEngineInfo = document.getElementById('exportEngineInfo');
  const exportProgressBox = document.getElementById('exportProgressBox');
  const exportProgressBar = document.getElementById('exportProgressBar');
  const exportProgressText = document.getElementById('exportProgressText');
  const exportStatusText = document.getElementById('exportStatusText');
  const btnStartExport = document.getElementById('btnStartExport');
  const btnCancelExport = document.getElementById('btnCancelExport');

  document.getElementById('btnOpenExport').addEventListener('click', async () => {
    if (editor.layers.length === 0) {
      showToast('⚠️ Hãy tải ít nhất 1 ảnh nền hoặc video trước khi xuất!');
      return;
    }
    exportModal.classList.remove('hidden');
    exportProgressBox.classList.add('hidden');
    btnStartExport.disabled = false;
    btnCancelExport.classList.add('hidden');

    const caps = await exporter.detectCapabilities();
    exportEngineInfo.textContent = caps.message;
    exportEngineInfo.className = 'engine-info' + (caps.mode !== 'webcodecs' ? ' fallback' : '');
  });

  document.getElementById('btnCloseExport').addEventListener('click', () => {
    if (exporter.isExporting) {
      if (!confirm('Đang xuất video, bạn có muốn hủy không?')) return;
      exporter.cancel();
    }
    exportModal.classList.add('hidden');
  });

  btnCancelExport.addEventListener('click', () => {
    exporter.cancel();
    exportStatusText.textContent = 'Đang hủy...';
  });

  btnStartExport.addEventListener('click', async () => {
    const resolution = document.getElementById('exportResolution').value;
    const fps = document.getElementById('exportFps').value;
    const includeAudio = document.getElementById('exportIncludeAudio').checked;

    btnStartExport.disabled = true;
    btnCancelExport.classList.remove('hidden');
    exportProgressBox.classList.remove('hidden');
    exportProgressBar.style.width = '0%';
    exportProgressText.textContent = '0%';
    exportStatusText.textContent = 'Đang khởi tạo bộ mã hóa...';

    try {
      const result = await exporter.exportVideo({
        resolution,
        fps,
        includeAudio,
        onProgress: (pct, msg) => {
          exportProgressBar.style.width = `${pct}%`;
          exportProgressText.textContent = `${pct}%`;
          exportStatusText.textContent = msg;
        }
      });
      showToast(`🎉 Đã xuất và tải xuống video .${result.format.toUpperCase()} thành công!`);
    } catch (err) {
      showToast('❌ ' + err.message);
      exportStatusText.textContent = err.message;
    } finally {
      btnStartExport.disabled = false;
      btnCancelExport.classList.add('hidden');
    }
  });

  /* =========================================================
     7. PHÍM TẮT BÀN PHÍM & ĐỒNG BỘ TỔNG THỂ
     ========================================================= */
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    if (e.code === 'Space') {
      e.preventDefault();
      editor.togglePlay();
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      if (editor.selectedLayerId) {
        editor.deleteLayer(editor.selectedLayerId);
        showToast('Đã xóa lớp đang chọn.');
      }
    } else if (e.code === 'ArrowLeft') { e.preventDefault(); nudge(e.shiftKey ? -10 : -1, 0); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); nudge(e.shiftKey ? 10 : 1, 0); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); nudge(0, e.shiftKey ? -10 : -1); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); nudge(0, e.shiftKey ? 10 : 1); }
  });

  editor.onTimeUpdate = (sec) => updatePlayheadUI(sec);

  editor.onChange = (lightweight) => {
    btnPlayPause.textContent = editor.isPlaying ? '⏸ Tạm dừng' : '▶ Phát';
    timeTotalEl.textContent = formatTime(editor.totalDuration);
    inputTotalDuration.value = editor.totalDuration;
    syncPropertiesPanel();

    if (!lightweight) {
      renderLayersList();
      renderTimelineRuler();
      renderTimelineTracks();
      updatePlayheadUI(editor.currentTime);
    }
  };

  // Khởi tạo giao diện ban đầu
  editor._emitChange();
});
