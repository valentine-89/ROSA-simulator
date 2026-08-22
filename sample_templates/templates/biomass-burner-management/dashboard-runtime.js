(function () {
  "use strict";

  /*
   * TEMPLATE PLATFORM INVARIANT
   * Use only standard ROSA IoT-page telemetry/realtime/macros and
   * iot-cmd/system_cmds. Never add a biomass API, auth or c1 action to core.
   */
  var configNode = document.getElementById("biomass-burner-config");
  var runtimeScript = document.currentScript;
  var assetBase = runtimeScript && runtimeScript.src ? new URL(".", runtimeScript.src).href : "";
  var iconUrls = {
    offline: assetBase + "burner-offline.png",
    online: assetBase + "burner-online.png",
    burning: assetBase + "burner-burning.png"
  };
  var settingDefinitions = [
    { key: "1005", group: "Mồi lò", label: "Điện trở", minimum: 30, maximum: 180, unit: "s" },
    { key: "1006", group: "Mồi lò", label: "Quạt mồi tối thiểu", minimum: 0, maximum: 30, unit: "%" },
    { key: "1014", group: "Mồi lò", label: "Sơ cấp", minimum: 20, maximum: 100, unit: "%" },
    { key: "1010", group: "Mồi lò", label: "Thứ cấp", minimum: 0, maximum: 100, unit: "%" },
    { key: "1017", group: "Mồi lò", label: "Quạt mồi sau mồi", minimum: 0, maximum: 100, unit: "%" },
    { key: "1007", group: "Lửa lớn", label: "Sơ cấp", minimum: 20, maximum: 100, unit: "%" },
    { key: "1008", group: "Lửa lớn", label: "Thứ cấp", minimum: 20, maximum: 100, unit: "%" },
    { key: "1009", group: "Lửa vừa", label: "Sơ cấp", minimum: 20, maximum: 100, unit: "%" },
    { key: "1011", group: "Lửa vừa", label: "Thứ cấp", minimum: 20, maximum: 100, unit: "%" },
    { key: "1012", group: "Lửa nhỏ", label: "Sơ cấp", minimum: 20, maximum: 100, unit: "%" },
    { key: "1013", group: "Lửa nhỏ", label: "Thứ cấp", minimum: 20, maximum: 100, unit: "%" },
    { key: "1015", group: "Tắt lò", label: "Thứ cấp chờ", minimum: 20, maximum: 100, unit: "%" },
    { key: "1018", group: "Tắt lò", label: "Chống khói ngược", minimum: 0, maximum: 100, unit: "%" },
    { key: "1016", group: "Tắt lò", label: "Thời gian chờ", minimum: 60, maximum: 3600, unit: "s" }
  ];
  var cfg = {
    title: "Quản lý lò sinh khối", subtitle: "", fleetIoid: "", publicBaseUrl: "https://rosa.technology", pageSize: 50, refreshMs: 60000,
    fleetViewPageId: "biomass-fleet-view", fleetAdminPageId: "biomass-fleet-admin",
    activeStaleMinutes: 15, idleStaleMinutes: 15,
    mapCenterLat: 21.35, mapCenterLng: 105.72, mapZoom: 8
  };
  try { cfg = Object.assign(cfg, JSON.parse(configNode && configNode.textContent || "{}")); } catch (_) {}
  var query = new URLSearchParams(location.search);
  cfg.fleetIoid = String(query.get("ioid") || cfg.fleetIoid || "").trim().split("@")[0];
  cfg.refreshMs = Math.max(60000, Number(cfg.refreshMs) || 60000);
  cfg.activeStaleMinutes = Math.max(1, Number(cfg.activeStaleMinutes) || 15);
  cfg.idleStaleMinutes = Math.max(1, Number(cfg.idleStaleMinutes) || 15);
  var leaseStorageKey = "rosa-batch-lease:" + cfg.fleetIoid + ":" + cfg.fleetViewPageId;
  var storedLeaseId = "";
  try { storedLeaseId = String(sessionStorage.getItem(leaseStorageKey) || ""); } catch (_) {}

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    title: $("bb-title"), subtitle: $("bb-subtitle"), status: $("bb-status"), refresh: $("bb-refresh"),
    addOpen: $("bb-add-open"), lotOpen: $("bb-lot-open"), lotSectionOpen: $("bb-lot-section-open"),
    addModal: $("bb-add-modal"), addForm: $("bb-add-form"), addClose: $("bb-add-close"), addCancel: $("bb-add-cancel"),
    search: $("bb-search"), pageSize: $("bb-page-size"), apply: $("bb-apply-filter"), body: $("bb-table-body"), empty: $("bb-empty"),
    prev: $("bb-prev"), next: $("bb-next"), pageInfo: $("bb-page-info"), total: $("bb-kpi-total"), active: $("bb-kpi-active"),
    stale: $("bb-kpi-stale"), burned: $("bb-kpi-burned"), purchased: $("bb-kpi-purchased"), map: $("bb-map"),
    mapLoading: $("bb-map-loading"), mapFit: $("bb-map-fit"), mapList: $("bb-map-list"), mapCount: $("bb-map-count"),
    settingsModal: $("bb-settings-modal"), settingsTitle: $("bb-settings-title"), settingsSubtitle: $("bb-settings-subtitle"),
    settingsClose: $("bb-settings-close"), coordinateSource: $("bb-coordinate-source"), deviceForm: $("bb-device-form"),
    settingsGrid: $("bb-settings-grid"), settingsState: $("bb-settings-read-state"), deleteBurner: $("bb-delete-burner"),
    creditPurchased: $("bb-credit-purchased"), creditRemaining: $("bb-credit-remaining"), creditEdit: $("bb-credit-edit"),
    openRefuel: $("bb-open-refuel"), showQr: $("bb-show-qr"), creditModal: $("bb-credit-modal"), creditForm: $("bb-credit-form"),
    creditClose: $("bb-credit-close"), creditCancel: $("bb-credit-cancel"), creditValue: $("bb-credit-value"),
    lotModal: $("bb-lot-modal"), lotForm: $("bb-lot-form"), lotClose: $("bb-lot-close"), lotCancel: $("bb-lot-cancel"),
    lotSearch: $("bb-lot-search"), lotStatus: $("bb-lot-status"), lotApply: $("bb-lot-apply"), lotBody: $("bb-lot-body"),
    lotEmpty: $("bb-lot-empty"), lotPrev: $("bb-lot-prev"), lotNext: $("bb-lot-next"), lotPageInfo: $("bb-lot-page-info"),
    batchModal: $("bb-batch-modal"), batchSummary: $("bb-batch-summary"), batchCodes: $("bb-batch-codes"),
    batchClose: $("bb-batch-close"), batchCopy: $("bb-batch-copy"), batchCsv: $("bb-batch-csv"),
    qrModal: $("bb-qr-modal"), qrClose: $("bb-qr-close"), qrCode: $("bb-qr-code"), qrDevice: $("bb-qr-device"),
    qrUrl: $("bb-qr-url"), qrCopy: $("bb-qr-copy"), qrPrint: $("bb-qr-print"), toast: $("bb-toast-stack")
  };
  var state = {
    page: 1, pageSize: Math.max(1, Number(cfg.pageSize) || 50), total: 0,
    lotPage: 1, lotPageSize: 50, lotTotal: 0, lotRows: [], batchRows: [],
    loading: false, timer: 0, renderTimer: 0, current: null, listRows: [], mapRows: [], telemetry: {},
    map: null, markers: null, mapIcons: {}, stream: null, viewerLeaseId: storedLeaseId, generation: ""
  };
  els.title.textContent = cfg.title;
  els.subtitle.textContent = cfg.subtitle;
  els.pageSize.value = String(state.pageSize);

  function esc(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function number(value) { return Number(value || 0).toLocaleString("vi-VN"); }
  function dateTime(value) { return value ? new Date(Number(value)).toLocaleString("vi-VN") : "--"; }
  function modeLabel(mode) { return ["OFF", "START", "HIGH", "MEDIUM", "LOW", "CHỜ TẮT"][Number(mode)] || "OFF"; }
  function coordinateSourceLabel(source) { return source === "gps" ? "GPS" : source === "manual" ? "Thủ công" : "Mặc định"; }
  function validCoordinates(lat, lng) { return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number(lat) >= -90 && Number(lat) <= 90 && Number(lng) >= -180 && Number(lng) <= 180 && !(Number(lat) === 0 && Number(lng) === 0); }
  function showModal(modal, visible) { modal.setAttribute("aria-hidden", visible ? "false" : "true"); modal.classList.toggle("is-open", visible); }
  function notify(message, error) { var item = document.createElement("div"); item.className = "bb-toast" + (error ? " is-error" : ""); item.textContent = message; els.toast.appendChild(item); setTimeout(function () { item.remove(); }, 4200); }
  function setStatus(text, status) { els.status.textContent = text; els.status.dataset.state = status; }
  function requestId(prefix) {
    var id = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    return String(prefix || "REQ") + "-" + id;
  }
  function semanticTelemetry(payload) {
    var source = payload || {};
    var names = ["mode", "burned_minutes", "program_version", "cfg_1005", "cfg_1006", "cfg_1007", "cfg_1008", "cfg_1009", "cfg_1010", "cfg_1011", "cfg_1012", "cfg_1013", "cfg_1014", "cfg_1015", "cfg_1016", "latitude", "longitude", "purchased_minutes_cache", "cfg_1017", "cfg_1018"];
    var normalized = Object.assign({}, source);
    names.forEach(function (name, index) { if (normalized[name] == null && source["c" + (index + 1)] != null) normalized[name] = source["c" + (index + 1)]; });
    return normalized;
  }
  function publicMacroUrl(pageId) { return "/api/iot-page-macro/" + encodeURIComponent(cfg.fleetIoid) + "/" + encodeURIComponent(pageId); }
  function batchTelemetryUrl(cursor) { var q = new URLSearchParams(); if (state.viewerLeaseId) q.set("lease", state.viewerLeaseId); if (cursor) q.set("cursor", cursor); return "/api/iot-page-batch-telemetry/" + encodeURIComponent(cfg.fleetIoid) + "/" + encodeURIComponent(cfg.fleetViewPageId) + "?" + q; }
  function batchRealtimeUrl() { return "/api/iot-page-batch-realtime/" + encodeURIComponent(cfg.fleetIoid) + "/" + encodeURIComponent(cfg.fleetViewPageId) + "?lease=" + encodeURIComponent(state.viewerLeaseId); }
  function refuelUrl(item) { var base = String(cfg.publicBaseUrl || "https://rosa.technology").replace(/\/+$/, ""); return base + "/iot-page/" + encodeURIComponent(cfg.fleetIoid) + "/" + encodeURIComponent(item.refuel_page_id); }
  async function jsonRequest(url, options) { var response = await fetch(url, Object.assign({ credentials: "same-origin", cache: "no-store" }, options || {})); var data = await response.json().catch(function () { return {}; }); if (!response.ok) throw new Error(data.message || data.error || "Yêu cầu thất bại"); return data; }
  async function runMacro(pageId, macro, params) { var data = await jsonRequest(publicMacroUrl(pageId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ macro: macro, params: params || {} }) }); return Array.isArray(data.rows) ? data.rows : []; }
  function applyBatchDevice(device) { if (!device || !device.ioid) return; state.telemetry[String(device.ioid)] = { serverTime: Number(device.serverTime || 0), payload: semanticTelemetry(device.payload), credentialStatus: String(device.credentialStatus || "pending") }; }
  async function loadBatchTelemetry() { var cursor = 0; var first = true; do { var data = await jsonRequest(batchTelemetryUrl(cursor)); if (first) { state.viewerLeaseId = String(data.viewerLeaseId || state.viewerLeaseId); try { sessionStorage.setItem(leaseStorageKey, state.viewerLeaseId); } catch (_) {} state.generation = String(data.generation || ""); state.telemetry = {}; first = false; } (data.devices || []).forEach(applyBatchDevice); cursor = data.nextCursor == null ? -1 : Number(data.nextCursor); } while (cursor >= 0); }

  function enriched(row) {
    var latest = state.telemetry[String(row.ioid)] || null;
    var payload = latest && latest.payload || {};
    var credentialStatus = String(latest && latest.credentialStatus || "pending");
    var mode = Number(payload.mode == null ? row.stored_mode || 0 : payload.mode);
    var staleAfter = (mode === 0 ? cfg.idleStaleMinutes : cfg.activeStaleMinutes) * 60000;
    var lastReportedAt = Number(latest && latest.serverTime || row.reported_at || 0);
    var stale = credentialStatus !== "accepted" || !lastReportedAt || Date.now() - lastReportedAt > staleAfter;
    var gps = validCoordinates(payload.latitude, payload.longitude);
    var purchased = Number(row.purchased_minutes || 0);
    var burned = Number(row.burned_minutes == null ? payload.burned_minutes || 0 : row.burned_minutes);
    return Object.assign({}, row, {
      mode: mode, stale: stale, credentialStatus: credentialStatus, lastReportedAt: lastReportedAt || null, burnedMinutes: burned,
      purchasedMinutes: purchased, remainingMinutes: Math.max(purchased - burned, 0),
      programVersion: String(payload.program_version || ""),
      latitude: gps ? Number(payload.latitude) : Number(row.latitude), longitude: gps ? Number(payload.longitude) : Number(row.longitude),
      coordinateSource: gps ? "gps" : String(row.coordinate_source || "default"), payload: payload
    });
  }
  function deviceState(item) { return item && item.stale ? "offline" : Number(item && item.mode) > 0 ? "burning" : "online"; }
  function deviceStateLabel(item) { var value = deviceState(item); return value === "offline" ? "Mất kết nối" : value === "burning" ? "Đang đốt" : "Online"; }
  function credentialLabel(value) { return value === "accepted" ? "Đã nhận" : value === "rejected" ? "Sai khóa" : "Chờ thiết bị"; }
  function iconUrl(itemOrState) { var value = typeof itemOrState === "string" ? itemOrState : deviceState(itemOrState); return iconUrls[value] || iconUrls.offline; }

  function renderSummary(items) {
    var active = 0; var stale = 0; var burned = 0; var purchased = 0;
    items.forEach(function (item) { if (item.stale) stale += 1; else if (Number(item.mode) > 0) active += 1; burned += item.burnedMinutes; purchased += item.purchasedMinutes; });
    els.total.textContent = number(state.total); els.active.textContent = number(active); els.stale.textContent = number(stale);
    els.burned.textContent = number(burned); els.purchased.textContent = number(purchased);
  }
  function renderTable(items) {
    els.empty.hidden = items.length > 0;
    els.body.innerHTML = items.map(function (item) {
      var visual = deviceState(item); var modeText = visual === "burning" ? " · " + modeLabel(item.mode) : "";
      return "<tr data-ioid=\"" + esc(item.ioid) + "\"><td><strong>" + esc(item.ioid) + "</strong><small class=\"bb-credential-state\" data-state=\"" + esc(item.credentialStatus) + "\">" + esc(credentialLabel(item.credentialStatus)) + "</small></td>" +
        "<td><strong>" + esc(item.name || "--") + "</strong><small>" + esc(item.location || "--") + "</small></td>" +
        "<td><span class=\"bb-live-pill\" data-state=\"" + visual + "\">" + esc(deviceStateLabel(item) + modeText) + "</span></td>" +
        "<td>" + number(item.burnedMinutes) + "</td><td><strong>" + number(item.purchasedMinutes) + "</strong></td>" +
        "<td>" + number(item.remainingMinutes) + "</td>" +
        "<td>" + esc(dateTime(item.lastReportedAt)) + "</td><td><div class=\"bb-row-actions\"><button class=\"bb-btn\" data-settings=\"" + esc(item.ioid) + "\">Cài đặt</button><button class=\"bb-btn\" data-refuel=\"" + esc(item.ioid) + "\">Nạp</button><button class=\"bb-btn\" data-qr=\"" + esc(item.ioid) + "\">QR</button></div></td></tr>";
    }).join("");
    var pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    els.pageInfo.textContent = "Trang " + state.page + " / " + pages; els.prev.disabled = state.page <= 1; els.next.disabled = state.page >= pages;
  }
  function renderLots() {
    els.lotEmpty.hidden = state.lotRows.length > 0;
    els.lotBody.innerHTML = state.lotRows.map(function (row) {
      var used = !!row.redeemed_at;
      return "<tr><td><code class=\"bb-lot-code\">" + esc(row.code) + "</code></td><td>" + esc(row.description) + "</td><td>" + number(row.purchased_minutes) + "</td><td>" + esc(dateTime(row.created_at)) + "</td><td>" + esc(dateTime(row.redeemed_at)) + "</td><td>" + esc(row.redeemed_ioid || "--") + "</td><td><span class=\"bb-lot-state\" data-state=\"" + (used ? "redeemed" : "unused") + "\">" + (used ? "Đã nạp" : "Chưa nạp") + "</span></td></tr>";
    }).join("");
    var pages = Math.max(1, Math.ceil(state.lotTotal / state.lotPageSize));
    els.lotPageInfo.textContent = "Trang " + state.lotPage + " / " + pages;
    els.lotPrev.disabled = state.lotPage <= 1; els.lotNext.disabled = state.lotPage >= pages;
  }
  function ensureMap() { if (state.map || !window.L) return; state.map = window.L.map(els.map).setView([Number(cfg.mapCenterLat), Number(cfg.mapCenterLng)], Number(cfg.mapZoom)); window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(state.map); state.markers = window.L.markerClusterGroup ? window.L.markerClusterGroup({ chunkedLoading: true }) : window.L.layerGroup(); state.map.addLayer(state.markers); els.mapLoading.hidden = true; }
  function leafletIcon(visual) { if (!window.L) return null; if (!state.mapIcons[visual]) state.mapIcons[visual] = window.L.icon({ iconUrl: iconUrl(visual), iconSize: [52, 52], iconAnchor: [26, 50], popupAnchor: [0, -45] }); return state.mapIcons[visual]; }
  function renderMap(items) {
    ensureMap(); if (!state.map) return; state.markers.clearLayers(); els.mapCount.textContent = items.length + " lò có tọa độ";
    els.mapList.innerHTML = items.slice(0, 100).map(function (item) { var visual = deviceState(item); return "<div class=\"bb-map-item\" data-state=\"" + visual + "\"><img class=\"bb-map-item-icon\" src=\"" + esc(iconUrl(visual)) + "\" alt=\"\"><span class=\"bb-map-item-main\"><strong>" + esc(item.ioid) + "</strong><span>" + esc(item.location || item.name || coordinateSourceLabel(item.coordinateSource)) + "</span></span><span class=\"bb-map-item-state\">" + esc(deviceStateLabel(item)) + "</span></div>"; }).join("");
    items.forEach(function (item) { if (!validCoordinates(item.latitude, item.longitude)) return; var visual = deviceState(item); var marker = window.L.marker([item.latitude, item.longitude], { title: item.ioid, icon: leafletIcon(visual) }); marker.bindPopup("<div class=\"bb-map-popup\"><div class=\"bb-map-popup-head\"><strong>" + esc(item.ioid) + "</strong><span class=\"bb-map-popup-status\" data-state=\"" + visual + "\">" + esc(deviceStateLabel(item)) + "</span></div><div class=\"bb-map-popup-grid\"><span>Đã mua</span><b>" + number(item.purchasedMinutes) + " phút</b><span>Còn lại</span><b>" + number(item.remainingMinutes) + " phút</b></div></div>"); marker._biomassIoid = item.ioid; state.markers.addLayer(marker); });
  }
  function renderAll() { var mapItems = state.mapRows.map(enriched); var listItems = state.listRows.map(enriched); renderSummary(mapItems); renderTable(listItems); renderMap(mapItems); renderLots(); }
  function scheduleLiveRender() { clearTimeout(state.renderTimer); state.renderTimer = setTimeout(renderAll, 200); }
  function fitMap() { var items = state.mapRows.map(enriched).filter(function (item) { return validCoordinates(item.latitude, item.longitude); }); if (!state.map || !items.length) return; state.map.fitBounds(window.L.latLngBounds(items.map(function (item) { return [item.latitude, item.longitude]; })), { padding: [30, 30], maxZoom: 13 }); }
  function findItem(ioid) { var row = state.mapRows.concat(state.listRows).find(function (item) { return String(item.ioid) === String(ioid); }); return row ? enriched(row) : null; }
  function closeStream() { if (state.stream) state.stream.close(); state.stream = null; }
  function connectBatchStream() { if (state.stream || !state.viewerLeaseId || !window.EventSource) return; var stream = new EventSource(batchRealtimeUrl()); state.stream = stream; stream.onmessage = function (event) { try { var data = JSON.parse(event.data); if (data.type === "reset") { state.telemetry = {}; state.generation = String(data.generation || ""); } else if (data.type === "snapshot") { (data.devices || []).forEach(applyBatchDevice); } else if (data.type === "delta" && data.device) { applyBatchDevice(data.device); } else if (data.type === "billing_blocked") { closeStream(); setStatus("Hết hạn mức", "error"); notify("SyncID đã hết hạn mức", true); return; } scheduleLiveRender(); } catch (_) {} }; stream.onerror = function () { if (state.stream === stream) { closeStream(); setTimeout(connectBatchStream, 3000); } }; }
  async function cacheGps(rows) { await Promise.all(rows.map(async function (row) { var latest = state.telemetry[row.ioid]; var payload = latest && latest.payload || {}; if (!validCoordinates(payload.latitude, payload.longitude)) return; if (String(row.coordinate_source) === "gps" && Number(row.latitude) === Number(payload.latitude) && Number(row.longitude) === Number(payload.longitude)) return; try { await runMacro(cfg.fleetAdminPageId, "biomass-fleet-cache-gps", { burner_id: row.ioid, latitude: Number(payload.latitude), longitude: Number(payload.longitude) }); row.latitude = Number(payload.latitude); row.longitude = Number(payload.longitude); row.coordinate_source = "gps"; } catch (_) {} })); }

  async function refresh() {
    if (state.loading) return; state.loading = true; setStatus("Đang tải", "loading");
    try {
      var fleetOffset = (state.page - 1) * state.pageSize;
      var lotOffset = (state.lotPage - 1) * state.lotPageSize;
      var results = await Promise.all([
        runMacro(cfg.fleetViewPageId, "biomass-fleet-summary"),
        runMacro(cfg.fleetViewPageId, "biomass-fleet-list", { search: els.search.value.trim(), page_size: state.pageSize, offset: fleetOffset }),
        runMacro(cfg.fleetViewPageId, "biomass-fleet-map"),
        runMacro(cfg.fleetAdminPageId, "biomass-fuel-lot-list", { search: els.lotSearch.value.trim(), status: els.lotStatus.value, page_size: state.lotPageSize, offset: lotOffset })
      ]);
      state.total = Number(results[0][0] && results[0][0].total || 0);
      state.listRows = results[1] || []; state.mapRows = results[2] || [];
      state.lotRows = (results[3] || []).filter(function (row) { return /^[A-Z0-9]{6}$/.test(String(row.code || "")); });
      state.lotTotal = Number(state.lotRows[0] && state.lotRows[0].total_rows || 0);
      await loadBatchTelemetry();
      await cacheGps(state.mapRows); renderAll();
      connectBatchStream();
      setStatus("Đã cập nhật", "online");
    } catch (error) { setStatus("Không thể tải", "error"); notify(error.message, true); }
    finally { state.loading = false; clearTimeout(state.timer); state.timer = setTimeout(refresh, cfg.refreshMs); }
  }

  function validSettingValue(definition, value) { if (!Number.isInteger(value)) return false; if (Array.isArray(definition.choices)) return definition.choices.includes(value); return value >= definition.minimum && value <= definition.maximum; }
  function settingControl(definition, value) { if (Array.isArray(definition.choices)) return "<select class=\"bb-input\" name=\"value\">" + definition.choices.map(function (choice) { return "<option value=\"" + choice + "\"" + (Number(value) === choice ? " selected" : "") + ">" + choice + "</option>"; }).join("") + "</select>"; return "<input class=\"bb-input\" name=\"value\" type=\"number\" step=\"1\" min=\"" + definition.minimum + "\" max=\"" + definition.maximum + "\" value=\"" + esc(value == null ? "" : value) + "\">"; }
  function settingsMarkup(payload) { var previousGroup = ""; return settingDefinitions.map(function (definition) { var heading = definition.group !== previousGroup ? "<div class=\"bb-setting-group-title\">" + esc(definition.group) + "</div>" : ""; previousGroup = definition.group; var value = payload["cfg_" + definition.key]; return heading + "<form class=\"bb-setting-card\" data-setting-key=\"" + definition.key + "\"><label><span>" + esc(definition.label) + "</span><code>#" + definition.key + "</code></label><div class=\"bb-setting-control\">" + settingControl(definition, value) + "<span>" + definition.unit + "</span><button class=\"bb-btn\" type=\"submit\">Ghi</button></div></form>"; }).join(""); }
  async function openSettings(ioid) { try { var rows = await runMacro(cfg.fleetViewPageId, "biomass-fleet-device", { burner_id: ioid }); if (!rows.length) throw new Error("Không tìm thấy lò"); if (!state.telemetry[ioid]) await loadBatchTelemetry(); var item = enriched(rows[0]); state.current = item; els.settingsTitle.textContent = "Cài đặt " + ioid; els.settingsSubtitle.textContent = deviceStateLabel(item) + (Number(item.mode) > 0 ? " · " + modeLabel(item.mode) : ""); els.coordinateSource.textContent = coordinateSourceLabel(item.coordinateSource); els.creditPurchased.textContent = number(item.purchasedMinutes); els.creditRemaining.textContent = number(item.remainingMinutes); ["name", "location", "latitude", "longitude"].forEach(function (key) { els.deviceForm.elements[key].value = item[key] == null ? "" : item[key]; }); els.deviceForm.elements.api_key.value = ""; els.settingsGrid.innerHTML = settingsMarkup(item.payload); els.settingsState.textContent = item.credentialStatus === "accepted" ? "Đã đọc telemetry" : credentialLabel(item.credentialStatus); showModal(els.settingsModal, true); } catch (error) { notify(error.message, true); } }
  async function waitSetting(ioid, key, expected) { for (var attempt = 0; attempt < 8; attempt += 1) { await new Promise(function (resolve) { setTimeout(resolve, 1000); }); var latest = state.telemetry[ioid]; if (latest && Number(latest.payload["cfg_" + key]) === expected) return true; } return false; }
  async function auditSetting(ioid, key, value, resultState) { try { await runMacro(cfg.fleetAdminPageId, "biomass-setting-audit", { burner_id: ioid, setting_key: key, value: value, state: resultState }); } catch (_) {} }
  function openQr(item) { if (!item) return; var url = refuelUrl(item); els.qrDevice.textContent = item.ioid; els.qrUrl.value = url; if (window.BiomassQr) window.BiomassQr.render(els.qrCode, url, 236); showModal(els.qrModal, true); }
  function downloadCsv(rows) { var lines = ["code,description,purchased_minutes,created_at"].concat(rows.map(function (row) { return [row.code, row.description, row.purchased_minutes, new Date(Number(row.created_at)).toISOString()].map(function (value) { return '"' + String(value).replace(/"/g, '""') + '"'; }).join(","); })); var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }); var link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "lo-nhien-lieu-" + new Date().toISOString().slice(0, 10) + ".csv"; link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000); }

  els.refresh.onclick = refresh;
  els.apply.onclick = function () { state.page = 1; state.pageSize = Number(els.pageSize.value); refresh(); };
  els.prev.onclick = function () { if (state.page > 1) { state.page -= 1; refresh(); } };
  els.next.onclick = function () { if (state.page * state.pageSize < state.total) { state.page += 1; refresh(); } };
  els.mapFit.onclick = fitMap;
  els.addOpen.onclick = function () { els.addForm.reset(); showModal(els.addModal, true); };
  els.addClose.onclick = els.addCancel.onclick = function () { showModal(els.addModal, false); };
  els.settingsClose.onclick = function () { showModal(els.settingsModal, false); };
  els.lotOpen.onclick = els.lotSectionOpen.onclick = function () { els.lotForm.reset(); els.lotForm.elements.minutes_per_lot.value = "300"; els.lotForm.elements.quantity.value = "1"; showModal(els.lotModal, true); };
  els.lotClose.onclick = els.lotCancel.onclick = function () { showModal(els.lotModal, false); };
  els.batchClose.onclick = function () { showModal(els.batchModal, false); };
  els.creditClose.onclick = els.creditCancel.onclick = function () { showModal(els.creditModal, false); };
  els.qrClose.onclick = function () { showModal(els.qrModal, false); };
  els.lotApply.onclick = function () { state.lotPage = 1; refresh(); };
  els.lotPrev.onclick = function () { if (state.lotPage > 1) { state.lotPage -= 1; refresh(); } };
  els.lotNext.onclick = function () { if (state.lotPage * state.lotPageSize < state.lotTotal) { state.lotPage += 1; refresh(); } };
  els.creditEdit.onclick = function () { if (!state.current) return; els.creditValue.value = String(state.current.purchasedMinutes); showModal(els.creditModal, true); els.creditValue.focus(); els.creditValue.select(); };
  els.openRefuel.onclick = function () { if (state.current) window.open(refuelUrl(state.current), "_blank", "noopener"); };
  els.showQr.onclick = function () { openQr(state.current); };
  els.qrCopy.onclick = async function () { try { await navigator.clipboard.writeText(els.qrUrl.value); notify("Đã sao chép URL"); } catch (_) { els.qrUrl.select(); document.execCommand("copy"); notify("Đã sao chép URL"); } };
  els.qrPrint.onclick = function () { var popup = window.open("", "_blank"); if (!popup) { notify("Trình duyệt đã chặn cửa sổ in", true); return; } popup.document.write("<!doctype html><title>QR " + esc(els.qrDevice.textContent) + "</title><style>body{font-family:system-ui;text-align:center;padding:28px}svg{width:320px;height:320px}h1{font-size:24px}</style><h1>" + esc(els.qrDevice.textContent) + "</h1>" + els.qrCode.innerHTML + "<p>Quét để nạp nhiên liệu</p><script>onload=function(){print()}<\/script>"); popup.document.close(); };
  els.batchCopy.onclick = async function () { try { await navigator.clipboard.writeText(els.batchCodes.value); notify("Đã sao chép mã"); } catch (_) { els.batchCodes.select(); document.execCommand("copy"); notify("Đã sao chép mã"); } };
  els.batchCsv.onclick = function () { downloadCsv(state.batchRows); };

  els.addForm.onsubmit = async function (event) { event.preventDefault(); var form = new FormData(els.addForm); var params = { burner_id: String(form.get("ioid") || "").trim(), api_key: String(form.get("api_key") || "").trim(), name: String(form.get("name") || "").trim(), location: String(form.get("location") || "").trim() }; if (String(form.get("latitude") || "").trim() && String(form.get("longitude") || "").trim()) { params.latitude = Number(form.get("latitude")); params.longitude = Number(form.get("longitude")); } try { await runMacro(cfg.fleetAdminPageId, "biomass-fleet-create", params); showModal(els.addModal, false); notify("Đã thêm lò và trang nạp"); refresh(); } catch (error) { notify(error.message, true); } };
  els.lotForm.onsubmit = async function (event) { event.preventDefault(); var form = new FormData(els.lotForm); var params = { client_request_id: requestId("BATCH"), description: String(form.get("description") || "").trim(), minutes_per_lot: Number(form.get("minutes_per_lot")), quantity: Number(form.get("quantity")) }; var button = els.lotForm.querySelector("button[type=submit]"); button.disabled = true; try { var rows = await runMacro(cfg.fleetAdminPageId, "biomass-fuel-lot-create-batch", params); if (!rows.length || rows.some(function (row) { return row.status !== "OK"; })) throw new Error("Không thể tạo đủ mã cho lô"); if (rows.length !== params.quantity) throw new Error("Số mã trả về không đúng yêu cầu"); state.batchRows = rows; els.batchSummary.textContent = rows.length + " mã · " + number(params.minutes_per_lot) + " phút/mã"; els.batchCodes.value = rows.map(function (row) { return row.code; }).join("\n"); showModal(els.lotModal, false); showModal(els.batchModal, true); state.lotPage = 1; notify("Đã tạo " + rows.length + " mã"); refresh(); } catch (error) { notify(error.message, true); } finally { button.disabled = false; } };
  els.creditForm.onsubmit = async function (event) { event.preventDefault(); if (!state.current) return; var value = Number(els.creditValue.value); if (!Number.isInteger(value) || value < 0 || value > 2147483647) { notify("Giá trị phút không hợp lệ", true); return; } if (!confirm("Đặt phút đã mua của " + state.current.ioid + " thành " + number(value) + "?")) return; try { var rows = await runMacro(cfg.fleetAdminPageId, "biomass-purchased-minutes-set", { burner_id: state.current.ioid, purchased_minutes: value }); if (!rows[0] || rows[0].status !== "OK") throw new Error("Không tìm thấy lò"); showModal(els.creditModal, false); notify("Đã cập nhật phút mua"); await openSettings(state.current.ioid); refresh(); } catch (error) { notify(error.message, true); } };
  els.deviceForm.onsubmit = async function (event) { event.preventDefault(); if (!state.current) return; var form = new FormData(els.deviceForm); try { await runMacro(cfg.fleetAdminPageId, "biomass-fleet-update", { burner_id: state.current.ioid, api_key: String(form.get("api_key") || "").trim(), name: String(form.get("name") || "").trim(), location: String(form.get("location") || "").trim(), latitude: Number(form.get("latitude")), longitude: Number(form.get("longitude")) }); notify("Đã lưu"); await loadBatchTelemetry(); await openSettings(state.current.ioid); refresh(); } catch (error) { notify(error.message, true); } };
  els.settingsGrid.onsubmit = async function (event) { event.preventDefault(); var form = event.target.closest("[data-setting-key]"); if (!form || !state.current) return; var key = form.dataset.settingKey; var definition = settingDefinitions.find(function (item) { return item.key === key; }); var value = Number(form.elements.value.value); if (!definition || !validSettingValue(definition, value)) { notify("Giá trị không hợp lệ", true); return; } var button = form.querySelector("button"); button.disabled = true; els.settingsState.textContent = "Đang ghi"; try { await jsonRequest("/api/iot-cmd/" + encodeURIComponent(state.current.ioid) + "/biomass-set-" + key, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: value }) }); var matched = await waitSetting(state.current.ioid, key, value); if (!matched) throw new Error("Chưa nhận được telemetry đọc lại"); await auditSetting(state.current.ioid, key, value, "confirmed"); els.settingsState.textContent = "Đã đọc lại"; notify("Đã cập nhật #" + key); scheduleLiveRender(); } catch (error) { await auditSetting(state.current.ioid, key, value, "failed"); els.settingsState.textContent = "Ghi lỗi"; notify(error.message, true); } finally { button.disabled = false; } };
  els.deleteBurner.onclick = async function () { if (!state.current || !confirm("Xóa " + state.current.ioid + "?")) return; try { await runMacro(cfg.fleetAdminPageId, "biomass-fleet-delete", { burner_id: state.current.ioid }); showModal(els.settingsModal, false); notify("Đã xóa lò"); state.current = null; refresh(); } catch (error) { notify(error.message, true); } };
  document.addEventListener("click", function (event) { var settings = event.target.closest("[data-settings]"); if (settings) openSettings(settings.dataset.settings); var refuel = event.target.closest("[data-refuel]"); if (refuel) { var refuelItem = findItem(refuel.dataset.refuel); if (refuelItem) window.open(refuelUrl(refuelItem), "_blank", "noopener"); } var qr = event.target.closest("[data-qr]"); if (qr) openQr(findItem(qr.dataset.qr)); });
  window.addEventListener("beforeunload", function () { clearTimeout(state.timer); clearTimeout(state.renderTimer); closeStream(); });
  document.querySelectorAll("[data-burner-icon]").forEach(function (image) { image.src = iconUrl(image.dataset.burnerIcon); });
  refresh();
})();
