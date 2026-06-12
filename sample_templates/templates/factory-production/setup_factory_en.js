(function () {
  "use strict";
  var language = "en";
  var phase = "";
  var setupTitle = "";
  var isVi = language === "vi";
  var state = { baseConfig: {}, context: {}, items: [] };
  var els = {};

  var text = isVi ? {
    waiting: "Đang chờ dữ liệu từ ứng dụng.",
    ready: "Sẵn sàng cấu hình.",
    general: "Thông tin chung",
    dashboardTitle: "Tên dashboard",
    subtitle: "Mô tả ngắn",
    deviceKey: "Device key",
    billingAccount: "AccountID tính phí chung",
    historySource: "Nguồn lịch sử",
    factoryId: "Mã nhà máy",
    refreshMs: "Chu kỳ làm mới (ms)",
    pageSize: "Số dòng mỗi trang",
    telemetryRefreshMs: "Chu kỳ telemetry (ms)",
    expirySoonDays: "Số ngày cảnh báo hết hạn",
    co2KgPerBurnMinute: "kg CO2 / phút đốt",
    databaseSessionId: "Device key lưu database",
    mediaField: "Field media",
    defaultSignal: "Nội dung chờ mặc định",
    historyMs: "Khoảng đọc stream (ms)",
    title: "Tên",
    description: "Mô tả",
    add: "Thêm",
    clone: "Nhân bản",
    remove: "Xóa",
    advanced: "Nâng cao",
    fields: "Field thiết bị",
    commands: "Lệnh điều khiển",
    controls: "Công tắc",
    valves: "Van",
    widgets: "Thẻ",
    schedules: "Field hẹn giờ",
    group: "Nhóm",
    cabinet: "Tủ",
    switchCount: "Số công tắc",
    widgetCount: "Số thẻ",
    addWidget: "Thêm thẻ",
    atLeastOneWidget: "Cần giữ ít nhất một thẻ trong thiết bị.",
    controlCount: "Số công tắc",
    valveCount: "Số van",
    empty: "Chưa có mục nào.",
    atLeastOne: "Cần giữ ít nhất một mục.",
    enterTitle: "Hãy nhập tên.",
    missingDevice: " chưa có Device key.",
    invalid: "Cấu hình chưa hợp lệ.",
    addGroup: "Thêm nhóm",
    addCabinet: "Thêm tủ",
    row: "Dòng"
  } : {
    waiting: "Waiting for data from the app.",
    ready: "Ready to configure.",
    general: "General",
    dashboardTitle: "Dashboard name",
    subtitle: "Subtitle",
    deviceKey: "Device key",
    billingAccount: "Shared billing AccountID",
    historySource: "History source",
    factoryId: "Factory ID",
    refreshMs: "Refresh interval (ms)",
    pageSize: "Rows per page",
    telemetryRefreshMs: "Telemetry interval (ms)",
    expirySoonDays: "Expiry warning days",
    co2KgPerBurnMinute: "kg CO2 / burn minute",
    databaseSessionId: "Database device key",
    mediaField: "Media field",
    defaultSignal: "Default waiting content",
    historyMs: "Stream history window (ms)",
    title: "Title",
    description: "Description",
    add: "Add",
    clone: "Duplicate",
    remove: "Delete",
    advanced: "Advanced",
    fields: "Device fields",
    commands: "Commands",
    controls: "Switches",
    valves: "Valves",
    widgets: "Cards",
    schedules: "Schedule fields",
    group: "Group",
    cabinet: "Cabinet",
    switchCount: "Switch count",
    widgetCount: "Card count",
    addWidget: "Add card",
    atLeastOneWidget: "Keep at least one card in this device.",
    controlCount: "Switch count",
    valveCount: "Valve count",
    empty: "No items yet.",
    atLeastOne: "Keep at least one item.",
    enterTitle: "Enter a title.",
    missingDevice: " is missing a Device key.",
    invalid: "Configuration is not valid.",
    addGroup: "Add group",
    addCabinet: "Add cabinet",
    row: "Row"
  };

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value == null ? {} : value)); } catch (error) { return {}; }
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeTextValue(value) {
    var next = String(value == null ? "" : value).trim();
    var lowered = next.toLowerCase();
    if (!next || next === "0" || lowered === "null" || lowered === "undefined" || lowered === "nan" || next.indexOf("[object Object]") >= 0 || next.indexOf("NaN") >= 0) return "";
    return next;
  }

  function safeText(value, fallback) {
    return normalizeTextValue(value) || normalizeTextValue(fallback) || "";
  }

  function normalizeByIndex(items, factory) {
    return (Array.isArray(items) ? items : []).map(function (item, index) {
      var next = factory(index, item);
      if (item && item._advancedOpen && next) next._advancedOpen = true;
      return next;
    });
  }

  function numberValue(value, fallback, min, max) {
    var next = Number(value);
    if (!Number.isFinite(next)) next = fallback;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max)) next = Math.min(max, next);
    return next;
  }

  function intValue(value, fallback, min, max) {
    return Math.round(numberValue(value, fallback, min, max));
  }

  function countOptions(min, max, selected) {
    var html = "";
    for (var value = min; value <= max; value += 1) {
      html += '<option value="' + value + '"' + (Number(selected) === value ? " selected" : "") + '>' + value + '</option>';
    }
    return html;
  }

  function setupTitleText() {
    if (setupTitle) return setupTitle;
    if (false) return isVi ? "Cài đặt trang thẻ cơ bản" : "Set up basic cards";
    if (false) return isVi ? "Cài đặt tủ điện thông minh" : "Set up smart cabinet";
    if (false) return "Cài đặt hẹn giờ tưới tiêu";
    if (false) return "Cài đặt tưới cây tuần tự";
    if (false) return "Cài đặt lò đốt sinh khối";
    if (true) return isVi ? "Cài đặt giám sát nhà máy" : "Set up factory monitoring";
    if (false) return isVi ? "Cài đặt màn hình media" : "Set up media display";
    return isVi ? "Cài đặt trang mẫu" : "Set up sample dashboard";
  }

  function listTitle() {
    if (false) return isVi ? "Danh sách nhóm thiết bị" : "Device groups";
    if (false) return isVi ? "Danh sách tủ điện" : "Cabinet list";
    if (false) return "Danh sách khu tưới";
    if (false) return "Danh sách tuyến tưới";
    return "";
  }

  function addLabel() {
    if (false) return text.addGroup;
    if (false) return text.addCabinet;
    if (false) return "Thêm khu tưới";
    if (false) return "Thêm tuyến tưới";
    return text.add;
  }

  function generalFields() {
    if (false) {
      return [
        { key: "sessionId", label: text.deviceKey },
        { key: "syncId", label: text.billingAccount },
        { key: "field", label: text.mediaField },
        { key: "defaultSignal", label: text.defaultSignal, full: true, textarea: true },
        { key: "historyMs", label: text.historyMs, type: "number" }
      ];
    }
    if (true) {
      return [
        { key: "title", label: text.dashboardTitle, full: true },
        { key: "description", label: text.description, full: true, textarea: true },
        { key: "sessionId", label: text.deviceKey },
        { key: "syncId", label: text.billingAccount },
        { key: "factoryId", label: text.factoryId },
        { key: "refreshMs", label: text.refreshMs, type: "number" }
      ];
    }
    if (false) {
      return [
        { key: "title", label: text.dashboardTitle, full: true },
        { key: "subtitle", label: text.subtitle, full: true, textarea: true },
        { key: "databaseSessionId", label: text.databaseSessionId },
        { key: "syncId", label: text.billingAccount },
        { key: "pageSize", label: text.pageSize, type: "number" },
        { key: "telemetryRefreshMs", label: text.telemetryRefreshMs, type: "number" },
        { key: "expirySoonDays", label: text.expirySoonDays, type: "number" },
        { key: "co2KgPerBurnMinute", label: text.co2KgPerBurnMinute, type: "number", step: "0.01" }
      ];
    }
    if (false) {
      return [
        { key: "title", label: text.dashboardTitle, full: true },
        { key: "subtitle", label: text.subtitle, full: true },
        { key: "syncId", label: text.billingAccount }
      ];
    }
    if (false || false) {
      return [
        { key: "title", label: text.dashboardTitle, full: true },
        { key: "historySessionId", label: text.historySource },
        { key: "syncId", label: text.billingAccount }
      ];
    }
    return [
      { key: "syncId", label: text.billingAccount }
    ];
  }

  function generalFieldHtml(field) {
    var attrs = 'id="general-' + esc(field.key) + '" data-general-key="' + esc(field.key) + '"';
    if (field.type) attrs += ' type="' + esc(field.type) + '"';
    if (field.step) attrs += ' step="' + esc(field.step) + '"';
    var control = field.textarea
      ? '<textarea ' + attrs + '></textarea>'
      : '<input ' + attrs + ' />';
    return '<label class="' + (field.full ? "full" : "") + '">' + esc(field.label) + control + '</label>';
  }

  function setupShell() {
    var fields = generalFields().map(generalFieldHtml).join("");
    var withList = false || false || false || false;
    document.body.innerHTML = ''
      + '<main class="shell">'
      + '<header class="head"><div><h1>' + esc(setupTitleText()) + '</h1><div class="status" id="status">' + esc(text.waiting) + '</div></div><div class="badge" id="count-badge" ' + (withList ? "" : 'hidden') + '>0</div></header>'
      + '<section class="panel"><h2>' + esc(text.general) + '</h2><div class="grid">' + fields + '</div></section>'
      + (withList ? '<section class="panel"><div class="toolbar"><h2>' + esc(listTitle()) + '</h2><button type="button" data-action="add-item">' + esc(addLabel()) + '</button></div><div class="item-list" id="item-list"></div></section>' : "")
      + '</main>';
    els = {
      status: document.getElementById("status"),
      countBadge: document.getElementById("count-badge"),
      list: document.getElementById("item-list")
    };
  }

  function setGeneral(key, value) {
    var node = document.getElementById("general-" + key);
    if (node) node.value = value == null ? "" : String(value);
  }

  function getGeneral(key) {
    var node = document.getElementById("general-" + key);
    return safeText(node && node.value, "");
  }

  function makeWidget(type, index, source) {
    var label = safeText(source && source.label, (isVi ? "Thẻ " : "Card ") + (index + 1));
    var base;
    if (type === "switch") {
      base = { type: "switch", label: label, stateField: "O" + (index + 1), commandOn: "D1O" + (index + 1), commandOff: "D2O" + (index + 1), tone: "success" };
    } else if (type === "command") {
      base = { type: "command", label: label, command: "N5", buttonLabel: isVi ? "Chạy" : "Run", tone: "primary" };
    } else if (type === "input") {
      base = { type: "input", label: label, input: { key: "value", valueType: "number", field: "O" + (index + 1) }, submitCommand: "D1O" + (index + 1) + "'{value}'", buttonLabel: isVi ? "Gửi" : "Send", tone: "info" };
    } else if (type === "dual-input") {
      base = { type: "dual-input", label: label, field: "#1010", inputs: [{ key: "low", label: isVi ? "Thấp" : "Low", valueType: "number" }, { key: "high", label: isVi ? "Cao" : "High", valueType: "number" }], submitCommand: "#1010={low},{high}", buttonLabel: isVi ? "Lưu" : "Save", tone: "danger" };
    } else if (type === "line-chart") {
      base = { type: "line-chart", label: label, field: "temperature", unit: isVi ? "°C" : "°C", digits: 1, range: "24h", yDeltaMin: 10, tone: "warning" };
    } else {
      base = { type: "telemetry", label: label, field: "temperature", unit: "°C", digits: 1, tone: "primary" };
    }
    var next = Object.assign({}, base, clone(source));
    next.type = type;
    if (base.input || source && source.input) next.input = Object.assign({}, clone(base.input), clone(source && source.input));
    if (base.inputs || source && source.inputs) next.inputs = Array.isArray(source && source.inputs) ? clone(source.inputs) : clone(base.inputs);
    return next;
  }

  function defaultWidgetType(index) {
    return ["switch", "telemetry", "command", "input", "dual-input", "line-chart"][index % 6];
  }

  function makeBasicGroup(index, source) {
    var widgets = Array.isArray(source && source.widgets) ? source.widgets : [];
    var count = intValue(source && (source.widgetCount || widgets.length), widgets.length || 6, 1, 12);
    var nextWidgets = [];
    for (var i = 0; i < count; i += 1) {
      var existing = widgets[i] || {};
      nextWidgets.push(makeWidget(safeText(existing.type, defaultWidgetType(i)), i, existing));
    }
    return {
      title: safeText(source && source.title, isVi ? "Thiết bị " + (index + 1) : "Device " + (index + 1)),
      sessionId: safeText(source && source.sessionId, state.context.sessionId || ""),
      widgetCount: nextWidgets.length,
      widgets: nextWidgets
    };
  }

  function makeSmartSession(index, source) {
    var switchCount = intValue(source && source.switchCount, source && source.fields && source.fields.switch3 ? 3 : 2, 1, 3);
    var isThree = phase === "three";
    var fields = isThree ? {
      switch1: "O101.1",
      switch2: "O101.2",
      switch3: switchCount >= 3 ? "O101.3" : "",
      voltage1: "Voltage1_V",
      voltage2: "Voltage2_V",
      voltage3: "Voltage3_V",
      current1: "Current1_A",
      current2: "Current2_A",
      current3: "Current3_A",
      energy: "Energy_KWh",
      powerFactor: "Total_power_factor"
    } : {
      switch1: "O3",
      switch2: "O4",
      switch3: switchCount >= 3 ? "O5" : "",
      motor: "O2",
      voltage: "Voltage_V",
      current: "Current_A",
      energy: "Energy_Wh",
      powerFactor: "power_factor",
      temperature: "temperature",
      humidity: "humidity"
    };
    var commands = {
      switch1On: isThree ? "D1O101.1" : "D1O3",
      switch1Off: isThree ? "D2O101.1" : "D2O3",
      switch2On: isThree ? "D1O101.2" : "D1O4",
      switch2Off: isThree ? "D2O101.2" : "D2O4",
      switch3On: switchCount >= 3 ? (isThree ? "D1O101.3" : "D1O5") : "",
      switch3Off: switchCount >= 3 ? (isThree ? "D2O101.3" : "D2O5") : ""
    };
    fields = Object.assign({}, fields, clone(source && source.fields));
    commands = Object.assign({}, commands, clone(source && source.commands));
    if (switchCount < 3) {
      fields.switch3 = "";
      commands.switch3On = "";
      commands.switch3Off = "";
    }
    return {
      title: safeText(source && source.title, isVi ? "Tủ điện " + (index + 1) : "Cabinet " + (index + 1)),
      sessionId: safeText(source && source.sessionId, state.context.sessionId || ""),
      description: safeText(source && source.description, ""),
      switchCount: switchCount,
      fields: fields,
      commands: commands
    };
  }

  function makeIrrigationGroup(index, source) {
    var controls = Array.isArray(source && source.controls) ? source.controls : [];
    var count = intValue(source && (source.controlCount || controls.length), controls.length || 4, 1, 12);
    var nextControls = [];
    for (var i = 0; i < count; i += 1) {
      var ordinal = i + 1;
      var scheduleStart = 1021 + (i * 10);
      var generated = {
        label: i === 0 ? "Bơm tổng" : "Van khu " + String.fromCharCode(64 + i),
        stateField: "O" + (100 + ordinal),
        commandOn: 'N3,' + ordinal + ',"ON","<<username>>"',
        commandOff: 'N3,' + ordinal + ',"OFF","<<username>>"',
        scheduleFields: ["#" + scheduleStart, "#" + (scheduleStart + 1), "#" + (scheduleStart + 2), "#" + (scheduleStart + 3), "#" + (scheduleStart + 4)]
      };
      var existing = controls[i] || {};
      var merged = Object.assign({}, generated, clone(existing));
      merged.scheduleFields = Array.isArray(existing.scheduleFields) && existing.scheduleFields.length ? existing.scheduleFields.slice(0, 5) : generated.scheduleFields;
      nextControls.push(merged);
    }
    return {
      title: safeText(source && source.title, "Khu tưới " + (index + 1)),
      sessionId: safeText(source && source.sessionId, state.context.sessionId || ""),
      controlCount: count,
      controls: nextControls
    };
  }

  function makeSequentialDevice(index, source) {
    var pump = source && source.pump && typeof source.pump === "object" ? source.pump : {};
    var valves = source && source.valves && typeof source.valves === "object" ? source.valves : {};
    var count = intValue(source && (source.valveCount || valves.count), valves.count || 12, 1, 50);
    var scheduleStart = 1021 + (index * 10);
    var scheduleFields = Array.isArray(pump.scheduleFields) && pump.scheduleFields.length
      ? pump.scheduleFields.slice(0, 5)
      : ["#" + scheduleStart, "#" + (scheduleStart + 1), "#" + (scheduleStart + 2), "#" + (scheduleStart + 3), "#" + (scheduleStart + 4)];
    return {
      title: safeText(source && source.title, "Tuyến tưới " + (index + 1)),
      sessionId: safeText(source && source.sessionId, state.context.sessionId || ""),
      valveCount: count,
      pump: {
        label: safeText(pump.label, "Máy bơm " + (index + 1)),
        stateField: safeText(pump.stateField, "O" + (100 + (index * 10))),
        commandOn: safeText(pump.commandOn, 'N3,"ON",0'),
        commandOff: safeText(pump.commandOff, 'N3,"OFF",0'),
        scheduleFields: scheduleFields
      },
      valves: {
        count: count,
        stateField: safeText(valves.stateField, "O" + (101 + (index * 10))),
        batteryField: safeText(valves.batteryField, "B" + (101 + (index * 10))),
        durationField: safeText(valves.durationField, "#" + (1005 + index)),
        commandTemplate: safeText(valves.commandTemplate, 'N3,"{action}",{valveId}')
      }
    };
  }

  function initialize(payload) {
    var config = payload && payload.config && typeof payload.config === "object" ? payload.config : {};
    state.baseConfig = clone(config);
    state.context = clone(payload && payload.context ? payload.context : {});

    if (false) {
      setGeneral("sessionId", safeText(config.sessionId, state.context.sessionId || ""));
      setGeneral("syncId", safeText(config.syncId, state.context.syncId || ""));
      setGeneral("field", safeText(config.field, "media"));
      setGeneral("defaultSignal", safeText(config.defaultSignal, "text@ani1:Waiting for media"));
      setGeneral("historyMs", intValue(config.historyMs, 24 * 60 * 60 * 1000, 0, 7 * 24 * 60 * 60 * 1000));
    } else if (true) {
      setGeneral("title", safeText(config.title, isVi ? "Giám sát sản xuất nhà máy" : "Factory Production Monitoring"));
      setGeneral("description", safeText(config.description, ""));
      setGeneral("sessionId", safeText(config.sessionId, state.context.sessionId || ""));
      setGeneral("syncId", safeText(config.syncId, state.context.syncId || ""));
      setGeneral("factoryId", safeText(config.factoryId, ""));
      setGeneral("refreshMs", numberValue(config.refreshMs, 30000, 10000));
    } else if (false) {
      setGeneral("title", safeText(config.title, "Quản lý lò đốt sinh khối"));
      setGeneral("subtitle", safeText(config.subtitle, ""));
      setGeneral("databaseSessionId", safeText(config.databaseSessionId, state.context.sessionId || ""));
      setGeneral("syncId", safeText(config.syncId, state.context.syncId || ""));
      setGeneral("pageSize", intValue(config.pageSize, 50, 1, 500));
      setGeneral("telemetryRefreshMs", intValue(config.telemetryRefreshMs, 30000, 5000, 3600000));
      setGeneral("expirySoonDays", intValue(config.expirySoonDays, 30, 1, 365));
      setGeneral("co2KgPerBurnMinute", numberValue(config.co2KgPerBurnMinute, 2.77, 0));
    } else if (false) {
      setGeneral("title", safeText(config.title, isVi ? "Trang thẻ cơ bản" : "Basic Cards Dashboard"));
      setGeneral("subtitle", safeText(config.subtitle, ""));
      setGeneral("syncId", safeText(config.syncId, state.context.syncId || ""));
      var groups = Array.isArray(config.groups) ? config.groups : [];
      state.items = groups.length ? normalizeByIndex(groups, makeBasicGroup) : [makeBasicGroup(0, {})];
    } else if (false) {
      setGeneral("syncId", safeText(config.syncId, state.context.syncId || ""));
      var sessions = Array.isArray(config.sessions) ? config.sessions : [];
      state.items = sessions.length ? normalizeByIndex(sessions, makeSmartSession) : [makeSmartSession(0, {})];
    } else if (false) {
      setGeneral("title", safeText(config.title, "Hẹn giờ tưới tiêu"));
      var history = config.history && typeof config.history === "object" ? config.history : {};
      setGeneral("historySessionId", safeText(history.sessionId, state.context.sessionId || ""));
      setGeneral("syncId", safeText(history.syncId || config.syncId, state.context.syncId || ""));
      var irrigationGroups = Array.isArray(config.groups) ? config.groups : [];
      state.items = irrigationGroups.length ? normalizeByIndex(irrigationGroups, makeIrrigationGroup) : [makeIrrigationGroup(0, {})];
    } else if (false) {
      setGeneral("title", safeText(config.title, "Tưới cây tuần tự"));
      var sequentialHistory = config.history && typeof config.history === "object" ? config.history : {};
      setGeneral("historySessionId", safeText(sequentialHistory.sessionId, state.context.sessionId || ""));
      setGeneral("syncId", safeText(sequentialHistory.syncId || config.syncId, state.context.syncId || ""));
      var sequentialDevices = Array.isArray(config.devices) ? config.devices : [];
      state.items = sequentialDevices.length ? normalizeByIndex(sequentialDevices, makeSequentialDevice) : [makeSequentialDevice(0, {})];
    }

    els.status.textContent = text.ready;
    render();
  }

  function readItemsFromDom() {
    if (!els.list) return;
    var cards = Array.prototype.slice.call(els.list.querySelectorAll("[data-item-index]"));
    state.items = cards.map(function (card, index) {
      var current = state.items[index] || {};
      var read = function (selector) {
        var node = card.querySelector(selector);
        return node ? safeText(node.value, "") : "";
      };

      if (false) {
        var group = {
          title: read('[data-basic="title"]'),
          sessionId: read('[data-basic="sessionId"]'),
          widgetCount: 0,
          widgets: clone(current.widgets || [])
        };
        card.querySelectorAll("[data-widget-index][data-widget-field]").forEach(function (node) {
          var widgetIndex = Number(node.getAttribute("data-widget-index") || 0);
          var field = node.getAttribute("data-widget-field");
          if (!group.widgets[widgetIndex]) group.widgets[widgetIndex] = {};
          group.widgets[widgetIndex][field] = safeText(node.value, "");
        });
        card.querySelectorAll("[data-widget-index][data-widget-input-field]").forEach(function (node) {
          var widgetIndex = Number(node.getAttribute("data-widget-index") || 0);
          var field = node.getAttribute("data-widget-input-field");
          if (!group.widgets[widgetIndex]) group.widgets[widgetIndex] = {};
          if (!group.widgets[widgetIndex].input) group.widgets[widgetIndex].input = {};
          group.widgets[widgetIndex].input[field] = safeText(node.value, "");
        });
        group.widgetCount = Math.max(1, Math.min(12, group.widgets.length || 1));
        return group;
      }

      if (false) {
        var session = {
          title: read('[data-basic="title"]'),
          sessionId: read('[data-basic="sessionId"]'),
          description: read('[data-basic="description"]'),
          switchCount: intValue(read('[data-basic="switchCount"]'), 2, 1, 3),
          fields: {},
          commands: {}
        };
        card.querySelectorAll("[data-field-key]").forEach(function (node) {
          session.fields[node.getAttribute("data-field-key")] = safeText(node.value, "");
        });
        card.querySelectorAll("[data-command-key]").forEach(function (node) {
          session.commands[node.getAttribute("data-command-key")] = safeText(node.value, "");
        });
        return session;
      }

      if (false) {
        var device = {
          title: read('[data-basic="title"]'),
          sessionId: read('[data-basic="sessionId"]'),
          valveCount: intValue(read('[data-basic="valveCount"]'), 12, 1, 50),
          pump: clone(current.pump || {}),
          valves: clone(current.valves || {})
        };
        card.querySelectorAll("[data-seq-pump]").forEach(function (node) {
          device.pump[node.getAttribute("data-seq-pump")] = safeText(node.value, "");
        });
        var scheduleFields = [];
        card.querySelectorAll("[data-seq-schedule-index]").forEach(function (node) {
          var scheduleIndex = Number(node.getAttribute("data-seq-schedule-index") || 0);
          scheduleFields[scheduleIndex] = safeText(node.value, "");
        });
        device.pump.scheduleFields = scheduleFields;
        card.querySelectorAll("[data-seq-valves]").forEach(function (node) {
          device.valves[node.getAttribute("data-seq-valves")] = safeText(node.value, "");
        });
        device.valves.count = device.valveCount;
        return device;
      }

      var group = {
        title: read('[data-basic="title"]'),
        sessionId: read('[data-basic="sessionId"]'),
        controlCount: intValue(read('[data-basic="controlCount"]'), 4, 1, 12),
        controls: clone(current.controls || [])
      };
      card.querySelectorAll("[data-control-index][data-control-field]").forEach(function (node) {
        var controlIndex = Number(node.getAttribute("data-control-index") || 0);
        var field = node.getAttribute("data-control-field");
        if (!group.controls[controlIndex]) group.controls[controlIndex] = {};
        group.controls[controlIndex][field] = safeText(node.value, "");
      });
      card.querySelectorAll("[data-control-index][data-schedule-index]").forEach(function (node) {
        var controlIndex = Number(node.getAttribute("data-control-index") || 0);
        var scheduleIndex = Number(node.getAttribute("data-schedule-index") || 0);
        if (!group.controls[controlIndex]) group.controls[controlIndex] = {};
        if (!Array.isArray(group.controls[controlIndex].scheduleFields)) group.controls[controlIndex].scheduleFields = [];
        group.controls[controlIndex].scheduleFields[scheduleIndex] = safeText(node.value, "");
      });
      return group;
    });
    state.items.forEach(function (item, index) {
      var details = cards[index] && cards[index].querySelector("details");
      if (item && details && details.open) item._advancedOpen = true;
    });
  }

  function normalizeItems(preserveAdvanced) {
    if (false) state.items = normalizeByIndex(state.items, makeBasicGroup);
    if (false) state.items = normalizeByIndex(state.items, makeSmartSession);
    if (false) state.items = normalizeByIndex(state.items, makeIrrigationGroup);
    if (false) state.items = normalizeByIndex(state.items, makeSequentialDevice);
  }

  function render() {
    if (!els.list) {
      notifyResize();
      return;
    }
    normalizeItems(true);
    els.list.innerHTML = state.items.length ? state.items.map(renderItem).join("") : '<div class="empty">' + esc(text.empty) + '</div>';
    els.countBadge.textContent = state.items.length + " " + (false ? text.cabinet : false ? "tuyến" : text.group);
    notifyResize();
  }

  function renderItem(item, index) {
    if (false) return renderBasicGroup(item, index);
    if (false) return renderSmartSession(item, index);
    if (false) return renderSequentialDevice(item, index);
    return renderIrrigationGroup(item, index);
  }

  function cardShell(itemTitle, index, basicHtml, advancedHtml) {
    var detailsOpen = state.items[index] && state.items[index]._advancedOpen ? " open" : "";
    return '<article class="item-card" data-item-index="' + index + '">'
      + '<div class="item-top"><div class="item-title"><span class="badge">#' + (index + 1) + '</span><strong>' + esc(itemTitle) + '</strong></div>'
      + '<div class="item-actions"><button class="secondary" type="button" data-action="clone-item" data-index="' + index + '">' + esc(text.clone) + '</button>'
      + '<button class="danger" type="button" data-action="delete-item" data-index="' + index + '">' + esc(text.remove) + '</button></div></div>'
      + basicHtml
      + '<details' + detailsOpen + '><summary>' + esc(text.advanced) + '</summary><div class="advanced-body">' + advancedHtml + '</div></details>'
      + '</article>';
  }

  function renderBasicGroup(group, index) {
    var basic = '<div class="grid-3">'
      + '<label>' + esc(text.title) + '<input data-basic="title" value="' + esc(group.title) + '" /></label>'
      + '<label>' + esc(text.deviceKey) + '<input data-basic="sessionId" value="' + esc(group.sessionId) + '" /></label>'
      + '<label>' + esc(text.widgetCount) + '<input value="' + esc(group.widgets.length) + '" readonly /></label>'
      + '</div>';
    var advanced = '<div class="toolbar"><h3>' + esc(text.widgets) + '</h3><button type="button" data-action="add-widget" data-group-index="' + index + '">' + esc(text.addWidget) + '</button></div>'
      + '<div class="advanced-section">'
      + group.widgets.map(function (widget, widgetIndex) { return renderWidget(widget, widgetIndex, index); }).join("")
      + '</div>';
    return cardShell(safeText(group.title, text.group + " " + (index + 1)), index, basic, advanced);
  }

  function widgetTypeOptions(selected) {
    var types = ["telemetry", "switch", "command", "input", "dual-input", "line-chart"];
    return types.map(function (type) {
      return '<option value="' + type + '"' + (type === selected ? " selected" : "") + '>' + type + '</option>';
    }).join("");
  }

  function renderWidget(widget, index, groupIndex) {
    var type = safeText(widget.type, "telemetry");
    var extra = "";
    if (type === "switch") {
      extra = fieldLine(index, "stateField", widget.stateField) + fieldLine(index, "commandOn", widget.commandOn) + fieldLine(index, "commandOff", widget.commandOff);
    } else if (type === "command") {
      extra = fieldLine(index, "command", widget.command) + fieldLine(index, "buttonLabel", widget.buttonLabel);
    } else if (type === "input") {
      extra = inputFieldLine(index, "field", widget.input && widget.input.field) + fieldLine(index, "submitCommand", widget.submitCommand) + fieldLine(index, "buttonLabel", widget.buttonLabel);
    } else if (type === "dual-input") {
      extra = fieldLine(index, "field", widget.field) + fieldLine(index, "submitCommand", widget.submitCommand) + fieldLine(index, "buttonLabel", widget.buttonLabel);
    } else {
      extra = fieldLine(index, "field", widget.field) + fieldLine(index, "unit", widget.unit) + fieldLine(index, "digits", widget.digits);
      if (type === "line-chart") extra += fieldLine(index, "range", widget.range);
    }
    return '<div class="advanced-section">'
      + '<div class="item-top"><div class="item-title"><span class="badge">#' + (index + 1) + '</span><strong>' + esc(widget.label || (text.widgets + " " + (index + 1))) + '</strong></div>'
      + '<div class="item-actions"><button class="secondary" type="button" data-action="clone-widget" data-group-index="' + groupIndex + '" data-widget-index="' + index + '">' + esc(text.clone) + '</button>'
      + '<button class="danger" type="button" data-action="delete-widget" data-group-index="' + groupIndex + '" data-widget-index="' + index + '">' + esc(text.remove) + '</button></div></div>'
      + '<div class="grid-3">'
      + '<label>type<select data-widget-index="' + index + '" data-widget-field="type">' + widgetTypeOptions(type) + '</select></label>'
      + fieldLine(index, "label", widget.label)
      + extra
      + fieldLine(index, "tone", widget.tone)
      + '</div></div>';
  }

  function fieldLine(index, key, value) {
    return '<label>' + esc(key) + '<input data-widget-index="' + index + '" data-widget-field="' + esc(key) + '" value="' + esc(value == null ? "" : value) + '" /></label>';
  }

  function inputFieldLine(index, key, value) {
    return '<label>input.' + esc(key) + '<input data-widget-index="' + index + '" data-widget-input-field="' + esc(key) + '" value="' + esc(value == null ? "" : value) + '" /></label>';
  }

  function renderSmartSession(session, index) {
    var basic = '<div class="grid-3">'
      + '<label>' + esc(text.title) + '<input data-basic="title" value="' + esc(session.title) + '" /></label>'
      + '<label>' + esc(text.deviceKey) + '<input data-basic="sessionId" value="' + esc(session.sessionId) + '" /></label>'
      + '<label>' + esc(text.switchCount) + '<select data-basic="switchCount">' + countOptions(1, 3, session.switchCount) + '</select></label>'
      + '<label class="full">' + esc(text.description) + '<input data-basic="description" value="' + esc(session.description) + '" /></label>'
      + '</div>';
    var advanced = '<div class="advanced-section"><h3>' + esc(text.fields) + '</h3><div class="grid-3">'
      + Object.keys(session.fields || {}).map(function (key) {
        return '<label>' + esc(key) + '<input data-field-key="' + esc(key) + '" value="' + esc(session.fields[key]) + '" /></label>';
      }).join("")
      + '</div></div><div class="advanced-section"><h3>' + esc(text.commands) + '</h3><div class="grid-3">'
      + Object.keys(session.commands || {}).map(function (key) {
        return '<label>' + esc(key) + '<input data-command-key="' + esc(key) + '" value="' + esc(session.commands[key]) + '" /></label>';
      }).join("")
      + '</div></div>';
    return cardShell(safeText(session.title, text.cabinet + " " + (index + 1)), index, basic, advanced);
  }

  function renderIrrigationGroup(group, index) {
    var basic = '<div class="grid-3">'
      + '<label>' + esc(text.title) + '<input data-basic="title" value="' + esc(group.title) + '" /></label>'
      + '<label>' + esc(text.deviceKey) + '<input data-basic="sessionId" value="' + esc(group.sessionId) + '" /></label>'
      + '<label>' + esc(text.controlCount) + '<select data-basic="controlCount">' + countOptions(1, 12, group.controlCount) + '</select></label>'
      + '</div>';
    var advanced = '<div class="advanced-section"><h3>' + esc(text.controls) + '</h3>'
      + group.controls.map(renderIrrigationControl).join("")
      + '</div>';
    return cardShell(safeText(group.title, text.group + " " + (index + 1)), index, basic, advanced);
  }

  function renderIrrigationControl(control, index) {
    var schedule = Array.isArray(control.scheduleFields) ? control.scheduleFields : [];
    return '<div class="advanced-section"><h3>' + esc(control.label || (text.controls + " " + (index + 1))) + '</h3><div class="grid-3">'
      + controlField(index, "label", control.label)
      + controlField(index, "stateField", control.stateField)
      + controlField(index, "commandOn", control.commandOn)
      + controlField(index, "commandOff", control.commandOff)
      + '</div><div class="grid-4">'
      + [0, 1, 2, 3, 4].map(function (slot) {
        return '<label>' + esc(text.row + " " + (slot + 1)) + '<input data-control-index="' + index + '" data-schedule-index="' + slot + '" value="' + esc(schedule[slot] || "") + '" /></label>';
      }).join("")
      + '</div></div>';
  }

  function renderSequentialDevice(device, index) {
    var pump = device.pump || {};
    var valves = device.valves || {};
    var schedule = Array.isArray(pump.scheduleFields) ? pump.scheduleFields : [];
    var basic = '<div class="grid-3">'
      + '<label>' + esc(text.title) + '<input data-basic="title" value="' + esc(device.title) + '" /></label>'
      + '<label>' + esc(text.deviceKey) + '<input data-basic="sessionId" value="' + esc(device.sessionId) + '" /></label>'
      + '<label>' + esc(text.valveCount) + '<select data-basic="valveCount">' + countOptions(1, 50, device.valveCount) + '</select></label>'
      + '</div>';
    var advanced = '<div class="advanced-section"><h3>Máy bơm</h3><div class="grid-3">'
      + sequentialPumpField("label", pump.label)
      + sequentialPumpField("stateField", pump.stateField)
      + sequentialPumpField("commandOn", pump.commandOn)
      + sequentialPumpField("commandOff", pump.commandOff)
      + '</div><div class="grid-4">'
      + [0, 1, 2, 3, 4].map(function (slot) {
        return '<label>' + esc(text.row + " " + (slot + 1)) + '<input data-seq-schedule-index="' + slot + '" value="' + esc(schedule[slot] || "") + '" /></label>';
      }).join("")
      + '</div></div>'
      + '<div class="advanced-section"><h3>' + esc(text.valves) + '</h3><div class="grid-3">'
      + sequentialValveField("stateField", valves.stateField)
      + sequentialValveField("batteryField", valves.batteryField)
      + sequentialValveField("durationField", valves.durationField)
      + sequentialValveField("commandTemplate", valves.commandTemplate)
      + '</div></div>';
    return cardShell(safeText(device.title, "Tuyến tưới " + (index + 1)), index, basic, advanced);
  }

  function sequentialPumpField(key, value) {
    return '<label>' + esc(key) + '<input data-seq-pump="' + esc(key) + '" value="' + esc(value == null ? "" : value) + '" /></label>';
  }

  function sequentialValveField(key, value) {
    return '<label>' + esc(key) + '<input data-seq-valves="' + esc(key) + '" value="' + esc(value == null ? "" : value) + '" /></label>';
  }

  function controlField(index, key, value) {
    return '<label>' + esc(key) + '<input data-control-index="' + index + '" data-control-field="' + esc(key) + '" value="' + esc(value == null ? "" : value) + '" /></label>';
  }

  function buildConfig() {
    readItemsFromDom();
    normalizeItems(true);
    var next = clone(state.baseConfig);

    if (false) {
      next.sessionId = safeText(getGeneral("sessionId"), state.context.sessionId || "");
      next.syncId = safeText(getGeneral("syncId"), state.context.syncId || "");
      next.field = safeText(getGeneral("field"), "media");
      next.defaultSignal = safeText(getGeneral("defaultSignal"), "text@ani1:Waiting for media");
      next.historyMs = intValue(getGeneral("historyMs"), 24 * 60 * 60 * 1000, 0, 7 * 24 * 60 * 60 * 1000);
      return next;
    }

    if (true) {
      next.title = safeText(getGeneral("title"), "");
      if (!next.title) throw new Error(text.enterTitle);
      next.description = getGeneral("description");
      next.sessionId = safeText(getGeneral("sessionId"), state.context.sessionId || "");
      next.syncId = safeText(getGeneral("syncId"), state.context.syncId || "");
      next.factoryId = getGeneral("factoryId");
      next.refreshMs = intValue(getGeneral("refreshMs"), 30000, 10000, 3600000);
      return next;
    }

    if (false) {
      next.title = safeText(getGeneral("title"), "");
      if (!next.title) throw new Error(text.enterTitle);
      next.subtitle = getGeneral("subtitle");
      next.databaseSessionId = safeText(getGeneral("databaseSessionId"), state.context.sessionId || "");
      next.syncId = safeText(getGeneral("syncId"), state.context.syncId || "");
      next.pageSize = intValue(getGeneral("pageSize"), 50, 1, 500);
      next.telemetryRefreshMs = intValue(getGeneral("telemetryRefreshMs"), 30000, 5000, 3600000);
      next.expirySoonDays = intValue(getGeneral("expirySoonDays"), 30, 1, 365);
      next.co2KgPerBurnMinute = numberValue(getGeneral("co2KgPerBurnMinute"), 2.77, 0);
      return next;
    }

    if (!state.items.length) throw new Error(text.atLeastOne);

    if (false) {
      next.locale = next.locale || language;
      next.title = safeText(getGeneral("title"), "");
      if (!next.title) throw new Error(text.enterTitle);
      next.subtitle = getGeneral("subtitle");
      next.syncId = safeText(getGeneral("syncId"), state.context.syncId || "");
      next.groups = state.items.map(function (group, index) {
        if (!group.sessionId) throw new Error(text.group + " #" + (index + 1) + text.missingDevice);
        return {
          title: safeText(group.title, text.group + " " + (index + 1)),
          sessionId: group.sessionId,
          widgets: group.widgets.slice(0, group.widgetCount)
        };
      });
      return next;
    }

    if (false) {
      next.syncId = safeText(getGeneral("syncId"), state.context.syncId || "");
      next.sessions = state.items.map(function (session, index) {
        if (!session.sessionId) throw new Error(text.cabinet + " #" + (index + 1) + text.missingDevice);
        return {
          title: safeText(session.title, text.cabinet + " " + (index + 1)),
          sessionId: session.sessionId,
          description: safeText(session.description, ""),
          fields: session.fields || {},
          commands: session.commands || {}
        };
      });
      return next;
    }

    if (false) {
      next.title = safeText(getGeneral("title"), "");
      if (!next.title) throw new Error(text.enterTitle);
      next.syncId = safeText(getGeneral("syncId"), state.context.syncId || "");
      next.history = Object.assign({}, clone(next.history), {
        sessionId: safeText(getGeneral("historySessionId"), state.context.sessionId || ""),
        syncId: next.syncId,
        macro: safeText(next.history && next.history.macro, "irrigation-control-history"),
        pageSize: Number(next.history && next.history.pageSize) || 100
      });
      next.devices = state.items.map(function (device, index) {
        if (!device.sessionId) throw new Error("Tuyến tưới #" + (index + 1) + text.missingDevice);
        return {
          title: safeText(device.title, "Tuyến tưới " + (index + 1)),
          sessionId: device.sessionId,
          pump: {
            label: safeText(device.pump && device.pump.label, "Máy bơm"),
            stateField: safeText(device.pump && device.pump.stateField, ""),
            commandOn: safeText(device.pump && device.pump.commandOn, ""),
            commandOff: safeText(device.pump && device.pump.commandOff, ""),
            scheduleFields: ((device.pump && device.pump.scheduleFields) || []).filter(Boolean).slice(0, 5)
          },
          valves: {
            count: intValue(device.valveCount || device.valves && device.valves.count, 12, 1, 50),
            stateField: safeText(device.valves && device.valves.stateField, ""),
            batteryField: safeText(device.valves && device.valves.batteryField, ""),
            durationField: safeText(device.valves && device.valves.durationField, ""),
            commandTemplate: safeText(device.valves && device.valves.commandTemplate, "")
          }
        };
      });
      if (!next.locale) next.locale = "vi";
      return next;
    }

    next.title = safeText(getGeneral("title"), "");
    if (!next.title) throw new Error(text.enterTitle);
    next.syncId = safeText(getGeneral("syncId"), state.context.syncId || "");
    next.history = Object.assign({}, clone(next.history), {
      sessionId: safeText(getGeneral("historySessionId"), state.context.sessionId || ""),
      syncId: next.syncId,
      macro: safeText(next.history && next.history.macro, "irrigation-control-history"),
      pageSize: Number(next.history && next.history.pageSize) || 100
    });
    next.groups = state.items.map(function (group, index) {
      if (!group.sessionId) throw new Error(text.group + " #" + (index + 1) + text.missingDevice);
      return {
        title: safeText(group.title, "Khu tưới " + (index + 1)),
        sessionId: group.sessionId,
        controls: group.controls.slice(0, group.controlCount).map(function (control) {
          return {
            label: safeText(control.label, ""),
            stateField: safeText(control.stateField, ""),
            commandOn: safeText(control.commandOn, ""),
            commandOff: safeText(control.commandOff, ""),
            scheduleFields: (control.scheduleFields || []).filter(Boolean).slice(0, 5)
          };
        })
      };
    });
    if (!next.locale) next.locale = "vi";
    return next;
  }

  function sendError(message) {
    DashboardSetupBridge.error(String(message || text.invalid));
  }

  function notifyResize() {
    window.requestAnimationFrame(function () {
      var height = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 560);
      DashboardSetupBridge.resize();
    });
  }

  function blankItem() {
    if (false) return { title: isVi ? "Thiết bị " + (state.items.length + 1) : "Device " + (state.items.length + 1), sessionId: state.context.sessionId || "", widgetCount: 3 };
    if (false) return { title: isVi ? "Tủ điện " + (state.items.length + 1) : "Cabinet " + (state.items.length + 1), sessionId: state.context.sessionId || "", description: "", switchCount: 2 };
    if (false) return { title: "Tuyến tưới " + (state.items.length + 1), sessionId: state.context.sessionId || "", valveCount: 12 };
    return { title: "Khu tưới " + (state.items.length + 1), sessionId: state.context.sessionId || "", controlCount: 4 };
  }

  function cloneBasic(source) {
    if (false) {
      var widgets = Array.isArray(source.widgets) ? clone(source.widgets) : [];
      return {
        title: safeText(source.title, text.group) + " copy",
        sessionId: source.sessionId || state.context.sessionId || "",
        widgetCount: widgets.length || source.widgetCount || 3,
        widgets: widgets
      };
    }
    if (false) return { title: safeText(source.title, text.cabinet) + " copy", sessionId: source.sessionId || state.context.sessionId || "", description: source.description || "", switchCount: source.switchCount || 2 };
    if (false) return { title: safeText(source.title, "Tuyến tưới") + " copy", sessionId: source.sessionId || state.context.sessionId || "", valveCount: source.valveCount || source.valves && source.valves.count || 12, pump: clone(source.pump || {}), valves: clone(source.valves || {}) };
    return { title: safeText(source.title, text.group) + " copy", sessionId: source.sessionId || state.context.sessionId || "", controlCount: source.controlCount || 4 };
  }

  function handleWidgetAction(action, groupIndex, widgetIndex) {
    if (true || groupIndex < 0 || !state.items[groupIndex]) return false;
    var group = state.items[groupIndex];
    var widgets = Array.isArray(group.widgets) ? group.widgets : [];
    if (action === "add-widget") {
      if (widgets.length >= 12) {
        sendError(isVi ? "Mỗi thiết bị tối đa 12 thẻ." : "Each device supports up to 12 cards.");
        return true;
      }
      widgets.push(makeWidget(defaultWidgetType(widgets.length), widgets.length, {}));
      group.widgets = widgets;
      group.widgetCount = widgets.length;
      render();
      return true;
    }
    if (action === "clone-widget" && widgetIndex >= 0 && widgets[widgetIndex]) {
      if (widgets.length >= 12) {
        sendError(isVi ? "Mỗi thiết bị tối đa 12 thẻ." : "Each device supports up to 12 cards.");
        return true;
      }
      var cloned = clone(widgets[widgetIndex]);
      cloned.label = safeText(cloned.label, text.widgets) + " copy";
      widgets.splice(widgetIndex + 1, 0, cloned);
      group.widgets = widgets;
      group.widgetCount = widgets.length;
      render();
      return true;
    }
    if (action === "delete-widget" && widgetIndex >= 0) {
      if (widgets.length <= 1) {
        sendError(text.atLeastOneWidget);
        return true;
      }
      widgets.splice(widgetIndex, 1);
      group.widgets = widgets;
      group.widgetCount = widgets.length;
      render();
      return true;
    }
    return false;
  }

  function handleAction(action, index) {
    readItemsFromDom();
    if (handleWidgetAction(action, index, -1)) return;
    if (action === "add-item") {
      state.items.push(blankItem());
      normalizeItems(true);
      render();
      return;
    }
    if (action === "clone-item" && index >= 0) {
      var clonedItem = cloneBasic(state.items[index] || {});
      if (state.items[index] && state.items[index]._advancedOpen) clonedItem._advancedOpen = true;
      state.items.splice(index + 1, 0, clonedItem);
      normalizeItems(true);
      render();
      return;
    }
    if (action === "delete-item" && index >= 0) {
      if (state.items.length <= 1) {
        sendError(text.atLeastOne);
        return;
      }
      state.items.splice(index, 1);
      normalizeItems(false);
      render();
    }
  }

  setupShell();

  document.addEventListener("click", function (event) {
    var target = event.target.closest("[data-action]");
    if (!target) return;
    var action = target.getAttribute("data-action");
    if (action === "add-widget" || action === "clone-widget" || action === "delete-widget") {
      readItemsFromDom();
      handleWidgetAction(
        action,
        Number(target.getAttribute("data-group-index") || -1),
        Number(target.getAttribute("data-widget-index") || -1)
      );
      return;
    }
    handleAction(action, Number(target.getAttribute("data-index") || -1));
  });

  document.addEventListener("change", function (event) {
    if (!event.target.matches('[data-basic="switchCount"], [data-basic="controlCount"], [data-basic="valveCount"], [data-widget-field="type"]')) return;
    readItemsFromDom();
    normalizeItems(false);
    render();
  });

  document.addEventListener("input", notifyResize);

  DashboardSetupBridge.start({ onInit: initialize, onCollect: buildConfig });
})();
