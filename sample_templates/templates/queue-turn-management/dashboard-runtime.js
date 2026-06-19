(function () {
  "use strict";

  var config = readJson("queue-turn-config", {});
  var state = {
    site: normalizeSite(config.initialSetup && config.initialSetup.site),
    stations: normalizeStations(config.initialSetup && config.initialSetup.stations),
    editingStationId: ""
  };

  var nodes = {
    title: document.getElementById("qt-title"),
    subtitle: document.getElementById("qt-subtitle"),
    status: document.getElementById("qt-status"),
    refresh: document.getElementById("qt-refresh"),
    applyAll: document.getElementById("qt-apply-all"),
    addStation: document.getElementById("qt-add-station"),
    saveSite: document.getElementById("qt-save-site"),
    loadDraft: document.getElementById("qt-load-draft"),
    exportConfig: document.getElementById("qt-export-config"),
    importConfig: document.getElementById("qt-import-config"),
    importFile: document.getElementById("qt-import-file"),
    siteName: document.getElementById("qt-site-name"),
    siteIoid: document.getElementById("qt-site-ioid"),
    siteNote: document.getElementById("qt-site-note"),
    defaultTheme: document.getElementById("qt-default-theme"),
    defaultLayout: document.getElementById("qt-default-layout"),
    stationCount: document.getElementById("qt-station-count"),
    stations: document.getElementById("qt-stations"),
    example: document.getElementById("qt-gateway-example"),
    modal: document.getElementById("qt-station-modal"),
    modalTitle: document.getElementById("qt-modal-title"),
    modalClose: document.getElementById("qt-modal-close"),
    modalCancel: document.getElementById("qt-modal-cancel"),
    stationForm: document.getElementById("qt-station-form"),
    stationSubmit: document.getElementById("qt-station-submit"),
    toastStack: document.getElementById("qt-toast-stack")
  };

  function readJson(id, fallback) {
    try {
      var node = document.getElementById(id);
      return JSON.parse(node && node.textContent || "{}");
    } catch (error) {
      return fallback;
    }
  }

  function safeText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || String(fallback || "");
  }

  function isIoidPlaceholder(value) {
    return /^<<ioid>>$/i.test(safeText(value, ""));
  }

  function configuredIoid() {
    var setupSite = config.initialSetup && config.initialSetup.site || {};
    var text = safeText(setupSite.source_ioid || setupSite.sourceIoid, "");
    return isIoidPlaceholder(text) ? "" : text;
  }

  function currentIoid(fallback) {
    var profileIoid = configuredIoid();
    if (profileIoid) return profileIoid;
    var text = safeText(fallback, "");
    return isIoidPlaceholder(text) ? configuredIoid() : text;
  }

  function boolValue(value, fallback) {
    if (value === undefined || value === null || value === "") return !!fallback;
    if (value === true || value === 1) return true;
    var text = String(value).trim().toLowerCase();
    return ["1", "true", "yes", "on"].indexOf(text) >= 0;
  }

  function normalizeSlug(value, fallback, separator) {
    var text = safeText(value, fallback).toLowerCase();
    text = text.normalize ? text.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : text;
    text = text.replace(/[^a-z0-9]+/g, separator || "-").replace(new RegExp("\\" + (separator || "-") + "+", "g"), separator || "-");
    text = text.replace(new RegExp("^\\" + (separator || "-") + "|\\" + (separator || "-") + "$", "g"), "");
    return safeText(text, fallback);
  }

  function normalizeFieldPrefix(value, fallback) {
    return normalizeSlug(value, fallback || "queue_a", "_").replace(/_+/g, "_").slice(0, 48);
  }

  function normalizePageId(value, fallback) {
    return normalizeSlug(value, fallback || "queue-display", "-").slice(0, 96);
  }

  function normalizeTheme(value) {
    var text = safeText(value, "medical");
    return ["medical", "bank", "pickup", "amusement", "neutral"].indexOf(text) >= 0 ? text : "medical";
  }

  function normalizeLayout(value) {
    var text = safeText(value, "two-column");
    return ["two-column", "single-column", "media-top", "media-side"].indexOf(text) >= 0 ? text : "two-column";
  }

  function themeLabel(value) {
    return {
      medical: "Khám bệnh",
      bank: "Ngân hàng",
      pickup: "Nhận hàng",
      amusement: "Khu vui chơi",
      neutral: "Kiosk chung"
    }[normalizeTheme(value)] || "Kiosk chung";
  }

  function layoutLabel(value) {
    return {
      "two-column": "2 cột số",
      "single-column": "1 cột số",
      "media-top": "Media trên",
      "media-side": "Media bên cạnh"
    }[normalizeLayout(value)] || "2 cột số";
  }

  function normalizeSite(raw) {
    raw = raw || {};
    return {
      name: safeText(raw.name || raw.site_name, "ROSA Queue"),
      source_ioid: currentIoid(raw.source_ioid || raw.sourceIoid),
      note: safeText(raw.note, "Sẵn sàng phục vụ khách hàng."),
      default_theme: normalizeTheme(raw.default_theme || raw.defaultTheme),
      default_layout: normalizeLayout(raw.default_layout || raw.defaultLayout)
    };
  }

  function normalizeStation(raw, index) {
    raw = raw || {};
    var stationId = normalizePageId(raw.station_id || raw.stationId, "station-" + (index + 1));
    var pageId = normalizePageId(raw.page_id || raw.pageId, "queue-" + stationId);
    var prefix = normalizeFieldPrefix(raw.field_prefix || raw.fieldPrefix, stationId.replace(/-/g, "_"));
    return {
      station_id: stationId,
      title: safeText(raw.title, "Trạm " + (index + 1)),
      page_id: pageId,
      source_ioid: currentIoid(raw.source_ioid || raw.sourceIoid || state && state.site && state.site.source_ioid),
      field_prefix: prefix,
      theme_preset: normalizeTheme(raw.theme_preset || raw.themePreset || state && state.site && state.site.default_theme),
      layout: normalizeLayout(raw.layout || state && state.site && state.site.default_layout),
      hide_link: boolValue(raw.hide_link == null ? raw.hideLink : raw.hide_link, false),
      enabled: boolValue(raw.enabled, true),
      note: safeText(raw.note, "")
    };
  }

  function normalizeStations(list) {
    return (Array.isArray(list) ? list : []).map(normalizeStation);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function apiUrl() {
    var sessionId = safeText(config.databaseSessionId, "");
    var syncId = safeText(config.syncId, "");
    if (!sessionId || !syncId) return "";
    return "/api/" + encodeURIComponent(sessionId) + "/" + encodeURIComponent(syncId) + "/iodata";
  }

  function gatewayEndpoint() {
    var sessionId = safeText(config.databaseSessionId, "");
    var syncId = safeText(config.syncId, "");
    if (!sessionId || !syncId) return "Chưa có endpoint. Hãy tạo template từ profile thiết bị hợp lệ.";
    return location.origin.replace(/\/$/, "") + "/api/" + encodeURIComponent(sessionId) + "/" + encodeURIComponent(syncId);
  }

  function postMacro(payload) {
    var url = apiUrl();
    if (!url) return Promise.reject(new Error("Thiếu cấu hình databaseSessionId/syncId."));
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) {
          throw new Error(data && data.error ? data.error : "Không thể chạy macro.");
        }
        return Array.isArray(data) ? data : data && Array.isArray(data.rows) ? data.rows : [];
      });
    });
  }

  function setStatus(text, kind) {
    if (!nodes.status) return;
    nodes.status.textContent = text;
    nodes.status.setAttribute("data-state", kind === "error" ? "error" : kind === "loading" ? "loading" : "ok");
  }

  function toast(message, kind) {
    if (!nodes.toastStack) return;
    var item = document.createElement("div");
    item.className = "qt-toast" + (kind === "error" ? " error" : "");
    item.textContent = message;
    nodes.toastStack.appendChild(item);
    setTimeout(function () {
      item.remove();
    }, 4200);
  }

  function fillSiteForm() {
    if (nodes.siteName) nodes.siteName.value = state.site.name;
    if (nodes.siteIoid) {
      nodes.siteIoid.value = state.site.source_ioid;
      nodes.siteIoid.readOnly = true;
      nodes.siteIoid.setAttribute("aria-readonly", "true");
    }
    if (nodes.siteNote) nodes.siteNote.value = state.site.note;
    if (nodes.defaultTheme) nodes.defaultTheme.value = state.site.default_theme;
    if (nodes.defaultLayout) nodes.defaultLayout.value = state.site.default_layout;
    if (nodes.title) nodes.title.textContent = safeText(config.title, state.site.name);
    if (nodes.subtitle) nodes.subtitle.textContent = safeText(config.subtitle, state.site.note);
  }

  function readSiteForm() {
    state.site = normalizeSite({
      name: nodes.siteName && nodes.siteName.value,
      source_ioid: currentIoid(nodes.siteIoid && nodes.siteIoid.value),
      note: nodes.siteNote && nodes.siteNote.value,
      default_theme: nodes.defaultTheme && nodes.defaultTheme.value,
      default_layout: nodes.defaultLayout && nodes.defaultLayout.value
    });
    return state.site;
  }

  function fieldNames(prefix) {
    return ["name", "text1", "order1", "text2", "order2", "media", "note", "alert"].map(function (suffix) {
      return prefix + "_" + suffix;
    });
  }

  function stationFieldLabel(key) {
    return {
      station_id: "mã trạm",
      page_id: "mã trang",
      field_prefix: "mã dữ liệu"
    }[key] || key;
  }

  function validateUniqueStations(stations, skipStationId) {
    var seen = {
      station_id: {},
      page_id: {},
      field_prefix: {}
    };
    (stations || []).forEach(function (station) {
      if (skipStationId && station.station_id === skipStationId) return;
      ["station_id", "page_id", "field_prefix"].forEach(function (key) {
        var value = safeText(station[key], "");
        if (!value) throw new Error("Thiếu " + stationFieldLabel(key) + " cho trạm " + safeText(station.title, station.station_id || "mới") + ".");
        if (seen[key][value]) throw new Error("Bị trùng " + stationFieldLabel(key) + ": " + value + ".");
        seen[key][value] = true;
      });
    });
  }

  function validateStationCandidate(station) {
    validateUniqueStations([station].concat(state.stations.filter(function (item) {
      return item.station_id !== state.editingStationId;
    })));
  }

  function stationUrl(station) {
    var ioid = currentIoid(station.source_ioid || state.site.source_ioid);
    return "/iot-page/" + encodeURIComponent(ioid) + "/" + encodeURIComponent(station.page_id);
  }

  function gatewayExample(station) {
    var prefix = safeText(station && station.field_prefix, "clinic_a");
    var title = safeText(station && station.title, "Phòng khám A");
    return [
      "# Endpoint nhận dữ liệu",
      "#801=" + gatewayEndpoint(),
      "",
      "# Lệnh mẫu cập nhật số cho " + title,
      "D23,#801,,\"telemetry\",\"" + prefix + "_name=" + title + "\",\"" + prefix + "_text1=Quầy 1\",\"" + prefix + "_order1=001,002,003\",\"" + prefix + "_text2=Quầy 2\",\"" + prefix + "_order2=004,005\"",
      "",
      "# Dữ liệu có thể gửi thêm: " + fieldNames(prefix).join(", ")
    ].join("\n");
  }

  function updateExample() {
    if (!nodes.example) return;
    nodes.example.textContent = gatewayExample(state.stations[0] || {
      field_prefix: "clinic_a",
      title: "Phòng khám A"
    });
  }

  function renderStations() {
    if (!nodes.stations) return;
    if (nodes.stationCount) nodes.stationCount.textContent = state.stations.length + " trạm";
    if (!state.stations.length) {
      nodes.stations.innerHTML = '<div class="qt-empty">Chưa có trạm. Bấm "Thêm trạm" để tạo màn hình nhảy số đầu tiên.</div>';
      updateExample();
      return;
    }

    nodes.stations.innerHTML = state.stations.map(function (station) {
      var url = stationUrl(station);
      return '<article class="qt-station" data-station-id="' + esc(station.station_id) + '">' +
        '<div class="qt-station-top">' +
          '<div class="qt-station-title">' +
            '<strong>' + esc(station.title) + '</strong>' +
            '<span class="qt-small">Mã trạm: ' + esc(station.station_id) + ' · Mã trang: ' + esc(station.page_id) + '</span>' +
          '</div>' +
          '<div class="qt-badges">' +
            '<span class="qt-badge ' + (station.enabled ? "on" : "off") + '">' + (station.enabled ? "Đang bật" : "Đang tắt") + '</span>' +
            '<span class="qt-badge">' + esc(themeLabel(station.theme_preset)) + '</span>' +
            '<span class="qt-badge">' + esc(layoutLabel(station.layout)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="qt-small">Mã dữ liệu: <b>' + esc(station.field_prefix) + '</b></div>' +
        '<div class="qt-small">Trang hiển thị: <a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a></div>' +
        '<details class="qt-command-details"><summary>Lệnh gửi số</summary><pre class="qt-code">' + esc(gatewayExample(station)) + '</pre></details>' +
        '<div class="qt-station-actions">' +
          '<button class="qt-button" type="button" data-action="edit">Sửa</button>' +
          '<button class="qt-button" type="button" data-action="copy-url">Copy URL</button>' +
          '<button class="qt-button" type="button" data-action="copy-command">Copy lệnh</button>' +
          '<button class="qt-button primary" type="button" data-action="apply">Cập nhật trang</button>' +
          '<button class="qt-button ' + (station.enabled ? "danger" : "primary") + '" type="button" data-action="toggle">' + (station.enabled ? "Tắt trang" : "Bật trang") + '</button>' +
          '<button class="qt-button danger" type="button" data-action="delete">Xóa</button>' +
        '</div>' +
      '</article>';
    }).join("");
    updateExample();
  }

  function rowsToState(rows) {
    var siteRow = null;
    var stations = [];
    (rows || []).forEach(function (row) {
      if (String(row.row_type || "") === "site") siteRow = row;
      if (String(row.row_type || "") === "station") stations.push(normalizeStation(row, stations.length));
    });
    if (siteRow) {
      state.site = normalizeSite({
        name: siteRow.site_name,
        source_ioid: siteRow.site_source_ioid,
        note: siteRow.site_note,
        default_theme: siteRow.default_theme,
        default_layout: siteRow.default_layout
      });
    }
    if (stations.length) state.stations = stations;
  }

  function loadState() {
    setStatus("Đang tải", "loading");
    return postMacro({ macro: safeText(config.stateMacro, "queue-admin-state") })
      .then(function (rows) {
        rowsToState(rows);
        fillSiteForm();
        renderStations();
        setStatus("Sẵn sàng", "ok");
      })
      .catch(function (error) {
        fillSiteForm();
        renderStations();
        setStatus("Lỗi tải DB", "error");
        toast(error.message || "Không thể tải dữ liệu.", "error");
      });
  }

  function saveSite() {
    var site = readSiteForm();
    setStatus("Đang lưu", "loading");
    return runSaveSite(site).then(function () {
      toast("Đã lưu thông tin chung.");
      return loadState();
    }).catch(function (error) {
      setStatus("Lỗi lưu", "error");
      toast(error.message || "Không thể lưu thông tin chung.", "error");
    });
  }

  function sitePayload(site) {
    return {
      macro: safeText(config.saveSiteMacro, "queue-admin-save-site-config"),
      site_name: site.name,
      note: site.note,
      default_theme: site.default_theme,
      default_layout: site.default_layout
    };
  }

  function runSaveSite(site) {
    return postMacro(sitePayload(site));
  }

  function openModal(station) {
    station = station ? normalizeStation(station, 0) : normalizeStation({
      station_id: "station-" + (state.stations.length + 1),
      title: "Trạm " + (state.stations.length + 1),
      source_ioid: currentIoid(state.site.source_ioid),
      theme_preset: state.site.default_theme,
      layout: state.site.default_layout
    }, state.stations.length);
    state.editingStationId = station.station_id;
    var isExisting = state.stations.some(function (item) { return item.station_id === station.station_id; });
    if (nodes.modalTitle) nodes.modalTitle.textContent = isExisting ? "Sửa trạm" : "Thêm trạm";
    Array.prototype.slice.call(nodes.stationForm.elements).forEach(function (element) {
      if (!element.name) return;
      if (element.name === "hide_link") {
        element.value = station.hide_link ? "1" : "0";
      } else {
        element.value = station[element.name] == null ? "" : station[element.name];
      }
      if (["station_id", "page_id", "field_prefix"].indexOf(element.name) >= 0) {
        element.readOnly = isExisting;
        element.setAttribute("aria-readonly", isExisting ? "true" : "false");
      }
    });
    nodes.modal.classList.add("open");
    nodes.modal.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    nodes.modal.classList.remove("open");
    nodes.modal.setAttribute("aria-hidden", "true");
    state.editingStationId = "";
  }

  function readStationForm() {
    var data = {};
    Array.prototype.slice.call(nodes.stationForm.elements).forEach(function (element) {
      if (!element.name) return;
      data[element.name] = element.value;
    });
    data.source_ioid = currentIoid(data.source_ioid || state.site.source_ioid);
    data.hide_link = data.hide_link === "1";
    var existing = findStation(state.editingStationId);
    data.enabled = existing ? existing.enabled : true;
    return normalizeStation(data, 0);
  }

  function stationPayload(station) {
    return {
      macro: safeText(config.applyStationMacro, "queue-admin-apply-station-page"),
      station_id: station.station_id,
      title: station.title,
      page_id: station.page_id,
      field_prefix: station.field_prefix,
      theme_preset: station.theme_preset,
      layout: station.layout,
      hide_link: station.hide_link ? "1" : "0",
      enabled: station.enabled ? "1" : "0",
      note: station.note
    };
  }

  function runApplyStation(station) {
    return postMacro(stationPayload(station));
  }

  function applyStation(station) {
    try {
      validateStationCandidate(station);
    } catch (error) {
      toast(error.message || "Thông tin trạm chưa hợp lệ.", "error");
      return Promise.resolve();
    }
    setStatus("Đang tạo trang", "loading");
    return runApplyStation(station).then(function () {
      closeModal();
      toast("Đã tạo/cập nhật trang " + station.page_id + ".");
      return loadState();
    }).catch(function (error) {
      setStatus("Lỗi tạo trang", "error");
      toast(error.message || "Không thể tạo trang.", "error");
    });
  }

  function applyExistingStation(station) {
    try {
      validateUniqueStations(state.stations);
    } catch (error) {
      toast(error.message || "Danh sách trạm chưa hợp lệ.", "error");
      return Promise.resolve();
    }
    setStatus("Đang cập nhật trang", "loading");
    return runApplyStation(station).then(function () {
      toast("Đã cập nhật trang " + station.page_id + ".");
      return loadState();
    }).catch(function (error) {
      setStatus("Lỗi cập nhật", "error");
      toast(error.message || "Không thể cập nhật trang.", "error");
    });
  }

  function applyAllStations() {
    var site = readSiteForm();
    var stations = state.stations.map(function (station, index) {
      return normalizeStation(station, index);
    });
    try {
      validateUniqueStations(stations);
    } catch (error) {
      toast(error.message || "Danh sách trạm chưa hợp lệ.", "error");
      return Promise.resolve();
    }
    if (!stations.length) {
      toast("Hãy tạo ít nhất một trạm.", "error");
      return Promise.resolve();
    }
    setStatus("Đang tạo/cập nhật tất cả", "loading");
    return runSaveSite(site).then(function () {
      return stations.reduce(function (chain, station) {
        return chain.then(function () { return runApplyStation(station); });
      }, Promise.resolve());
    }).then(function () {
      toast("Đã tạo/cập nhật " + stations.length + " trang.");
      return loadState();
    }).catch(function (error) {
      setStatus("Lỗi cập nhật", "error");
      toast(error.message || "Không thể tạo/cập nhật tất cả trang.", "error");
    });
  }

  function toggleStation(station) {
    var nextEnabled = !station.enabled;
    setStatus(nextEnabled ? "Đang bật trang" : "Đang tắt trang", "loading");
    return postMacro({
      macro: safeText(config.setEnabledMacro, "queue-admin-set-station-enabled"),
      station_id: station.station_id,
      page_id: station.page_id,
      enabled: nextEnabled ? "1" : "0"
    }).then(function () {
      toast(nextEnabled ? "Đã bật trang." : "Đã tắt trang.");
      return loadState();
    }).catch(function (error) {
      toast(error.message || "Không thể đổi trạng thái.", "error");
    });
  }

  function deleteStation(station) {
    if (!window.confirm("Xóa trạm \"" + station.title + "\" và trang hiển thị tương ứng?")) return Promise.resolve();
    setStatus("Đang xóa trạm", "loading");
    return postMacro({
      macro: safeText(config.deleteStationMacro, "queue-admin-delete-station"),
      station_id: station.station_id,
      page_id: station.page_id
    }).then(function () {
      toast("Đã xóa trạm " + station.title + ".");
      return loadState();
    }).catch(function (error) {
      setStatus("Lỗi xóa", "error");
      toast(error.message || "Không thể xóa trạm.", "error");
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast("Đã copy.");
      }).catch(function () {
        toast(text);
      });
      return;
    }
    toast(text);
  }

  function exportConfig() {
    try {
      validateUniqueStations(state.stations);
    } catch (error) {
      toast(error.message || "Danh sách trạm chưa hợp lệ.", "error");
      return;
    }
    var payload = JSON.stringify({ site: readSiteForm(), stations: state.stations }, null, 2);
    var blob = new Blob([payload], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "queue-turn-config.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importConfigFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result || "{}"));
        var stations = normalizeStations(parsed.stations);
        if (!stations.length) throw new Error("File không có danh sách trạm.");
        validateUniqueStations(stations);
        state.site = parsed.site ? normalizeSite(parsed.site) : state.site;
        state.stations = stations;
        fillSiteForm();
        renderStations();
        toast("Đã nạp cấu hình. Bấm tạo/cập nhật tất cả để ghi DB.");
      } catch (error) {
        toast(error.message || "JSON không hợp lệ.", "error");
      }
    };
    reader.readAsText(file);
  }

  function findStation(id) {
    return state.stations.find(function (station) {
      return station.station_id === id;
    });
  }

  function wireEvents() {
    if (nodes.refresh) nodes.refresh.addEventListener("click", loadState);
    if (nodes.saveSite) nodes.saveSite.addEventListener("click", saveSite);
    if (nodes.applyAll) nodes.applyAll.addEventListener("click", applyAllStations);
    if (nodes.loadDraft) nodes.loadDraft.addEventListener("click", function () {
      state.site = normalizeSite(config.initialSetup && config.initialSetup.site);
      state.stations = normalizeStations(config.initialSetup && config.initialSetup.stations);
      fillSiteForm();
      renderStations();
      toast("Đã nạp cấu hình nháp từ setup.");
    });
    if (nodes.addStation) nodes.addStation.addEventListener("click", function () { openModal(); });
    if (nodes.modalClose) nodes.modalClose.addEventListener("click", closeModal);
    if (nodes.modalCancel) nodes.modalCancel.addEventListener("click", closeModal);
    if (nodes.stationForm) nodes.stationForm.addEventListener("submit", function (event) {
      event.preventDefault();
      applyStation(readStationForm());
    });
    if (nodes.exportConfig) nodes.exportConfig.addEventListener("click", exportConfig);
    if (nodes.importConfig) nodes.importConfig.addEventListener("click", function () {
      if (nodes.importFile) nodes.importFile.click();
    });
    if (nodes.importFile) nodes.importFile.addEventListener("change", function () {
      importConfigFile(nodes.importFile.files && nodes.importFile.files[0]);
      nodes.importFile.value = "";
    });
    if (nodes.stations) nodes.stations.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("[data-action]") : null;
      if (!button) return;
      var card = button.closest("[data-station-id]");
      var station = card ? findStation(card.getAttribute("data-station-id")) : null;
      if (!station) return;
      var action = button.getAttribute("data-action");
      if (action === "edit") openModal(station);
      if (action === "apply") applyExistingStation(station);
      if (action === "toggle") toggleStation(station);
      if (action === "delete") deleteStation(station);
      if (action === "copy-url") copyText(location.origin + stationUrl(station));
      if (action === "copy-command") copyText(gatewayExample(station));
    });
  }

  fillSiteForm();
  renderStations();
  wireEvents();
  loadState();
})();
