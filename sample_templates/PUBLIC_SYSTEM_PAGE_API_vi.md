# Secure Public IoT Page APIs

Tài liệu này dành cho template author khi cần tạo trang public chạy từ `system_pages` mà không lộ `sessionId@apiKey`, API key hoặc `sync_id` thật.

Bản hướng dẫn đầy đủ cho AI/kỹ sư nằm ở `docs/secure-iot-page-flow.md`. File này là ghi chú nhanh đặt cạnh `sample_templates/` để AI dễ thấy khi quét template mẫu.

## Nguyên tắc

- Trang public được mở qua `/iot-page/{ioid}/{pageid}`.
- Trang public không được gọi trực tiếp `/api/{sessionId}/{syncId}/iotelemetry`, `/iotimeseries`, `/iodata` hoặc `/dataquery`.
- JavaScript trong trang đọc telemetry/timeseries public qua `/api/iot-page-telemetry/{ioid}/{pageid}`, `/api/iot-page-timeseries/{ioid}/{pageid}` hoặc SSE `/api/iot-page-realtime/{ioid}/{pageid}`.
- JavaScript trong trang gọi macro qua `/api/iot-page-macro/{ioid}/{pageid}`.
- Trang có realtime DB bằng `/api/iot-page-stream/{ioid}/{pageid}` nếu bật `publicApi.stream`.
- Trang public gửi lệnh IoT qua `/api/iot-cmd/{ioid}/{cmd_id}` và command phải được khai báo trong `system_cmds`.
- Macro public không bị ép chỉ đọc. Macro được allowlist trong `system_pages.meta.publicApi.macros` thì được chạy; macro tự quyết định đọc hay ghi qua SQL.
- ROSA core bảo vệ bằng allowlist, schema tham số, giới hạn dung lượng body, rate limit, billing theo `system_pages.sync_id`, same-origin, và reserved bindings.
- Nếu page là QR/system page dẫn về landing cá nhân, có thể khai báo `meta.accountLandingPageUrl`. Khi user đã đăng nhập tải page đó, ROSA lưu landing vào account để `/iot-page` render trực tiếp landing về sau.
- Simulator local dùng identity giả từ `SIM_USER_EMAIL`, `SIM_USER_NAME`, `SIM_USER_PHONE`; production dùng Google/phone verification thật.

## Endpoint tóm tắt

| Mục đích | Endpoint public | Ghi chú |
| --- | --- | --- |
| Render public page | `GET /iot-page/{ioid}/{pageid}` | Render HTML lưu trong cột `system_pages.html`, inject `__ROSA_IOT_PAGE_META__` và `__ROSA_IOT_PAGE_CONTEXT__`. |
| Latest telemetry | `GET /api/iot-page-telemetry/{ioid}/{pageid}` | Chỉ trả field trong `publicApi.fields`. |
| Timeseries | `GET /api/iot-page-timeseries/{ioid}/{pageid}?from=...&to=...` | Chỉ trả field trong `publicApi.fields`. |
| Telemetry/timeseries SSE | `GET /api/iot-page-realtime/{ioid}/{pageid}` | Không cần refresh interval. |
| Public macro | `POST /api/iot-page-macro/{ioid}/{pageid}` | Body `{ "macro": "...", "params": {} }`. |
| DB change SSE | `GET /api/iot-page-stream/{ioid}/{pageid}` | Chỉ bật khi `publicApi.stream=true`. |
| Secure command | `POST /api/iot-cmd/{ioid}/{cmd_id}` | Đọc `system_cmds`, resolve template phía server. |

Public response có thể trả `sessionId` dạng sanitize như `{ioid}@public-page` và `syncId` là `public-page`. Đây không phải credential thiết bị.

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

Client không được gửi các key sau làm dữ liệu tin cậy. Không khai báo các key này trong `publicApi.context`, public macro params, `system_cmds.params_schema` hoặc command body:

```text
email, username, phone, apikey, api_key, syncid, sync_id, sessionid, session_id, ioid, macro, __proto__, prototype, constructor
```

Các biến thể camel-case như `apiKey`, `syncId`, `sessionId` cũng bị xem là không an toàn vì backend normalize key trước khi validate.

Nếu page có `require_email` hoặc `require_phone`, backend sẽ tự inject `email`, `username`, `phone` từ tài khoản ROSA đã xác thực. Template không được lấy các giá trị này từ client.

## Public telemetry/timeseries

`system_pages.meta.publicApi.fields` là allowlist duy nhất cho public telemetry/timeseries:

```json
{
  "pageType": "queue-display",
  "publicApi": {
    "fields": [
      "clinic_a_name",
      "clinic_a_text1",
      "clinic_a_order1",
      "clinic_a_text2",
      "clinic_a_order2",
      "clinic_a_media",
      "clinic_a_note",
      "clinic_a_alert"
    ]
  }
}
```

Trang public đọc context đã inject:

```html
<script id="rosa-iot-page-meta" type="application/json">__ROSA_IOT_PAGE_META__</script>
<script id="rosa-iot-page-context" type="application/json">__ROSA_IOT_PAGE_CONTEXT__</script>
```

```js
var context = JSON.parse(document.getElementById('rosa-iot-page-context').textContent || '{}');
var es = new EventSource('/api/iot-page-realtime/' + encodeURIComponent(context.ioid) + '/' + encodeURIComponent(context.pageId));
es.onmessage = function (event) {
  var data = JSON.parse(event.data || '{}');
  if (data.type === 'telemetry') render(data.payload || {});
};
```

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

## Secure command bằng `system_cmds`

Public page không tự tạo URL gateway và không gửi API key. Nếu cần gửi lệnh từ QR/public page, tạo row trong `system_cmds`:

```sql
INSERT INTO system_cmds (
  cmd_id,
  command_template,
  require_email,
  require_phone,
  sync_id,
  params_schema,
  enabled
) VALUES (
  'locker-open-auto',
  'N3,"LOCKER_OPEN","<<action>>","<<request_id>>","<<cabinet_id>>","<<locker_id>>",<<slot_no>>,"<<hardware_addr>>","<<phone>>"',
  1,
  1,
  '<<syncid>>',
  '{"action":{"type":"string","required":true,"maxLength":32,"pattern":"^[A-Za-z0-9_-]{1,32}$"},"cabinet_id":{"type":"string","required":true,"maxLength":24,"pattern":"^[A-Z0-9_-]{1,24}$"},"locker_id":{"type":"string","required":true,"maxLength":24,"pattern":"^[A-Z0-9_-]*$"},"slot_no":{"type":"integer","required":true,"min":0,"max":999},"hardware_addr":{"type":"string","required":true,"maxLength":48,"pattern":"^[A-Za-z0-9_.:-]*$"},"request_id":{"type":"string","required":true,"maxLength":48,"pattern":"^[A-Za-z0-9_.:-]{1,48}$"}}',
  1
);
```

Frontend gọi:

```js
fetch('/api/iot-cmd/' + encodeURIComponent(context.ioid) + '/locker-open-auto', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'same-origin',
  body: JSON.stringify({
    action: 'pickup',
    request_id: 'REQ-123',
    cabinet_id: 'CAB-A',
    locker_id: 'A-008',
    slot_no: 8,
    hardware_addr: 'ADDR-A-008'
  })
});
```

`<<email>>`, `<<username>>`, `<<phone>>` trong `command_template` do backend resolve. Client không được gửi các khóa này.

## Checklist cho template public

- HTML public được lưu trong cột `system_pages.html` và mở qua `/iot-page/{ioid}/{pageid}`.
- HTML public có `__ROSA_IOT_PAGE_META__` và `__ROSA_IOT_PAGE_CONTEXT__`.
- HTML/JS public không chứa `@simulate`, API key, `sync_id` thật hoặc direct `/api/{sessionId}/{syncId}/...`.
- `publicApi.fields` chỉ chứa telemetry/timeseries field được phép public.
- `publicApi.macros` chỉ chứa macro được phép chạy public.
- Public macro params có schema rõ ràng và không dùng reserved keys.
- Public command dùng `system_cmds`, không build gateway command bằng API key trong browser.
- Nếu macro ghi dữ liệu, có idempotency key như `client_request_id`.
- Chạy `npm run validate` và `npm run check`.

## Chống spam và payload lớn

- Mặc định body tối đa 4096 bytes.
- Page có thể đặt `publicApi.maxBodyBytes`, nhưng không vượt hard cap global 64KB.
- Rate limit tính theo IP + `ioid/pageid/macro`.
- `publicApi.rateLimit.limit` được clamp tối đa 600 request mỗi window.
- `publicApi.rateLimit.windowMs` được clamp trong khoảng 1 giây đến 10 phút.
- POST public macro có same-origin check để trang khác không gọi bằng browser một cách tùy tiện.
