(function () {
  "use strict";

  var DEFAULT_ACCENTS = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#7c3aed", "#0891b2"];
  var HISTORY_RANGE_OPTIONS = [
    { minutes: 15, label: "15 min" },
    { minutes: 60, label: "1 hour" },
    { minutes: 360, label: "6 hours" },
    { minutes: 1440, label: "24 hours" }
  ];
  var state = {
    context: {},
    config: {},
    servers: []
  };
  var els = {};

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clone(value) {
    try {
      return JSON.parse(JSON.stringify(value == null ? {} : value));
    } catch (error) {
      return {};
    }
  }

  function normalizeTextValue(value) {
    var next = String(value == null ? "" : value).trim();
    var lowered = next.toLowerCase();
    if (!next || next === "0" || lowered === "null" || lowered === "undefined" || lowered === "nan") return "";
    if (next.indexOf("[object Object]") >= 0 || next.indexOf("NaN") >= 0) return "";
    return next;
  }

  function safeText(value, fallback) {
    return normalizeTextValue(value) || normalizeTextValue(fallback) || "";
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

  function contextSession() {
    return safeText(state.context.sessionId, "<<sessionid>>");
  }

  function contextSync() {
    return safeText(state.context.syncId, "<<syncid>>");
  }

  function defaultFields(source) {
    var fields = source && typeof source === "object" ? source : {};
    return {
      cpu: safeText(fields.cpu, "CPU_Percent"),
      ram: safeText(fields.ram, "RAM_Percent"),
      temperature: safeText(fields.temperature, "CPU_Temperature_C"),
      networkIn: safeText(fields.networkIn, "Network_In_Mbps"),
      networkOut: safeText(fields.networkOut, "Network_Out_Mbps"),
      diskUsed: safeText(fields.diskUsed, "Disk_Main_Used_GB"),
      diskTotal: safeText(fields.diskTotal, "Disk_Main_Total_GB")
    };
  }

  function normalizeServer(source, index) {
    var server = source && typeof source === "object" ? source : {};
    return {
      name: safeText(server.name, "Server " + (index + 1)),
      sessionId: safeText(server.sessionId, defaultSessionForIndex(index)),
      accent: safeText(server.accent, DEFAULT_ACCENTS[index % DEFAULT_ACCENTS.length]),
      fields: defaultFields(server.fields)
    };
  }

  function defaultSessionForIndex(index) {
    if (index === 0) return contextSession();
    if (index === 1) return "IO456efgh@simulate";
    if (index === 2) return "IO789ijkl@simulate";
    if (index === 3) return "IO321mnop@simulate";
    return "IO" + String(100 + index) + "server@simulate";
  }

  function normalizeConfig(source) {
    var cfg = source && typeof source === "object" ? source : {};
    var servers = Array.isArray(cfg.servers) ? cfg.servers : [];
    if (!servers.length) {
      servers = [
        { name: "Server 01", sessionId: contextSession(), accent: DEFAULT_ACCENTS[0], fields: defaultFields({}) },
        { name: "Server 02", sessionId: "IO456efgh@simulate", accent: DEFAULT_ACCENTS[1], fields: defaultFields({}) },
        { name: "Server 03", sessionId: "IO789ijkl@simulate", accent: DEFAULT_ACCENTS[2], fields: defaultFields({}) },
        { name: "Server 04", sessionId: "IO321mnop@simulate", accent: DEFAULT_ACCENTS[4], fields: defaultFields({}) }
      ];
    }
    return {
      locale: "en",
      title: safeText(cfg.title, "Server Health Monitor"),
      subtitle: safeText(cfg.subtitle, "Monitor CPU, RAM, network traffic, and primary disk usage across multiple servers."),
      eyebrow: safeText(cfg.eyebrow, "ROSA Server Observability"),
      syncId: safeText(cfg.syncId, contextSync()),
      historyMinutes: intValue(cfg.historyMinutes, 60, 5, 1440),
      thresholds: {
        cpuWarn: intValue(cfg.thresholds && cfg.thresholds.cpuWarn, 70, 0, 100),
        cpuDanger: intValue(cfg.thresholds && cfg.thresholds.cpuDanger, 85, 0, 100),
        ramWarn: intValue(cfg.thresholds && cfg.thresholds.ramWarn, 72, 0, 100),
        ramDanger: intValue(cfg.thresholds && cfg.thresholds.ramDanger, 88, 0, 100),
        diskWarn: intValue(cfg.thresholds && cfg.thresholds.diskWarn, 75, 0, 100),
        diskDanger: intValue(cfg.thresholds && cfg.thresholds.diskDanger, 90, 0, 100)
      },
      servers: servers.map(normalizeServer)
    };
  }

  function shell() {
    document.body.innerHTML = ''
      + '<main class="shell">'
      + '<header class="head"><div><h1>Server Health Monitor Setup</h1><div class="status" id="status">Waiting for app data.</div></div><div class="badge" id="count-badge">0 servers</div></header>'
      + '<section class="panel"><h2>General</h2><div class="grid" id="general-grid"></div></section>'
      + '<section class="panel"><h2>Alert thresholds</h2><div class="grid-3" id="threshold-grid"></div></section>'
      + '<section class="panel"><div class="toolbar"><h2>Server list</h2><button type="button" data-action="add-server">Add server</button></div><div class="item-list" id="server-list"></div></section>'
      + '</main>';
    els = {
      status: document.getElementById("status"),
      countBadge: document.getElementById("count-badge"),
      generalGrid: document.getElementById("general-grid"),
      thresholdGrid: document.getElementById("threshold-grid"),
      serverList: document.getElementById("server-list")
    };
  }

  function inputHtml(label, key, value, options) {
    var cfg = options || {};
    var attrs = 'data-general-key="' + esc(key) + '" value="' + esc(value) + '"';
    if (cfg.type) attrs += ' type="' + esc(cfg.type) + '"';
    if (cfg.min != null) attrs += ' min="' + esc(cfg.min) + '"';
    if (cfg.max != null) attrs += ' max="' + esc(cfg.max) + '"';
    if (cfg.step != null) attrs += ' step="' + esc(cfg.step) + '"';
    return '<label class="' + (cfg.full ? "full" : "") + '">' + esc(label) + '<input ' + attrs + ' /></label>';
  }

  function selectHtml(label, key, value, options) {
    var selected = String(value == null ? "" : value);
    var hasSelected = false;
    var html = '<label>' + esc(label) + '<select data-general-key="' + esc(key) + '">';
    (options || []).forEach(function (option) {
      var optionValue = String(option.minutes);
      var isSelected = optionValue === selected;
      if (isSelected) hasSelected = true;
      html += '<option value="' + esc(optionValue) + '"' + (isSelected ? " selected" : "") + '>' + esc(option.label) + '</option>';
    });
    if (selected && !hasSelected) {
      html += '<option value="' + esc(selected) + '" selected>' + esc(selected + " min") + '</option>';
    }
    html += '</select></label>';
    return html;
  }

  function generalHtml(config) {
    return [
      inputHtml("Dashboard title", "title", config.title, { full: true }),
      inputHtml("Short description", "subtitle", config.subtitle, { full: true }),
      inputHtml("Eyebrow label", "eyebrow", config.eyebrow),
      inputHtml("AccountID / SyncID", "syncId", config.syncId),
      selectHtml("Default time range", "historyMinutes", config.historyMinutes, HISTORY_RANGE_OPTIONS)
    ].join("");
  }

  function thresholdHtml(thresholds) {
    return [
      inputHtml("CPU warning (%)", "cpuWarn", thresholds.cpuWarn, { type: "number", min: 0, max: 100 }),
      inputHtml("CPU critical (%)", "cpuDanger", thresholds.cpuDanger, { type: "number", min: 0, max: 100 }),
      inputHtml("RAM warning (%)", "ramWarn", thresholds.ramWarn, { type: "number", min: 0, max: 100 }),
      inputHtml("RAM critical (%)", "ramDanger", thresholds.ramDanger, { type: "number", min: 0, max: 100 }),
      inputHtml("Disk warning (%)", "diskWarn", thresholds.diskWarn, { type: "number", min: 0, max: 100 }),
      inputHtml("Disk critical (%)", "diskDanger", thresholds.diskDanger, { type: "number", min: 0, max: 100 })
    ].join("");
  }

  function serverInput(label, key, value, options) {
    var cfg = options || {};
    var attrs = 'data-server-key="' + esc(key) + '" value="' + esc(value) + '"';
    if (cfg.type) attrs += ' type="' + esc(cfg.type) + '"';
    return '<label class="' + (cfg.full ? "full" : "") + '">' + esc(label) + '<input ' + attrs + ' /></label>';
  }

  function fieldInput(label, key, value) {
    return '<label>' + esc(label) + '<input data-field-key="' + esc(key) + '" value="' + esc(value) + '" /></label>';
  }

  function serverCard(server, index) {
    return ''
      + '<article class="item-card" data-server-index="' + index + '">'
      + '<div class="item-top">'
      + '<div class="item-title"><strong>' + esc(server.name || ("Server " + (index + 1))) + '</strong><span class="badge">' + esc(server.sessionId || "Device key") + '</span></div>'
      + '<div class="item-actions">'
      + '<button class="secondary" type="button" data-action="clone-server" data-index="' + index + '">Clone</button>'
      + '<button class="danger" type="button" data-action="remove-server" data-index="' + index + '">Delete</button>'
      + '</div>'
      + '</div>'
      + '<div class="grid">'
      + serverInput("Server name", "name", server.name)
      + serverInput("Device key / sessionId", "sessionId", server.sessionId, { full: true })
      + serverInput("Accent color", "accent", server.accent, { type: "color" })
      + '</div>'
      + '<details open><summary>Field telemetry</summary><div class="advanced-body"><div class="grid-3">'
      + fieldInput("CPU %", "cpu", server.fields.cpu)
      + fieldInput("RAM %", "ram", server.fields.ram)
      + fieldInput("CPU temperature C", "temperature", server.fields.temperature)
      + fieldInput("Network In Mbps", "networkIn", server.fields.networkIn)
      + fieldInput("Network Out Mbps", "networkOut", server.fields.networkOut)
      + fieldInput("Disk used GB", "diskUsed", server.fields.diskUsed)
      + fieldInput("Disk total GB", "diskTotal", server.fields.diskTotal)
      + '</div></div></details>'
      + '</article>';
  }

  function render() {
    var config = state.config;
    els.generalGrid.innerHTML = generalHtml(config);
    els.thresholdGrid.innerHTML = thresholdHtml(config.thresholds || {});
    els.serverList.innerHTML = state.servers.length
      ? state.servers.map(serverCard).join("")
      : '<div class="empty">No servers configured.</div>';
    els.countBadge.textContent = state.servers.length + (state.servers.length === 1 ? " server" : " servers");
    els.status.textContent = "Ready to configure.";
    if (window.DashboardSetupBridge) window.DashboardSetupBridge.resize();
  }

  function read(selector, root) {
    var node = (root || document).querySelector(selector);
    return node ? String(node.value || "").trim() : "";
  }

  function collectGeneral() {
    return {
      title: safeText(read('[data-general-key="title"]'), "Server Health Monitor"),
      subtitle: safeText(read('[data-general-key="subtitle"]'), ""),
      eyebrow: safeText(read('[data-general-key="eyebrow"]'), "ROSA Server Observability"),
      syncId: safeText(read('[data-general-key="syncId"]'), contextSync()),
      historyMinutes: intValue(read('[data-general-key="historyMinutes"]'), 60, 5, 1440),
      thresholds: {
        cpuWarn: intValue(read('[data-general-key="cpuWarn"]'), 70, 0, 100),
        cpuDanger: intValue(read('[data-general-key="cpuDanger"]'), 85, 0, 100),
        ramWarn: intValue(read('[data-general-key="ramWarn"]'), 72, 0, 100),
        ramDanger: intValue(read('[data-general-key="ramDanger"]'), 88, 0, 100),
        diskWarn: intValue(read('[data-general-key="diskWarn"]'), 75, 0, 100),
        diskDanger: intValue(read('[data-general-key="diskDanger"]'), 90, 0, 100)
      }
    };
  }

  function collectServers() {
    var cards = Array.prototype.slice.call(document.querySelectorAll("[data-server-index]"));
    return cards.map(function (card, index) {
      return normalizeServer({
        name: read('[data-server-key="name"]', card),
        sessionId: read('[data-server-key="sessionId"]', card),
        accent: read('[data-server-key="accent"]', card) || DEFAULT_ACCENTS[index % DEFAULT_ACCENTS.length],
        fields: {
          cpu: read('[data-field-key="cpu"]', card),
          ram: read('[data-field-key="ram"]', card),
          temperature: read('[data-field-key="temperature"]', card),
          networkIn: read('[data-field-key="networkIn"]', card),
          networkOut: read('[data-field-key="networkOut"]', card),
          diskUsed: read('[data-field-key="diskUsed"]', card),
          diskTotal: read('[data-field-key="diskTotal"]', card)
        }
      }, index);
    });
  }

  function captureStateFromDom() {
    var general = collectGeneral();
    state.servers = collectServers();
    state.config = {
      locale: "en",
      title: general.title,
      subtitle: general.subtitle,
      eyebrow: general.eyebrow,
      syncId: general.syncId,
      historyMinutes: general.historyMinutes,
      thresholds: general.thresholds,
      servers: state.servers
    };
  }

  function onClick(event) {
    var actionNode = event.target && event.target.closest("[data-action]");
    if (!actionNode) return;
    var action = actionNode.getAttribute("data-action");
    captureStateFromDom();
    if (action === "add-server") {
      state.servers.push(normalizeServer({ name: "Server " + String(state.servers.length + 1).padStart(2, "0"), sessionId: defaultSessionForIndex(state.servers.length), accent: DEFAULT_ACCENTS[state.servers.length % DEFAULT_ACCENTS.length], fields: defaultFields({}) }, state.servers.length));
      render();
      return;
    }
    var index = Number(actionNode.getAttribute("data-index"));
    if (!Number.isFinite(index) || index < 0 || index >= state.servers.length) return;
    if (action === "clone-server") {
      var copy = clone(state.servers[index]);
      copy.name = safeText(copy.name, "Server") + " copy";
      copy.accent = DEFAULT_ACCENTS[state.servers.length % DEFAULT_ACCENTS.length];
      state.servers.splice(index + 1, 0, normalizeServer(copy, index + 1));
      render();
      return;
    }
    if (action === "remove-server") {
      if (state.servers.length <= 1) {
        els.status.textContent = "Keep at least one server.";
        return;
      }
      state.servers.splice(index, 1);
      render();
    }
  }

  function collect() {
    captureStateFromDom();
    if (!state.config.title) throw new Error("Enter a dashboard title.");
    if (!state.config.syncId) throw new Error("Enter a SyncID.");
    if (!state.servers.length) throw new Error("At least one server is required.");
    state.servers.forEach(function (server, index) {
      if (!server.name) throw new Error("Server #" + (index + 1) + " needs a name.");
      if (!server.sessionId) throw new Error("Server #" + (index + 1) + " needs a Device key.");
    });
    return clone(state.config);
  }

  function onInit(payload) {
    state.context = clone(payload && payload.context || {});
    state.config = normalizeConfig(payload && payload.config || {});
    state.servers = state.config.servers;
    render();
  }

  shell();
  document.addEventListener("click", onClick);
  if (window.DashboardSetupBridge) {
    window.DashboardSetupBridge.start({
      onInit: onInit,
      onCollect: collect
    });
  }
})();
