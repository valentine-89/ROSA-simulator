# Secure IoT Page Flow For Template Authors

This guide is for AI agents and engineers creating templates that include customer-facing QR pages, public displays, or public IoT pages stored in `system_pages`.

## Core Rule

There are two different browser contexts:

- Private dashboard/setup pages run inside the ROSA dashboard or simulator template picker. They may use context placeholders such as `<<sessionid>>` and `<<syncid>>`, and may call the existing direct APIs.
- Public IoT pages run from `/iot-page/{ioid}/{pageid}`. They must never expose `sessionId@apikey`, the real `sync_id`, API keys, or direct `/api/{sessionId}/{syncId}/...` URLs in HTML or JavaScript.

If a public page needs data, use only the pageid-based public APIs described below. Do not add backend routes for a template.

## Simulator Fidelity

The simulator supports the same public contract needed for local testing:

- `GET /iot-page/{ioid}/{pageid}` renders the HTML stored in the `system_pages.html` column.
- `GET /api/iot-page-telemetry/{ioid}/{pageid}` returns latest public telemetry fields configured in page meta.
- `GET /api/iot-page-timeseries/{ioid}/{pageid}` returns public timeseries rows configured in page meta.
- `GET /api/iot-page-realtime/{ioid}/{pageid}` streams configured public telemetry/timeseries by SSE.
- `POST /api/iot-page-macro/{ioid}/{pageid}` runs only macros configured in `publicApi.macros`.
- `GET /api/iot-page-stream/{ioid}/{pageid}` streams `iodata_changed` when `publicApi.stream=true`.
- `POST /api/iot-cmd/{ioid}/{cmd_id}` resolves `system_cmds.command_template`, logs locally, and does not call the real IoT gateway.

The simulator uses fake identity values from `SIM_USER_EMAIL`, `SIM_USER_NAME`, and `SIM_USER_PHONE`. If these env vars are absent, it provides a local demo identity so QR/locker/mixer pages can be tested.

Production ROSA may add real account identity, phone verification, usage billing, and extra server-side protection. Templates should target the same public API contract and must not depend on simulator-only shortcuts.

## Required SQLite Tables

Public pages live in the sample SQLite database copied to `.sim/state/iodata/{ioid}.sqlite`.

Minimum `system_pages` shape:

```sql
CREATE TABLE IF NOT EXISTS system_pages (
  page_id TEXT PRIMARY KEY,
  html TEXT NOT NULL,
  require_email INTEGER NOT NULL DEFAULT 0,
  require_phone INTEGER NOT NULL DEFAULT 0,
  sync_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  title TEXT,
  meta TEXT
);
```

Secure public commands use `system_cmds`:

```sql
CREATE TABLE IF NOT EXISTS system_cmds (
  cmd_id TEXT PRIMARY KEY,
  command_template TEXT NOT NULL,
  require_email INTEGER NOT NULL DEFAULT 0,
  require_phone INTEGER NOT NULL DEFAULT 0,
  sync_id TEXT NOT NULL,
  params_schema TEXT,
  enabled INTEGER NOT NULL DEFAULT 1
);
```

Use placeholders such as `<<ioid>>`, `<<sessionid>>`, and `<<syncid>>` in sample SQLite rows when needed. The simulator replaces them when importing the sample database. For public page HTML, do not use `<<sessionid>>` to build direct API URLs; read the injected page context and use the public pageid APIs instead.

## Public Page HTML

Public page HTML should read only injected metadata and context:

```html
<script id="rosa-iot-page-meta" type="application/json">__ROSA_IOT_PAGE_META__</script>
<script id="rosa-iot-page-context" type="application/json">__ROSA_IOT_PAGE_CONTEXT__</script>
```

```js
function readJsonScript(id) {
  try {
    return JSON.parse(document.getElementById(id).textContent || '{}');
  } catch {
    return {};
  }
}

const pageMeta = readJsonScript('rosa-iot-page-meta');
const pageContext = readJsonScript('rosa-iot-page-context');
```

The injected context is intentionally small. It includes `ioid`, `pageId`, and `title`; it does not include real `sessionId`, `syncId`, or API key.

## `meta.publicApi`

`system_pages.meta` is JSON. The public API contract lives under `publicApi`:

```json
{
  "pageType": "queue-display",
  "publicApi": {
    "fields": ["clinic_a_name", "clinic_a_order1"],
    "stream": true,
    "context": { "station_id": "clinic-a" },
    "macros": {
      "queue-public-state": {
        "params": {
          "limit": { "type": "integer", "min": 1, "max": 100 }
        }
      }
    }
  }
}
```

Rules:

- `fields` is the server-side public field list for telemetry/timeseries/realtime reads. Browser requests do not send this list.
- `stream=true` enables `/api/iot-page-stream/...` for `iodata_changed`.
- `context` is server-side page context. Client code must not send these keys.
- `macros` lists the public macros this page can call. A macro not listed here must be rejected.
- `maxBodyBytes` and `rateLimit` are optional server-side safety settings handled by ROSA/simulator when configured.

## Public Telemetry And Timeseries

Use public read APIs from public pages:

```js
async function loadTelemetry() {
  const response = await fetch(
    '/api/iot-page-telemetry/' + encodeURIComponent(pageContext.ioid) + '/' + encodeURIComponent(pageContext.pageId),
    { credentials: 'same-origin' }
  );
  const data = await response.json();
  if (!response.ok || data.c1 !== 'ok') throw new Error(data.message || data.error || 'Telemetry failed');
  return data.c2.payload;
}
```

```js
const to = Date.now();
const from = to - 60 * 60 * 1000;
const url = '/api/iot-page-timeseries/' +
  encodeURIComponent(pageContext.ioid) + '/' +
  encodeURIComponent(pageContext.pageId) +
  '?from=' + from + '&to=' + to;
```

```js
const source = new EventSource(
  '/api/iot-page-realtime/' + encodeURIComponent(pageContext.ioid) + '/' + encodeURIComponent(pageContext.pageId)
);
source.onmessage = function (event) {
  const message = JSON.parse(event.data || '{}');
  if (message.type === 'telemetry') renderTelemetry(message.payload || {});
};
```

The response may include sanitized values such as `sessionId: "{ioid}@public-page"` and `syncId: "public-page"`. Do not treat them as device credentials.

## Public Macros

Public macro requests must use this shape:

```json
{
  "macro": "locker-qr-open-precheck",
  "params": {
    "requested_action": "pickup"
  }
}
```

JavaScript example:

```js
async function runPublicMacro(macro, params) {
  const response = await fetch(
    '/api/iot-page-macro/' + encodeURIComponent(pageContext.ioid) + '/' + encodeURIComponent(pageContext.pageId),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ macro, params: params || {} })
    }
  );
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || 'Public macro failed');
  return data.rows || [];
}
```

Macros may read or write SQLite data, but public write macros must be designed carefully:

- Use `client_request_id` or another idempotency key for submit/retry flows.
- Validate every user-provided value through `publicApi.macros[macro].params`.
- Keep write effects narrow and auditable.
- Do not rely on client-provided identity, device keys, `sync_id`, or `ioid`.

## Public IoData Stream

For database-backed public pages that need to refresh when a macro changes SQLite data:

```js
const source = new EventSource(
  '/api/iot-page-stream/' + encodeURIComponent(pageContext.ioid) + '/' + encodeURIComponent(pageContext.pageId)
);
source.onmessage = function (event) {
  const message = JSON.parse(event.data || '{}');
  if (message.type === 'iodata_changed') reloadPublicState();
};
```

This route is separate from telemetry realtime. Use it for macro/database changes, not for sensor telemetry.

## Secure Public Commands

Public pages must not build IoT gateway URLs or expose device credentials. If a public page needs to send a command, define the command in `system_cmds` and call `/api/iot-cmd/{ioid}/{cmd_id}`.

Example `system_cmds` row:

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

Browser call:

```js
await fetch('/api/iot-cmd/' + encodeURIComponent(pageContext.ioid) + '/locker-open-auto', {
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

The backend injects `<<email>>`, `<<username>>`, and `<<phone>>` when required. The browser must not send these values.

## Reserved Keys

The following keys are reserved and must not appear in public `params`, `publicApi.context`, macro param schemas, or command request bodies:

```text
apikey, api_key, syncid, sync_id, sessionid, session_id, ioid, macro, email, phone, username, __proto__, prototype, constructor
```

Camel-case variants are also unsafe because keys are normalized before validation; for example `apiKey`, `syncId`, and `sessionId` are rejected.

## Anti-Patterns

Do not do these in public pages:

- Do not call `/api/{sessionId}/{syncId}/iotelemetry`, `/iotimeseries`, `/iodata`, or `/dataquery`.
- Do not put `IO...@...`, API keys, or real `sync_id` in HTML, JS, data attributes, query strings, QR codes, logs, or localStorage.
- Do not ask the user/browser to send `phone`, `email`, `username`, `ioid`, `sync_id`, `sessionId`, or API keys.
- Do not add a new backend route when `publicApi.fields`, `publicApi.macros`, `system_cmds`, or SQLite macros can model the behavior.
- Do not declare reserved keys such as `phone` in `publicApi.macros[macro].params`; the page will fail validation.
- Do not use public pages as admin dashboards unless every exposed macro and field is intentionally public.

## Authoring Checklist

Before a template with public pages is considered done:

- The private dashboard/setup still works without backend changes.
- Public pages are stored in the `system_pages.html` column and opened through `/iot-page/{ioid}/{pageid}`.
- Public HTML uses `__ROSA_IOT_PAGE_META__` and `__ROSA_IOT_PAGE_CONTEXT__`.
- Public HTML contains no `@simulate`, no API key, no direct `sync_id`, and no direct `/api/{sessionId}/{syncId}/...` URL.
- `publicApi.fields` contains only fields safe for public display.
- `publicApi.macros` contains only macros safe for the public page.
- All public macro params have explicit schema rules.
- Reserved keys are not used in params, context, or command bodies.
- Public write macros are idempotent where retry/double-click is possible.
- `system_cmds` is used for public commands instead of client-side gateway commands.
- `npm run validate` and `npm run check` pass.

## Local Smoke Test

After importing a sample database in the simulator:

```bash
curl http://localhost:4177/iot-page/IO123abcd/<pageid>
curl http://localhost:4177/api/iot-page-telemetry/IO123abcd/<pageid>
curl -N http://localhost:4177/api/iot-page-realtime/IO123abcd/<pageid>
```

For macro pages:

```bash
curl -X POST http://localhost:4177/api/iot-page-macro/IO123abcd/<pageid> \
  -H "Content-Type: application/json" \
  -d '{"macro":"your-public-macro","params":{}}'
```

Then inspect the rendered HTML or browser devtools and confirm that public pages do not expose direct device credentials.
