(function () {
  "use strict";
  var node = document.getElementById("biomass-burner-config");
  var cfg = { title: "Quản lý lò sinh khối", subtitle: "", fleetIoid: "", syncId: "", pageSize: 50, refreshMs: 60000, mapCenterLat: 21.35, mapCenterLng: 105.72, mapZoom: 8 };
  try { cfg = Object.assign(cfg, JSON.parse(node && node.textContent || "{}")); } catch (_) {}
  var query = new URLSearchParams(location.search);
  cfg.fleetIoid = String(query.get("ioid") || cfg.fleetIoid || "").trim();
  cfg.syncId = String(query.get("syncId") || query.get("syncid") || cfg.syncId || "").trim();
  cfg.refreshMs = Math.max(60000, Number(cfg.refreshMs) || 60000);

  var $ = function (id) { return document.getElementById(id); };
  var els = { title: $("bb-title"), subtitle: $("bb-subtitle"), status: $("bb-status"), refresh: $("bb-refresh"), settingsOpen: $("bb-settings-open"), addOpen: $("bb-add-open"), addModal: $("bb-add-modal"), addForm: $("bb-add-form"), addClose: $("bb-add-close"), addCancel: $("bb-add-cancel"), search: $("bb-search"), pageSize: $("bb-page-size"), apply: $("bb-apply-filter"), body: $("bb-table-body"), empty: $("bb-empty"), prev: $("bb-prev"), next: $("bb-next"), pageInfo: $("bb-page-info"), total: $("bb-kpi-total"), active: $("bb-kpi-active"), stale: $("bb-kpi-stale"), burned: $("bb-kpi-burned"), map: $("bb-map"), mapLoading: $("bb-map-loading"), mapFit: $("bb-map-fit"), mapList: $("bb-map-list"), mapCount: $("bb-map-count"), settingsModal: $("bb-settings-modal"), settingsTitle: $("bb-settings-title"), settingsSubtitle: $("bb-settings-subtitle"), settingsClose: $("bb-settings-close"), coordinateSource: $("bb-coordinate-source"), deviceForm: $("bb-device-form"), settingsGrid: $("bb-settings-grid"), settingsState: $("bb-settings-read-state"), deleteBurner: $("bb-delete-burner"), toast: $("bb-toast-stack") };
  var state = { page: 1, pageSize: Math.max(1, Number(cfg.pageSize) || 50), total: 0, loading: false, timer: 0, current: null, visibleItems: [], definitions: [], map: null, markers: null, mapItems: [], temperatureEnabled: false };
  els.title.textContent = cfg.title;
  els.subtitle.textContent = cfg.subtitle;
  els.pageSize.value = String(state.pageSize);

  function esc(value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function number(value) { return Number(value || 0).toLocaleString("vi-VN"); }
  function modeLabel(mode) { return ["OFF", "START", "HIGH", "MEDIUM", "LOW"][Number(mode)] || "OFF"; }
  function coordinateSourceLabel(source) { return source === "gps" ? "GPS" : source === "manual" ? "Thủ công" : "Mặc định"; }
  function dateTime(value) { if (!value) return "--"; return new Date(Number(value)).toLocaleString("vi-VN"); }
  function showModal(modal, visible) { modal.setAttribute("aria-hidden", visible ? "false" : "true"); modal.classList.toggle("is-open", visible); }
  function notify(message, error) { var item = document.createElement("div"); item.className = "bb-toast" + (error ? " is-error" : ""); item.textContent = message; els.toast.appendChild(item); setTimeout(function () { item.remove(); }, 4000); }
  function baseUrl() { return "/api/biomass-fleets/" + encodeURIComponent(cfg.fleetIoid) + "/" + encodeURIComponent(cfg.syncId); }
  async function api(url, options) { var response = await fetch(url, Object.assign({ credentials: "same-origin", headers: { "Content-Type": "application/json" } }, options || {})); var data = await response.json().catch(function () { return {}; }); if (!response.ok || !data.ok) throw new Error(data.message || "Yêu cầu thất bại"); return data; }

  function setStatus(text, status) { els.status.textContent = text; els.status.dataset.state = status; }
  function renderSummary(summary) { els.total.textContent = number(summary.total); els.active.textContent = number(summary.active); els.stale.textContent = number(summary.stale); els.burned.textContent = number(summary.burnedMinutes); }
  function renderTemperatureCapability(enabled) { state.temperatureEnabled = enabled; document.querySelectorAll(".bb-temperature-column").forEach(function (cell) { cell.hidden = !enabled; }); }
  function renderTable(items) {
    els.empty.hidden = items.length > 0;
    els.body.innerHTML = items.map(function (item) {
      return "<tr data-ioid=\"" + esc(item.ioid) + "\"><td><strong>" + esc(item.ioid) + "</strong><small>" + esc(item.programVersion || "--") + "</small></td><td><strong>" + esc(item.name || "--") + "</strong><small>" + esc(item.location || "--") + "</small></td><td><span class=\"bb-live-pill\" data-state=\"" + (item.stale ? "unknown" : Number(item.mode) ? "on" : "off") + "\">" + (item.stale ? "MẤT KẾT NỐI" : modeLabel(item.mode)) + "</span></td><td>" + number(item.burnedMinutes) + "</td><td>" + number(item.primaryFanPct) + "%</td><td>" + number(item.secondaryFanPct) + "%</td>" + (state.temperatureEnabled ? "<td class=\"bb-temperature-column\">" + (item.temperature == null ? "--" : esc(item.temperature) + " °C") + "</td>" : "") + "<td>" + esc(dateTime(item.lastReportedAt)) + "</td><td><button class=\"bb-btn\" data-settings=\"" + esc(item.ioid) + "\">Cài đặt</button></td></tr>";
    }).join("");
    var pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    els.pageInfo.textContent = "Trang " + state.page + " / " + pages;
    els.prev.disabled = state.page <= 1; els.next.disabled = state.page >= pages;
  }

  function ensureMap() {
    if (state.map || !window.L) return;
    state.map = window.L.map(els.map).setView([Number(cfg.mapCenterLat), Number(cfg.mapCenterLng)], Number(cfg.mapZoom));
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(state.map);
    state.markers = window.L.markerClusterGroup ? window.L.markerClusterGroup({ chunkedLoading: true }) : window.L.layerGroup();
    state.map.addLayer(state.markers); els.mapLoading.hidden = true;
  }
  function renderMap(items) {
    state.mapItems = items; ensureMap(); if (!state.map) return; state.markers.clearLayers();
    els.mapCount.textContent = items.length + " lò có tọa độ";
    els.mapList.innerHTML = items.slice(0, 100).map(function (item) { return "<button class=\"bb-map-item\" data-map-ioid=\"" + esc(item.ioid) + "\"><span class=\"bb-map-item-dot\"></span><span class=\"bb-map-item-main\"><strong>" + esc(item.ioid) + "</strong><span>" + esc(item.location || item.name || coordinateSourceLabel(item.coordinateSource)) + "</span></span></button>"; }).join("");
    items.forEach(function (item) { var marker = window.L.marker([item.latitude, item.longitude], { title: item.ioid }); marker.bindPopup("<strong>" + esc(item.ioid) + "</strong><br>" + esc(item.stale ? "Mất kết nối" : modeLabel(item.mode)) + " · " + esc(coordinateSourceLabel(item.coordinateSource)) + "<br><button class=\"bb-btn\" data-settings=\"" + esc(item.ioid) + "\">Cài đặt</button>"); marker._biomassIoid = item.ioid; state.markers.addLayer(marker); });
  }
  function fitMap() { if (!state.map || !state.mapItems.length) return; state.map.fitBounds(window.L.latLngBounds(state.mapItems.map(function (item) { return [item.latitude, item.longitude]; })), { padding: [30, 30], maxZoom: 13 }); }

  async function refresh() {
    if (state.loading) return;
    state.loading = true; setStatus("Đang tải", "loading");
    try {
      var url = baseUrl() + "?action=snapshot&page=" + state.page + "&pageSize=" + state.pageSize + "&search=" + encodeURIComponent(els.search.value.trim());
      var data = await api(url); state.total = data.list.total; state.visibleItems = data.list.items || []; state.definitions = data.settingDefinitions || [];
      renderTemperatureCapability(Number(data.summary.withTemperature) > 0); renderSummary(data.summary); renderTable(data.list.items || []); renderMap(data.map || []); setStatus("Đã cập nhật", "online");
    } catch (error) { setStatus("Không thể tải", "error"); notify(error.message, true); }
    finally { state.loading = false; clearTimeout(state.timer); state.timer = setTimeout(refresh, cfg.refreshMs); }
  }

  async function mutate(body) { return api(baseUrl(), { method: "POST", body: JSON.stringify(body) }); }
  async function openSettings(ioid) {
    try {
      var data = await api(baseUrl() + "?action=device&ioid=" + encodeURIComponent(ioid)); state.current = data.device;
      els.settingsTitle.textContent = "Cài đặt " + ioid; els.settingsSubtitle.textContent = modeLabel(data.device.mode) + " · rev " + data.device.configRevision;
      els.coordinateSource.textContent = coordinateSourceLabel(data.device.coordinateSource);
      ["name", "location", "latitude", "longitude"].forEach(function (key) { els.deviceForm.elements[key].value = data.device[key] == null ? "" : data.device[key]; });
      var byKey = {}; (data.device.settings || []).forEach(function (setting) { byKey[String(setting.key)] = setting; });
      els.settingsGrid.innerHTML = state.definitions.map(function (definition) { var current = byKey[String(definition.key)] || {}; var value = current.reportedValue == null ? current.desiredValue : current.reportedValue; return "<form class=\"bb-setting-card\" data-setting-key=\"" + esc(definition.key) + "\"><label>#" + esc(definition.key) + " · " + esc(definition.label) + "</label><div class=\"bb-setting-control\"><input class=\"bb-input\" name=\"value\" type=\"number\" min=\"" + definition.minimum + "\" max=\"" + definition.maximum + "\" value=\"" + esc(value) + "\"><span>" + esc(definition.unit) + "</span><button class=\"bb-btn\" type=\"submit\">Ghi</button></div></form>"; }).join("");
      els.settingsState.textContent = "Đã đọc"; showModal(els.settingsModal, true);
    } catch (error) { notify(error.message, true); }
  }

  els.refresh.onclick = refresh;
  els.settingsOpen.onclick = function () { var target = state.current && state.current.ioid || (state.visibleItems.length === 1 ? state.visibleItems[0].ioid : ""); if (target) openSettings(target); else notify("Chọn lò trong danh sách", true); };
  els.apply.onclick = function () { state.page = 1; state.pageSize = Number(els.pageSize.value); refresh(); };
  els.prev.onclick = function () { if (state.page > 1) { state.page -= 1; refresh(); } };
  els.next.onclick = function () { if (state.page * state.pageSize < state.total) { state.page += 1; refresh(); } };
  els.mapFit.onclick = fitMap;
  els.addOpen.onclick = function () { els.addForm.reset(); showModal(els.addModal, true); };
  els.addClose.onclick = els.addCancel.onclick = function () { showModal(els.addModal, false); };
  els.settingsClose.onclick = function () { showModal(els.settingsModal, false); };
  els.addForm.onsubmit = async function (event) { event.preventDefault(); var form = new FormData(els.addForm); try { await mutate({ action: "create", ioid: form.get("ioid"), name: form.get("name"), location: form.get("location"), latitude: form.get("latitude"), longitude: form.get("longitude") }); showModal(els.addModal, false); notify("Đã thêm lò"); refresh(); } catch (error) { notify(error.message, true); } };
  document.addEventListener("click", function (event) { var button = event.target.closest("[data-settings]"); if (button) openSettings(button.dataset.settings); });
  els.mapList.onclick = function (event) { var button = event.target.closest("[data-map-ioid]"); if (button) openSettings(button.dataset.mapIoid); };
  els.deviceForm.onsubmit = async function (event) { event.preventDefault(); if (!state.current) return; var form = new FormData(els.deviceForm); try { await mutate({ action: "update", ioid: state.current.ioid, name: form.get("name"), location: form.get("location"), latitude: form.get("latitude"), longitude: form.get("longitude") }); notify("Đã lưu"); await openSettings(state.current.ioid); refresh(); } catch (error) { notify(error.message, true); } };
  els.settingsGrid.onsubmit = async function (event) { event.preventDefault(); var form = event.target.closest("[data-setting-key]"); if (!form || !state.current) return; var button = form.querySelector("button"); button.disabled = true; els.settingsState.textContent = "Đang ghi"; try { var result = await api(baseUrl() + "/devices/" + encodeURIComponent(state.current.ioid) + "/settings/" + encodeURIComponent(form.dataset.settingKey), { method: "POST", body: JSON.stringify({ value: form.elements.value.value }) }); form.elements.value.value = result.value; els.settingsState.textContent = "Đã đọc lại"; notify("Đã cập nhật #" + form.dataset.settingKey); } catch (error) { els.settingsState.textContent = "Ghi lỗi"; notify(error.message, true); } finally { button.disabled = false; } };
  els.deleteBurner.onclick = async function () { if (!state.current || !confirm("Xóa " + state.current.ioid + "?")) return; try { await mutate({ action: "delete", ioid: state.current.ioid }); showModal(els.settingsModal, false); notify("Đã xóa lò"); refresh(); } catch (error) { notify(error.message, true); } };
  window.addEventListener("beforeunload", function () { clearTimeout(state.timer); });
  refresh();
})();
