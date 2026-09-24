import { EditorState } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  keymap,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { autocompletion } from "@codemirror/autocomplete";
import { setDiagnostics } from "@codemirror/lint";
const $ = (id) => document.getElementById(id);
const exampleSources = {
  "Trả JSON":
    'export default async function main(input, rosa) {\n  console.log("Bắt đầu");\n  return { ok: true, input };\n}',
  "Đọc / ghi macro":
    'export default async function main(input, rosa) {\n  const rows = await rosa.db.macro("inventory-list", input);\n  return { rows };\n}',
  "Báo cáo":
    'export default async function main(input, rosa) {\n  const rows = await rosa.db.report("inventory-report", input);\n  return { rows };\n}',
  "Trạng thái IoT":
    'export default async function main(input, rosa) {\n  const state = await rosa.iot.latest("device");\n  return { state };\n}',
  "Lịch sử IoT":
    'export default async function main(input, rosa) {\n  const history = await rosa.iot.timeseries("device", { from: Date.now()-3600000, to: Date.now() });\n  return { history };\n}',
  "Lệnh thiết bị":
    'export default async function main(input, rosa) {\n  const result = await rosa.iot.command("device", "switch", { state: input.state });\n  return { result };\n}',
  "Xử lý lỗi":
    'export default async function main(input, rosa) {\n  try {\n    return { rows: await rosa.db.macro("inventory-list", input) };\n  } catch (error) {\n    console.error(error.message);\n    return { ok: false, error: error.message };\n  }\n}',
};
const sdkOptions = [
  "rosa.db.macro",
  "rosa.db.report",
  "rosa.iot.latest",
  "rosa.iot.timeseries",
  "rosa.iot.command",
  "console.log",
].map((label) => ({ label, type: "function" }));
const editor = new EditorView({
  state: EditorState.create({
    doc: exampleSources["Trả JSON"],
    extensions: [
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      javascript(),
      highlightActiveLine(),
      autocompletion({
        override: [
          (context) => {
            const word = context.matchBefore(/[\w.]+/);
            return word ? { from: word.from, options: sdkOptions } : null;
          },
        ],
      }),
    ],
  }),
  parent: $("editor"),
});
let ioid = "",
  backends = [],
  simulation = false,
  selected = "",
  busy = false,
  requestId = "",
  lastInputHash = "";
const emptySchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
};
function status(text, error = false) {
  $("status").textContent = text;
  $("status").dataset.error = String(error);
}
async function api(body, query = "") {
  const response = await fetch("/api/backends" + query, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || value.error);
  return value;
}
function parse(id) {
  try {
    return JSON.parse($(id).value);
  } catch {
    throw new Error(`${id}: JSON không hợp lệ.`);
  }
}
function definition() {
  return {
    name: $("name").value,
    source: editor.state.doc.toString(),
    inputSchema: parse("inputSchema"),
    outputSchema: parse("outputSchema"),
    permissions: parse("permissionsJson"),
  };
}
function config() {
  return {
    syncId: $("syncId").value,
    externalEnabled: $("external").checked,
    authType: $("authType").value,
    username: $("username").value,
    apiKey: $("apiKey").value,
    enabled: backends.find((d) => d.name === $("name").value)?.config?.enabled === true,
  };
}
function apiView() {
  const external = $("external").checked;
  $("externalConfig").hidden = !external;
  $("usernameLabel").hidden = $("authType").value !== "basic";
  const url = `${location.origin}/bw/${ioid}/${$("name").value}`;
  $("url").textContent = url;
  const auth =
    $("authType").value === "basic"
      ? `-u '${$("username").value}:<API_KEY>'`
      : $("authType").value === "api-key"
        ? `-H 'X-API-Key: <API_KEY>'`
        : `-H 'Authorization: Bearer <API_KEY>'`;
  $("curl").textContent =
    `curl -X POST '${url}' ${auth} -H 'Content-Type: application/json' -H 'Idempotency-Key: request-001' -d '${$("input").value}'\n\nTrang IoT: await rosa.backend.run("${$("name").value}", input);`;
}
function load(d) {
  selected = d.name;
  $("name").value = d.name;
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: d.source },
  });
  $("inputSchema").value = JSON.stringify(
    d.inputSchema || emptySchema,
    null,
    2,
  );
  $("outputSchema").value = JSON.stringify(
    d.outputSchema || { type: "object" },
    null,
    2,
  );
  $("permissionsJson").value = JSON.stringify(
    d.permissions || { macros: [], reports: [], devices: {} },
    null,
    2,
  );
  const c = d.config || {};
  $("syncId").value =
    c.syncId ||
    (simulation ? "SIM_SYNC" : sessionStorage.getItem("backend-payer") || "");
  $("external").checked = !!c.externalEnabled;
  $("authType").value = c.authType || "bearer";
  $("username").value = c.username || "";
  $("apiKey").value = "";
  $("apiKey").placeholder = c.hasKey
    ? "Đã có khóa; để trống để giữ"
    : "API key ≥24 ký tự";
  $("output").textContent = "";
  $("usage").textContent = "";
  requestId = "";
  apiView();
  renderList();
}
function renderList() {
  $("list").replaceChildren(
    ...backends.map((d) => {
      const b = document.createElement("button");
      b.textContent = d.name;
      b.title =
        d.config?.enabled && d.config?.published
          ? "Đang phát hành"
          : "Bản nháp / đã tắt";
      b.className = d.name === selected ? "active" : "";
      b.onclick = () => load(d);
      return b;
    }),
  );
  renderFields("input");
  renderFields("output");
}
async function refresh() {
  const value = await api();
  ioid = value.ioid;
  simulation = value.simulation;
  backends = value.backends;
  $("context").textContent = ioid;
  $("mode").textContent = simulation ? "Mô phỏng local" : "";
  $("run").textContent = simulation ? "Chạy mô phỏng" : "Chạy thật";
  $("connect").hidden = true;
  renderList();
  if (!selected && backends.length) load(backends[0]);
  else apiView();
}
async function action(fn) {
  if (busy) return;
  busy = true;
  document
    .querySelectorAll(".toolbar button")
    .forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    status(e.message, true);
  } finally {
    busy = false;
    document
      .querySelectorAll(".toolbar button")
      .forEach((b) => (b.disabled = false));
  }
}
async function save() {
  await api({
    action: "save",
    definition: definition(),
    deviceSessions: parse("deviceSessions"),
  });
  selected = $("name").value;
  status("Đã lưu nháp.");
  await refresh();
}
async function configure(enabled = config().enabled) {
  await api({ action: "configure", name: $("name").value, config: { ...config(), enabled } });
  $("apiKey").value = "";
  sessionStorage.removeItem("backend-payer");
  status("Đã lưu cấu hình.");
}
$("connect").onsubmit = (e) => {
  e.preventDefault();
  void action(async () => {
    await api({ action: "connect", sessionId: $("session").value });
    $("session").value = "";
    await refresh();
    status("Đã kết nối.");
  });
};
$("refresh").onclick = () => action(refresh);
$("new").onclick = () =>
  load({ name: "backend-moi", source: exampleSources["Trả JSON"] });
$("save").onclick = () => action(save);
$("configSave").onclick = () => action(configure);
for (const id of ["syntax", "analyze"])
  $(id).onclick = () =>
    action(async () => {
      const value = await api({
        action: "check",
        source: editor.state.doc.toString(),
        syntaxOnly: id === "syntax",
      });
      const diagnostics = value.diagnostics.map((d) => {
        const line = editor.state.doc.line(
          Math.min(d.line, editor.state.doc.lines),
        );
        return {
          from: Math.min(line.to, line.from + d.column - 1),
          to: Math.min(line.to, line.from + d.column),
          severity: d.severity,
          message: d.message,
        };
      });
      editor.dispatch(setDiagnostics(editor.state, diagnostics));
      $("diagnostics").replaceChildren(
        ...value.diagnostics.map((d) => {
          const b = document.createElement("button");
          b.textContent = `${d.line}:${d.column} ${d.message}`;
          b.onclick = () => {
            const line = editor.state.doc.line(
              Math.min(d.line, editor.state.doc.lines),
            );
            editor.dispatch({
              selection: { anchor: line.from },
              scrollIntoView: true,
            });
            editor.focus();
          };
          return b;
        }),
      );
      status(value.ok ? "Kiểm tra đạt." : "Có lỗi cần sửa.", !value.ok);
    });
$("publish").onclick = () =>
  action(async () => {
    await save();
    await configure();
    await api({
      action: "publish",
      name: $("name").value,
      deviceSessions: parse("deviceSessions"),
    });
    await configure(true);
    status("Đã phát hành.");
    await refresh();
  });
$("disable").onclick = () =>
  action(async () => {
    await api({
      action: "configure",
      name: $("name").value,
      config: { ...config(), enabled: false },
    });
    status("Backend đã tắt.");
    await refresh();
  });
$("run").onclick = () =>
  action(async () => {
    await save();
    await configure();
    const input = parse("input");
    const hash = JSON.stringify([definition(), input]);
    if (hash !== lastInputHash || !requestId) {
      requestId = crypto.randomUUID();
      lastInputHash = hash;
    }
    let run = await api({
      action: "run",
      name: $("name").value,
      input,
      requestId,
      deviceSessions: parse("deviceSessions"),
    });
    while (["queued", "running"].includes(run.status)) {
      $("usage").textContent =
        `${run.status} · CPU ${run.cpuMs.toFixed(2)} ms · ${(run.wallMs / 1000).toFixed(1)} s`;
      await new Promise((r) => setTimeout(r, 1000));
      run = await api(null, `?runId=${encodeURIComponent(run.runId)}`);
    }
    $("output").textContent = JSON.stringify(
      { result: run.result, error: run.error, logs: run.logs },
      null,
      2,
    );
    $("usage").textContent =
      `CPU ${run.cpuMs.toFixed(2)} ms · ${(run.wallMs / 1000).toFixed(1)} s · CPU ${run.cpuCost.toFixed(6)} + dịch vụ ${run.serviceCost.toFixed(6)}`;
    status(run.error ? run.error.message : "Hoàn tất.", !!run.error);
    requestId = "";
  });
for (const [label] of Object.entries(exampleSources)) {
  const o = document.createElement("option");
  o.value = label;
  o.textContent = label;
  $("examples").append(o);
}
$("examples").onchange = () => {
  if (exampleSources[$("examples").value])
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: exampleSources[$("examples").value],
      },
    });
  $("examples").value = "";
};
$("generateKey").onclick = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join(
    "",
  );
  $("apiKey").value = key;
  $("apiKey").type = "text";
  status("Sao chép khóa mới trước khi lưu.");
  if (navigator.clipboard)
    void navigator.clipboard.writeText(key).then(
      () => status("Đã sao chép khóa mới. Lưu cấu hình để áp dụng."),
      () => {},
    );
};
$("changeDevice").onclick = () => {
  $("connect").hidden = false;
  $("session").focus();
};
function renderFields(kind) {
  let schema;
  try {
    schema = parse(kind + "Schema");
  } catch {
    return;
  }
  const container = $(kind + "Fields");
  container.replaceChildren();
  if (schema.type !== "object") {
    container.textContent = "Dùng JSON Schema nâng cao cho kiểu " + schema.type;
    return;
  }
  for (const [name, spec] of Object.entries(schema.properties || {})) {
    const row = document.createElement("div");
    row.className = "row fieldRow";
    const input = document.createElement("input");
    input.value = name;
    input.setAttribute("aria-label", "Tên " + kind);
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Kiểu " + name);
    for (const t of [
      "string",
      "number",
      "integer",
      "boolean",
      "object",
      "array",
      "null",
    ]) {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      select.append(o);
    }
    select.value = spec.type || "string";
    const label = document.createElement("label");
    const required = document.createElement("input");
    required.type = "checkbox";
    required.checked = (schema.required || []).includes(name);
    label.append(required, document.createTextNode("Bắt buộc"));
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Xóa " + name);
    const update = (deleted) => {
      try {
        const next = parse(kind + "Schema"),
          key = input.value.trim();
        if (
          !deleted &&
          (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ||
            ["__proto__", "prototype", "constructor"].includes(key) ||
            (key !== name && Object.hasOwn(next.properties || {}, key)))
        )
          throw new Error("Tên trường không hợp lệ hoặc đã có.");
        const p = { ...spec, type: select.value };
        if (p.type === "array" && !p.items) p.items = {};
        if (p.type !== "array") delete p.items;
        delete next.properties[name];
        if (!deleted) next.properties[key] = p;
        next.required = (next.required || []).filter((x) => x !== name);
        if (!deleted && required.checked) next.required.push(key);
        if (!next.required.length) delete next.required;
        $(kind + "Schema").value = JSON.stringify(next, null, 2);
        renderFields(kind);
      } catch (e) {
        status(e.message, true);
      }
    };
    input.onchange = () => update(false);
    select.onchange = () => update(false);
    required.onchange = () => update(false);
    remove.onclick = () => update(true);
    row.append(input, select, label, remove);
    container.append(row);
  }
}
for (const kind of ["input", "output"]) {
  $(kind + "Schema").onchange = () => renderFields(kind);
  $("add" + kind[0].toUpperCase() + kind.slice(1)).onclick = () => {
    try {
      const schema = parse(kind + "Schema");
      if (schema.type !== "object")
        throw new Error("Thêm trường cần schema object.");
      schema.properties = schema.properties || {};
      let n = 1;
      while (Object.hasOwn(schema.properties, "field" + n)) n++;
      schema.properties["field" + n] = { type: "string" };
      $(kind + "Schema").value = JSON.stringify(schema, null, 2);
      renderFields(kind);
    } catch (e) {
      status(e.message, true);
    }
  };
}
for (const id of ["external", "authType", "name", "username", "input"])
  $(id).addEventListener("input", apiView);
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll(".tab")
        .forEach((t) => (t.hidden = t.id !== b.dataset.tab));
      document
        .querySelectorAll("[data-tab]")
        .forEach((x) => x.classList.toggle("active", x === b));
    }),
);
window.addEventListener("message", (event) => {
  if (
    event.origin !== location.origin ||
    event.data?.type !== "rosa-backend-connect"
  )
    return;
  void action(async () => {
    await api({ action: "connect", sessionId: event.data.sessionId });
    sessionStorage.setItem("backend-payer", event.data.syncId || "");
    await refresh();
  });
});
load({ name: "backend-moi", source: exampleSources["Trả JSON"] });
selected = "";
refresh().catch(() => status("Kết nối thiết bị để quản lý backend."));
if (window.parent !== window)
  window.parent.postMessage({ type: "rosa-backend-ready" }, location.origin);
