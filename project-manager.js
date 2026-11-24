/**
 * KAI TỒ REVIEW – PROJECT MANAGER (project-manager.js)
 * Lưu cấu hình dự án ra file .json trên máy người dùng và mở lại kèm công cụ nạp lại file media.
 */

class KaiToProjectManager {
  constructor(editor) {
    this.editor = editor;
    this.storageKey = 'kaito_composer_autosave_v1';
  }

  /**
   * Trích xuất toàn bộ dữ liệu cấu hình (không nhúng binary video để tránh tràn bộ nhớ)
   */
  serialize() {
    return {
      app: 'KAI TỒ REVIEW - IMAGE & VIDEO COMPOSER',
      version: 1,
      savedAt: new Date().toISOString(),
      canvasWidth: this.editor.canvasWidth,
      canvasHeight: this.editor.canvasHeight,
      aspectRatio: this.editor.aspectRatio,
      totalDuration: this.editor.totalDuration,
      layers: this.editor.layers.map(l => ({
        id: l.id,
        name: l.name,
        type: l.type,
        isBackground: l.isBackground,
        x: l.x,
        y: l.y,
        width: l.width,
        height: l.height,
        rotation: l.rotation,
        opacity: l.opacity,
        borderRadius: l.borderRadius,
        keepAspect: l.keepAspect,
        crop: { ...l.crop },
        visible: l.visible,
        locked: l.locked,
        startTime: l.startTime,
        endTime: l.endTime,
        mediaStart: l.mediaStart,
        fileName: l.fileName,
        naturalWidth: l.naturalWidth,
        naturalHeight: l.naturalHeight,
        duration: l.duration,
        volume: l.volume,
        muted: l.muted,
        initialState: l.initialState,
        text: l.text,
        fontSize: l.fontSize,
        fontFamily: l.fontFamily,
        textColor: l.textColor,
        strokeColor: l.strokeColor,
        strokeWidth: l.strokeWidth,
        bgColor: l.bgColor,
        bgTransparent: l.bgTransparent
      }))
    };
  }

  /**
   * Tải file dự án .json về máy tính
   */
  downloadProjectFile() {
    const data = this.serialize();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `KAI_TO_PROJECT_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  /**
   * Lưu nháp tự động vào localStorage
   */
  autoSaveDraft() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.serialize()));
    } catch (_) {}
  }

  /**
   * Đọc file dự án .json từ máy người dùng và khôi phục các lớp
   * Trả về danh sách các lớp ảnh/video cần người dùng chọn lại file gốc
   */
  loadProjectFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.layers)) {
            throw new Error('File dự án không đúng định dạng KAI TỒ REVIEW.');
          }

          this.editor.resetAll();
          this.editor.resizeCanvasResolution(
            data.canvasWidth || 1080,
            data.canvasHeight || 1920,
            data.aspectRatio || 'custom'
          );
          this.editor.totalDuration = data.totalDuration || 10;

          const missingMediaLayers = [];

          data.layers.forEach(item => {
            const restored = this.editor.createBaseLayer({
              ...item,
              element: null,
              file: null,
              objectUrl: null
            });
            this.editor.layers.push(restored);
            if (restored.type === 'image' || restored.type === 'video') {
              missingMediaLayers.push(restored);
            }
          });

          if (this.editor.layers.length > 0) {
            this.editor.selectedLayerId = this.editor.layers[this.editor.layers.length - 1].id;
          }

          this.editor.render();
          this.editor._emitChange();
          resolve(missingMediaLayers);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Không thể đọc file dự án.'));
      reader.readAsText(file);
    });
  }
}

window.KaiToProjectManager = KaiToProjectManager;
