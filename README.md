# ROSA-simulator

## Tiếng Việt

ROSA-simulator là môi trường chạy local để mở, tạo và test ROSA sample dashboard templates. Repo này được bố trí để khách hàng tải GitHub ZIP về, mở `ROSA-simulator.exe`, và server tự sẵn sàng.

### Chạy nhanh trên Windows

1. Tải repo bằng `Code -> Download ZIP` trên GitHub.
2. Giải nén ZIP.
3. Mở thư mục `ROSA-simulator`.
4. Double-click `ROSA-simulator.exe`.
5. Giữ cửa sổ CMD đang mở trong lúc test. Đóng cửa sổ này sẽ dừng server local.

`ROSA-simulator.exe` là bootstrapper. Khi chạy, nó sẽ:

- dùng Node.js đã cài trên máy nếu phiên bản phù hợp;
- nếu chưa có Node.js, tự tải Node portable vào `%LOCALAPPDATA%\ROSA-simulator`;
- cài Node dependencies vào cache user nếu chưa có hoặc `package-lock.json` thay đổi;
- khởi động server và mở `http://localhost:4177`.

Lần chạy đầu cần internet nếu máy chưa có Node/dependencies trong cache. Các lần sau sẽ dùng cache và khởi động nhanh hơn.

### Chạy bằng Node thủ công

Dùng cách này nếu bạn muốn tự chạy từ source:

```bash
npm install
npm start
```

Sau đó mở `http://localhost:4177`.

### Tạo template mới bằng AI

Khi dùng AI để tạo template mới từ một dự án sẵn có:

1. Yêu cầu AI đọc `docs/ai-template-brief.md` trước khi sửa file.
2. Yêu cầu AI chọn template gần nhất trong `sample_templates/templates/` rồi copy/chỉnh lại.
3. Chỉ tạo template trong `sample_templates/` và cập nhật `sample_templates/manifest.json`.
4. Chạy kiểm tra:

```bash
npm run validate
npm run check
```

Template mới chưa hoàn tất nếu hai lệnh trên chưa pass.

Prompt mẫu cho AI:

```text
Trong ROSA-simulator, hãy đọc docs/ai-template-brief.md rồi tạo mẫu trang ROSA theo yêu cầu: [mô tả yêu cầu].

Làm đúng phạm vi trong tài liệu, chọn mẫu gần nhất trong sample_templates/templates/, cập nhật manifest, rồi chạy npm run validate và npm run check.
```

### Thư mục quan trọng

- `sample_templates/`: template manifest, HTML, CSS, runtime JS, ảnh mẫu và sample SQLite files.
- `docs/`: tài liệu hướng dẫn tạo template và ghi chú kỹ thuật.
- `.sim/state/`: state local do simulator tạo ra khi chạy test.
- `logs/`: log của launcher/server.
- `%LOCALAPPDATA%\ROSA-simulator`: cache Node portable và Node dependencies do bootstrapper tự tạo.

Có thể reset dữ liệu test bằng cách đóng app rồi xóa `.sim/state/`, hoặc dùng các nút clear trong giao diện simulator.

---

## English

ROSA-simulator is a local environment for opening, creating, and testing ROSA sample dashboard templates. This repository is arranged so customers can download the GitHub ZIP, open `ROSA-simulator.exe`, and have the server prepared automatically.

### Quick Start On Windows

1. Download the repository with `Code -> Download ZIP` on GitHub.
2. Extract the ZIP.
3. Open the `ROSA-simulator` folder.
4. Double-click `ROSA-simulator.exe`.
5. Keep the CMD window open while testing. Closing it stops the local server.

`ROSA-simulator.exe` is a bootstrapper. When started, it will:

- use an installed Node.js if the version is compatible;
- download portable Node into `%LOCALAPPDATA%\ROSA-simulator` if Node.js is missing;
- install Node dependencies into the user cache if missing or if `package-lock.json` changed;
- start the server and open `http://localhost:4177`.

The first run requires internet if Node/dependencies are not already cached. Later runs reuse the cache and start faster.

### Run Manually With Node

Use this path if you want to run from source yourself:

```bash
npm install
npm start
```

Then open `http://localhost:4177`.

### Create A New Template With AI

When using AI to create a new template from an existing project:

1. Ask the AI agent to read `docs/ai-template-brief.md` before editing files.
2. Ask it to copy and adapt the closest working template from `sample_templates/templates/`.
3. Keep template work inside `sample_templates/` and update `sample_templates/manifest.json`.
4. Run validation:

```bash
npm run validate
npm run check
```

The new template is not complete until both commands pass.

Suggested AI prompt:

```text
In ROSA-simulator, read docs/ai-template-brief.md, then create this ROSA template: [describe the request].

Follow the documented scope, copy the closest template from sample_templates/templates/, update the manifest, then run npm run validate and npm run check.
```

### Important Folders

- `sample_templates/`: template manifest, HTML, CSS, runtime JS, sample images, and sample SQLite files.
- `docs/`: template-authoring documentation and technical notes.
- `.sim/state/`: local simulator state created while testing.
- `logs/`: launcher/server logs.
- `%LOCALAPPDATA%\ROSA-simulator`: portable Node and Node dependency cache created by the bootstrapper.

To reset test data, close the app and delete `.sim/state/`, or use the clear buttons in the simulator UI.
