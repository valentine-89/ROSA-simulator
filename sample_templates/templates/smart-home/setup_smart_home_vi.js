(function () {
  "use strict";

  var DEFAULT_CONFIG = {
    locale: "vi",
    title: "Nhà thông minh",
    subtitle: "Mọi không gian trong nhà, luôn ở trong tầm tay",
    syncId: "<<syncid>>",
    groups: [
      {
        title: "Không gian sống",
        sessionId: "<<sessionid>>",
        widgets: [
          { type: "telemetry", label: "Nhiệt độ", field: "temperature", unit: "°C", digits: 1, tone: "danger" },
          { type: "telemetry", label: "Độ ẩm", field: "humidity", unit: "%", digits: 0, tone: "info" },
          { type: "telemetry", label: "Chất lượng không khí", field: "air_quality", unit: "AQI", digits: 0, tone: "success" },
          { type: "switch", label: "Đèn phòng khách", stateField: "O1", commandOn: "D1O1", commandOff: "D2O1", tone: "warning" },
          { type: "switch", label: "Điều hòa", stateField: "O2", commandOn: "D1O2", commandOff: "D2O2", tone: "info" },
          { type: "angle", label: "Rèm cửa", field: "curtain", submitCommand: "D1O3'{value}'", tone: "primary" }
        ]
      },
      {
        title: "An ninh & năng lượng",
        sessionId: "<<sessionid>>",
        widgets: [
          { type: "switch", label: "Cửa chính", stateField: "door_status", commandOn: "", commandOff: "", tone: "sensor" },
          { type: "switch", label: "Cảnh báo khói", stateField: "smoke", commandOn: "", commandOff: "", tone: "alarm" },
          { type: "telemetry", label: "Công suất", field: "power_w", unit: "W", digits: 0, tone: "warning" },
          { type: "telemetry", label: "Điện năng hôm nay", field: "energy_kwh", unit: "kWh", digits: 2, tone: "success" },
          { type: "command", label: "Tắt toàn bộ đèn", command: "D2O1,D2O4,D2O5", buttonLabel: "Tắt tất cả", tone: "danger" },
          { type: "line-chart", label: "Nhiệt độ 24 giờ", field: "temperature", unit: "°C", digits: 1, range: "24h", yDeltaMin: 8, tone: "info" }
        ]
      }
    ]
  };
  var state = { config: clone(DEFAULT_CONFIG), context: {} };
  var root;

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? {} : value));
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function safe(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || String(fallback == null ? "" : fallback).trim();
  }

  function widgetField(widget) {
    if (widget.type === "switch") return widget.stateField || "";
    if (widget.type === "command") return widget.command || "";
    return widget.field || "";
  }

  function render() {
    var config = state.config;
    var groups = Array.isArray(config.groups) ? config.groups : [];
    document.body.innerHTML = '<main class="shell">' +
      '<header class="head"><div><h1>Cài đặt nhà thông minh</h1><div class="status">Chỉnh thông tin chung, khu vực và field thiết bị.</div></div><div class="badge">' + groups.length + ' khu vực</div></header>' +
      '<section class="panel"><h2>Thông tin chung</h2><div class="grid">' +
        '<label class="full">Tên dashboard<input id="home-title" value="' + esc(config.title) + '"></label>' +
        '<label class="full">Mô tả ngắn<input id="home-subtitle" value="' + esc(config.subtitle) + '"></label>' +
        '<label>AccountID dùng chung<input id="home-sync" value="' + esc(config.syncId) + '"></label>' +
      '</div></section>' +
      '<section class="panel"><h2>Các khu vực</h2><div class="item-list">' + groups.map(function (group, groupIndex) {
        return '<article class="item-card" data-group="' + groupIndex + '">' +
          '<div class="item-top"><div class="item-title"><span class="badge">#' + (groupIndex + 1) + '</span><strong>' + esc(group.title) + '</strong></div></div>' +
          '<div class="grid">' +
            '<label>Tên khu vực<input data-group-title value="' + esc(group.title) + '"></label>' +
            '<label>Device key<input data-group-session value="' + esc(group.sessionId) + '"></label>' +
          '</div><div class="advanced-section"><h3>Thiết bị / cảm biến</h3>' +
          (Array.isArray(group.widgets) ? group.widgets : []).map(function (widget, widgetIndex) {
            return '<div class="grid" data-widget="' + widgetIndex + '">' +
              '<label>Tên hiển thị<input data-widget-label value="' + esc(widget.label) + '"></label>' +
              '<label>' + (widget.type === "command" ? "Lệnh" : "Field") + '<input data-widget-field value="' + esc(widgetField(widget)) + '"></label>' +
            '</div>';
          }).join("") + '</div></article>';
      }).join("") + '</div></section></main>';
    root = document.querySelector(".shell");
    DashboardSetupBridge.resize();
  }

  function initialize(payload) {
    state.config = clone(payload && payload.config && Object.keys(payload.config).length ? payload.config : DEFAULT_CONFIG);
    state.context = clone(payload && payload.context || {});
    if (!state.config.syncId) state.config.syncId = state.context.syncId || "";
    (state.config.groups || []).forEach(function (group) {
      if (!group.sessionId) group.sessionId = state.context.sessionId || "";
    });
    render();
  }

  function collect() {
    var next = clone(state.config);
    next.title = safe(document.getElementById("home-title").value, "Nhà thông minh");
    next.subtitle = safe(document.getElementById("home-subtitle").value, "Mọi không gian trong nhà, luôn ở trong tầm tay");
    next.syncId = safe(document.getElementById("home-sync").value, state.context.syncId || "");
    Array.prototype.forEach.call(root.querySelectorAll("[data-group]"), function (card) {
      var groupIndex = Number(card.getAttribute("data-group"));
      var group = next.groups[groupIndex];
      group.title = safe(card.querySelector("[data-group-title]").value, "Khu vực " + (groupIndex + 1));
      group.sessionId = safe(card.querySelector("[data-group-session]").value, state.context.sessionId || "");
      Array.prototype.forEach.call(card.querySelectorAll("[data-widget]"), function (row) {
        var widget = group.widgets[Number(row.getAttribute("data-widget"))];
        widget.label = safe(row.querySelector("[data-widget-label]").value, widget.label);
        var value = safe(row.querySelector("[data-widget-field]").value, "");
        if (widget.type === "switch") widget.stateField = value;
        else if (widget.type === "command") widget.command = value;
        else widget.field = value;
      });
    });
    if (!next.groups.length) throw new Error("Template cần ít nhất một khu vực.");
    return next;
  }

  render();
  DashboardSetupBridge.start({ onInit: initialize, onCollect: collect });
})();
