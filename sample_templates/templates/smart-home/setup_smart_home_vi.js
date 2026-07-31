(function () {
  "use strict";

  var TYPES = ["telemetry", "switch", "command", "angle", "input", "dual-input", "line-chart", "image"];
  var TONES = ["primary", "success", "info", "warning", "danger", "sensor", "alarm"];
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

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? {} : value));
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safe(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || String(fallback == null ? "" : fallback).trim();
  }

  function numberValue(value, fallback, min) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) parsed = Number(fallback);
    if (Number.isFinite(min)) parsed = Math.max(min, parsed);
    return parsed;
  }

  function options(values, selected) {
    return values.map(function (value) {
      return '<option value="' + esc(value) + '"' + (value === selected ? " selected" : "") + ">" + esc(value) + "</option>";
    }).join("");
  }

  function field(label, key, value, type, extra) {
    return '<label>' + esc(label) + '<input data-widget-field="' + esc(key) + '" type="' + esc(type || "text") +
      '" value="' + esc(value == null ? "" : value) + '"' + (extra ? " " + extra : "") + "></label>";
  }

  function defaultWidget(type, index) {
    var number = index + 1;
    if (type === "switch") {
      return { type: type, label: "Công tắc " + number, stateField: "O" + number, commandOn: "D1O" + number, commandOff: "D2O" + number, tone: "success" };
    }
    if (type === "command") {
      return { type: type, label: "Lệnh " + number, command: "D1O" + number, buttonLabel: "Gửi lệnh", tone: "danger" };
    }
    if (type === "angle") {
      return { type: type, label: "Góc điều khiển " + number, field: "angle_" + number, submitCommand: "D1O" + number + "'{value}'", tone: "primary" };
    }
    if (type === "input") {
      return { type: type, label: "Giá trị " + number, input: { field: "value_" + number }, submitCommand: "SET,{value}", buttonLabel: "Lưu", tone: "info" };
    }
    if (type === "dual-input") {
      return {
        type: type,
        label: "Khoảng giá trị " + number,
        field: "range_" + number,
        inputs: [
          { key: "low", label: "Thấp", valueType: "number" },
          { key: "high", label: "Cao", valueType: "number" }
        ],
        submitCommand: "SET,{low},{high}",
        buttonLabel: "Lưu",
        tone: "warning"
      };
    }
    if (type === "line-chart") {
      return { type: type, label: "Biểu đồ " + number, field: "temperature", unit: "°C", digits: 1, range: "24h", yDeltaMin: 8, tone: "info" };
    }
    if (type === "image") {
      return { type: type, label: "Hình ảnh " + number, src: "/sample_dashboards/smart-home/sample.svg", alt: "Hình ảnh nhà thông minh", tone: "primary" };
    }
    return { type: "telemetry", label: "Cảm biến " + number, field: "sensor_" + number, unit: "", digits: 1, tone: "primary" };
  }

  function normalizeConfig(config) {
    var next = clone(config && Object.keys(config).length ? config : DEFAULT_CONFIG);
    next.locale = safe(next.locale, "vi");
    next.groups = Array.isArray(next.groups) ? next.groups : [];
    next.groups.forEach(function (group, groupIndex) {
      group.title = safe(group.title, "Khu vực " + (groupIndex + 1));
      group.sessionId = safe(group.sessionId, state.context.sessionId || "");
      group.widgets = Array.isArray(group.widgets) ? group.widgets : [];
      group.widgets = group.widgets.map(function (widget, widgetIndex) {
        var type = TYPES.indexOf(widget && widget.type) >= 0 ? widget.type : "telemetry";
        return Object.assign(defaultWidget(type, widgetIndex), clone(widget), { type: type });
      });
    });
    return next;
  }

  function widgetSpecificHtml(widget) {
    if (widget.type === "switch") {
      return field("Field trạng thái", "stateField", widget.stateField) +
        field("Lệnh bật", "commandOn", widget.commandOn) +
        field("Lệnh tắt", "commandOff", widget.commandOff);
    }
    if (widget.type === "command") {
      return field("Lệnh", "command", widget.command) +
        field("Nhãn nút", "buttonLabel", widget.buttonLabel);
    }
    if (widget.type === "angle") {
      return field("Field góc", "field", widget.field) +
        field("Mẫu lệnh", "submitCommand", widget.submitCommand);
    }
    if (widget.type === "input") {
      return field("Field nhập", "inputField", widget.input && widget.input.field) +
        field("Mẫu lệnh", "submitCommand", widget.submitCommand) +
        field("Nhãn nút", "buttonLabel", widget.buttonLabel);
    }
    if (widget.type === "dual-input") {
      return field("Field dữ liệu", "field", widget.field) +
        field("Mẫu lệnh", "submitCommand", widget.submitCommand) +
        field("Nhãn nút", "buttonLabel", widget.buttonLabel) +
        '<label class="full">Định nghĩa hai ô nhập<textarea data-widget-field="inputsJson">' +
          esc(JSON.stringify(widget.inputs || [], null, 2)) + "</textarea></label>";
    }
    if (widget.type === "image") {
      return field("Đường dẫn ảnh", "src", widget.src || widget.url || widget.imageUrl) +
        field("Mô tả ảnh", "alt", widget.alt);
    }
    return field("Field", "field", widget.field) +
      field("Đơn vị", "unit", widget.unit) +
      field("Số chữ số thập phân", "digits", widget.digits, "number", 'min="0" max="6" step="1"') +
      (widget.type === "line-chart"
        ? field("Khoảng thời gian", "range", widget.range) +
          field("Biên độ trục Y tối thiểu", "yDeltaMin", widget.yDeltaMin, "number", 'min="0" step="0.1"')
        : "");
  }

  function widgetHtml(widget, groupIndex, widgetIndex) {
    return '<section class="widget-card" data-widget="' + widgetIndex + '">' +
      '<div class="item-top"><div class="item-title"><span class="badge">#' + (widgetIndex + 1) +
      "</span><strong>" + esc(widget.label) + '</strong></div><div class="item-actions">' +
      '<button class="secondary" type="button" data-action="clone-widget" data-group-index="' + groupIndex +
      '" data-widget-index="' + widgetIndex + '">Nhân bản</button>' +
      '<button class="danger" type="button" data-action="delete-widget" data-group-index="' + groupIndex +
      '" data-widget-index="' + widgetIndex + '">Xóa</button></div></div>' +
      '<div class="grid grid-3"><label>Loại widget<select data-widget-field="type">' +
      options(TYPES, widget.type) + "</select></label>" +
      field("Tên hiển thị", "label", widget.label) +
      '<label>Màu trạng thái<select data-widget-field="tone">' + options(TONES, safe(widget.tone, "primary")) +
      "</select></label>" + widgetSpecificHtml(widget) + "</div></section>";
  }

  function groupHtml(group, groupIndex) {
    return '<article class="item-card" data-group="' + groupIndex + '">' +
      '<div class="item-top"><div class="item-title"><span class="badge">#' + (groupIndex + 1) +
      "</span><strong>" + esc(group.title) + '</strong></div><div class="item-actions">' +
      '<button class="secondary" type="button" data-action="clone-group" data-group-index="' + groupIndex +
      '">Nhân bản</button><button class="danger" type="button" data-action="delete-group" data-group-index="' +
      groupIndex + '">Xóa</button></div></div>' +
      '<div class="grid"><label>Tên khu vực<input data-group-field="title" value="' + esc(group.title) +
      '"></label><label>Device key<input data-group-field="sessionId" value="' + esc(group.sessionId) +
      '"></label></div><div class="advanced-section"><div class="toolbar"><h3>Thiết bị / cảm biến</h3>' +
      '<button type="button" data-action="add-widget" data-group-index="' + groupIndex +
      '">+ Thêm widget</button></div><div class="widget-list">' +
      group.widgets.map(function (widget, widgetIndex) {
        return widgetHtml(widget, groupIndex, widgetIndex);
      }).join("") + "</div></div></article>";
  }

  function render() {
    var config = state.config;
    document.body.innerHTML = '<main class="shell"><header class="head"><div><h1>Cài đặt nhà thông minh</h1></div>' +
      '<div class="badge">' + config.groups.length + ' khu vực</div></header>' +
      '<section class="panel"><h2>Thông tin chung</h2><div class="grid">' +
      '<label class="full">Tên dashboard<input data-general="title" value="' + esc(config.title) + '"></label>' +
      '<label class="full">Mô tả ngắn<input data-general="subtitle" value="' + esc(config.subtitle) + '"></label>' +
      '<label>AccountID dùng chung<input data-general="syncId" value="' + esc(config.syncId) + '"></label>' +
      '</div></section><section class="panel"><div class="toolbar"><h2>Các khu vực</h2>' +
      '<button type="button" data-action="add-group">+ Thêm khu vực</button></div><div class="item-list">' +
      config.groups.map(groupHtml).join("") + "</div></section></main>";
    DashboardSetupBridge.resize();
  }

  function readWidget(card, current, widgetIndex) {
    var selectedType = safe(card.querySelector('[data-widget-field="type"]').value, "telemetry");
    var next = selectedType === current.type ? clone(current) : defaultWidget(selectedType, widgetIndex);
    next.type = selectedType;
    Array.prototype.forEach.call(card.querySelectorAll("[data-widget-field]"), function (node) {
      var key = node.getAttribute("data-widget-field");
      if (key === "type") return;
      if (key === "digits") next[key] = Math.round(numberValue(node.value, 0, 0));
      else if (key === "yDeltaMin") next[key] = numberValue(node.value, 0, 0);
      else if (key === "inputField") {
        next.input = Object.assign({}, next.input, { field: safe(node.value, "") });
      } else if (key === "inputsJson") {
        try {
          var inputs = JSON.parse(node.value || "[]");
          if (!Array.isArray(inputs) || inputs.length !== 2) throw new Error();
          next.inputs = inputs;
        } catch (error) {
          throw new Error("Widget #" + (widgetIndex + 1) + " cần đúng hai định nghĩa ô nhập dạng JSON.");
        }
      } else {
        next[key] = safe(node.value, "");
      }
    });
    return next;
  }

  function read() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-general]"), function (node) {
      state.config[node.getAttribute("data-general")] = safe(node.value, state.config[node.getAttribute("data-general")]);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-group]"), function (card) {
      var groupIndex = Number(card.getAttribute("data-group"));
      var current = state.config.groups[groupIndex];
      current.title = safe(card.querySelector('[data-group-field="title"]').value, "Khu vực " + (groupIndex + 1));
      current.sessionId = safe(card.querySelector('[data-group-field="sessionId"]').value, state.context.sessionId || "");
      var widgets = [];
      Array.prototype.forEach.call(card.querySelectorAll("[data-widget]"), function (widgetCard) {
        var widgetIndex = Number(widgetCard.getAttribute("data-widget"));
        widgets.push(readWidget(widgetCard, current.widgets[widgetIndex], widgetIndex));
      });
      current.widgets = widgets;
    });
  }

  function readOrReport() {
    try {
      read();
      return true;
    } catch (error) {
      DashboardSetupBridge.error(error && error.message ? error.message : "Cấu hình chưa hợp lệ.");
      return false;
    }
  }

  function initialize(payload) {
    state.context = clone(payload && payload.context || {});
    state.config = normalizeConfig(payload && payload.config || {});
    render();
  }

  function collect() {
    read();
    if (!state.config.title) throw new Error("Hãy nhập tên dashboard.");
    if (!state.config.groups.length) throw new Error("Template cần ít nhất một khu vực.");
    state.config.groups.forEach(function (group, groupIndex) {
      if (!group.sessionId) throw new Error("Khu vực #" + (groupIndex + 1) + " chưa có Device key.");
      if (!group.widgets.length) throw new Error(group.title + " cần ít nhất một widget.");
      group.widgets.forEach(function (widget, widgetIndex) {
        if (!widget.label) throw new Error(group.title + " · widget #" + (widgetIndex + 1) + " chưa có tên.");
        if (["telemetry", "angle", "line-chart"].indexOf(widget.type) >= 0 && !widget.field) {
          throw new Error(group.title + " · " + widget.label + " chưa có field.");
        }
        if (widget.type === "switch" && !widget.stateField) {
          throw new Error(group.title + " · " + widget.label + " chưa có field trạng thái.");
        }
        if (widget.type === "command" && !widget.command) {
          throw new Error(group.title + " · " + widget.label + " chưa có lệnh.");
        }
        if (widget.type === "angle" && !widget.submitCommand) {
          throw new Error(group.title + " · " + widget.label + " chưa có mẫu lệnh.");
        }
      });
    });
    return clone(state.config);
  }

  document.addEventListener("change", function (event) {
    if (!event.target.matches('[data-widget-field="type"]')) return;
    if (!readOrReport()) return;
    var widgetCard = event.target.closest("[data-widget]");
    var groupCard = event.target.closest("[data-group]");
    var groupIndex = Number(groupCard.getAttribute("data-group"));
    var widgetIndex = Number(widgetCard.getAttribute("data-widget"));
    var current = state.config.groups[groupIndex].widgets[widgetIndex];
    state.config.groups[groupIndex].widgets[widgetIndex] = Object.assign(
      defaultWidget(event.target.value, widgetIndex),
      { label: current.label, tone: current.tone }
    );
    render();
  });

  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    event.preventDefault();
    if (!readOrReport()) return;
    var action = button.getAttribute("data-action");
    var groupIndex = Number(button.getAttribute("data-group-index"));
    var widgetIndex = Number(button.getAttribute("data-widget-index"));
    if (action === "add-group") {
      state.config.groups.push({
        title: "Khu vực " + (state.config.groups.length + 1),
        sessionId: state.context.sessionId || "",
        widgets: [defaultWidget("telemetry", 0)]
      });
    } else if (action === "clone-group") {
      var groupCopy = clone(state.config.groups[groupIndex]);
      groupCopy.title = safe(groupCopy.title, "Khu vực") + " copy";
      state.config.groups.splice(groupIndex + 1, 0, groupCopy);
    } else if (action === "delete-group") {
      if (state.config.groups.length <= 1) return DashboardSetupBridge.error("Cần giữ ít nhất một khu vực.");
      state.config.groups.splice(groupIndex, 1);
    } else if (action === "add-widget") {
      var widgets = state.config.groups[groupIndex].widgets;
      widgets.push(defaultWidget("telemetry", widgets.length));
    } else if (action === "clone-widget") {
      var widgetCopy = clone(state.config.groups[groupIndex].widgets[widgetIndex]);
      widgetCopy.label = safe(widgetCopy.label, "Widget") + " copy";
      state.config.groups[groupIndex].widgets.splice(widgetIndex + 1, 0, widgetCopy);
    } else if (action === "delete-widget") {
      var groupWidgets = state.config.groups[groupIndex].widgets;
      if (groupWidgets.length <= 1) return DashboardSetupBridge.error("Cần giữ ít nhất một widget trong khu vực.");
      groupWidgets.splice(widgetIndex, 1);
    }
    render();
  });

  render();
  DashboardSetupBridge.start({ onInit: initialize, onCollect: collect });
})();
