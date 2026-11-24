# KAI TỒ REVIEW – IMAGE & VIDEO COMPOSER

Công cụ ghép video lên ảnh tĩnh và xuất file **MP4 hoàn chỉnh** trực tiếp trên trình duyệt, triển khai miễn phí bằng **GitHub Pages** (không cần server, không cần Python/Node.js, không tốn phí API).

## Tính năng chính
- **Tải ảnh nền** (JPG, PNG, WEBP) với các tỷ lệ khung hình chuẩn: `9:16`, `16:9`, `1:1` và kích thước tùy chỉnh.
- **Thêm nhiều lớp Video MP4 & Văn bản**, hỗ trợ xem trước link TikTok qua TikTok Embed (kèm cảnh báo CORS và hướng dẫn nạp file MP4).
- **Chỉnh sửa trực quan trên Canvas**: kéo thả tự do, phóng to/thu nhỏ 4 góc, xoay góc tùy chỉnh, bo góc, độ mờ, crop 4 cạnh, căn giữa tự động (snap), khóa vị trí, đặt lại ban đầu.
- **Quản lý lớp (Layers) & Timeline**: ẩn/hiện, khóa, sắp xếp thứ tự trên/dưới, kéo chỉnh điểm bắt đầu và kết thúc xuất hiện của từng lớp, xem trước đồng bộ.
- **Xuất Video MP4 thật (720p / 1080p)**: sử dụng **WebCodecs API (H.264 + AAC)** kết hợp **`mp4-muxer`** chạy tăng tốc phần cứng GPU ngay trên máy người dùng, có phương án dự phòng `MediaRecorder`.
- **Lưu & Mở dự án**: xuất file cấu hình `.json` trực tiếp về máy tính.

## Trình duyệt khuyên dùng
- Google Chrome, Microsoft Edge hoặc Cốc Cốc phiên bản mới trên Windows để đạt tốc độ xuất MP4 nhanh nhất nhờ tăng tốc GPU.
