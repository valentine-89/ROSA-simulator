# Hướng dẫn vận hành - Locker Manager

Tài liệu này mô tả phần nằm trong template `locker-management`. ROSA core không có backend riêng cho locker; template dùng SQLite, macro iodata, public system page macro, secure IoT command và SSE chung.

## Luồng gửi đồ

1. Người dùng quét QR của đúng tủ, mở `/iot-page/{ioid}/{pageid}`.
2. Trang QR yêu cầu Google account và SĐT đã xác nhận theo cài đặt system page.
3. Người dùng bấm `Gửi đồ`.
4. Trang gọi public macro `locker-qr-open-precheck` với `requested_action=deposit`; `phone/email` do backend inject, `cabinet_id` lấy từ `publicApi.context`.
5. Nếu thiếu tiền hoặc hết locker trống, trang không gọi IoT command và chuyển về landing sau timeout.
6. Nếu hợp lệ, trang gọi `/api/iot-cmd/{ioid}/locker-open-auto` với `action=deposit`; thiết bị tự chọn ngăn trống trong tủ đó.
7. Khi khách đóng cửa và thiết bị xác nhận nhận hàng, thiết bị gọi `IO-locker-report deposit_success`.
8. Macro report tạo session active, set locker `occupied`, trừ phí theo `locker_users.tier -> locker_rates.open_fee`, ghi ví và event.

## Luồng nhận đồ

1. Người dùng quét QR của tủ đang đứng trước mặt và bấm `Nhận đồ`.
2. Precheck chỉ tìm active session của chính SĐT đó trong đúng `cabinet_id` của QR.
3. Nếu đồ ở tủ khác, macro trả `NO_ACTIVE_SESSION_IN_THIS_CABINET`; trang không gọi IoT command.
4. Nếu có đồ trong tủ này, trang gửi command `action=pickup`.
5. Thiết bị mở các locker active của user trong tủ hiện tại.
6. Với mỗi locker đã lấy xong, thiết bị gửi một `pickup_success` với `request_id` riêng.
7. Macro report đóng session, set locker `free`, không trừ thêm tiền.

## Wire format thiết bị

Endpoint gateway chung:

```text
#801=rosa.technology/api/<<sessionid>>/<<syncid>>
```

Gửi hàng thành công:

```text
D23,#801,,"data","IO-locker-report","deposit_success","CAB-A","A-001","REQ123","0912345678","door_closed"
```

Lấy hàng thành công:

```text
D23,#801,,"data","IO-locker-report","pickup_success","CAB-A","A-001","REQ124","0912345678","door_closed"
```

Lỗi thiết bị được hỗ trợ:

```text
D23,#801,,"data","IO-locker-report","door_not_closed","CAB-A","A-001","REQ125","0912345678","door_still_open"
D23,#801,,"data","IO-locker-report","lock_jammed","CAB-A","A-001","REQ126","0912345678","motor_timeout"
D23,#801,,"data","IO-locker-report","sensor_error","CAB-A","A-001","REQ127","0912345678","sensor_offline"
D23,#801,,"data","IO-locker-report","forced_open","CAB-A","A-001","REQ128","0912345678","tamper_detected"
D23,#801,,"data","IO-locker-report","device_replay","CAB-A","A-001","REQ129","0912345678","duplicate_device_event"
```

`IO-locker-report` trả các trường chính: `c1`, `code`, `request_id`, `cabinet_id`, `locker_id`, `event_type`, `detail`. Gọi lặp cùng `request_id` trả `OK/ALREADY_APPLIED` và không ghi trùng.

## Schema DB chính

- `locker_site`: tên đơn vị, địa chỉ, hướng dẫn/QR nạp tiền tại quầy.
- `locker_cabinets`: mỗi tủ gắn `ioid`, `page_id`, `qr_url`, vị trí và trạng thái bật/tắt.
- `lockers`: mỗi ngăn có `cabinet_id`, `slot_no`, `hardware_addr`, `state`, phone/session hiện tại.
- `locker_users`: user theo SĐT đã xác nhận, `tier`, `role`, `email`, `balance`.
- `locker_rates`: bảng giá tối giản `tier -> open_fee`.
- `locker_sessions`: lịch sử gửi/nhận; có unique partial index để chặn 2 session active trên cùng locker.
- `locker_wallet_transactions`: ledger nạp tiền, trừ phí, hoàn tiền.
- `locker_events`: audit vận hành, report thiết bị và thao tác admin.
- `locker_operation_requests`: idempotency theo `request_id` cho report thiết bị.

## Vận hành admin

- Admin dashboard không load toàn bộ user; tìm user bằng một ô chung cho tên/email/SĐT và phân trang.
- Log vận hành có thể lọc theo loại dữ liệu `Event/Session/Ví`, tủ, locker, SĐT, event/status và khoảng thời gian.
- Xuất CSV chạy ở frontend bằng macro filter hiện tại, không cần API riêng.
- Panel cài đặt hệ thống import/export JSON cấu hình site, tủ, mapping phần cứng và pricing nháp; chỉ khi bấm apply/lưu macro mới ghi DB.
- Monitor có `monitorPrivacy`: `maskedPhone`, `hiddenPhone`, `stateOnly`, `summaryOnly`; `summaryOnly` chỉ hiển thị tổng theo tủ.

## Giới hạn template-only v1

- Thiết bị IoT chọn locker trống thực tế khi gửi đồ; ROSA core không chọn locker thay thiết bị.
- QR precheck có thể bootstrap user balance `0`, nhưng không ghi session/request/log/trạng thái locker.
- Chưa có PayOS/ROSA wallet tự nạp; admin nạp tiền thủ công vào DB locker.
- Chưa có HMAC/token riêng cho thiết bị trong template; nếu triển khai thật cần đánh giá lớp xác thực gateway hiện tại.
- Chưa có archive log/session/wallet cũ; site lớn nên lên kế hoạch backup/restore SQLite định kỳ.
