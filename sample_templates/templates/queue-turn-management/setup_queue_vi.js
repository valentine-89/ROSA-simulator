(function () {
  "use strict";

  var state = {
    config: {},
    context: {},
    stations: []
  };

  var nodes = {
    siteName: document.getElementById("qt-site-name"),
    sourceIoid: document.getElementById("qt-source-ioid"),
    siteNote: document.getElementById("qt-site-note"),
    defaultTheme: document.getElementById("qt-default-theme"),
    defaultLayout: document.getElementById("qt-default-layout"),
    stationCount: document.getElementById("qt-station-count"),
    prefixBase: document.getElementById("qt-prefix-base"),
    stations: document.getElementById("qt-stations"),
    addStation: document.getElementById("qt-add-station"),
    regenerate: document.getElementById("qt-regenerate"),
    importButton: document.getElementById("qt-import"),
    exportButton: document.getElementById("qt-export"),
    importFile: document.getElementById("qt-import-file")
  };

  function safeText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || String(fallback || "");
  }

  function isIoidPlaceholder(value) {
    return /^<<ioid>>$/i.test(safeText(value, ""));
  }

  function currentIoid(fallback) {
    var contextIoid = safeText(state.context && state.context.ioid, "");
    if (contextIoid) return contextIoid;
    var text = safeText(fallback, "");
    return isIoidPlaceholder(text) ? "" : text;
  }

  function boolValue(value, fallback) {
    if (value === undefined || value === null || value === "") return !!fallback;
    if (value === true || value === 1) return true;
    var text = String(value).trim().toLowerCase();
    return ["1", "true", "yes", "on"].indexOf(text) >= 0;
  }

  function numberValue(value, fallback, min, max) {
    var parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) parsed = fallback;
    parsed = Math.max(min, parsed);
    if (Number.isFinite(max)) parsed = Math.min(max, parsed);
    return parsed;
  }

  function slug(value, fallback, separator) {
    var sep = separator || "-";
    var text = safeText(value, fallback).toLowerCase();
    text = text.normalize ? text.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : text;
    text = text.replace(/[^a-z0-9]+/g, sep).replace(new RegExp("\\" + sep + "+", "g"), sep);
    text = text.replace(new RegExp("^\\" + sep + "|\\" + sep + "$", "g"), "");
    return safeText(text, fallback);
  }

  function normalizeTheme(value) {
    var text = safeText(value, "medical");
    return ["medical", "bank", "pickup", "amusement", "neutral"].indexOf(text) >= 0 ? text : "medical";
  }

  function normalizeLayout(value) {
    var text = safeText(value, "two-column");
    return ["two-column", "single-column", "media-top", "media-side"].indexOf(text) >= 0 ? text : "two-column";
  }

  function stationFieldLabel(key) {
    return {
      station_id: "mã trạm",
      page_id: "mã trang",
      field_prefix: "mã dữ liệu"
    }[key] || key;
  }

  function reportError(message) {
    if (window.DashboardSetupBridge && window.DashboardSetupBridge.error) {
      window.DashboardSetupBridge.error(message);
      return;
    }
    window.alert(message);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function defaultSite(config, context) {
    var setup = config.initialSetup && config.initialSetup.site || {};
    return {
      name: safeText(setup.name, "ROSA Queue"),
      source_ioid: currentIoid(context.ioid || setup.source_ioid || setup.sourceIoid),
      note: safeText(setup.note, "Sẵn sàng phục vụ khách hàng."),
      default_theme: normalizeTheme(setup.default_theme || setup.defaultTheme),
      default_layout: normalizeLayout(setup.default_layout || setup.defaultLayout)
    };
  }

  function stationDefaults(index) {
    var base = slug(nodes.prefixBase && nodes.prefixBase.value, "queue", "_");
    var suffix = String(index + 1).padStart(2, "0");
    var stationId = slug(base + "-" + suffix, "queue-" + suffix, "-");
    return {
      station_id: stationId,
      title: "Trạm " + (index + 1),
      page_id: "queue-" + stationId,
      field_prefix: slug(base + "_" + suffix, "queue_" + suffix, "_"),
      source_ioid: currentIoid(nodes.sourceIoid && nodes.sourceIoid.value),
      theme_preset: normalizeTheme(nodes.defaultTheme && nodes.defaultTheme.value),
      layout: normalizeLayout(nodes.defaultLayout && nodes.defaultLayout.value),
      hide_link: false,
      enabled: true,
      note: ""
    };
  }

  function normalizeStation(raw, index) {
    raw = raw || {};
    var fallback = stationDefaults(index);
    var stationId = slug(raw.station_id || raw.stationId, fallback.station_id, "-").slice(0, 64);
    return {
      station_id: stationId,
      title: safeText(raw.title, fallback.title),
      page_id: slug(raw.page_id || raw.pageId, "queue-" + stationId, "-").slice(0, 96),
      field_prefix: slug(raw.field_prefix || raw.fieldPrefix, stationId.replace(/-/g, "_"), "_").slice(0, 48),
      source_ioid: currentIoid(raw.source_ioid || raw.sourceIoid || fallback.source_ioid),
      theme_preset: normalizeTheme(raw.theme_preset || raw.themePreset || fallback.theme_preset),
      layout: normalizeLayout(raw.layout || fallback.layout),
      hide_link: boolValue(raw.hide_link == null ? raw.hideLink : raw.hide_link, false),
      enabled: boolValue(raw.enabled, true),
      note: safeText(raw.note, "")
    };
  }

  function readStationsFromDom() {
    var rows = Array.prototype.slice.call(nodes.stations.querySelectorAll("[data-station-index]"));
    if (!rows.length) return state.stations.slice();
    return rows.map(function (row, index) {
      function value(name) {
        var input = row.querySelector("[data-field='" + name + "']");
        return input ? input.value : "";
      }
      return normalizeStation({
        station_id: value("station_id"),
        title: value("title"),
        page_id: value("page_id"),
        field_prefix: value("field_prefix"),
        source_ioid: value("source_ioid"),
        theme_preset: value("theme_preset"),
        layout: value("layout"),
        hide_link: value("hide_link"),
        enabled: value("enabled"),
        note: value("note")
      }, index);
    });
  }

  function renderStations() {
    if (!nodes.stations) return;
    nodes.stations.innerHTML = state.stations.map(function (station, index) {
      return '<div class="setup-station" data-station-index="' + index + '">' +
        '<div class="setup-station-head">' +
          '<strong>' + esc(station.title) + '</strong>' +
          '<button class="setup-secondary-button" type="button" data-remove="' + index + '">Xóa</button>' +
        '</div>' +
        '<div class="setup-station-grid">' +
          field("station_id", "Mã trạm", station.station_id) +
          field("title", "Tiêu đề", station.title) +
          field("page_id", "Mã trang", station.page_id) +
          field("field_prefix", "Mã dữ liệu", station.field_prefix) +
          select("theme_preset", "Giao diện", station.theme_preset, [
            ["medical", "Khám bệnh"],
            ["bank", "Ngân hàng"],
            ["pickup", "Nhận hàng"],
            ["amusement", "Khu vui chơi"],
            ["neutral", "Kiosk chung"]
          ]) +
          select("layout", "Bố cục", station.layout, [
            ["two-column", "2 cột số"],
            ["single-column", "1 cột số"],
            ["media-top", "Media phía trên"],
            ["media-side", "Media bên cạnh"]
          ]) +
          select("hide_link", "Ẩn khỏi danh sách", station.hide_link ? "1" : "0", [["0", "Không"], ["1", "Có"]]) +
          select("enabled", "Trang hoạt động", station.enabled ? "1" : "0", [["1", "Có"], ["0", "Không"]]) +
          field("note", "Ghi chú", station.note) +
        '</div>' +
      '</div>';
    }).join("");
    resize();
  }

  function field(name, label, value) {
    return '<label class="setup-field"><span>' + esc(label) + '</span><input data-field="' + esc(name) + '" value="' + esc(value) + '" /></label>';
  }

  function select(name, label, value, options) {
    return '<label class="setup-field"><span>' + esc(label) + '</span><select data-field="' + esc(name) + '">' +
      options.map(function (option) {
        return '<option value="' + esc(option[0]) + '"' + (String(option[0]) === String(value) ? " selected" : "") + '>' + esc(option[1]) + '</option>';
      }).join("") +
    '</select></label>';
  }

  function resize() {
    if (window.DashboardSetupBridge) window.DashboardSetupBridge.resize();
  }

  function validateStations(stations) {
    if (!stations.length) throw new Error("Hãy tạo ít nhất một trạm.");
    var seen = {
      station_id: {},
      page_id: {},
      field_prefix: {}
    };
    stations.forEach(function (station) {
      ["station_id", "page_id", "field_prefix"].forEach(function (key) {
        var value = safeText(station[key], "");
        if (!value) throw new Error("Thiếu " + stationFieldLabel(key) + " cho trạm " + safeText(station.title, "mới") + ".");
        if (seen[key][value]) throw new Error("Bị trùng " + stationFieldLabel(key) + ": " + value + ".");
        seen[key][value] = true;
      });
    });
  }

  function initialize(payload) {
    state.config = payload.config || {};
    state.context = payload.context || {};
    var site = defaultSite(state.config, state.context);
    nodes.siteName.value = site.name;
    nodes.sourceIoid.value = site.source_ioid;
    nodes.sourceIoid.readOnly = true;
    nodes.sourceIoid.setAttribute("aria-readonly", "true");
    nodes.siteNote.value = site.note;
    nodes.defaultTheme.value = site.default_theme;
    nodes.defaultLayout.value = site.default_layout;
    nodes.stationCount.value = String(Math.max(1, (state.config.initialSetup && state.config.initialSetup.stations || []).length || 1));
    nodes.prefixBase.value = "queue";
    state.stations = (state.config.initialSetup && Array.isArray(state.config.initialSetup.stations) ? state.config.initialSetup.stations : [stationDefaults(0)]).map(normalizeStation);
    renderStations();
  }

  function collect() {
    var stations = readStationsFromDom();
    validateStations(stations);
    var site = {
      name: safeText(nodes.siteName.value, "ROSA Queue"),
      source_ioid: currentIoid(nodes.sourceIoid.value),
      note: safeText(nodes.siteNote.value, ""),
      default_theme: normalizeTheme(nodes.defaultTheme.value),
      default_layout: normalizeLayout(nodes.defaultLayout.value)
    };
    var next = Object.assign({}, state.config, {
      title: safeText(state.config.title, "Quản lý màn hình nhảy số"),
      subtitle: safeText(state.config.subtitle, "Tạo trang hiển thị số thứ tự realtime cho các khu vực cần xếp hàng."),
      databaseSessionId: safeText(state.config.databaseSessionId, state.context.sessionId || ""),
      syncId: safeText(state.config.syncId, state.context.syncId || ""),
      stateMacro: safeText(state.config.stateMacro, "queue-admin-state"),
      saveSiteMacro: safeText(state.config.saveSiteMacro, "queue-admin-save-site-config"),
      applyStationMacro: safeText(state.config.applyStationMacro, "queue-admin-apply-station-page"),
      setEnabledMacro: safeText(state.config.setEnabledMacro, "queue-admin-set-station-enabled"),
      deleteStationMacro: safeText(state.config.deleteStationMacro, "queue-admin-delete-station"),
      initialSetup: {
        site: site,
        stations: stations
      }
    });
    return next;
  }

  function wire() {
    nodes.addStation.addEventListener("click", function () {
      state.stations = readStationsFromDom();
      state.stations.push(stationDefaults(state.stations.length));
      renderStations();
    });
    nodes.regenerate.addEventListener("click", function () {
      var count = numberValue(nodes.stationCount.value, 1, 1, 40);
      var current = readStationsFromDom();
      if (current.length && !window.confirm("Tạo lại danh sách sẽ thay thế các trạm hiện tại. Tiếp tục?")) return;
      state.stations = [];
      for (var i = 0; i < count; i += 1) state.stations.push(stationDefaults(i));
      renderStations();
    });
    nodes.stations.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("[data-remove]") : null;
      if (!button) return;
      var index = Number(button.getAttribute("data-remove"));
      state.stations = readStationsFromDom().filter(function (_, itemIndex) { return itemIndex !== index; });
      renderStations();
    });
    nodes.exportButton.addEventListener("click", function () {
      var collected;
      try {
        collected = collect();
      } catch (error) {
        reportError(error.message || "Cấu hình chưa hợp lệ.");
        return;
      }
      var payload = JSON.stringify({ site: collected.initialSetup.site, stations: collected.initialSetup.stations }, null, 2);
      var blob = new Blob([payload], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "queue-turn-setup.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    nodes.importButton.addEventListener("click", function () {
      nodes.importFile.click();
    });
    nodes.importFile.addEventListener("change", function () {
      var file = nodes.importFile.files && nodes.importFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result || "{}"));
          var nextStations = Array.isArray(parsed.stations) ? parsed.stations.map(normalizeStation) : [];
          validateStations(nextStations);
          if (parsed.site) {
            nodes.siteName.value = safeText(parsed.site.name, nodes.siteName.value);
            nodes.sourceIoid.value = currentIoid(nodes.sourceIoid.value);
            nodes.siteNote.value = safeText(parsed.site.note, nodes.siteNote.value);
            nodes.defaultTheme.value = normalizeTheme(parsed.site.default_theme || parsed.site.defaultTheme || nodes.defaultTheme.value);
            nodes.defaultLayout.value = normalizeLayout(parsed.site.default_layout || parsed.site.defaultLayout || nodes.defaultLayout.value);
          }
          state.stations = nextStations;
          renderStations();
        } catch (error) {
          reportError(error.message || "JSON không hợp lệ.");
        }
      };
      reader.readAsText(file);
      nodes.importFile.value = "";
    });
  }

  wire();
  if (window.DashboardSetupBridge) {
    window.DashboardSetupBridge.start({
      onInit: initialize,
      onCollect: collect
    });
  }
})();
