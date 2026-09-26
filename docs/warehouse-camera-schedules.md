# Camera kho AI chạy theo lịch

Trong cài đặt camera, bật **Tự động mỗi giờ**, chọn **Cả ngày** hoặc **Khung giờ**, rồi lưu. Giờ Việt Nam (UTC+7), gồm giờ bắt đầu và không gồm giờ kết thúc; hỗ trợ qua nửa đêm. Lịch mặc định tắt. Lần đầu chạy ở mốc giờ sau đủ một chu kỳ, không chạy ngay khi lưu. Nếu `/manage` đặt chu kỳ tối thiểu lớn hơn 1 giờ, giao diện từ chối bật lịch mỗi giờ.

Lần đầu bật sẽ tạo một backend riêng cho camera, tính vào hạn mức backend/thiết bị. Tắt lịch giữ backend để bật lại. Khi camera tắt, trang và command tự động cũng tắt. Sửa camera không thay trang QR thủ công. Backend đã được sửa code riêng sẽ không bị giao diện ghi đè.

Luồng: lịch backend → macro đọc cấu hình camera → `rosa.page.command` → dịch vụ command dùng chung với `iot-cmd` → hàng chờ AI → Vision → macro `warehouse-ai-count-result` → tồn kho/lịch sử. Actor hiển thị **Tự động**. Cả template cơ bản và template IoT đều đếm trực tiếp bằng AI khi chạy lịch; không gửi lệnh xuống thiết bị IoT. QR thủ công của bản IoT giữ quy trình hiện có.

Lịch backend vẫn chịu trần đồng thời và tỷ lệ 20% trên server. Sau khi gửi yêu cầu vào SQLite, isolate kết thúc; hàng chờ AI không giữ isolate. Dịch vụ AI giữ giới hạn 3 yêu cầu đang đếm/SyncID. Mỗi camera chỉ có một yêu cầu chờ hoặc đang chạy; yêu cầu mới trả thông tin yêu cầu hiện hữu. Trước khi gửi tới Vision, kiểm tra lại quyền trang/backend, camera, callback, khung giờ và số dư. Hết giờ hiện tại thì bỏ yêu cầu còn chờ; không chạy dồn hoặc retry lần đếm đã lỗi. Kỳ sau vẫn được xét. Tắt lịch không hủy lần đếm đã gửi tới Vision.

CPU backend và phí AI/dữ liệu được ghi riêng theo SyncID hiện hữu. Không đưa key camera, key thiết bị hay URL runner vào code backend. API ngoài của backend mặc định tắt.

## Nâng cấp kho đang dùng

`node scripts/install-warehouse-camera-schedules.cjs /absolute/IOID.sqlite --dashboard-db=/absolute/user-sync.db` kiểm tra và dry-run. Thêm `--apply` để áp dụng. Script thêm bảng/cấu hình lịch tắt cho camera hiện hữu, command/trang nội bộ và hai macro; bật giao diện trên đúng một dashboard tương ứng. Dữ liệu camera, lịch sử, tồn kho và trang/command thủ công được so hash trước/sau trong transaction. Không nạp lại sample database. Bản demo `IO282jItw` dùng quy trình này.

## Tạo và kiểm tra offline bằng AI

Prompt mẫu:

> Nâng cấp template kho AI trong ROSA Simulator. Dùng camera-schedules.cjs và camera-schedules-ui.js, bật cameraSchedules trong inventory-config. Mỗi camera bật lịch sẽ có backend nhận {}, đọc warehouse-schedule-get rồi gọi rosa.page.command theo quyền trang/command cụ thể. Đặt lịch 1 giờ; hỗ trợ cả ngày hoặc khung giờ UTC+7. Không gọi fetch, không nhúng khóa và không gọi xuống IoT khi chạy tự động. Giữ luồng QR thủ công. Tạo dữ liệu đếm giả để kiểm tra cập nhật tồn kho/lịch sử, tắt lịch và ngoài khung giờ.

Trong Simulator, tạo `.sim/state/mock-camera-counts.json` (hoặc trong `SIM_STATE_DIR`):

```json
{"IO123abcd":{"camera-id":{"type1":12,"type2":5}}}
```

Số đếm chưa khai báo là 0. Kết quả có `simulated:true`, giá AI 0 và không có ảnh; không truy cập camera hoặc Vision thật. Mở backend vừa tạo, dùng **+1 giờ mô phỏng** tới lần chạy. Đồng hồ này chỉ đổi lịch; `Date.now()`/khung giờ vẫn là thời gian máy, nên chọn Cả ngày khi muốn thử ngay. Kiểm tra lịch sử có actor Tự động và tồn kho đúng dữ liệu giả. Khi đưa sang ROSA phải đặt SyncID thật, phát hành và bật lịch riêng.
