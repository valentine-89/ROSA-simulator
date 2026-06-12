(function () {
  "use strict";
  var language = "en";
  var isVi = language === "vi";

  var T = getSetupText("single-phase", isVi);
  var state = {
    baseConfig: {},
    context: {},
    items: []
  };
  var els = {};

  function getSetupText(setupMode, vi) {
    var common = vi ? {
      waiting: "Đang chờ dữ liệu từ ứng dụng.",
      ready: "Sẵn sàng cấu hình.",
      dashboardTitle: "Tên dashboard",
      historySource: "Nguồn lịch sử",
      billingAccount: "AccountID tính phí chung",
      add: "Thêm",
      clone: "Nhân bản",
      remove: "Xóa",
      advanced: "Nâng cao",
      deviceKey: "Device key",
      description: "Mô tả",
      empty: "Chưa có mục nào.",
      atLeastOne: "Cần giữ ít nhất một mục.",
      invalid: "Cấu hình chưa hợp lệ.",
      enterTitle: "Hãy nhập tên dashboard.",
      missingDevice: " chưa có Device key.",
      device: "Thiết bị",
      controller: "Tủ / ao",
      switchLabelPrefix: "Tiền tố nhãn công tắc",
      motorCount: "Số mô tơ",
      switchCount: "Số công tắc",
      fieldSection: "Field thiết bị",
      commandSection: "Lệnh điều khiển",
      scheduleSection: "Field hẹn giờ",
      meterSection: "Điện kế",
      controlSection: "Công tắc",
      noMeter: "Không có điện kế riêng.",
      row: "Dòng",
      motor: "Mô tơ"
    } : {
      waiting: "Waiting for data from the app.",
      ready: "Ready to configure.",
      dashboardTitle: "Dashboard name",
      historySource: "History source",
      billingAccount: "Shared billing AccountID",
      add: "Add",
      clone: "Duplicate",
      remove: "Delete",
      advanced: "Advanced",
      deviceKey: "Device key",
      description: "Description",
      empty: "No items yet.",
      atLeastOne: "Keep at least one item.",
      invalid: "Configuration is not valid.",
      enterTitle: "Enter a dashboard name.",
      missingDevice: " is missing a Device key.",
      device: "Device",
      controller: "Pond cabinet",
      switchLabelPrefix: "Switch label prefix",
      motorCount: "Motor count",
      switchCount: "Switch count",
      fieldSection: "Device fields",
      commandSection: "Commands",
      scheduleSection: "Schedule fields",
      meterSection: "Meter",
      controlSection: "Switches",
      noMeter: "No separate meter.",
      row: "Row",
      motor: "Motor"
    };

    if (setupMode === "control-only") {
      return Object.assign(common, vi ? {
        header: "Cài đặt ao nuôi chỉ điều khiển",
        defaultTitle: "Chỉ điều khiển",
        listTitle: "Danh sách thiết bị / tủ",
        addItem: "Thêm thiết bị",
        countUnit: "thiết bị",
        defaultPrefix: "Mô tơ"
      } : {
        header: "Set up aquaculture control only",
        defaultTitle: "Aquaculture Controls",
        listTitle: "Device / cabinet list",
        addItem: "Add device",
        countUnit: "devices",
        defaultPrefix: "Motor"
      });
    }

    if (setupMode === "single-phase") {
      return Object.assign(common, {
        header: "Set up single-phase aquaculture",
        defaultTitle: "Single-Phase Aquaculture Control",
        listTitle: "Controller list",
        addItem: "Add controller",
        countUnit: "controllers",
        defaultPrefix: "Motor"
      });
    }

    return Object.assign(common, vi ? {
      header: "Cài đặt ao nuôi 3 pha",
      defaultTitle: "Giám sát ao nuôi",
      listTitle: "Danh sách tủ / ao",
      addItem: "Thêm tủ",
      countUnit: "tủ",
      defaultPrefix: "Mô tơ"
    } : {
      header: "Set up 3-phase aquaculture",
      defaultTitle: "Monitoring Aquaculture Ponds",
      listTitle: "Pond cabinet list",
      addItem: "Add cabinet",
      countUnit: "cabinets",
      defaultPrefix: "Pump"
    });
  }

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
    var text = String(value == null ? "" : value).trim();
    var lowered = text.toLowerCase();
    if (!text || text === "0" || lowered === "null" || lowered === "undefined" || lowered === "nan" || text.indexOf("[object Object]") >= 0 || text.indexOf("NaN") >= 0) return "";
    return text;
  }

  function safeText(value, fallback) {
    return normalizeTextValue(value) || normalizeTextValue(fallback) || "";
  }

  function toCount(value, fallback, min, max) {
    var count = Number(value == null ? fallback : value);
    if (!Number.isFinite(count)) count = fallback;
    count = Math.round(count);
    return Math.max(min, Math.min(max, count));
  }

  function setupShell() {
    document.body.innerHTML = ''
      + '<main class="shell">'
      + '<header class="head"><div><h1>' + esc(T.header) + '</h1><div class="status" id="status">' + esc(T.waiting) + '</div></div><div class="badge" id="count-badge">0</div></header>'
      + '<section class="panel"><h2>' + esc(isVi ? "Thông tin chung" : "General") + '</h2><div class="grid">'
      + '<label class="full">' + esc(T.dashboardTitle) + '<input id="dashboard-title" maxlength="120" /></label>'
      + '<label>' + esc(T.historySource) + '<input id="history-session" /></label>'
      + '<label>' + esc(T.billingAccount) + '<input id="history-sync" /></label>'
      + '</div></section>'
      + '<section class="panel"><div class="toolbar"><h2>' + esc(T.listTitle) + '</h2><button type="button" data-action="add-item">' + esc(T.addItem) + '</button></div><div class="item-list" id="item-list"></div></section>'
      + '</main>';

    els = {
      status: document.getElementById("status"),
      countBadge: document.getElementById("count-badge"),
      title: document.getElementById("dashboard-title"),
      historySession: document.getElementById("history-session"),
      historySync: document.getElementById("history-sync"),
      list: document.getElementById("item-list")
    };
  }

  function makeThreePhaseItem(index, basic, outputStart) {
    var ordinal = index + 1;
    var motorCount = toCount(basic && basic.motorCount, 2, 1, 3);
    var fields = {
      contactor1: motorCount >= 1 ? "O" + outputStart : "",
      contactor2: motorCount >= 2 ? "O" + (outputStart + 1) : "",
      contactor3: motorCount >= 3 ? "O" + (outputStart + 2) : "",
      alarm: "alarm" + ordinal,
      currentThreshold: "#" + (1010 + ordinal),
      alarmPhone: "#1002." + ordinal,
      runWindow: "#" + (1004 + ordinal),
      updateEnabled: "#1003." + ordinal
    };
    var commands = {
      contactor1On: motorCount >= 1 ? 'N3,' + ordinal + ',1,"ON","<<username>>"' : "",
      contactor1Off: motorCount >= 1 ? 'N3,' + ordinal + ',1,"OFF","<<username>>"' : "",
      contactor2On: motorCount >= 2 ? 'N3,' + ordinal + ',2,"ON","<<username>>"' : "",
      contactor2Off: motorCount >= 2 ? 'N3,' + ordinal + ',2,"OFF","<<username>>"' : "",
      contactor3On: motorCount >= 3 ? 'N3,' + ordinal + ',3,"ON","<<username>>"' : "",
      contactor3Off: motorCount >= 3 ? 'N3,' + ordinal + ',3,"OFF","<<username>>"' : "",
      alarmOff: 'N4,"<<username>>",' + ordinal
    };
    var scheduleStart = 1021 + (index * 4);
    var meters = {};
    for (var motorIndex = 1; motorIndex <= motorCount; motorIndex += 1) {
      meters["contactor" + motorIndex] = {
        title: (isVi ? "Mô tơ " : "Pump ") + motorIndex,
        voltage: "Voltage" + ordinal + motorIndex + "_V",
        current1: "Current" + ordinal + motorIndex + "_A1",
        current2: "Current" + ordinal + motorIndex + "_A2",
        current3: "Current" + ordinal + motorIndex + "_A3",
        temperature: "Temper" + ordinal + motorIndex,
        energy: "Energy" + ordinal + motorIndex + "_Wh"
      };
    }
    return {
      title: safeText(basic && basic.title, T.controller + " " + ordinal),
      sessionId: safeText(basic && basic.sessionId, state.context.sessionId || ""),
      description: safeText(basic && basic.description, ""),
      motorCount: motorCount,
      fields: fields,
      commands: commands,
      scheduleFields: ["#" + scheduleStart, "#" + (scheduleStart + 1), "#" + (scheduleStart + 2), "#" + (scheduleStart + 3)],
      meters: meters
    };
  }

  function makeControlOnlyGroup(index, basic) {
    var count = toCount(basic && (basic.controlCount || basic.controls && basic.controls.length), 4, 1, 8);
    var prefix = safeText(basic && basic.labelPrefix, T.defaultPrefix);
    var controls = [];
    for (var controlIndex = 0; controlIndex < count; controlIndex += 1) {
      var ordinal = controlIndex + 1;
      var pondOrdinal = Math.floor(controlIndex / 2) + 1;
      var motorOrdinal = (controlIndex % 2) + 1;
      var label = prefix + " " + ordinal;
      controls.push({
        label: label,
        stateField: "O" + (101 + controlIndex),
        commandOn: 'N3,' + pondOrdinal + ',' + motorOrdinal + ',"ON","<<username>>"',
        commandOff: 'N3,' + pondOrdinal + ',' + motorOrdinal + ',"OFF","<<username>>"',
        meter: {
          title: label,
          voltage: "Voltage" + pondOrdinal + motorOrdinal + "_V",
          current1: "Current" + pondOrdinal + motorOrdinal + "_A1",
          current2: "Current" + pondOrdinal + motorOrdinal + "_A2",
          current3: "Current" + pondOrdinal + motorOrdinal + "_A3",
          temperature: "Temper" + pondOrdinal + motorOrdinal,
          energy: "Energy" + pondOrdinal + motorOrdinal + "_Wh"
        }
      });
    }
    return {
      title: safeText(basic && basic.title, T.device + " " + (index + 1)),
      sessionId: safeText(basic && basic.sessionId, state.context.sessionId || ""),
      labelPrefix: prefix,
      controlCount: count,
      controls: controls
    };
  }

  function makeSinglePhaseController(index, basic) {
    var count = toCount(basic && (basic.controlCount || basic.controls && basic.controls.length), 8, 1, 8);
    var controls = [];
    for (var controlIndex = 0; controlIndex < count; controlIndex += 1) {
      var ordinal = controlIndex + 1;
      controls.push({
        label: (isVi ? "Mô tơ " : "Motor ") + ordinal,
        stateField: "O" + (101 + controlIndex),
        currentField: "Current" + ordinal + "_A",
        commandOn: 'N3,' + ordinal + ',"ON"',
        commandOff: 'N3,' + ordinal + ',"OFF"'
      });
    }
    return {
      title: safeText(basic && basic.title, "Controller " + (index + 1)),
      sessionId: safeText(basic && basic.sessionId, state.context.sessionId || ""),
      controlCount: count,
      fields: {
        alarm: "alarm1",
        alarmPhone: "#1002",
        currentThreshold: "#1011",
        runWindow: "#1005"
      },
      commands: {
        alarmOff: 'N4,"<<username>>",1'
      },
      scheduleFields: ["#1021", "#1022", "#1023", "#1024", "#1025", "#1026", "#1027", "#1028", "#1029", "#1030"],
      controls: controls
    };
  }

  function inferPrefix(controls) {
    var first = controls && controls[0] && controls[0].label ? String(controls[0].label) : "";
    return safeText(first.replace(/\s*\d+\s*$/, ""), T.defaultPrefix);
  }

  function controlOnlyFromConfig(group, index) {
    var source = group && typeof group === "object" ? group : {};
    var controls = Array.isArray(source.controls) ? source.controls : [];
    return {
      title: T.device + " " + (index + 1),
      sessionId: safeText(source.sessionId, state.context.sessionId || ""),
      labelPrefix: inferPrefix(controls),
      controlCount: controls.length || 4,
      controls: clone(controls)
    };
  }

  function threePhaseFromConfig(session, index) {
    var source = session && typeof session === "object" ? session : {};
    var fields = source.fields && typeof source.fields === "object" ? source.fields : {};
    var meters = source.meters && typeof source.meters === "object" ? source.meters : {};
    var count = fields.contactor3 || meters.contactor3 ? 3 : (fields.contactor2 || meters.contactor2 ? 2 : 1);
    return {
      title: safeText(source.title, T.controller + " " + (index + 1)),
      sessionId: safeText(source.sessionId, state.context.sessionId || ""),
      description: safeText(source.description, ""),
      motorCount: count,
      fields: clone(source.fields),
      commands: clone(source.commands),
      scheduleFields: Array.isArray(source.scheduleFields) ? source.scheduleFields.slice(0, 4) : [],
      meters: clone(source.meters)
    };
  }

  function singlePhaseFromConfig(controller, index) {
    var source = controller && typeof controller === "object" ? controller : {};
    var controls = Array.isArray(source.controls) ? source.controls : [];
    return {
      title: safeText(source.title, "Controller " + (index + 1)),
      sessionId: safeText(source.sessionId, state.context.sessionId || ""),
      controlCount: controls.length || 8,
      fields: clone(source.fields),
      commands: clone(source.commands),
      scheduleFields: Array.isArray(source.scheduleFields) ? source.scheduleFields.slice(0, 10) : [],
      controls: clone(controls)
    };
  }

  function mergeControl(target, source) {
    var next = Object.assign({}, target, clone(source));
    if (target.meter || source && source.meter) {
      next.meter = Object.assign({}, clone(target.meter), clone(source && source.meter));
    }
    return next;
  }

  function preserveAdvancedOpen(target, source) {
    if (source && source._advancedOpen && target) target._advancedOpen = true;
    return target;
  }

  function normalizeItems(items, preserveAdvanced) {
    if (false) {
      return items.map(function (item, index) {
        var generated = makeControlOnlyGroup(index, item || {});
        if (!preserveAdvanced) return preserveAdvancedOpen(generated, item);
        var next = clone(generated);
        next.controls = generated.controls.map(function (control, controlIndex) {
          return mergeControl(control, item && item.controls ? item.controls[controlIndex] : null);
        });
        return preserveAdvancedOpen(next, item);
      });
    }

    if (true) {
      return items.map(function (item, index) {
        var generated = makeSinglePhaseController(index, item || {});
        if (!preserveAdvanced) return preserveAdvancedOpen(generated, item);
        var next = clone(generated);
        next.title = generated.title;
        next.sessionId = generated.sessionId;
        next.fields = Object.assign({}, generated.fields, clone(item && item.fields));
        next.commands = Object.assign({}, generated.commands, clone(item && item.commands));
        next.scheduleFields = Array.isArray(item && item.scheduleFields) && item.scheduleFields.length
          ? item.scheduleFields.map(function (field) { return safeText(field, ""); }).slice(0, 10)
          : generated.scheduleFields;
        next.controls = generated.controls.map(function (control, controlIndex) {
          return Object.assign({}, control, clone(item && item.controls ? item.controls[controlIndex] : null));
        });
        return preserveAdvancedOpen(next, item);
      });
    }

    var outputCursor = 101;
    return items.map(function (item, index) {
      var generated = makeThreePhaseItem(index, item || {}, outputCursor);
      outputCursor += generated.motorCount;
      if (!preserveAdvanced) return preserveAdvancedOpen(generated, item);
      var next = clone(generated);
      next.title = generated.title;
      next.sessionId = generated.sessionId;
      next.description = generated.description;
      next.fields = Object.assign({}, generated.fields, clone(item && item.fields));
      next.commands = Object.assign({}, generated.commands, clone(item && item.commands));
      next.scheduleFields = Array.isArray(item && item.scheduleFields) && item.scheduleFields.length
        ? item.scheduleFields.map(function (field) { return safeText(field, ""); }).slice(0, 4)
        : generated.scheduleFields;
      next.meters = clone(generated.meters);
      var sourceMeters = item && item.meters && typeof item.meters === "object" ? item.meters : {};
      Object.keys(next.meters).forEach(function (meterKey) {
        next.meters[meterKey] = Object.assign({}, next.meters[meterKey], clone(sourceMeters[meterKey]));
      });
      return preserveAdvancedOpen(next, item);
    });
  }

  function readItemsFromDom() {
    var cards = Array.prototype.slice.call(els.list.querySelectorAll("[data-item-index]"));
    state.items = cards.map(function (card, index) {
      var current = state.items[index] || {};
      var read = function (selector) {
        var node = card.querySelector(selector);
        return node ? String(node.value || "").trim() : "";
      };

      if (false) {
        var group = {
          title: T.device + " " + (index + 1),
          sessionId: read('[data-basic="sessionId"]'),
          labelPrefix: read('[data-basic="labelPrefix"]'),
          controlCount: toCount(read('[data-basic="controlCount"]'), 4, 1, 8),
          controls: clone(current.controls || [])
        };
        card.querySelectorAll("[data-control-index][data-control-field]").forEach(function (node) {
          var controlIndex = Number(node.getAttribute("data-control-index") || 0);
          var field = node.getAttribute("data-control-field");
          if (!group.controls[controlIndex]) group.controls[controlIndex] = {};
          group.controls[controlIndex][field] = String(node.value || "").trim();
        });
        card.querySelectorAll("[data-control-index][data-meter-field]").forEach(function (node) {
          var controlIndex = Number(node.getAttribute("data-control-index") || 0);
          var field = node.getAttribute("data-meter-field");
          if (!group.controls[controlIndex]) group.controls[controlIndex] = {};
          if (!group.controls[controlIndex].meter) group.controls[controlIndex].meter = {};
          group.controls[controlIndex].meter[field] = String(node.value || "").trim();
        });
        return group;
      }

      if (true) {
        var single = {
          title: read('[data-basic="title"]'),
          sessionId: read('[data-basic="sessionId"]'),
          controlCount: toCount(read('[data-basic="controlCount"]'), 8, 1, 8),
          fields: {},
          commands: {},
          scheduleFields: [],
          controls: clone(current.controls || [])
        };
        readAdvancedFields(card, single);
        card.querySelectorAll("[data-control-index][data-control-field]").forEach(function (node) {
          var controlIndex = Number(node.getAttribute("data-control-index") || 0);
          var field = node.getAttribute("data-control-field");
          if (!single.controls[controlIndex]) single.controls[controlIndex] = {};
          single.controls[controlIndex][field] = String(node.value || "").trim();
        });
        return single;
      }

      var item = {
        title: read('[data-basic="title"]'),
        sessionId: read('[data-basic="sessionId"]'),
        description: read('[data-basic="description"]'),
        motorCount: toCount(read('[data-basic="motorCount"]'), 2, 1, 3),
        fields: {},
        commands: {},
        scheduleFields: [],
        meters: clone(current.meters || {})
      };
      readAdvancedFields(card, item);
      card.querySelectorAll("[data-meter-key][data-meter-field]").forEach(function (node) {
        var meterKey = node.getAttribute("data-meter-key");
        var meterField = node.getAttribute("data-meter-field");
        if (!item.meters[meterKey]) item.meters[meterKey] = {};
        item.meters[meterKey][meterField] = String(node.value || "").trim();
      });
      return item;
    });
    state.items.forEach(function (item, index) {
      var details = cards[index] && cards[index].querySelector("details");
      if (item && details && details.open) item._advancedOpen = true;
    });
  }

  function readAdvancedFields(card, target) {
    card.querySelectorAll("[data-field-key]").forEach(function (node) {
      target.fields[node.getAttribute("data-field-key")] = String(node.value || "").trim();
    });
    card.querySelectorAll("[data-command-key]").forEach(function (node) {
      target.commands[node.getAttribute("data-command-key")] = String(node.value || "").trim();
    });
    card.querySelectorAll("[data-schedule-index]").forEach(function (node) {
      target.scheduleFields[Number(node.getAttribute("data-schedule-index") || 0)] = String(node.value || "").trim();
    });
  }

  function fieldInput(key, value) {
    return '<label>' + esc(key) + '<input data-field-key="' + esc(key) + '" value="' + esc(value) + '" /></label>';
  }

  function commandInput(key, value) {
    return '<label>' + esc(key) + '<input data-command-key="' + esc(key) + '" value="' + esc(value) + '" /></label>';
  }

  function scheduleInputs(schedule, count) {
    var fields = [];
    for (var index = 0; index < count; index += 1) {
      fields.push('<label>' + esc(T.row + " " + (index + 1)) + '<input data-schedule-index="' + index + '" value="' + esc(schedule[index] || "") + '" /></label>');
    }
    return fields.join("");
  }

  function meterInputs(meterKey, meter) {
    var fields = ["title", "voltage", "current1", "current2", "current3", "temperature", "energy"];
    return '<div class="advanced-section"><h3>' + esc(meter.title || meterKey) + '</h3><div class="grid-3">'
      + fields.map(function (field) {
        return '<label>' + esc(field) + '<input data-meter-key="' + esc(meterKey) + '" data-meter-field="' + esc(field) + '" value="' + esc(meter[field] || "") + '" /></label>';
      }).join("")
      + '</div></div>';
  }

  function controlInputs(control, index, includeMeter) {
    var fields = includeMeter
      ? ["label", "stateField", "commandOn", "commandOff"]
      : ["label", "stateField", "currentField", "commandOn", "commandOff"];
    var html = '<div class="advanced-section"><h3>' + esc(control.label || (T.motor + " " + (index + 1))) + '</h3><div class="grid-3">'
      + fields.map(function (field) {
        return '<label>' + esc(field) + '<input data-control-index="' + index + '" data-control-field="' + esc(field) + '" value="' + esc(control[field] || "") + '" /></label>';
      }).join("")
      + '</div>';
    if (includeMeter) {
      var meter = control.meter || {};
      var meterFields = ["title", "voltage", "current1", "current2", "current3", "temperature", "energy"];
      html += '<div class="grid-3">'
        + meterFields.map(function (field) {
          return '<label>' + esc("meter." + field) + '<input data-control-index="' + index + '" data-meter-field="' + esc(field) + '" value="' + esc(meter[field] || "") + '" /></label>';
        }).join("")
        + '</div>';
    }
    return html + '</div>';
  }

  function basicTitle(item, index) {
    if (false) return safeText(item.labelPrefix, T.device + " " + (index + 1));
    return safeText(item.title, (true ? "Controller " : T.controller + " ") + (index + 1));
  }

  function renderItem(item, index) {
    var basic = '';
    var advanced = '';
    var detailsOpen = item && item._advancedOpen ? " open" : "";

    if (false) {
      basic = '<div class="grid-3">'
        + '<label>' + esc(T.switchLabelPrefix) + '<input data-basic="labelPrefix" value="' + esc(item.labelPrefix) + '" /></label>'
        + '<label>' + esc(T.deviceKey) + '<input data-basic="sessionId" value="' + esc(item.sessionId) + '" /></label>'
        + '<label>' + esc(T.switchCount) + '<select data-basic="controlCount">' + countOptions(1, 8, item.controlCount) + '</select></label>'
        + '</div>';
      advanced = '<div class="advanced-section"><h3>' + esc(T.controlSection) + '</h3>'
        + (item.controls || []).map(function (control, controlIndex) { return controlInputs(control, controlIndex, true); }).join("")
        + '</div>';
    } else if (true) {
      basic = '<div class="grid-3">'
        + '<label>' + esc(T.controller) + '<input data-basic="title" value="' + esc(item.title) + '" /></label>'
        + '<label>' + esc(T.deviceKey) + '<input data-basic="sessionId" value="' + esc(item.sessionId) + '" /></label>'
        + '<label>' + esc(T.switchCount) + '<select data-basic="controlCount">' + countOptions(1, 8, item.controlCount) + '</select></label>'
        + '</div>';
      advanced = advancedFieldsHtml(item, 10)
        + '<div class="advanced-section"><h3>' + esc(T.controlSection) + '</h3>'
        + (item.controls || []).map(function (control, controlIndex) { return controlInputs(control, controlIndex, false); }).join("")
        + '</div>';
    } else {
      basic = '<div class="grid-3">'
        + '<label>' + esc(T.controller) + '<input data-basic="title" value="' + esc(item.title) + '" /></label>'
        + '<label>' + esc(T.deviceKey) + '<input data-basic="sessionId" value="' + esc(item.sessionId) + '" /></label>'
        + '<label>' + esc(T.motorCount) + '<select data-basic="motorCount">' + countOptions(1, 3, item.motorCount) + '</select></label>'
        + '<label class="full">' + esc(T.description) + '<input data-basic="description" value="' + esc(item.description) + '" /></label>'
        + '</div>';
      advanced = advancedFieldsHtml(item, 4)
        + (Object.keys(item.meters || {}).map(function (meterKey) {
          return meterInputs(meterKey, item.meters[meterKey] || {});
        }).join("") || '<div class="empty">' + esc(T.noMeter) + '</div>');
    }

    return '<article class="item-card" data-item-index="' + index + '">'
      + '<div class="item-top"><div class="item-title"><span class="badge">#' + (index + 1) + '</span><strong>' + esc(basicTitle(item, index)) + '</strong></div>'
      + '<div class="item-actions"><button class="secondary" type="button" data-action="clone-item" data-index="' + index + '">' + esc(T.clone) + '</button>'
      + '<button class="danger" type="button" data-action="delete-item" data-index="' + index + '">' + esc(T.remove) + '</button></div></div>'
      + basic
      + '<details' + detailsOpen + '><summary>' + esc(T.advanced) + '</summary><div class="advanced-body">' + advanced + '</div></details>'
      + '</article>';
  }

  function countOptions(min, max, selected) {
    var html = "";
    for (var value = min; value <= max; value += 1) {
      html += '<option value="' + value + '"' + (Number(selected) === value ? " selected" : "") + '>' + value + '</option>';
    }
    return html;
  }

  function advancedFieldsHtml(item, scheduleCount) {
    return '<div class="advanced-section"><h3>' + esc(T.fieldSection) + '</h3><div class="grid-3">'
      + Object.keys(item.fields || {}).map(function (key) { return fieldInput(key, item.fields[key]); }).join("")
      + '</div></div>'
      + '<div class="advanced-section"><h3>' + esc(T.commandSection) + '</h3><div class="grid-3">'
      + Object.keys(item.commands || {}).map(function (key) { return commandInput(key, item.commands[key]); }).join("")
      + '</div></div>'
      + '<div class="advanced-section"><h3>' + esc(T.scheduleSection) + '</h3><div class="grid-4">'
      + scheduleInputs(item.scheduleFields || [], scheduleCount)
      + '</div></div>';
  }

  function notifyResize() {
    window.requestAnimationFrame(function () {
      var height = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 560);
      DashboardSetupBridge.resize();
    });
  }

  function render() {
    els.list.innerHTML = state.items.length
      ? state.items.map(renderItem).join("")
      : '<div class="empty">' + esc(T.empty) + '</div>';
    els.countBadge.textContent = state.items.length + " " + T.countUnit;
    notifyResize();
  }

  function initialize(payload) {
    var config = payload && payload.config && typeof payload.config === "object" ? payload.config : {};
    state.baseConfig = clone(config);
    state.context = clone(payload && payload.context ? payload.context : {});
    els.title.value = safeText(config.title, T.defaultTitle);
    var history = config.history && typeof config.history === "object" ? config.history : {};
    els.historySession.value = safeText(history.sessionId, state.context.sessionId || "");
    els.historySync.value = safeText(history.syncId, state.context.syncId || config.syncId || "");

    if (false) {
      var groups = Array.isArray(config.groups) ? config.groups : [];
      state.items = groups.length ? groups.map(controlOnlyFromConfig) : [makeControlOnlyGroup(0, {})];
    } else if (true) {
      var controllers = Array.isArray(config.controllers) ? config.controllers : [];
      state.items = controllers.length ? controllers.map(singlePhaseFromConfig) : [makeSinglePhaseController(0, {})];
    } else {
      var sessions = Array.isArray(config.sessions) ? config.sessions : [];
      state.items = sessions.length ? sessions.map(threePhaseFromConfig) : [makeThreePhaseItem(0, {}, 101)];
    }

    state.items = normalizeItems(state.items, true);
    els.status.textContent = T.ready;
    render();
  }

  function applyCommonConfig(next) {
    next.title = safeText(els.title.value, "");
    if (!next.title) throw new Error(T.enterTitle);
    next.syncId = safeText(els.historySync.value, safeText(next.syncId, state.context.syncId || ""));
    next.history = Object.assign({}, clone(next.history), {
      sessionId: safeText(els.historySession.value, state.context.sessionId || ""),
      syncId: safeText(els.historySync.value, state.context.syncId || next.syncId || ""),
      macro: safeText(next.history && next.history.macro, "pond-event-history"),
      pageSize: Number(next.history && next.history.pageSize) || 100
    });
  }

  function buildConfig() {
    readItemsFromDom();
    state.items = normalizeItems(state.items, true);
    if (!state.items.length) throw new Error(T.atLeastOne);

    var next = clone(state.baseConfig);
    applyCommonConfig(next);

    if (false) {
      next.groups = state.items.map(function (group, index) {
        if (!group.sessionId) throw new Error(T.device + " #" + (index + 1) + T.missingDevice);
        return {
          sessionId: group.sessionId,
          controls: (group.controls || []).slice(0, group.controlCount).map(function (control) {
            return {
              label: safeText(control.label, T.motor),
              stateField: safeText(control.stateField, ""),
              commandOn: safeText(control.commandOn, ""),
              commandOff: safeText(control.commandOff, ""),
              meter: clone(control.meter)
            };
          })
        };
      });
      if (!next.locale) next.locale = language;
      return next;
    }

    if (true) {
      next.controllers = state.items.map(function (controller, index) {
        if (!controller.sessionId) throw new Error("Controller #" + (index + 1) + T.missingDevice);
        return {
          title: safeText(controller.title, "Controller " + (index + 1)),
          sessionId: controller.sessionId,
          fields: controller.fields || {},
          commands: controller.commands || {},
          scheduleFields: (controller.scheduleFields || []).filter(Boolean).slice(0, 10),
          controls: (controller.controls || []).slice(0, controller.controlCount).map(function (control) {
            return {
              label: safeText(control.label, T.motor),
              stateField: safeText(control.stateField, ""),
              currentField: safeText(control.currentField, ""),
              commandOn: safeText(control.commandOn, ""),
              commandOff: safeText(control.commandOff, "")
            };
          })
        };
      });
      if (!next.locale) next.locale = language;
      return next;
    }

    next.description = safeText(next.description, "");
    next.sessions = state.items.map(function (item, index) {
      if (!item.sessionId) throw new Error(T.controller + " #" + (index + 1) + T.missingDevice);
      return {
        title: safeText(item.title, T.controller + " " + (index + 1)),
        sessionId: item.sessionId,
        description: safeText(item.description, ""),
        fields: item.fields || {},
        commands: item.commands || {},
        scheduleFields: (item.scheduleFields || []).filter(Boolean).slice(0, 4),
        meters: item.meters || {}
      };
    });
    if (!next.locale) next.locale = language;
    return next;
  }

  function sendError(message) {
    DashboardSetupBridge.error(String(message || T.invalid));
  }

  function blankItem() {
    if (false) {
      return { sessionId: state.context.sessionId || "", labelPrefix: T.defaultPrefix, controlCount: 4 };
    }
    if (true) {
      return { title: "Controller " + (state.items.length + 1), sessionId: state.context.sessionId || "", controlCount: 8 };
    }
    return {
      title: T.controller + " " + (state.items.length + 1),
      sessionId: state.context.sessionId || "",
      description: "",
      motorCount: 2
    };
  }

  function cloneBasic(source, index) {
    if (false) {
      return {
        sessionId: safeText(source.sessionId, state.context.sessionId || ""),
        labelPrefix: safeText(source.labelPrefix, T.defaultPrefix) + " copy",
        controlCount: toCount(source.controlCount, 4, 1, 8)
      };
    }
    if (true) {
      return {
        title: safeText(source.title, "Controller " + (index + 1)) + " copy",
        sessionId: safeText(source.sessionId, state.context.sessionId || ""),
        controlCount: toCount(source.controlCount, 8, 1, 8)
      };
    }
    return {
      title: safeText(source.title, T.controller) + " copy",
      sessionId: safeText(source.sessionId, state.context.sessionId || ""),
      description: safeText(source.description, ""),
      motorCount: toCount(source.motorCount, 2, 1, 3)
    };
  }

  function handleAction(action, index) {
    readItemsFromDom();
    if (action === "add-item") {
      state.items.push(blankItem());
      state.items = normalizeItems(state.items, true);
      render();
      return;
    }
    if (action === "clone-item" && index >= 0) {
      var clonedItem = cloneBasic(state.items[index] || {}, index);
      if (state.items[index] && state.items[index]._advancedOpen) clonedItem._advancedOpen = true;
      state.items.splice(index + 1, 0, clonedItem);
      state.items = normalizeItems(state.items, true);
      render();
      return;
    }
    if (action === "delete-item" && index >= 0) {
      if (state.items.length <= 1) {
        sendError(T.atLeastOne);
        return;
      }
      state.items.splice(index, 1);
      state.items = normalizeItems(state.items, false);
      render();
    }
  }

  setupShell();

  document.addEventListener("click", function (event) {
    var target = event.target.closest("[data-action]");
    if (!target) return;
    handleAction(target.getAttribute("data-action"), Number(target.getAttribute("data-index") || -1));
  });

  els.list.addEventListener("change", function (event) {
    if (!event.target.matches('[data-basic="motorCount"], [data-basic="controlCount"]')) return;
    readItemsFromDom();
    state.items = normalizeItems(state.items, false);
    render();
  });

  els.list.addEventListener("input", notifyResize);

  DashboardSetupBridge.start({ onInit: initialize, onCollect: buildConfig });
})();
