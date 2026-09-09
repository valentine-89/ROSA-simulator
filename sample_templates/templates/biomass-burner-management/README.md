# Lò sinh khối compact-v2 trên ROSA

## Ranh giới bắt buộc

Template này tuyệt đối không được tạo route, manager, action `c1`, xác thực, tính phí, cache hoặc realtime riêng cho lò sinh khối trong ROSA core. Template chỉ dùng `telemetry`, public batch telemetry, `data`, `system_macros`, `system_pages` và `system_cmds` chuẩn dùng chung. Phần batch trong core phải giữ tên và hành vi tổng quát để các template khác tái sử dụng.

Chỉ hỗ trợ compact-v2. Không thêm fallback cho IO2722OB1 hoặc giả lập cảm biến nhiệt không tồn tại.

## Database fleet và phút mua

- Fleet dùng database `IO2729MB1`. Mỗi thiết bị tự khai báo IOID trong đối số đầu của macro; macro chỉ chấp nhận IOID có trong `biomass_burners`.
- `IO-biomass-meter`: macro `c1=IOID`, `c2=phút đã đốt`, `c3=mode`; response `c1=OK|METER_REGRESSION|UNKNOWN_DEVICE|INVALID`, `c2=purchased_minutes`.
- Meter đã đốt chỉ tăng. `purchased_minutes` có thể được quản trị viên đặt trực tiếp và không có audit theo yêu cầu nghiệp vụ.
- Phút mua chỉ dùng giám sát. Mất mạng, hết SyncID hoặc hết phút tuyệt đối không được chặn N1–N5/N101.
- Mã nhiên liệu là 6 ký tự `A-Z0-9`. Batch 1–500 mã được tạo atomically; một mã chỉ được nạp một lần. `client_request_id` làm cho retry không cộng phút lần hai.
- Trang nạp đọc `biomass-refuel-state` ngay khi mở để hiển thị phút đã đốt và phút đã mua. Khi người dùng nạp mã, trang gọi `biomass-refuel-check`, gửi `N26,"mã lô",phút` bằng `/api/iot-cmd/{fleetIoid}/biomass-refuel?pageId=...`, rồi mới redeem khi gateway trả đúng `OK`.
- Setup page tự lấy fleet IOID từ profile ROSA đang hoạt động và cố định hai page capability của template; không hiển thị IOID hoặc page ID kỹ thuật để người dùng sửa.
- Fleet khai báo nguồn `biomass-fleet` trong `system_iot_batch_sources`; mỗi lò có một dòng `IOID + API key` trong `system_iot_batch_devices`. Thêm/sửa chỉ lưu cấu hình, không gọi IOeasy và không kiểm tra Device profile.
- Collector chỉ nhận cặp credential khớp chính xác registry ROSA. API key không được trả về dashboard; UI chỉ hiển thị `Đã nhận`, `Chờ thiết bị` hoặc `Sai khóa`.
- Dashboard dùng một snapshot `/api/iot-page-batch-telemetry/...` và một SSE `/api/iot-page-batch-realtime/...` cho toàn fleet, không gọi telemetry riêng từng lò và không suy telemetry từ bảng `data`.
- Cache Redis được chia sẻ giữa dashboard/process, giữ nóng 15 phút sau người xem cuối. Phí đọc batch dùng giá telemetry hiện hành với hệ số `0,1 unit / thiết bị / người xem / phút`.
- Dashboard đánh dấu mất kết nối sau 15 phút không nhận telemetry, không phụ thuộc mode. Chỉ timestamp telemetry thật trong batch snapshot/delta được dùng; thời điểm refresh cache không được dùng làm `last_seen`.
- N20 dùng contract compact-v2 mới liên tục `c1..c20`, không có trường nhiệt độ hoặc cường độ quạt và không giữ fallback vị trí cũ. Các tham số cấu hình quạt vẫn có trong popup cài đặt.

Payload thiết bị qua gateway chuẩn:

```json
{"c1":"data","c2":"IO-biomass-meter","c3":"IO2729MB1","c4":2543,"c5":0}
```

Không tạo `biomass-report` hoặc bất kỳ action riêng nào.

## Trang IoT nạp nhiên liệu

- Mỗi lò có page ID ngẫu nhiên 32 ký tự hex trong database fleet và URL công khai `https://rosa.technology/iot-page/IO2729MB1/<page-id>`; không tạo page ID từ IOID. Page bật cờ chuẩn `meta.hideLink=true` để chuyển sang `/iot-page` sau khi mở.
- Trang chỉ gọi macro allowlist và command page-bound chuẩn. Context `burner_id`, `commandTarget` và source `biomass-fleet` nằm trong `system_pages.meta`; browser không được chọn IOID hoặc API key.
- Mỗi page chỉ điều khiển một lò. `/api/iot-cmd` đọc API key từ dòng `system_iot_batch_devices` của chính fleet database và chỉ gửi khi key đó khớp registry ROSA; dashboard khác có key đúng không cấp quyền cho dashboard đang lưu key sai.
- Public body tối đa 1 KB, rate limit 20 request/phút theo IP + IOID/page/macro.
- QR chỉ chứa URL trang IoT, không chứa API key hoặc SyncID. QR được render bằng asset local.
- Sau khi nạp thành công, input bị xóa và thay bằng màn hình thành công. `sessionStorage`, history state và `window.close()` sau 5 giây chỉ hỗ trợ UX; transaction SQLite mới là lớp chống nạp lặp.

## Chương trình thiết bị

- `#894`: tổng phút đã đốt journal bền.
- `#1022`: cache bền phút đã mua, khởi tạo `0`. Không dùng `#1019–#1021` vì thiết bị production đã dành các ô này cho luồng bán hàng.
- N20 compact-v2.8 gửi 9 field liên tục: `c1=mode`, `c2=phút đốt`, `c3=version`, `c4=#1005`, `c5=#1007` (chuỗi 8 mức sơ cấp), `c6=#1008` (chuỗi 8 mức thứ cấp), `c7/c8=GPS`, `c9=#1022`.
- N24 gọi `D23,#801,#1,"data","IO-biomass-meter",#1001,#894,#101`; chỉ ghi `#1022=#2` khi `#1` là `OK` hoặc `METER_REGRESSION`.
- N25 gọi GPS với `c1=#1001`, `c2=#105`, `c3=#106`.
- N26 nhận mã lô và số phút, cập nhật cache tham khảo `#1022`, giữ báo cáo bán hàng hiện có rồi trả `OK`. N24 vẫn là nguồn đồng bộ định kỳ từ SQLite và có thể ghi đè cache này.
- N10 bắt I99-1 và dispatch switch-case. N21 giữ lịch trong bản IO272qKB1: đang đốt 10 phút, OFF 30 phút; vì dashboard stale 15 phút, OFF có thể hiện offline giữa hai lần gửi. Chưa sửa lịch hoặc thử vật lý trong thay đổi này.
- Mẫu compact-v2.8 dựa trên chương trình IO272qKB1 lưu trên server IOeasy, đọc ngày 2026-09-09 (thiết bị không kết nối trực tiếp lúc đọc). Giữ trình tự đầu ra N1–N6/N101; N24/N25 vẫn theo đối số macro chuẩn của template.
- Giữ nguyên trình tự vật lý N1–N5/N101, các giá trị `#1019–#1021`, meter `#894` và luồng bán hàng ngoài ROSA `#802` khi merge xuống thiết bị. Trước khi restore phải đọc lại thiết bị, không ghi đè mù từ sample.

Chương trình mẫu chỉ có hai group UTF-8: `Quy trình` và `Chương trình con`. Validator từ chối group thừa, mojibake và N22 dư thừa.

## Xây dựng, kiểm thử và migration

Chạy bằng Node 24 trong WSL:

```bash
node sample_templates/templates/biomass-burner-management/build-qrcode-runtime.js
node sample_templates/templates/biomass-burner-management/build-sample-db.js
node sample_templates/templates/biomass-burner-management/smoke-test.js
node sample_templates/templates/biomass-burner-management/migration-test.js
```

Migration production chạy tại chỗ, không chèn demo lot và có thể chạy lặp lại:

```bash
node sample_templates/templates/biomass-burner-management/migrate-production.js /path/IO2729MB1.sqlite
```

Phải sao lưu database và snapshot chương trình trên host trước migration/restore. Không tạo backup trên thiết bị. Chỉ restore thiết bị khi online và mode OFF; không bật lò trong smoke test.

## Cấu hình 8 mức lửa (compact-v2.8)

- Hai phép lưu trạng thái nội bộ #102/#103 trong N1 cũng lấy phần tử danh sách mới; không thay thứ tự lệnh đầu ra hoặc delay. Thêm khai báo O2/O3 theo bản IO272qKB1.
- Chỉ hiển thị #1005 (điện trở mồi 30–180 giây), #1007 và #1008. Hai danh sách có đúng 8 số nguyên 0–56, 0 mạnh nhất và 56 yếu nhất; đây không phải phần trăm quạt.
- Mẫu sơ cấp: `16,23,28,33,36,41,48,56`; thứ cấp: `0,10,16,32,35,40,47,56`. Lệnh chuẩn system_cmds ghi chuỗi trong dấu ngoặc kép rồi gọi N20; xác nhận bằng telemetry đọc lại, không tạo API riêng hoặc sửa ROSA core.
- Popup quản trị hiển thị phút đã mua/đã đốt. Trang nạp hiển thị thêm dòng phút còn lại, bằng MAX(đã mua − đã đốt, 0).
- Chạy thêm `node sample_templates/templates/biomass-burner-management/eight-level-test.js`. Migration xóa các lệnh scalar cũ trong phạm vi biomass-set, giữ meter, khóa, tọa độ và lịch sử.
- N20 mới yêu cầu thiết bị dùng mapping mới. Không ghi tự động chương trình thật trong đợt thay đổi template này.
