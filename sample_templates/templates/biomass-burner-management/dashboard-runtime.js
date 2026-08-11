(function () {
  "use strict";

  /*
   * TEMPLATE PLATFORM INVARIANT
   * This runtime may only use standard ROSA capabilities: public IoT page
   * telemetry/realtime/macros and iot-cmd/system_cmds. Never add a biomass
   * API namespace, manager, c1 action, auth path or billing path to ROSA core.
   */
  var node = document.getElementById("biomass-burner-config");
  var runtimeScript = document.currentScript;
  var assetBase = runtimeScript && runtimeScript.src ? new URL(".", runtimeScript.src).href : "";
  var iconUrls = {
    offline: assetBase + "burner-offline.png",
    online: assetBase + "burner-online.png",
    burning: assetBase + "burner-burning.png"
  };
  var settingDefinitions = [
    { key: "1005", label: "Điện trở mồi", minimum: 30, maximum: 180, unit: "s" },
    { key: "1006", label: "Quạt mồi", minimum: 30, maximum: 300, unit: "s" },
    { key: "1007", label: "Lớn - sơ cấp", minimum: 30, maximum: 100, unit: "%" },
    { key: "1008", label: "Lớn - thứ cấp", minimum: 30, maximum: 100, unit: "%" },
    { key: "1009", label: "Vừa - sơ cấp", minimum: 30, maximum: 100, unit: "%" },
    { key: "1010", label: "Khởi động - thứ cấp", minimum: 30, maximum: 100, unit: "%" },
    { key: "1011", label: "Vừa - thứ cấp", minimum: 30, maximum: 100, unit: "%" },
    { key: "1012", label: "Nhỏ - sơ cấp", minimum: 30, maximum: 100, unit: "%" },
    { key: "1013", label: "Nhỏ - thứ cấp", minimum: 30, maximum: 100, unit: "%" }
  ];
  var cfg = {
    title: "Quản lý lò sinh khối", subtitle: "", fleetIoid: "", pageSize: 50, refreshMs: 60000,
    fleetViewPageId: "biomass-fleet-view", fleetAdminPageId: "biomass-fleet-admin",
    deviceStatusPageId: "biomass-status", mapCenterLat: 21.35, mapCenterLng: 105.72, mapZoom: 8
  };
  try { cfg = Object.assign(cfg, JSON.parse(node && node.textContent || "{}")); } catch (_) {}
  var query = new URLSearchParams(location.search);
  cfg.fleetIoid = String(query.get("ioid") || cfg.fleetIoid || "").trim();
  cfg.refreshMs = Math.max(60000, Number(cfg.refreshMs) || 60000);

  var $ = function (id) { return document.getElementById(id); };
  var els = { title: $("bb-title"), subtitle: $("bb-subtitle"), status: $("bb-status"), refresh: $("bb-refresh"), settingsOpen: $("bb-settings-open"), addOpen: $("bb-add-open"), addModal: $("bb-add-modal"), addForm: $("bb-add-form"), addClose: $("bb-add-close"), addCancel: $("bb-add-cancel"), search: $("bb-search"), pageSize: $("bb-page-size"), apply: $("bb-apply-filter"), body: $("bb-table-body"), empty: $("bb-empty"), prev: $("bb-prev"), next: $("bb-next"), pageInfo: $("bb-page-info"), total: $("bb-kpi-total"), active: $("bb-kpi-active"), stale: $("bb-kpi-stale"), burned: $("bb-kpi-burned"), map: $("bb-map"), mapLoading: $("bb-map-loading"), mapFit: $("bb-map-fit"), mapList: $("bb-map-list"), mapCount: $("bb-map-count"), settingsModal: $("bb-settings-modal"), settingsTitle: $("bb-settings-title"), settingsSubtitle: $("bb-settings-subtitle"), settingsClose: $("bb-settings-close"), coordinateSource: $("bb-coordinate-source"), deviceForm: $("bb-device-form"), settingsGrid: $("bb-settings-grid"), settingsState: $("bb-settings-read-state"), deleteBurner: $("bb-delete-burner"), toast: $("bb-toast-stack") };
  var state = { page: 1, pageSize: Math.max(1, Number(cfg.pageSize) || 50), total: 0, loading: false, timer: 0, renderTimer: 0, current: null, listRows: [], mapRows: [], telemetry: {}, map: null, markers: null, mapIcons: {}, streams: {}, temperatureEnabled: false };
  els.title.textContent = cfg.title; els.subtitle.textContent = cfg.subtitle; els.pageSize.value = String(state.pageSize);

  function esc(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function number(value) { return Number(value || 0).toLocaleString("vi-VN"); }
  function modeLabel(mode) { return ["OFF", "START", "HIGH", "MEDIUM", "LOW"][Number(mode)] || "OFF"; }
  function dateTime(value) { return value ? new Date(Number(value)).toLocaleString("vi-VN") : "--"; }
  function coordinateSourceLabel(source) { return source === "gps" ? "GPS" : source === "manual" ? "Thủ công" : "Mặc định"; }
  function validCoordinates(lat, lng) { return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && Number(lat) >= -90 && Number(lat) <= 90 && Number(lng) >= -180 && Number(lng) <= 180 && !(Number(lat) === 0 && Number(lng) === 0); }
  function showModal(modal, visible) { modal.setAttribute("aria-hidden", visible ? "false" : "true"); modal.classList.toggle("is-open", visible); }
  function notify(message, error) { var item = document.createElement("div"); item.className = "bb-toast" + (error ? " is-error" : ""); item.textContent = message; els.toast.appendChild(item); setTimeout(function () { item.remove(); }, 4000); }
  function setStatus(text, status) { els.status.textContent = text; els.status.dataset.state = status; }
  function semanticTelemetry(payload) {
    var source = payload || {};
    var names = ["mode", "burned_minutes", "primary_fan_pct", "secondary_fan_pct", "temperature", "program_version", "cfg_1005", "cfg_1006", "cfg_1007", "cfg_1008", "cfg_1009", "cfg_1010", "cfg_1011", "cfg_1012", "cfg_1013", "latitude", "longitude"];
    var normalized = Object.assign({}, source);
    names.forEach(function (name, index) { if (normalized[name] == null && source["c" + (index + 1)] != null) normalized[name] = source["c" + (index + 1)]; });
    return normalized;
  }
  function publicMacroUrl(pageId) { return "/api/iot-page-macro/" + encodeURIComponent(cfg.fleetIoid) + "/" + encodeURIComponent(pageId); }
  function telemetryUrl(ioid) { return "/api/iot-page-telemetry/" + encodeURIComponent(ioid) + "/" + encodeURIComponent(cfg.deviceStatusPageId); }
  function realtimeUrl(ioid) { return "/api/iot-page-realtime/" + encodeURIComponent(ioid) + "/" + encodeURIComponent(cfg.deviceStatusPageId) + "?historyMs=0"; }
  async function jsonRequest(url, options) { var response = await fetch(url, Object.assign({ credentials: "same-origin", cache: "no-store" }, options || {})); var data = await response.json().catch(function () { return {}; }); if (!response.ok) throw new Error(data.message || data.error || "Yêu cầu thất bại"); return data; }
  async function runMacro(pageId, macro, params) { var data = await jsonRequest(publicMacroUrl(pageId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ macro: macro, params: params || {} }) }); return Array.isArray(data.rows) ? data.rows : []; }
  async function readTelemetry(ioid) { try { var data = await jsonRequest(telemetryUrl(ioid)); return data && data.c2 ? { serverTime: Number(data.c2.serverTime || 0), payload: semanticTelemetry(data.c2.payload) } : null; } catch (_) { return null; } }
  async function mapLimit(items, limit, worker) { var cursor = 0; async function run() { while (cursor < items.length) { var index = cursor++; await worker(items[index], index); } } await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run)); }
  function enriched(row) {
    var latest = state.telemetry[String(row.ioid)] || null;
    var payload = latest && latest.payload || {};
    var mode = Number(payload.mode || 0);
    var staleAfter = mode === 0 ? 60 * 60000 : 20 * 60000;
    var lastReportedAt = Number(latest && latest.serverTime || 0);
    var stale = !lastReportedAt || Date.now() - lastReportedAt > staleAfter;
    var gps = validCoordinates(payload.latitude, payload.longitude);
    return Object.assign({}, row, {
      mode: mode, stale: stale, lastReportedAt: lastReportedAt || null,
      burnedMinutes: Number(payload.burned_minutes || 0), primaryFanPct: Number(payload.primary_fan_pct || 30), secondaryFanPct: Number(payload.secondary_fan_pct || 30),
      temperature: payload.temperature == null || payload.temperature === "" ? null : Number(payload.temperature), programVersion: String(payload.program_version || ""),
      latitude: gps ? Number(payload.latitude) : Number(row.latitude), longitude: gps ? Number(payload.longitude) : Number(row.longitude), coordinateSource: gps ? "gps" : String(row.coordinate_source || "default"), payload: payload
    });
  }
  function deviceState(item) { return item && item.stale ? "offline" : Number(item && item.mode) > 0 ? "burning" : "online"; }
  function deviceStateLabel(item) { var value = deviceState(item); return value === "offline" ? "Mất kết nối" : value === "burning" ? "Đang đốt" : "Online"; }
  function iconUrl(itemOrState) { var value = typeof itemOrState === "string" ? itemOrState : deviceState(itemOrState); return iconUrls[value] || iconUrls.offline; }

  function renderSummary(items) { var active = 0; var stale = 0; var burned = 0; items.forEach(function (item) { if (item.stale) stale += 1; else if (Number(item.mode) > 0) active += 1; burned += Number(item.burnedMinutes || 0); }); els.total.textContent = number(state.total); els.active.textContent = number(active); els.stale.textContent = number(stale); els.burned.textContent = number(burned); }
  function renderTemperatureCapability(items) { state.temperatureEnabled = items.some(function (item) { return item.temperature != null && Number.isFinite(Number(item.temperature)); }); document.querySelectorAll(".bb-temperature-column").forEach(function (cell) { cell.hidden = !state.temperatureEnabled; }); }
  function renderTable(items) { els.empty.hidden = items.length > 0; els.body.innerHTML = items.map(function (item) { var visual = deviceState(item); var modeText = visual === "burning" ? " · " + modeLabel(item.mode) : ""; return "<tr data-ioid=\"" + esc(item.ioid) + "\" data-row-state=\"" + visual + "\"><td><strong>" + esc(item.ioid) + "</strong><small>" + esc(item.programVersion || "--") + "</small></td><td><strong>" + esc(item.name || "--") + "</strong><small>" + esc(item.location || "--") + "</small></td><td><span class=\"bb-live-pill\" data-state=\"" + visual + "\">" + esc(deviceStateLabel(item) + modeText) + "</span></td><td>" + number(item.burnedMinutes) + "</td><td>" + number(item.primaryFanPct) + "%</td><td>" + number(item.secondaryFanPct) + "%</td>" + (state.temperatureEnabled ? "<td class=\"bb-temperature-column\">" + (item.temperature == null ? "--" : esc(item.temperature) + " °C") + "</td>" : "") + "<td>" + esc(dateTime(item.lastReportedAt)) + "</td><td><button class=\"bb-btn\" data-settings=\"" + esc(item.ioid) + "\">Cài đặt</button></td></tr>"; }).join(""); var pages = Math.max(1, Math.ceil(state.total / state.pageSize)); els.pageInfo.textContent = "Trang " + state.page + " / " + pages; els.prev.disabled = state.page <= 1; els.next.disabled = state.page >= pages; }
  function ensureMap() { if (state.map || !window.L) return; state.map = window.L.map(els.map).setView([Number(cfg.mapCenterLat), Number(cfg.mapCenterLng)], Number(cfg.mapZoom)); window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(state.map); state.markers = window.L.markerClusterGroup ? window.L.markerClusterGroup({ chunkedLoading: true }) : window.L.layerGroup(); state.map.addLayer(state.markers); els.mapLoading.hidden = true; }
  function leafletIcon(visual) { if (!window.L) return null; if (!state.mapIcons[visual]) state.mapIcons[visual] = window.L.icon({ iconUrl: iconUrl(visual), iconSize: [52, 52], iconAnchor: [26, 50], popupAnchor: [0, -45] }); return state.mapIcons[visual]; }
  function renderMap(items) { ensureMap(); if (!state.map) return; state.markers.clearLayers(); els.mapCount.textContent = items.length + " lò có tọa độ"; els.mapList.innerHTML = items.slice(0, 100).map(function (item) { var visual = deviceState(item); return "<button class=\"bb-map-item\" data-state=\"" + visual + "\" data-map-ioid=\"" + esc(item.ioid) + "\"><img class=\"bb-map-item-icon\" src=\"" + esc(iconUrl(visual)) + "\" alt=\"\"><span class=\"bb-map-item-main\"><strong>" + esc(item.ioid) + "</strong><span>" + esc(item.location || item.name || coordinateSourceLabel(item.coordinateSource)) + "</span></span><span class=\"bb-map-item-state\">" + esc(deviceStateLabel(item)) + "</span></button>"; }).join(""); items.forEach(function (item) { if (!validCoordinates(item.latitude, item.longitude)) return; var visual = deviceState(item); var marker = window.L.marker([item.latitude, item.longitude], { title: item.ioid, icon: leafletIcon(visual) }); marker.bindPopup("<div class=\"bb-map-popup\"><div class=\"bb-map-popup-head\"><strong>" + esc(item.ioid) + "</strong><span class=\"bb-map-popup-status\" data-state=\"" + visual + "\">" + esc(deviceStateLabel(item)) + "</span></div><div class=\"bb-map-popup-grid\"><span>Chế độ</span><b>" + esc(modeLabel(item.mode)) + "</b><span>Tọa độ</span><b>" + esc(coordinateSourceLabel(item.coordinateSource)) + "</b></div><button class=\"bb-btn\" data-settings=\"" + esc(item.ioid) + "\">Cài đặt</button></div>"); marker._biomassIoid = item.ioid; state.markers.addLayer(marker); }); }
  function renderAll() { var mapItems = state.mapRows.map(enriched); var listItems = state.listRows.map(enriched); renderTemperatureCapability(mapItems); renderSummary(mapItems); renderTable(listItems); renderMap(mapItems); }
  function scheduleLiveRender() { clearTimeout(state.renderTimer); state.renderTimer = setTimeout(renderAll, 200); }
  function fitMap() { var items = state.mapRows.map(enriched).filter(function (item) { return validCoordinates(item.latitude, item.longitude); }); if (!state.map || !items.length) return; state.map.fitBounds(window.L.latLngBounds(items.map(function (item) { return [item.latitude, item.longitude]; })), { padding: [30, 30], maxZoom: 13 }); }

  function closeStreams() { Object.keys(state.streams).forEach(function (ioid) { state.streams[ioid].close(); delete state.streams[ioid]; }); }
  function syncStreams(ioids) { var wanted = new Set(ioids); Object.keys(state.streams).forEach(function (ioid) { if (!wanted.has(ioid)) { state.streams[ioid].close(); delete state.streams[ioid]; } }); ioids.forEach(function (ioid) { if (state.streams[ioid] || !window.EventSource) return; var stream = new EventSource(realtimeUrl(ioid)); stream.onmessage = function (event) { try { var data = JSON.parse(event.data); if (data.type === "telemetry" && data.payload) { state.telemetry[ioid] = { serverTime: Number(data.serverTime || Date.now()), payload: semanticTelemetry(Object.assign({}, state.telemetry[ioid] && state.telemetry[ioid].payload || {}, data.payload)) }; scheduleLiveRender(); } } catch (_) {} }; state.streams[ioid] = stream; }); }
  async function cacheGps(rows) { await Promise.all(rows.map(async function (row) { var latest = state.telemetry[row.ioid]; var payload = latest && latest.payload || {}; if (!validCoordinates(payload.latitude, payload.longitude)) return; if (String(row.coordinate_source) === "gps" && Number(row.latitude) === Number(payload.latitude) && Number(row.longitude) === Number(payload.longitude)) return; try { await runMacro(cfg.fleetAdminPageId, "biomass-fleet-cache-gps", { burner_id: row.ioid, latitude: Number(payload.latitude), longitude: Number(payload.longitude) }); row.latitude = Number(payload.latitude); row.longitude = Number(payload.longitude); row.coordinate_source = "gps"; } catch (_) {} })); }
  async function refresh() { if (state.loading) return; state.loading = true; setStatus("Đang tải", "loading"); try { var offset = (state.page - 1) * state.pageSize; var results = await Promise.all([runMacro(cfg.fleetViewPageId, "biomass-fleet-summary"), runMacro(cfg.fleetViewPageId, "biomass-fleet-list", { search: els.search.value.trim(), page_size: state.pageSize, offset: offset }), runMacro(cfg.fleetViewPageId, "biomass-fleet-map")]); state.total = Number(results[0][0] && results[0][0].total || 0); state.listRows = results[1] || []; state.mapRows = results[2] || []; var ioids = state.mapRows.map(function (row) { return String(row.ioid); }); await mapLimit(ioids, 6, async function (ioid) { state.telemetry[ioid] = await readTelemetry(ioid); }); await cacheGps(state.mapRows); renderAll(); syncStreams(state.listRows.slice(0, 50).map(function (row) { return String(row.ioid); })); setStatus("Đã cập nhật", "online"); } catch (error) { setStatus("Không thể tải", "error"); notify(error.message, true); } finally { state.loading = false; clearTimeout(state.timer); state.timer = setTimeout(refresh, cfg.refreshMs); } }

  async function openSettings(ioid) { try { var results = await Promise.all([runMacro(cfg.fleetViewPageId, "biomass-fleet-device", { burner_id: ioid }), readTelemetry(ioid)]); var rows = results[0]; if (!rows.length) throw new Error("Không tìm thấy lò"); if (results[1]) state.telemetry[ioid] = results[1]; var item = enriched(rows[0]); state.current = item; els.settingsTitle.textContent = "Cài đặt " + ioid; els.settingsSubtitle.textContent = deviceStateLabel(item) + (Number(item.mode) > 0 ? " · " + modeLabel(item.mode) : ""); els.coordinateSource.textContent = coordinateSourceLabel(item.coordinateSource); ["name", "location", "latitude", "longitude"].forEach(function (key) { els.deviceForm.elements[key].value = item[key] == null ? "" : item[key]; }); els.settingsGrid.innerHTML = settingDefinitions.map(function (definition) { var value = item.payload["cfg_" + definition.key]; return "<form class=\"bb-setting-card\" data-setting-key=\"" + definition.key + "\"><label><span>" + esc(definition.label) + "</span><code>#" + definition.key + "</code></label><div class=\"bb-setting-control\"><input class=\"bb-input\" name=\"value\" type=\"number\" min=\"" + definition.minimum + "\" max=\"" + definition.maximum + "\" value=\"" + esc(value == null ? "" : value) + "\"><span>" + definition.unit + "</span><button class=\"bb-btn\" type=\"submit\">Ghi</button></div></form>"; }).join(""); els.settingsState.textContent = results[1] ? "Đã đọc telemetry" : "Chưa có telemetry"; showModal(els.settingsModal, true); } catch (error) { notify(error.message, true); } }
  async function waitSetting(ioid, key, expected) { for (var attempt = 0; attempt < 8; attempt += 1) { await new Promise(function (resolve) { setTimeout(resolve, 1000); }); var latest = await readTelemetry(ioid); if (latest) state.telemetry[ioid] = latest; if (latest && Number(latest.payload["cfg_" + key]) === expected) return true; } return false; }
  async function auditSetting(ioid, key, value, resultState) { try { await runMacro(cfg.fleetAdminPageId, "biomass-setting-audit", { burner_id: ioid, setting_key: key, value: value, state: resultState }); } catch (_) {} }

  els.refresh.onclick = refresh;
  els.settingsOpen.onclick = function () { var target = state.current && state.current.ioid || (state.listRows.length === 1 ? state.listRows[0].ioid : ""); if (target) openSettings(target); else notify("Chọn lò trong danh sách", true); };
  els.apply.onclick = function () { state.page = 1; state.pageSize = Number(els.pageSize.value); refresh(); };
  els.prev.onclick = function () { if (state.page > 1) { state.page -= 1; refresh(); } };
  els.next.onclick = function () { if (state.page * state.pageSize < state.total) { state.page += 1; refresh(); } };
  els.mapFit.onclick = fitMap;
  els.addOpen.onclick = function () { els.addForm.reset(); showModal(els.addModal, true); };
  els.addClose.onclick = els.addCancel.onclick = function () { showModal(els.addModal, false); };
  els.settingsClose.onclick = function () { showModal(els.settingsModal, false); };
  els.addForm.onsubmit = async function (event) { event.preventDefault(); var form = new FormData(els.addForm); var params = { burner_id: String(form.get("ioid") || "").trim(), name: String(form.get("name") || "").trim(), location: String(form.get("location") || "").trim() }; if (String(form.get("latitude") || "").trim() && String(form.get("longitude") || "").trim()) { params.latitude = Number(form.get("latitude")); params.longitude = Number(form.get("longitude")); } try { await runMacro(cfg.fleetAdminPageId, "biomass-fleet-create", params); showModal(els.addModal, false); notify("Đã thêm lò"); refresh(); } catch (error) { notify(error.message, true); } };
  document.addEventListener("click", function (event) { var button = event.target.closest("[data-settings]"); if (button) openSettings(button.dataset.settings); });
  els.mapList.onclick = function (event) { var button = event.target.closest("[data-map-ioid]"); if (button) openSettings(button.dataset.mapIoid); };
  els.deviceForm.onsubmit = async function (event) { event.preventDefault(); if (!state.current) return; var form = new FormData(els.deviceForm); try { await runMacro(cfg.fleetAdminPageId, "biomass-fleet-update", { burner_id: state.current.ioid, name: String(form.get("name") || "").trim(), location: String(form.get("location") || "").trim(), latitude: Number(form.get("latitude")), longitude: Number(form.get("longitude")) }); notify("Đã lưu"); await openSettings(state.current.ioid); refresh(); } catch (error) { notify(error.message, true); } };
  els.settingsGrid.onsubmit = async function (event) { event.preventDefault(); var form = event.target.closest("[data-setting-key]"); if (!form || !state.current) return; var key = form.dataset.settingKey; var definition = settingDefinitions.find(function (item) { return item.key === key; }); var value = Number(form.elements.value.value); if (!definition || !Number.isInteger(value) || value < definition.minimum || value > definition.maximum) { notify("Giá trị không hợp lệ", true); return; } var button = form.querySelector("button"); button.disabled = true; els.settingsState.textContent = "Đang ghi"; try { await jsonRequest("/api/iot-cmd/" + encodeURIComponent(state.current.ioid) + "/biomass-set-" + key, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: value }) }); var matched = await waitSetting(state.current.ioid, key, value); if (!matched) throw new Error("Chưa nhận được telemetry đọc lại"); await auditSetting(state.current.ioid, key, value, "confirmed"); els.settingsState.textContent = "Đã đọc lại"; notify("Đã cập nhật #" + key); scheduleLiveRender(); } catch (error) { await auditSetting(state.current.ioid, key, value, "failed"); els.settingsState.textContent = "Ghi lỗi"; notify(error.message, true); } finally { button.disabled = false; } };
  els.deleteBurner.onclick = async function () { if (!state.current || !confirm("Xóa " + state.current.ioid + "?")) return; try { await runMacro(cfg.fleetAdminPageId, "biomass-fleet-delete", { burner_id: state.current.ioid }); showModal(els.settingsModal, false); notify("Đã xóa lò"); refresh(); } catch (error) { notify(error.message, true); } };
  window.addEventListener("beforeunload", function () { clearTimeout(state.timer); clearTimeout(state.renderTimer); closeStreams(); });
  document.querySelectorAll("[data-burner-icon]").forEach(function (image) { image.src = iconUrl(image.dataset.burnerIcon); });
  refresh();
})();
