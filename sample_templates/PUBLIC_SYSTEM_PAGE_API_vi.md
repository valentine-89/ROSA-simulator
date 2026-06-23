# Public System Page Macro API

Tài liệu này dành cho template author khi cần tạo trang public chạy từ `system_pages` mà không lộ `sessionId@apiKey`.

## Nguyên tắc

- Trang public được mở qua `/iot-page/{ioid}/{pageid}`.
- JavaScript trong trang gọi macro qua `/api/iot-page-macro/{ioid}/{pageid}`.
- Trang có realtime DB bằng `/api/iot-page-stream/{ioid}/{pageid}` nếu bật `publicApi.stream`.
- Macro public không bị ép chỉ đọc. Macro được allowlist trong `system_pages.meta.publicApi.macros` thì được chạy; macro tự quyết định đọc hay ghi qua SQL.
- ROSA core bảo vệ bằng allowlist, schema tham số, giới hạn dung lượng body, rate limit, billing theo `system_pages.sync_id`, same-origin, và reserved bindings.
- Nếu page là QR/system page dẫn về landing cá nhân, có thể khai báo `meta.accountLandingPageUrl`. Khi user đã đăng nhập tải page đó, ROSA lưu landing vào account để `/iot-page` render trực tiếp landing về sau.

## Body gọi macro

```json
{
  "macro": "locker-monitor-state",
  "params": {
    "limit": 50
  }
}
```

`params` chỉ được chứa field đã khai báo trong `publicApi.macros[macro].params`. Field lạ sẽ bị từ chối.

## Reserved keys

Client không được gửi các key sau làm dữ liệu tin cậy:

```text
email, username, phone, apikey, api_key, syncid, sync_id, sessionid, session_id, ioid, macro, __proto__, prototype, constructor
```

Nếu page có `require_email` hoặc `require_phone`, backend sẽ tự inject `email`, `username`, `phone` từ tài khoản ROSA đã xác thực. Template không nên lấy các giá trị này từ client.

## Ví dụ monitor locker chỉ đọc

```json
{
  "pageType": "locker-monitor-public",
  "publicApi": {
    "stream": true,
    "maxBodyBytes": 2048,
    "rateLimit": { "limit": 60, "windowMs": 60000 },
    "macros": {
      "locker-monitor-state": {
        "params": {
          "limit": { "type": "integer", "min": 1, "max": 100 }
        }
      },
      "locker-event-list": {
        "params": {
          "limit": { "type": "integer", "min": 1, "max": 100 },
          "offset": { "type": "integer", "min": 0, "max": 10000 }
        }
      }
    }
  }
}
```

## Ví dụ QR locker precheck có bootstrap user tối thiểu

Locker QR dùng public macro để kiểm tra số dư theo `phone` đã xác nhận do backend inject. Mỗi QR/link chỉ ứng với một tủ/một bộ điều khiển qua `publicApi.context.cabinet_id`; nếu người dùng đến sai tủ để nhận đồ thì macro trả không có đồ trong tủ đó, dù user có đồ ở tủ khác. Macro này được phép tạo hồ sơ user tối thiểu nếu phone chưa có trong DB locker, với số dư mặc định `0`, nhưng không ghi nhận gửi/lấy đồ, không tạo session, không ghi ledger và không đổi trạng thái locker. Thiết bị IoT sẽ gọi macro gateway riêng sau khi cửa đóng/xác nhận thành công để ghi DB.

Public monitor locker dùng cùng endpoint macro nhưng truyền thêm `privacy` để template quyết định mức dữ liệu trả về: `maskedPhone`, `hiddenPhone`, `stateOnly`, hoặc `summaryOnly`. Đây vẫn là quyết định của macro/template, không phải mode read-only/read-write ở ROSA core.

```json
{
  "pageType": "locker-auto",
  "accountLandingPageUrl": "/iot-page/<<ioid>>/locker-landing",
  "publicApi": {
    "stream": false,
    "maxBodyBytes": 1024,
    "rateLimit": { "limit": 20, "windowMs": 60000 },
    "context": { "cabinet_id": "CAB-A" },
    "macros": {
      "locker-qr-open-precheck": {
        "params": {
          "requested_action": {
            "type": "string",
            "required": true,
            "enum": ["deposit", "pickup"],
            "maxLength": 16
          }
        }
      }
    }
  }
}
```

Frontend QR chỉ gửi `requested_action`. `phone`, `email` và `cabinet_id` đều do backend/context cung cấp; client không được tự gửi các giá trị này. Với `pickup`, thiết bị của tủ hiện tại dùng phone server-injected để mở các locker active trong chính tủ đó.

Với `accountLandingPageUrl`, account lưu:

```json
{
  "iotPageLandingTarget": { "ioid": "IO...", "pageId": "locker-landing" },
  "iotPageLandingList": [
    { "ioid": "IO...", "pageId": "locker-landing", "title": "ROSA Locker" }
  ]
}
```

`title` lấy từ `system_pages.title` của landing target, không khai báo riêng trong meta. Nếu account có nhiều landing page, header ở `/iot-page` sẽ hiện dropdown để switch.

## Ví dụ QR đặt món tại bàn có ghi DB

```json
{
  "pageType": "table-order",
  "publicApi": {
    "stream": true,
    "maxBodyBytes": 4096,
    "rateLimit": { "limit": 20, "windowMs": 60000 },
    "context": { "table_id": "B12" },
    "macros": {
      "order-create": {
        "params": {
          "items_json": { "type": "string", "required": true, "maxLength": 2500 },
          "note": { "type": "string", "maxLength": 240 },
          "client_request_id": { "type": "string", "required": true, "maxLength": 80 }
        }
      },
      "order-status": {
        "params": {
          "client_request_id": { "type": "string", "required": true, "maxLength": 80 }
        }
      }
    }
  }
}
```

Với macro ghi public, nên có `client_request_id` và xử lý idempotent trong SQL để chống bấm lặp hoặc retry tạo dữ liệu trùng.

## Chống spam và payload lớn

- Mặc định body tối đa 4096 bytes.
- Page có thể đặt `publicApi.maxBodyBytes`, nhưng không vượt hard cap global 64KB.
- Rate limit tính theo IP + `ioid/pageid/macro`.
- `publicApi.rateLimit.limit` được clamp tối đa 600 request mỗi window.
- `publicApi.rateLimit.windowMs` được clamp trong khoảng 1 giây đến 10 phút.
- POST public macro có same-origin check để trang khác không gọi bằng browser một cách tùy tiện.
