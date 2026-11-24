# KAI TỒ REVIEW – AUTO VIDEO COMPOSER

Công cụ web tự động ghép video vào ảnh nền cố định (`assets/background.png`) và xuất thành file **MP4 hoàn chỉnh** (1080p / 720p) trực tiếp trên trình duyệt.

## Quy trình hoạt động
`Ảnh nền cài sẵn (assets/background.png)` + `Video MP4` → `Tự động ghép đúng vùng trống bên phải` → `Xuất file MP4 hoàn chỉnh`.

## Điểm nổi bật
- Giao diện tối giản, không cần căn tọa độ hay chỉnh sửa thủ công.
- Giữ nguyên 100% ảnh nền gốc, không biến dạng, không che chữ hay nhân vật 3D.
- Xuất video MP4 thật chuẩn **H.264 + âm thanh AAC** bằng **WebCodecs API + mp4-muxer** tận dụng GPU phần cứng trên máy tính Windows (Chrome / Edge / Cốc Cốc).
- Chạy tĩnh 100% trên **GitHub Pages**, không cần server, Python hay Node.js.
