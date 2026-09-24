# Tạo template có backend V8

Runtime dùng chung package `packages/rosa-backend` với ROSA. Backend là ES module lưu trong bảng `system_backends`, không phải route Node mới. Bắt đầu từ `sample_templates/templates/backend-lab/`. Hướng dẫn đầy đủ và prompt AI có tại `/backend/guide.html` trong Simulator.

## Chuẩn bị và chạy offline

Dùng Node.js 24, `npm ci` rồi `npm run check:backend-native`. Trên Windows mở `ROSA-simulator.exe`: launcher chuẩn bị Node 24, SQLite, DuckDB và isolated-vm. Lần đầu cần Internet để tải dependencies; khi cache sẵn có, code, database và thiết bị giả lập chạy offline. Không có dịch vụ AI hoặc khóa cloud bắt buộc.

Nếu npm mới chặn install scripts, cho phép scripts của các dependency native hoặc chạy installer của chúng, sau đó kiểm tra lại native runtime. Không thay V8 bằng `eval`, `vm` hay browser JavaScript.

## Cấu trúc template

- `backend.mjs`: `export default async function main(input, rosa) { ... }`.
- `build-sample-db.cjs`: tạo `sample.sqlite` vào file mới, không ghi đè dữ liệu đang dùng.
- `system_backends(name,definition,updated_at)`: definition là JSON gồm `name`, `source`, `inputSchema`, `outputSchema`, `permissions`, `contractVersion:1`.
- `system_macros`: SQL với tham số `:name`. Backend chỉ gọi tên macro được cấp quyền.
- `system_cmds`: lệnh thiết bị với placeholder `<<state>>`, khai báo `params_schema`. Simulator ghi command log và cập nhật telemetry tương ứng.
- `system_pages.meta.publicApi.backends`: danh sách backend mà trang IoT được gọi.
- Browser gọi `await rosa.backend.run('kiem-tra-ton-kho', {sku:'SP001'})`. SDK được tự chèn; không nhúng key, SyncID hay địa chỉ runner.

Quyền mẫu:

```json
{"macros":["stock-find"],"reports":["stock-report"],"devices":{"device":{"ioid":"self","read":true,"fields":["temperature","O101"],"commands":["switch"]}}}
```

SDK: `rosa.db.macro(name,params)`, `rosa.db.report(name,params)`, `rosa.iot.latest(alias)`, `rosa.iot.timeseries(alias,{from,to})`, `rosa.iot.command(alias,name,params)`. Tất cả trả Promise và cần `await`. Không có HTTP tùy ý, require/import, file hoặc thư viện npm trong isolate. Report dùng DuckDB, SELECT/WITH duy nhất, snapshot SQLite tối đa 100.000 dòng/16 MiB; truy cập file/extension bị khóa.

## Quy trình kiểm tra

1. Đăng ký template trong manifest và tạo sample database từ source.
2. `npm run validate` và `npm run validate:backends` kiểm tra cấu trúc, code, schema, quyền và tham chiếu macro/lệnh.
3. `npm run check:backend-native` và `npm run test:backend` kiểm tra runtime thật, API, auth, timeout, phí mô phỏng và SQL đồng thời.
4. `npm start`; chọn Backend Lab, nạp sample DB, mở Backend. Lưu cấu hình `SIM_SYNC`, kiểm tra code, chạy với `{"sku":"SP001"}`, phát hành.
5. Mở `/iot-page/IO123abcd/backend-stock`; bấm tìm và kiểm tra rows/state. Đặt `O101`/temperature trong simulator để thử dữ liệu khác.
6. Bật API ngoài, tạo khóa thử, chọn Bearer/X-API-Key/Basic. POST `/bw/IO123abcd/kiem-tra-ton-kho`, đọc 202/runId, GET cùng URL với `?runId=...`. Thiếu key phải 401, sai input phải 400. Dùng Idempotency-Key cố định khi thử lại cùng yêu cầu.

CPU đo bằng V8; phí chỉ trừ trong sổ mô phỏng `.sim/state/backends.sqlite`. Mặc định 180 giây/10 MiB giống ROSA. 10 MiB là giới hạn heap V8, không phải tổng RSS process. Thiết bị mô phỏng nhận lệnh không chứng minh thiết bị vật lý đã hoạt động.

## Xuất sang ROSA

Xuất package template từ Simulator, gồm sample database có code. Import database vào ROSA, mở Backend, cấu hình SyncID thật, xác minh thiết bị khác nếu có, kiểm tra và phát hành. API key, cấu hình trả phí và publication của Simulator không đi theo database. ROSA cần quản trị đặt giá CPU trong `/manage` trước khi nhận lượt chạy thật.

Code sinh bởi AI chỉ sửa template và manifest. Không sửa `server.js`, `src`, package dependencies hoặc runner. Không dùng credential thật trong ví dụ. Timeout hoàn tác transaction đang mở nhưng không hoàn tác macro/lệnh đã commit; khi runner mất kết nối, đối soát tác động trước khi chạy lại.
