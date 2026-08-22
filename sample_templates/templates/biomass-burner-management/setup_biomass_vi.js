(function () {
  "use strict";

  // Template-only setup: return JSON configuration through DashboardSetupBridge.
  // Never call a private biomass API or mutate ROSA core from this page.
  var baseConfig = {};
  var activeFleetIoid = "";

  document.body.innerHTML = ""
    + "<main class=\"shell\">"
    + "<header class=\"head\"><div><h1>Cài đặt quản lý lò sinh khối</h1><p class=\"status\">Cấu hình trang và fleet.</p></div><span class=\"badge\">compact-v2</span></header>"
    + "<section class=\"panel\"><div class=\"grid\">"
    + field("title", "Tên dashboard", "text", "full")
    + field("subtitle", "Mô tả ngắn", "text", "full")
    + field("pageSize", "Số dòng mỗi trang", "number")
    + field("refreshMs", "Chu kỳ đối soát (ms)", "number")
    + field("mapCenterLat", "Vĩ độ tâm", "number", "", "0.000001")
    + field("mapCenterLng", "Kinh độ tâm", "number", "", "0.000001")
    + field("mapZoom", "Mức zoom", "number")
    + "</div></section>"
    + "</main>";

  function field(key, label, type, className, step) {
    return "<label class=\"" + (className || "") + "\"><span>" + label + "</span><input id=\"cfg-" + key + "\" type=\"" + (type || "text") + "\"" + (step ? " step=\"" + step + "\"" : "") + "></label>";
  }
  function input(key) { return document.getElementById("cfg-" + key); }
  function text(key, fallback) { var value = String(input(key).value || "").trim(); return value || fallback; }
  function integer(key, fallback, min, max) { var value = Math.floor(Number(input(key).value)); return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
  function number(key, fallback, min, max) { var value = Number(input(key).value); return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
  function set(key, value) { input(key).value = value == null ? "" : String(value); }
  function ioid(value) { return String(value || "").trim().split("@")[0]; }

  function initialize(payload) {
    baseConfig = payload && payload.config && typeof payload.config === "object" ? Object.assign({}, payload.config) : {};
    var context = payload && payload.context || {};
    // The active ROSA profile owns the fleet identity. The dashboard config may
    // already contain an expanded IOID@APIKEY placeholder, so never expose or
    // validate that credential-bearing value as a user-editable field.
    activeFleetIoid = ioid(context.ioid || context.sessionId || baseConfig.fleetIoid);
    set("title", baseConfig.title || "Quản lý lò sinh khối");
    set("subtitle", baseConfig.subtitle || "");
    set("pageSize", baseConfig.pageSize || 50);
    set("refreshMs", baseConfig.refreshMs || 60000);
    set("mapCenterLat", baseConfig.mapCenterLat == null ? 10.798 : baseConfig.mapCenterLat);
    set("mapCenterLng", baseConfig.mapCenterLng == null ? 106.651 : baseConfig.mapCenterLng);
    set("mapZoom", baseConfig.mapZoom || 12);
  }

  function collect() {
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(activeFleetIoid)) throw new Error("Không xác định được thiết bị ROSA đang hoạt động.");
    return Object.assign({}, baseConfig, {
      title: text("title", "Quản lý lò sinh khối"), subtitle: String(input("subtitle").value || "").trim(), fleetIoid: activeFleetIoid,
      pageSize: integer("pageSize", 50, 1, 100), refreshMs: integer("refreshMs", 60000, 60000, 3600000),
      mapCenterLat: number("mapCenterLat", 10.798, -90, 90), mapCenterLng: number("mapCenterLng", 106.651, -180, 180), mapZoom: integer("mapZoom", 12, 2, 19),
      // These page IDs are fixed template capabilities, not operator settings.
      fleetViewPageId: "biomass-fleet-view", fleetAdminPageId: "biomass-fleet-admin"
    });
  }

  DashboardSetupBridge.start({ onInit: initialize, onCollect: collect });
})();
