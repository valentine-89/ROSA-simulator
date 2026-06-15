# Checklist tạm - Locker Manager

Checklist này chỉ giữ các việc còn phù hợp với hướng hiện tại:

- Không tạo backend/API riêng cho locker trong ROSA core.
- ROSA core chỉ dùng các primitive chung: public system page macro, secure IoT command, iodata gateway macro, SSE, identity injection.
- Template locker xử lý nghiệp vụ bằng DB + macro SQL + system pages.
- QR precheck được phép bootstrap user tối thiểu `balance=0`, nhưng chưa ghi nhận gửi/lấy đồ.
- Thiết bị IoT chọn locker thực tế trong v1 và gọi `IO-locker-report` sau khi cửa đóng/xác nhận thành công để ghi DB.
- Mỗi QR/link chỉ tương ứng một tủ/một bộ điều khiển qua `publicApi.context.cabinet_id`; nhận đồ sai tủ sẽ không tìm thấy đồ ở tủ hiện tại.

## Đã xong trong template v1

- [x] DB mẫu có `locker_users.email`, `locker_users.balance`, `locker_users.updated_at`.
- [x] DB mẫu có `locker_wallet_transactions` để audit nạp tiền/trừ phí.
- [x] DB mẫu có 2 tủ, 60 locker và trạng thái mẫu.
- [x] Admin dashboard xem trạng thái locker, log, user, bảng giá mẫu.
- [x] Admin dashboard tìm user theo SĐT/tên/email.
- [x] Admin dashboard nạp tiền thủ công, tạo nhanh user khi phone chưa có.
- [x] Admin dashboard không load toàn bộ user khi mở trang; user dùng search phân trang cho dữ liệu lớn.
- [x] Admin dashboard có chi tiết user: profile, session, ví, event.
- [x] Admin dashboard hoàn full giao dịch `open_fee` lỗi, idempotent bằng `REFUND-{tx_id}`.
- [x] Admin dashboard cấu hình bảng giá thật: thêm/sửa/xóa tier, `open_fee`, ghi chú.
- [x] Admin dashboard đổi nhóm giá user theo `guest`, `member`, hoặc tier mới.
- [x] Admin dashboard có panel xử lý sự cố: mở tay, set trạng thái locker, audit thao tác.
- [x] Admin dashboard có panel “Cài đặt hệ thống” để lưu site và apply cấu hình tủ/ngăn/thiết bị xuống DB bằng macro.
- [x] Admin dashboard có filter log/session/wallet theo tủ, locker, SĐT, event/status và khoảng thời gian.
- [x] Admin dashboard xuất CSV log/session/wallet theo filter hiện tại ở frontend.
- [x] Admin dashboard import/export JSON cấu hình site/tủ/mapping/pricing nháp.
- [x] Setup page nhập cấu hình nháp: tên đơn vị, địa chỉ, QR/hướng dẫn nạp tiền, số tủ, số ngăn, IoID thiết bị và mapping phần cứng.
- [x] Setup page nhập pricing nháp ban đầu để dashboard admin nạp và lưu xuống DB.
- [x] Setup page import/export JSON cấu hình nháp.
- [x] Macro `locker-admin-config-state`, `locker-admin-save-site-config`, `locker-admin-apply-cabinet-config` đã có trong DB mẫu.
- [x] Macro `locker-admin-save-rate`, `locker-admin-delete-rate`, `locker-admin-set-user-tier` đã có trong DB mẫu.
- [x] Apply cấu hình tủ tăng số ngăn sẽ tạo locker mới; giảm số ngăn chỉ disable locker dư nếu không active.
- [x] Monitor dashboard mask SĐT và đọc trạng thái từ database.
- [x] Monitor dashboard có cấu hình privacy `maskedPhone`, `hiddenPhone`, `stateOnly`, `summaryOnly`.
- [x] Monitor dashboard có kiosk/summary mode cho màn hình lớn.
- [x] Public monitor/landing/QR dùng public macro API không lộ API key.
- [x] QR page gọi `locker-qr-open-precheck` theo verified phone trước khi gửi `/api/iot-cmd`.
- [x] QR page có 2 nút lớn `Gửi đồ` / `Nhận đồ` và gửi `requested_action=deposit|pickup` vào precheck.
- [x] QR nhận đồ chỉ kiểm tra active session trong đúng tủ của QR; nếu user có đồ ở tủ khác thì trả `NO_ACTIVE_SESSION_IN_THIS_CABINET`.
- [x] QR precheck bootstrap user guest 0đ nếu chưa có, lấy email do backend inject nếu có.
- [x] QR precheck không ghi session, operation request, event, wallet ledger hoặc trạng thái locker.
- [x] QR thiếu tiền không gọi IoT command, báo lỗi và chuyển landing sau 7 giây.
- [x] QR đủ tiền gọi secure command `locker-open-auto` và chuyển landing sau 7 giây.
- [x] Landing page đọc `locker-landing-state` theo verified phone, hiển thị site, số dư, phiên active, lịch sử dùng và ví.
- [x] Landing page hiển thị hướng dẫn/QR nạp tiền tại quầy và cảnh báo số dư thấp.
- [x] QR pages `locker-open-cab-a/b` khai báo `accountLandingPageUrl` để khi user tải QR, account lưu landing `locker-landing`.
- [x] `/iot-page` lưu `preferencesJson.iotPageLandingTarget` và `preferencesJson.iotPageLandingList` tối giản theo `{ ioid, pageId, title }`.
- [x] Header account trên `/iot-page` hiển thị dropdown switch landing khi account có nhiều landing page.
- [x] `IO-locker-report deposit_success` tạo/cập nhật session, set locker occupied, trừ phí, ghi ledger/event, idempotent theo `request_id`.
- [x] `IO-locker-report pickup_success` đóng session/free locker, không trừ thêm tiền.
- [x] `IO-locker-report` nhận lỗi thiết bị `door_not_closed`, `lock_jammed`, `sensor_error`, `forced_open`, `device_replay`.
- [x] `IO-locker-report` trả `c1`, `code`, `request_id`, `cabinet_id`, `locker_id`, `event_type`, `detail`.
- [x] DB có unique partial index chặn 2 session active trên cùng locker.
- [x] Public system page API đã có tài liệu cho monitor read-only, locker QR bootstrap user, và QR đặt món có ghi DB.
- [x] Template có tài liệu vận hành `OPERATIONS_GUIDE_vi.md` cho flow, wire format thiết bị, schema và giới hạn v1.
- [x] Đã smoke test macro ví/precheck/report trên copy DB.
- [x] Đã chạy `npm run validate:sample-templates`.
- [x] Đã chạy `npm run build`.

## Còn sót nên làm tiếp

### 1. Admin vận hành

- [x] Làm màn hình cấu hình bảng giá thật thay vì chỉ hiển thị dữ liệu mẫu.
- [x] Cho admin đổi nhóm giá của user: `guest`, `member`, hoặc nhóm mới.
- [x] Cho admin xem lịch sử chi tiết của một user: session, event, wallet transaction.
- [x] Thêm filter theo tủ, trạng thái, SĐT, loại event và khoảng thời gian.
- [x] Thêm xác nhận bắt buộc khi admin set trạng thái locker bằng tay.
- [x] Thêm audit event cho thao tác admin mở tay và set trạng thái.
- [x] Thêm audit event cho đổi nhóm giá và chỉnh phí sau khi có UI cấu hình tương ứng.
- [x] Thêm xuất CSV cho log/session/wallet nếu cần vận hành thực tế.

### 2. QR, landing và public monitor

- [ ] Làm thông báo lỗi thân thiện cho QR/landing:
  - [ ] Chưa đăng nhập Google.
  - [ ] Chưa xác nhận số điện thoại.
  - [ ] Không đủ tiền.
  - [ ] Hết locker trống.
  - [ ] Tủ đang bảo trì.
  - [ ] Gửi lệnh IoT thất bại.
- [x] Cho QR page hiển thị rõ `pickup` hay `deposit` sau precheck.
- [x] Landing hiển thị hướng dẫn nạp tiền tại quầy rõ hơn khi số dư thấp.
- [ ] Test thực tế nhiều site/landing khác nhau để kiểm tra dropdown switch trong header account.
- [x] Public monitor thêm tùy chọn mức riêng tư:
  - [x] Chỉ màu trạng thái.
  - [x] Mask phone.
  - [x] Ẩn hoàn toàn phone.
  - [x] Chỉ hiện tổng số trống/đang dùng/bảo trì/lỗi.
- [x] Thêm chế độ kiosk/màn hình lớn cho monitor.

### 3. IoT report và lỗi phần cứng

- [x] Mở rộng `IO-locker-report` cho các event lỗi thiết bị:
  - [x] `door_not_closed`.
  - [x] `lock_jammed`.
  - [x] `sensor_error`.
  - [x] `forced_open`.
  - [x] `device_replay`.
- [x] Chuẩn hóa response cho report lỗi: `OK`, `FAIL`, `code`, `request_id`.
- [x] Rà lại `report_failed` để trả lỗi rõ khi sai tủ/locker/event.
- [ ] Xác định cách xử lý report đến muộn sau khi QR đã chuyển landing.
- [x] Thêm mapping rõ giữa `cabinet_id`, `locker_id`, `slot_no`, `hardware_addr` và địa chỉ phần cứng.
- [ ] Nghiên cứu chữ ký/HMAC hoặc token thiết bị nếu gateway hiện tại chưa đủ xác thực cho triển khai thật.

### 4. Database và macro

- [x] Bổ sung ràng buộc tránh 2 session active trên cùng locker.
- [x] Cho phép 1 user có nhiều session active trên nhiều locker để gửi nhiều món.
- [ ] Chuẩn hóa phone:
  - [ ] Format lưu trữ nội bộ.
  - [ ] Hàm mask phone thống nhất.
  - [ ] Quy tắc nhập/tìm kiếm SĐT.
- [ ] Rà macro với dữ liệu lớn: hàng trăm tủ, hàng nghìn locker, nhiều năm log.
- [x] Bổ sung index cơ bản cho event/session/wallet filter vận hành.
- [ ] Rà thêm index production sau khi có dữ liệu lớn thực tế.
- [ ] Thêm cơ chế archive log/session/wallet cũ.
- [ ] Tách schema mẫu thành tài liệu migration khi triển khai thật.

### 5. Setup và triển khai site thật

- [x] Nâng setup page để nhập:
  - [x] Tên trường/đơn vị.
  - [x] Địa chỉ.
  - [x] Số tủ.
  - [x] Số locker mỗi tủ.
  - [x] Mapping phần cứng.
  - [x] Hướng dẫn/QR nạp tiền tại quầy.
- [x] Thêm cấu hình chính sách giá ban đầu vào setup/admin pricing UI.
- [x] Tạo QR system page theo từng tủ khi admin apply cấu hình tủ mới.
- [x] Thêm import/export cấu hình tủ và mapping phần cứng.
- [x] Thêm ghi chú backup/restore SQLite cho site nhỏ trong tài liệu vận hành.

### 6. Test còn thiếu

- [x] Smoke test macro admin user search/detail/refund/set-status/audit trên copy DB.
- [x] Smoke test macro cấu hình site/tủ/ngăn trên copy DB: tạo tủ mới, re-apply, tăng/giảm số ngăn và giữ locker active.
- [x] Smoke test macro pricing/tier/report trên copy DB: save/delete rate, set user tier, precheck đúng fee, `deposit_success` trừ phí và idempotent.
- [x] Smoke test QR action theo từng tủ: gửi thêm khi đã có đồ, nhận đúng tủ, nhận sai tủ, pickup nhiều locker bằng request riêng.
- [x] Test macro report sai tủ/locker/event trả `FAIL` đúng.
- [ ] Test admin dashboard refresh khi SSE `iodata_changed`.
- [ ] Test monitor dashboard refresh khi SSE `iodata_changed`.
- [ ] Test landing refresh khi `IO-locker-report` ghi DB.
- [ ] Test QR thiếu tiền không gọi `/api/iot-cmd`.
- [ ] Test QR đủ tiền gọi `/api/iot-cmd` đúng payload không chứa phone/email từ client.
- [x] Test admin user search không phụ thuộc load toàn bộ user.
- [x] Test refund lặp không cộng tiền lần hai.
- [ ] Test layout lưới 60 locker hiện tại không vỡ trên desktop/mobile.
- [ ] Test layout hàng trăm locker vẫn đọc được và không quá chậm.
- [ ] Test popup admin/topup không tràn màn hình mobile.
- [ ] Test panel Cài đặt hệ thống trên dashboard admin bằng trình duyệt: load từ setup, load từ DB, apply tất cả tủ.
- [ ] Test public monitor/landing/QR không lộ `sessionId@apiKey`.
- [ ] Test QR page có `accountLandingPageUrl` lưu landing vào `iotPageLandingList` đúng title từ `system_pages.title`.
- [ ] Test `/iot-page` có nhiều landing hiển thị dropdown và API select chỉ cho chọn item đã có trong list.

### 7. Tài liệu còn cần viết

- [x] Sơ đồ/diễn giải luồng gửi đồ.
- [x] Sơ đồ/diễn giải luồng lấy đồ.
- [x] Sơ đồ/diễn giải luồng QR bootstrap user 0đ nhưng chưa ghi nhận gửi/lấy.
- [x] Sơ đồ/diễn giải luồng thiết bị báo cáo qua `IO-locker-report`.
- [x] Tài liệu wire format thiết bị.
- [x] Tài liệu schema DB.
- [x] Tài liệu setup page chỉ sửa JSON config; ghi topology xuống DB bằng admin dashboard macro.
- [ ] Tài liệu public system page macro cho template author đã đủ ví dụ thực tế.
- [x] Tài liệu `/iot-page` account landing target/list/dropdown đã cập nhật trong `docs/iot-system-pages-api.md`.
- [x] Tài liệu triển khai một site thật ở mức template.
- [x] Tài liệu giới hạn của template-only v1.

## Để ngoài checklist hiện tại

Các mục dưới đây không theo đuổi trong v1 vì sẽ tạo logic riêng cho locker hoặc vượt quá phạm vi template hiện tại:

- API backend riêng trong ROSA core để chọn locker trống.
- Server-side allocation locker trong ROSA core.
- Ghi `pending operation` trước khi gửi lệnh QR.
- Liên thông PayOS/ROSA wallet tự động cho người dùng tự nạp.
- Chuyển nguồn sự thật số dư sang ROSA wallet.
- Thanh toán tự động, giữ tiền, miễn phí theo thời lượng, giá theo giờ/ngày, phạt quá hạn.
