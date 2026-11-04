# Đánh giá hiệu ứng — 2026-11-05

| Mã | Phong cách | Chuyển động |
| --- | --- | --- |
| ani1 | Hải lưu | Các đường nước trôi chậm, xanh biển và ngọc |
| ani2 | Dạ tiệc | Hạt ánh vàng trên nền đỏ rượu |
| ani3 | Sakura | Cành hoa và cánh hoa rơi trên nền giấy sáng |
| ani4 | Kiến trúc | Phối cảnh đường nét và điểm sáng di chuyển |
| ani5 | Ánh kim | Dải cong ánh kim trên nền than chì |
| ani6 | Chân trời | Thành phố nhiều lớp, ánh hoàng hôn và đèn xe |
| ani7 | Quỹ đạo | Vòng quỹ đạo và sao sáng nhẹ |
| ani8 | Mưa kính | Vệt mưa, mảng kính và gợn nước |
| ani9 | Vườn đêm | Tán lá và đom đóm |
| ani10 | Hình học | Cung tròn và các mảng màu giấy, đất nung |

## Tự đánh giá và chỉnh sửa

Đã xem ảnh cả mười kiểu ở 1280 × 720 và bố cục dọc 540 × 960.
Nội dung nằm ở vùng giữa; chi tiết trang trí tập trung ở mép.
Sau vòng đầu, bỏ bóng chữ trên hai nền sáng, nối hoa với cành,
thay các lá xếp đều bằng nhánh cong và lá có kích thước khác nhau.
Phép đo vừa chữ dùng đúng font của hiệu ứng và trừ khoảng đệm thực tế.

## Giới hạn tài nguyên

- Một canvas hiển thị, một canvas lưu phần nền tĩnh; tối đa 960 × 540 mỗi canvas.
- Giới hạn vẽ 24 fps, không nhân độ phân giải theo DPR, không WebGL hoặc blur toàn màn hình.
- Không tải ảnh, font hoặc thư viện bên ngoài cho các hiệu ứng.
- Trang bị ẩn hoặc bật giảm chuyển động sẽ dừng vòng vẽ.
- Video, YouTube và trang web dùng nền hiệu ứng tĩnh.
- SSE lặp lại nội dung giữ nguyên player và hiệu ứng; macro dữ liệu vẫn cập nhật.

## Kiểm chứng

Chrome tại máy phát triển, viewport 3840 × 2160, CPU throttle 4×:
10 kiểu chạy khoảng 24 fps; thời gian xử lý lệnh vẽ p95 từ 1,9 đến 8,7 ms.
Đây là đo trên máy phát triển, không phải phép đo trên Android TV thực tế;
không bao gồm đầy đủ chi phí GPU và giải mã video của TV.

`effects.browser.test.cjs` kiểm tra giới hạn canvas/fps, dừng khi ẩn/giảm chuyển động,
SSE trùng nội dung, 30 lần đổi kiểu và nền tĩnh khi phát video.
`playback.browser.test.cjs` xác nhận video phát qua 4 giây, lặp sau khi hết,
giữ player khi SSE nối lại và giữ trạng thái tạm dừng.
Các bài kiểm tra quản lý màn hình và trình kiểm tra template chuẩn cũng phải đạt.

`upgrade-effects.py` chỉ sửa HTML có các khối nguồn đã nhận diện bằng SHA-256.
Chạy kiểm tra trước, rồi dùng `--apply --expected` với mã kế hoạch đã đọc.
Giao dịch kiểm tra dấu vân tay của toàn bộ dữ liệu ngoài các ô HTML được sửa.
`upgrade-effects.test.py <dashboard-cu.html>` kiểm tra nâng cấp, CRLF/LF,
cấu hình riêng, năm màn hình, dashboard của chủ tài khoản khác và hủy kế hoạch sai.
