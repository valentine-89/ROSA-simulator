# Lò sinh khối compact-v2 trên ROSA

## Ranh giới bắt buộc

Template này tuyệt đối không được tạo route, manager, action `c1`, cơ chế xác thực, tính phí, cache hoặc realtime riêng trong ROSA core. Mọi thay đổi của template phải ghép từ các capability dùng chung đã có của ROSA. Nếu capability hiện có chưa đáp ứng được yêu cầu, phải dừng và thiết kế lại template; không sửa core chỉ để phục vụ lò sinh khối.

## Luồng chuẩn

- Trạng thái hiện tại: thiết bị gửi action `telemetry` chuẩn. Firmware D23 production phát 17 giá trị vị trí; sau khi dispatcher bỏ action, snapshot `c1..c17` lần lượt là mode, meter, hai quạt, nhiệt độ, version, chín cấu hình và GPS. Ánh xạ này nằm hoàn toàn trong template, tuyệt đối không thêm parser/action/API riêng vào ROSA core.
- Meter bền vững: thiết bị gửi riêng `c1="data"`, macro `IO-biomass-meter`. Theo ánh xạ chuẩn của gateway, hai giá trị sau tên macro được đọc tại `c1/c2` (meter/mode). Macro chỉ upsert meter đơn điệu trong database riêng của thiết bị, không tạo bảng event cho heartbeat.
- Fleet metadata: `biomass_burners` chỉ giữ IOID, tên, vị trí và tọa độ cache. Dashboard đọc/ghi bằng `system_macros` qua public IoT page macro API; trạng thái mỗi thiết bị được đọc bằng IoT page telemetry chuẩn với concurrency giới hạn.
- Realtime: dashboard dùng `/api/iot-page-realtime/{ioid}/biomass-status` cho tối đa 50 lò trên trang hiện tại và đối soát toàn fleet mỗi 60 giây bằng public telemetry API có sẵn.
- GPS: thiết bị có fix hợp lệ gửi riêng macro chuẩn `IO-biomass-gps`; thiết bị không có GPS hoặc chưa bắt sóng tiếp tục dùng tọa độ mặc định/thủ công đã cache trong SQLite.
- Cài đặt: dashboard gọi `/api/iot-cmd/{ioid}/biomass-set-{key}`. `system_cmds` ghi biến rồi chạy N20; dashboard chỉ báo thành công khi telemetry đọc lại đúng giá trị.
- Nhiệt độ: field tùy chọn. Khi thiết bị không gửi, dashboard không tạo giá trị giả.

## Chương trình thiết bị

- N10 bắt cả sự kiện cấp nguồn `I99-1` và mọi thay đổi I1-I4, đọc lại trạng thái thực của bốn ngõ vào để nhận cả OFF, rồi gửi ngay telemetry và data meter.
- Mức quạt chuẩn: tối thiểu 45%; HIGH 100/100, MEDIUM 90/80, LOW 70/45 và quạt thứ cấp lúc START 45%.
- N20 chỉ gửi telemetry chuẩn.
- N21 chạy từ `I99-1`, đếm phút bền ở `#894`, gửi mỗi 10 phút khi mode lớn hơn 0 và mỗi 30 phút khi OFF.
- N24 chỉ gửi data macro cho meter; N25 chỉ gửi data macro GPS khi có fix hợp lệ.
- Lỗi mạng chỉ làm mất lần gửi; không được chặn N1-N4/N101 hoặc điều khiển cục bộ.

## Cấp phát thiết bị

Mỗi lò phải được nạp database mẫu ở chế độ merge để có `system_pages`, `system_cmds`, `IO-biomass-meter` và `IO-biomass-gps`. Placeholder `<<syncid>>` phải được ROSA thay bằng SyncID của chính thiết bị. Không chia sẻ API key giữa các lò và không đưa API key vào dashboard/database/template.

Chương trình thiết bị chỉ có hai group: `0 = Quy trình` chứa N1/N2/N3/N4/N10 và `1 = Chương trình con` chứa N20/N21/N23/N24/N25/N101. Khi ghi bằng API phải gửi JSON UTF-8 và dùng đúng hai tên group này; validator từ chối group thừa hoặc chuỗi mojibake.

Chạy lại database mẫu:

```bash
node sample_templates/templates/biomass-burner-management/build-sample-db.js
```
