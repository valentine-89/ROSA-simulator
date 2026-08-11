(function () {
  "use strict";

  // Template-only setup: return JSON configuration through DashboardSetupBridge.
  // Never call a private biomass API or mutate ROSA core from this page.
  var baseConfig = {};

  document.body.innerHTML = ""
    + "<main class=\"shell\">"
    + "<header class=\"head\"><div><h1>Cài đặt quản lý lò sinh khối</h1><p class=\"status\">Cấu hình trang và fleet.</p></div><span class=\"badge\">compact-v2</span></header>"
    + "<section class=\"panel\"><div class=\"grid\">"
    + field("title", "Tên dashboard", "text", "full")
    + field("subtitle", "Mô tả ngắn", "text", "full")
    + field("fleetIoid", "IOID fleet", "text")
    + field("pageSize", "Số dòng mỗi trang", "number")
    + field("refreshMs", "Chu kỳ đối soát (ms)", "number")
    + field("mapCenterLat", "Vĩ độ tâm", "number", "", "0.000001")
    + field("mapCenterLng", "Kinh độ tâm", "number", "", "0.000001")
    + field("mapZoom", "Mức zoom", "number")
    + "</div></section>"
    + "<details><summary>Định danh capability ROSA</summary><div class=\"advanced-body\"><div class=\"grid\">"
    + field("fleetViewPageId", "Trang đọc fleet", "text")
    + field("fleetAdminPageId", "Trang quản trị fleet", "text")
    + field("deviceStatusPageId", "Trang telemetry thiết bị", "text")
    + "</div></div></details>"
    + "</main>";

  function field(key, label, type, className, step) {
    return "<label class=\"" + (className || "") + "\"><span>" + label + "</span><input id=\"cfg-" + key + "\" type=\"" + (type || "text") + "\"" + (step ? " step=\"" + step + "\"" : "") + "></label>";
  }
  function input(key) { return document.getElementById("cfg-" + key); }
  function text(key, fallback) { var value = String(input(key).value || "").trim(); return value || fallback; }
  function integer(key, fallback, min, max) { var value = Math.floor(Number(input(key).value)); return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
  function number(key, fallback, min, max) { var value = Number(input(key).value); return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
  function set(key, value) { input(key).value = value == null ? "" : String(value); }

  function initialize(payload) {
    baseConfig = payload && payload.config && typeof payload.config === "object" ? Object.assign({}, payload.config) : {};
    var context = payload && payload.context || {};
    set("title", baseConfig.title || "Quản lý lò sinh khối");
    set("subtitle", baseConfig.subtitle || "");
    set("fleetIoid", baseConfig.fleetIoid || String(context.sessionId || "").split("@")[0]);
    set("pageSize", baseConfig.pageSize || 50);
    set("refreshMs", baseConfig.refreshMs || 60000);
    set("mapCenterLat", baseConfig.mapCenterLat == null ? 21.35 : baseConfig.mapCenterLat);
    set("mapCenterLng", baseConfig.mapCenterLng == null ? 105.72 : baseConfig.mapCenterLng);
    set("mapZoom", baseConfig.mapZoom || 8);
    set("fleetViewPageId", baseConfig.fleetViewPageId || "biomass-fleet-view");
    set("fleetAdminPageId", baseConfig.fleetAdminPageId || "biomass-fleet-admin");
    set("deviceStatusPageId", baseConfig.deviceStatusPageId || "biomass-status");
  }

  function collect() {
    var fleetIoid = text("fleetIoid", "");
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(fleetIoid)) throw new Error("IOID fleet không hợp lệ.");
    return Object.assign({}, baseConfig, {
      title: text("title", "Quản lý lò sinh khối"), subtitle: String(input("subtitle").value || "").trim(), fleetIoid: fleetIoid,
      pageSize: integer("pageSize", 50, 1, 100), refreshMs: integer("refreshMs", 60000, 60000, 3600000),
      mapCenterLat: number("mapCenterLat", 21.35, -90, 90), mapCenterLng: number("mapCenterLng", 105.72, -180, 180), mapZoom: integer("mapZoom", 8, 2, 19),
      fleetViewPageId: text("fleetViewPageId", "biomass-fleet-view"), fleetAdminPageId: text("fleetAdminPageId", "biomass-fleet-admin"), deviceStatusPageId: text("deviceStatusPageId", "biomass-status")
    });
  }

  DashboardSetupBridge.start({ onInit: initialize, onCollect: collect });
})();
