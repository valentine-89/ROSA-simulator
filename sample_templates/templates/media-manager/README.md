# Media Only · Quản lý màn hình

Chọn **Hệ thống → Nạp trang mẫu → Media Only · Quản lý màn hình**, chọn database **Gộp (bổ sung)** rồi lưu setup. Email và SyncID hệ thống lấy từ tài khoản nạp template. Không cần thiết bị IoT; template cũng dùng được với nguồn thiết bị hiện có.

Dashboard cung cấp link quản lý `/iot-page/{email}/media-manager-{id}`. Ai có link này đều có thể thêm, sửa và xóa màn hình, không cần đăng nhập. Mỗi màn hình có link điều khiển và link hiển thị; hai trang cũng không yêu cầu đăng nhập.

- Prefix `frontdoor`, `backdoor`, `livingroom` dùng các field `frontdoor_media`, `backdoor_media`, `livingroom_media`. Để trống dùng `media`. Cho phép trùng Prefix; người nạp tự quản lý tên khi dùng nhiều template.
- URL giữ nguyên khi sửa tên/Prefix. Trang điều khiển kiểm tra lại cấu hình trước khi gửi. Tắt/xóa trang chặn yêu cầu tải hoặc ghi tiếp theo; trang hiển thị đang mở cần đóng/tải lại để bỏ nội dung đã nhận.
- Trang điều khiển được ghi field của nó qua `publicApi.writeFields`. Trang hiển thị đọc field/macro được cấu hình. Không đưa cặp email/SyncID credential vào HTML public; core kiểm tra SyncID của nguồn trên server.
- Macro quản lý chỉ được cấp cho link quản lý. Tạo/sửa/xóa dùng transaction và revision. Khi mất phản hồi, giao diện đọc lại và không tự gửi lại thao tác.
- SSE email dùng cùng sự kiện/transport với thiết bị, kể cả giữa các worker. Gửi thành công xác nhận telemetry đã ghi, không phải xác nhận màn hình vật lý đã phát.
- Bản **Media Only** cũ vẫn tồn tại và mở setup Prefix khi nạp. Prefix rỗng giữ cách đọc `media`; bản này hỗ trợ cả email và thiết bị.

SQLite lưu trang/cấu hình/macro. Xóa màn hình không xóa telemetry hay trang khác. Gộp database mẫu không cập nhật macro trùng tên đã tồn tại; cần migration riêng khi nâng cấp bản đã cài. Không chọn Thay thế nếu cần giữ database khác trên cùng tài khoản.

`definition.cjs` là nguồn schema, macro và HTML đóng gói. Tạo database mẫu vào file mới rồi kiểm tra trước khi thay artifact trong repository:

```sh
node sample_templates/templates/media-manager/build-sample-db.cjs /tmp/media-manager-new.sqlite
node --test sample_templates/templates/media-manager/media.test.cjs
node sample_templates/templates/media-manager/browser.test.cjs
node --test tests/accountPageRuntime.test.cjs
npm run validate:sample-templates
```

Các kiểm thử dùng SQLite/Redis cách ly và trình duyệt local, không ghi production. Simulator dùng cùng template, URL email và quyền ghi theo trang; đặt `SIM_SESSION_ID=developer@rosa.local`, `SIM_SYNC_ID=SIM_SYNC` để thử nguồn account.
