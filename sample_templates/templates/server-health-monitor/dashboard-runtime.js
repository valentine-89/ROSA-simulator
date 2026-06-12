(function () {
  "use strict";

  var DEFAULT_ACCENTS = ["#2563eb", "#16a34a", "#f59e0b", "#ef4444", "#7c3aed", "#0891b2"];
  var HISTORY_RANGE_OPTIONS = {
    vi: [
      { minutes: 15, label: "15 phút" },
      { minutes: 60, label: "1 giờ" },
      { minutes: 360, label: "6 giờ" },
      { minutes: 1440, label: "24 giờ" }
    ],
    en: [
      { minutes: 15, label: "15 min" },
      { minutes: 60, label: "1 hour" },
      { minutes: 360, label: "6 hours" },
      { minutes: 1440, label: "24 hours" }
    ]
  };
  var UI_TEXT = {
    vi: {
      defaultSubtitle: "Theo dõi CPU, RAM, network và dung lượng ổ đĩa chính cho nhiều server.",
      offline: "Offline",
      loadingData: "Chờ dữ liệu",
      stale: "Stale",
      critical: "Critical",
      warning: "Warning",
      online: "Online",
      noData: "Chưa có dữ liệu",
      updated: "Cập nhật",
      serverOnline: "Server online",
      avgCpu: "CPU trung bình",
      avgRam: "RAM trung bình",
      cpuTemp: "Nhiệt CPU",
      diskMain: "Ổ đĩa chính",
      serversWithData: "server có dữ liệu",
      missingContext: "Thiếu Device key hoặc SyncID",
      status: "Trạng thái",
      notConfigured: "Chưa cấu hình",
      checkSetup: "Hãy kiểm tra setup template.",
      loadingHistory: "Đang tải lịch sử",
      chartEmpty: "Chưa có lịch sử server",
      day: "ngày",
      hour: "giờ",
      minute: "phút"
    },
    en: {
      defaultSubtitle: "Monitor CPU, RAM, network traffic, and primary disk usage across multiple servers.",
      offline: "Offline",
      loadingData: "Waiting for data",
      stale: "Stale",
      critical: "Critical",
      warning: "Warning",
      online: "Online",
      noData: "No data",
      updated: "Updated",
      serverOnline: "Servers online",
      avgCpu: "Average CPU",
      avgRam: "Average RAM",
      cpuTemp: "CPU temp",
      diskMain: "Primary disk",
      serversWithData: "servers with data",
      missingContext: "Missing Device key or SyncID",
      status: "Status",
      notConfigured: "Not configured",
      checkSetup: "Check the template setup.",
      loadingHistory: "Loading history",
      chartEmpty: "No server history",
      day: "day",
      hour: "hour",
      minute: "min"
    }
  };
  var STALE_AFTER_MS = 600000;
  var RECONNECT_MS = 3000;
  var state = {
    config: {},
    servers: [],
    syncId: "",
    historyMinutes: 60,
    results: [],
    streams: [],
    reconnectTimers: [],
    historyLoading: false,
    historyRequestToken: 0,
    statusTimer: null,
    nodes: {}
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clamp(value, min, max) {
    var next = Number(value);
    if (!Number.isFinite(next)) next = min;
    return Math.max(min, Math.min(max, next));
  }

  function numberOr(value, fallback) {
    var next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  }

  function normalizeLocale(value) {
    return String(value || "").toLowerCase().indexOf("en") === 0 ? "en" : "vi";
  }

  function messageFor(locale, key, fallback) {
    var pack = UI_TEXT[normalizeLocale(locale)] || UI_TEXT.vi;
    return Object.prototype.hasOwnProperty.call(pack, key) ? pack[key] : fallback;
  }

  function localeKey() {
    return normalizeLocale(state.config && state.config.locale);
  }

  function t(key, fallback) {
    return messageFor(localeKey(), key, fallback || key);
  }

  function dateLocale() {
    return localeKey() === "en" ? "en-US" : "vi-VN";
  }

  function normalizeHistoryMinutes(value) {
    return Math.round(clamp(Number(value || 60), 5, 1440));
  }

  function unique(values) {
    var seen = {};
    return values.filter(function (value) {
      var key = String(value || "").trim();
      var lowered = key.toLowerCase();
      if (!key || seen[lowered]) return false;
      seen[lowered] = true;
      return true;
    });
  }

  function readConfig() {
    var node = byId("server-health-config");
    if (!node) return {};
    try {
      return JSON.parse(node.textContent || "{}");
    } catch (error) {
      return {};
    }
  }

  function contextValue(key) {
    var ctx = window.ROSA_SIMULATOR_CONTEXT || {};
    var params = new URLSearchParams(window.location.search || "");
    if (key === "sessionId") {
      return params.get("sessionId") || params.get("sessionid") || ctx.sessionId || "";
    }
    if (key === "syncId") {
      return params.get("syncId") || params.get("syncid") || ctx.syncId || "";
    }
    return "";
  }

  function resolveToken(value, key) {
    var fallback = contextValue(key);
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return fallback;
    return raw
      .replace(/<<sessionid>>/gi, contextValue("sessionId"))
      .replace(/<<syncid>>/gi, contextValue("syncId"));
  }

  function normalizeFields(fields) {
    var source = fields && typeof fields === "object" ? fields : {};
    return {
      cpu: String(source.cpu || "CPU_Percent").trim(),
      ram: String(source.ram || "RAM_Percent").trim(),
      temperature: String(source.temperature || "CPU_Temperature_C").trim(),
      networkIn: String(source.networkIn || "Network_In_Mbps").trim(),
      networkOut: String(source.networkOut || "Network_Out_Mbps").trim(),
      diskUsed: String(source.diskUsed || "Disk_Main_Used_GB").trim(),
      diskTotal: String(source.diskTotal || "Disk_Main_Total_GB").trim()
    };
  }

  function normalizeServer(server, index) {
    var fields = normalizeFields(server && server.fields);
    return {
      index: index,
      name: String(server && server.name || ("Server " + (index + 1))).trim(),
      sessionId: resolveToken(server && server.sessionId, "sessionId"),
      accent: String(server && server.accent || DEFAULT_ACCENTS[index % DEFAULT_ACCENTS.length]).trim(),
      fields: fields
    };
  }

  function normalizeConfig(raw) {
    var cfg = raw && typeof raw === "object" ? raw : {};
    var locale = normalizeLocale(cfg.locale || "vi");
    var servers = Array.isArray(cfg.servers) ? cfg.servers : [];
    if (!servers.length) {
      servers = [{ name: "Server 1", sessionId: "<<sessionid>>", fields: normalizeFields({}) }];
    }
    return {
      locale: locale,
      title: String(cfg.title || "Server Health Monitor"),
      subtitle: String(cfg.subtitle || messageFor(locale, "defaultSubtitle", "")),
      eyebrow: String(cfg.eyebrow || "ROSA Server Observability"),
      syncId: resolveToken(cfg.syncId, "syncId"),
      historyMinutes: normalizeHistoryMinutes(cfg.historyMinutes),
      thresholds: {
        cpuWarn: clamp(numberOr(cfg.thresholds && cfg.thresholds.cpuWarn, 70), 0, 100),
        cpuDanger: clamp(numberOr(cfg.thresholds && cfg.thresholds.cpuDanger, 85), 0, 100),
        ramWarn: clamp(numberOr(cfg.thresholds && cfg.thresholds.ramWarn, 72), 0, 100),
        ramDanger: clamp(numberOr(cfg.thresholds && cfg.thresholds.ramDanger, 88), 0, 100),
        diskWarn: clamp(numberOr(cfg.thresholds && cfg.thresholds.diskWarn, 75), 0, 100),
        diskDanger: clamp(numberOr(cfg.thresholds && cfg.thresholds.diskDanger, 90), 0, 100)
      },
      servers: servers.map(normalizeServer).filter(function (server) { return !!server.sessionId; })
    };
  }

  function collectNodes() {
    state.nodes = {
      title: byId("server-health-title"),
      subtitle: byId("server-health-subtitle"),
      eyebrow: byId("server-health-eyebrow"),
      rangeSelect: byId("server-health-range"),
      statusText: byId("server-health-status-text"),
      statusDot: document.querySelector("#server-health-status-pill .shm-dot"),
      clock: byId("server-health-clock"),
      kpis: byId("server-health-kpis"),
      serverGrid: byId("server-health-server-grid")
    };
  }

  function allFields(server) {
    var f = server.fields;
    return unique([f.cpu, f.ram, f.temperature, f.networkIn, f.networkOut, f.diskUsed, f.diskTotal]);
  }

  function timeseriesFields(server) {
    var f = server.fields;
    return unique([f.cpu, f.ram, f.temperature, f.networkIn, f.networkOut, f.diskUsed]);
  }

  function historyWindow(anchor) {
    var to = Number(anchor || Date.now());
    return {
      from: to - state.historyMinutes * 60 * 1000,
      to: to
    };
  }

  function buildTelemetryUrl(server) {
    if (!server.sessionId || !state.syncId) return "";
    var query = new URLSearchParams();
    query.set("fields", allFields(server).join(","));
    return "/api/" + encodeURIComponent(server.sessionId) + "/" + encodeURIComponent(state.syncId) + "/iotelemetry?" + query.toString();
  }

  function buildTimeseriesUrl(server, range) {
    if (!server.sessionId || !state.syncId) return "";
    var windowRange = range || historyWindow();
    var query = new URLSearchParams();
    query.set("from", String(windowRange.from));
    query.set("to", String(windowRange.to));
    query.set("fields", timeseriesFields(server).join(","));
    return "/api/" + encodeURIComponent(server.sessionId) + "/" + encodeURIComponent(state.syncId) + "/iotimeseries?" + query.toString();
  }

  function buildStreamUrl(server) {
    if (!server.sessionId) return "";
    var query = new URLSearchParams();
    query.set("fields", allFields(server).join(","));
    return "/api/" + encodeURIComponent(server.sessionId) + "/stream?" + query.toString();
  }

  function fetchJson(url) {
    if (!url) return Promise.resolve(null);
    return fetch(url, { cache: "no-store" }).then(function (response) {
      if (!response.ok) return null;
      return response.json().catch(function () { return null; });
    }).catch(function () {
      return null;
    });
  }

  function readPayload(payload, field) {
    if (!payload || !field) return null;
    if (Object.prototype.hasOwnProperty.call(payload, field)) return payload[field];
    var wanted = String(field).toLowerCase();
    var keys = Object.keys(payload);
    for (var index = 0; index < keys.length; index += 1) {
      if (String(keys[index]).toLowerCase() === wanted) return payload[keys[index]];
    }
    return null;
  }

  function num(value) {
    if (value === null || value === undefined || value === "") return null;
    var next = Number(value);
    return Number.isFinite(next) ? next : null;
  }

  function groupRows(rows) {
    var grouped = {};
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var field = String(row && row.field || "").toLowerCase();
      var value = num(row && row.value);
      var ts = Number(row && row.ts);
      if (!field || value === null || !Number.isFinite(ts)) return;
      if (!grouped[field]) grouped[field] = [];
      grouped[field].push({ ts: ts, value: value });
    });
    return grouped;
  }

  function samplePoints(points, maxPoints) {
    var visible = (Array.isArray(points) ? points : []).slice().sort(function (left, right) {
      return Number(left.ts || 0) - Number(right.ts || 0);
    });
    var limit = Math.max(2, Number(maxPoints || 180));
    if (visible.length <= limit) return visible;
    var step = (visible.length - 1) / (limit - 1);
    var sampled = [];
    for (var index = 0; index < limit; index += 1) {
      var sourceIndex = Math.round(index * step);
      if (sourceIndex >= visible.length) sourceIndex = visible.length - 1;
      if (sampled.length <= 0 || sampled[sampled.length - 1] !== visible[sourceIndex]) {
        sampled.push(visible[sourceIndex]);
      }
    }
    if (sampled[sampled.length - 1] !== visible[visible.length - 1]) sampled.push(visible[visible.length - 1]);
    return sampled;
  }

  function getSeries(result, field) {
    var key = String(field || "").toLowerCase();
    var range = historyWindow();
    var rows = result && result.rowsByField && result.rowsByField[key] || [];
    rows = rows.filter(function (point) {
      var ts = Number(point && point.ts);
      return Number.isFinite(ts) && ts >= range.from && ts <= range.to;
    });
    if (rows.length) return samplePoints(rows, 180);
    var latest = metricValue(result, field);
    if (latest === null) return [];
    var lastSeen = Number(result && result.lastSeen || 0);
    if (lastSeen && (lastSeen < range.from || lastSeen > range.to)) return [];
    return [{ ts: lastSeen || Date.now(), value: latest }];
  }

  function metricValue(result, field) {
    return num(readPayload(result && result.payload, field));
  }

  function emptyResult(server) {
    return {
      server: server,
      payload: {},
      lastSeen: 0,
      rowsByField: {},
      connectionState: "connecting"
    };
  }

  function fetchServer(server, range) {
    return Promise.all([
      fetchJson(buildTelemetryUrl(server)),
      fetchJson(buildTimeseriesUrl(server, range))
    ]).then(function (parts) {
      var telemetry = parts[0] && parts[0].c2 && typeof parts[0].c2 === "object" ? parts[0].c2 : null;
      var ts = parts[1] && parts[1].c2 && typeof parts[1].c2 === "object" ? parts[1].c2 : null;
      return {
        server: server,
        payload: telemetry && telemetry.payload || {},
        lastSeen: Number(telemetry && telemetry.serverTime) || 0,
        rowsByField: groupRows(ts && ts.rows || [])
      };
    });
  }

  function fetchServerHistory(server, range) {
    return fetchJson(buildTimeseriesUrl(server, range)).then(function (payload) {
      var ts = payload && payload.c2 && typeof payload.c2 === "object" ? payload.c2 : null;
      return {
        server: server,
        rowsByField: groupRows(ts && ts.rows || []),
        range: range
      };
    });
  }

  function mergeResult(index, nextResult) {
    var current = state.results[index] || emptyResult(state.servers[index]);
    state.results[index] = {
      server: current.server,
      payload: Object.assign({}, current.payload, nextResult && nextResult.payload || {}),
      lastSeen: Math.max(Number(current.lastSeen || 0), Number(nextResult && nextResult.lastSeen || 0)),
      rowsByField: Object.assign({}, current.rowsByField, nextResult && nextResult.rowsByField || {}),
      connectionState: current.connectionState
    };
    trimResultSeries(state.results[index]);
  }

  function replaceResultHistory(index, nextResult, range) {
    var current = state.results[index] || emptyResult(state.servers[index]);
    var nextRows = Object.assign({}, nextResult && nextResult.rowsByField || {});
    Object.keys(current.rowsByField || {}).forEach(function (key) {
      var preserved = (current.rowsByField[key] || []).filter(function (point) {
        var ts = Number(point && point.ts);
        return Number.isFinite(ts) && ts > range.to && ts >= range.from;
      });
      if (!preserved.length) return;
      nextRows[key] = (nextRows[key] || []).concat(preserved).sort(function (left, right) {
        return Number(left.ts || 0) - Number(right.ts || 0);
      });
    });
    state.results[index] = {
      server: current.server,
      payload: current.payload,
      lastSeen: current.lastSeen,
      rowsByField: nextRows,
      connectionState: current.connectionState
    };
    trimResultSeries(state.results[index]);
  }

  function appendTimeseriesRows(result, rows) {
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      var field = String(row && row.field || "").trim();
      var key = field.toLowerCase();
      var value = num(typeof row.last !== "undefined" ? row.last : row.value);
      var ts = Number(row && row.ts) || Date.now();
      if (!field || value === null) return;
      if (!result.rowsByField[key]) result.rowsByField[key] = [];
      result.rowsByField[key].push({ ts: ts, value: value });
      setPayloadValue(result, field, value, ts);
    });
    trimResultSeries(result);
  }

  function setPayloadValue(result, field, value, timestamp) {
    if (!result || !field) return;
    result.payload[field] = value;
    result.lastSeen = Math.max(Number(result.lastSeen || 0), Number(timestamp || Date.now()));
  }

  function trimResultSeries(result) {
    if (!result || !result.rowsByField) return;
    var cutoff = Date.now() - state.historyMinutes * 60 * 1000;
    Object.keys(result.rowsByField).forEach(function (key) {
      result.rowsByField[key] = (result.rowsByField[key] || []).filter(function (point) {
        return Number(point.ts) >= cutoff;
      });
    });
  }

  function formatPercent(value) {
    return value === null ? "--" : Math.round(value) + "%";
  }

  function formatNumber(value, digits) {
    if (value === null) return "--";
    return Number(value).toLocaleString(dateLocale(), {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits || 0
    });
  }

  function formatMbps(value) {
    if (value === null) return "--";
    if (Math.abs(value) >= 1000) return formatNumber(value / 1000, 1) + " Gbps";
    return formatNumber(value, 1) + " Mbps";
  }

  function formatGb(value) {
    if (value === null) return "--";
    if (Math.abs(value) >= 1024) return formatNumber(value / 1024, 1) + " TB";
    return formatNumber(value, 0) + " GB";
  }

  function formatCelsius(value) {
    return value === null ? "--" : formatNumber(value, 1) + "\u00b0C";
  }

  function formatTime(ts) {
    if (!ts) return "--";
    try {
      return new Date(ts).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch (error) {
      return "--";
    }
  }

  function shortSession(sessionId) {
    var raw = String(sessionId || "");
    var at = raw.indexOf("@");
    return at > 0 ? raw.slice(0, at) : raw.slice(0, 18);
  }

  function severityFor(value, warn, danger) {
    if (value === null) return "loading";
    if (value >= danger) return "danger";
    if (value >= warn) return "warn";
    return "ok";
  }

  function colorForSeverity(severity, fallback) {
    if (severity === "danger") return "#ef4444";
    if (severity === "warn") return "#f59e0b";
    if (severity === "offline") return "#94a3b8";
    return fallback || "#22c55e";
  }

  function statusFor(result) {
    var now = Date.now();
    if (!result.lastSeen) {
      return result.connectionState === "offline"
        ? { state: "offline", label: t("offline", "Offline") }
        : { state: "loading", label: t("loadingData", "Waiting for data") };
    }
    if (now - result.lastSeen > STALE_AFTER_MS) return { state: "offline", label: t("stale", "Stale") };
    var f = result.server.fields;
    var cpu = metricValue(result, f.cpu);
    var ram = metricValue(result, f.ram);
    var used = metricValue(result, f.diskUsed);
    var total = metricValue(result, f.diskTotal);
    var disk = used !== null && total ? used / total * 100 : null;
    var danger = cpu >= state.config.thresholds.cpuDanger
      || ram >= state.config.thresholds.ramDanger
      || disk >= state.config.thresholds.diskDanger;
    if (danger) return { state: "danger", label: t("critical", "Critical") };
    var warn = cpu >= state.config.thresholds.cpuWarn
      || ram >= state.config.thresholds.ramWarn
      || disk >= state.config.thresholds.diskWarn;
    return warn ? { state: "warn", label: t("warning", "Warning") } : { state: "ok", label: t("online", "Online") };
  }

  function kpiHtml(label, value, detail) {
    return '<article class="shm-kpi"><small>' + esc(label) + '</small><strong>' + esc(value) + '</strong><span>' + esc(detail) + '</span></article>';
  }

  function updateKpis(results) {
    var online = 0;
    var cpuValues = [];
    var ramValues = [];
    var networkTotal = 0;
    var diskUsed = 0;
    var diskTotal = 0;

    results.forEach(function (result) {
      var status = statusFor(result);
      if (status.state === "ok" || status.state === "warn" || status.state === "danger") online += 1;
      var f = result.server.fields;
      var cpu = metricValue(result, f.cpu);
      var ram = metricValue(result, f.ram);
      var netIn = metricValue(result, f.networkIn);
      var netOut = metricValue(result, f.networkOut);
      var used = metricValue(result, f.diskUsed);
      var total = metricValue(result, f.diskTotal);
      if (cpu !== null) cpuValues.push(cpu);
      if (ram !== null) ramValues.push(ram);
      networkTotal += (netIn || 0) + (netOut || 0);
      if (used !== null) diskUsed += used;
      if (total !== null) diskTotal += total;
    });

    var avgCpu = average(cpuValues);
    var avgRam = average(ramValues);
    var diskPercent = diskTotal > 0 ? diskUsed / diskTotal * 100 : null;
    state.nodes.kpis.innerHTML = [
      kpiHtml(t("serverOnline", "Servers online"), online + " / " + results.length, t("updated", "Updated") + " " + formatTime(Date.now())),
      kpiHtml(t("avgCpu", "Average CPU"), formatPercent(avgCpu), cpuValues.length + " " + t("serversWithData", "servers with data")),
      kpiHtml(t("avgRam", "Average RAM"), formatPercent(avgRam), ramValues.length + " " + t("serversWithData", "servers with data")),
      kpiHtml(t("diskMain", "Primary disk"), formatPercent(diskPercent), formatGb(diskUsed || null) + " / " + formatGb(diskTotal || null))
    ].join("");

    var overallState = online === 0 ? "offline" : (results.some(function (item) { return statusFor(item).state === "danger"; }) ? "danger" : (results.some(function (item) { return statusFor(item).state === "warn"; }) ? "warn" : "ok"));
    state.nodes.statusDot.setAttribute("data-state", overallState);
    state.nodes.statusText.textContent = online ? (t("online", "Online") + " " + online + "/" + results.length) : t("noData", "No data");
  }

  function average(values) {
    if (!values.length) return null;
    return values.reduce(function (sum, value) { return sum + value; }, 0) / values.length;
  }

  function networkSeries(result) {
    var inRows = getSeries(result, result.server.fields.networkIn).map(function (point) {
      return { ts: point.ts, value: point.value, key: "in" };
    });
    var outRows = getSeries(result, result.server.fields.networkOut).map(function (point) {
      return { ts: point.ts, value: point.value, key: "out" };
    });
    var events = inRows.concat(outRows).sort(function (a, b) { return a.ts - b.ts; });
    var latestIn = null;
    var latestOut = null;
    var points = [];
    events.forEach(function (event) {
      if (event.key === "in") latestIn = event.value;
      if (event.key === "out") latestOut = event.value;
      if (latestIn !== null || latestOut !== null) {
        points.push({ ts: event.ts, value: (latestIn || 0) + (latestOut || 0) });
      }
    });
    return points;
  }

  function diskPercentSeries(result, fallbackTotal) {
    var usedRows = getSeries(result, result.server.fields.diskUsed);
    var totalRows = getSeries(result, result.server.fields.diskTotal);
    var latestTotal = Number(fallbackTotal || 0);
    var totalByTime = {};
    totalRows.forEach(function (point) {
      if (point.value > 0) {
        latestTotal = point.value;
        totalByTime[String(point.ts)] = point.value;
      }
    });
    return usedRows.map(function (point) {
      var total = totalByTime[String(point.ts)] || latestTotal;
      if (!total) return null;
      return { ts: point.ts, value: clamp(point.value / total * 100, 0, 100) };
    }).filter(Boolean);
  }

  function normalizedNetworkSeries(result) {
    var rows = networkSeries(result);
    var max = rows.reduce(function (highest, point) {
      return Math.max(highest, Number(point.value || 0));
    }, 0);
    if (!max) return [];
    return rows.map(function (point) {
      return { ts: point.ts, value: clamp(point.value / max * 100, 0, 100) };
    });
  }

  function combinedHealthSeries(result, diskTotal) {
    var f = result.server.fields;
    var series = [
      { label: "CPU", color: "#2563eb", points: getSeries(result, f.cpu) },
      { label: "RAM", color: "#f59e0b", points: getSeries(result, f.ram) },
      { label: "DISK", color: "#16a34a", points: diskPercentSeries(result, diskTotal) },
      { label: "NET", color: "#0891b2", points: normalizedNetworkSeries(result) }
    ];
    var temperature = getSeries(result, f.temperature);
    if (temperature.length) series.push({ label: "TEMP", color: "#ef4444", points: temperature });
    return series;
  }

  function seriesLegend(series) {
    return '<div class="shm-series-legend">' + series.map(function (item) {
      return '<span><i style="background:' + esc(item.color) + '"></i>' + esc(item.label) + '</span>';
    }).join("") + '</div>';
  }

  function pointPath(points, xMin, xMax, yMin, yMax, width, height, pad) {
    if (!points.length) return "";
    var innerW = width - pad.left - pad.right;
    var innerH = height - pad.top - pad.bottom;
    var safeX = xMax === xMin ? xMin + 1 : xMax;
    var safeY = yMax === yMin ? yMin + 1 : yMax;
    return points.map(function (point, index) {
      var x = pad.left + ((point.ts - xMin) / (safeX - xMin)) * innerW;
      var y = pad.top + (1 - ((point.value - yMin) / (safeY - yMin))) * innerH;
      x = clamp(x, pad.left, width - pad.right);
      y = clamp(y, pad.top, height - pad.bottom);
      return (index === 0 ? "M " : "L ") + x.toFixed(2) + " " + y.toFixed(2);
    }).join(" ");
  }

  function lineChartSvg(seriesList, options) {
    var range = options && options.range ? options.range : historyWindow();
    var series = (Array.isArray(seriesList) ? seriesList : []).map(function (item) {
      return {
        label: item.label || "",
        color: item.color || "#2563eb",
        points: (Array.isArray(item.points) ? item.points : []).filter(function (point) {
          var ts = Number(point && point.ts);
          return Number.isFinite(ts) && Number.isFinite(Number(point.value)) && ts >= range.from && ts <= range.to;
        })
      };
    }).map(function (item) {
      item.points = samplePoints(item.points, 180);
      return item;
    }).filter(function (item) { return item.points.length; });

    if (!series.length) {
      return '<div class="shm-empty">' + esc(options && options.empty || t("noData", "No data")) + '</div>';
    }

    var width = 640;
    var height = 220;
    var pad = { top: 18, right: 18, bottom: 34, left: 46 };
    var allPoints = [];
    series.forEach(function (item) { allPoints = allPoints.concat(item.points); });
    var xMin = range.from;
    var xMax = range.to;
    var yMax = options && Number.isFinite(Number(options.max)) ? Number(options.max) : allPoints.reduce(function (max, point) { return Math.max(max, point.value); }, 0);
    yMax = yMax > 0 ? yMax * (options && options.max ? 1 : 1.16) : 1;
    var yMin = 0;
    var grid = "";
    for (var step = 0; step <= 4; step += 1) {
      var y = pad.top + ((height - pad.top - pad.bottom) / 4) * step;
      var labelValue = yMax - (yMax / 4) * step;
      grid += '<line class="grid" x1="' + pad.left + '" y1="' + y.toFixed(2) + '" x2="' + (width - pad.right) + '" y2="' + y.toFixed(2) + '"></line>';
      grid += '<text class="axis-label" x="8" y="' + (y + 4).toFixed(2) + '">' + esc(shortAxis(labelValue, options && options.unit)) + '</text>';
    }
    grid += '<text class="axis-label" x="' + pad.left + '" y="' + (height - 9) + '">' + esc(formatSmallTime(xMin, state.historyMinutes)) + '</text>';
    grid += '<text class="axis-label" x="' + (width - pad.right) + '" y="' + (height - 9) + '" text-anchor="end">' + esc(formatSmallTime(xMax, state.historyMinutes)) + '</text>';

    var lines = series.map(function (item) {
      var path = pointPath(item.points, xMin, xMax, yMin, yMax, width, height, pad);
      var last = item.points[item.points.length - 1];
      var singlePoint = item.points.length === 1 ? singlePointCircle(last, xMin, xMax, yMin, yMax, width, height, pad, item.color) : "";
      return '<path class="line" d="' + esc(path) + '" stroke="' + esc(item.color) + '"></path>' + singlePoint;
    }).join("");

    return '<svg class="shm-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + grid + lines + '</svg>';
  }

  function singlePointCircle(point, xMin, xMax, yMin, yMax, width, height, pad, color) {
    var innerW = width - pad.left - pad.right;
    var innerH = height - pad.top - pad.bottom;
    var safeX = xMax === xMin ? xMin + 1 : xMax;
    var safeY = yMax === yMin ? yMin + 1 : yMax;
    var x = pad.left + ((point.ts - xMin) / (safeX - xMin)) * innerW;
    var y = pad.top + (1 - ((point.value - yMin) / (safeY - yMin))) * innerH;
    return '<circle class="point" cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="4" fill="' + esc(color) + '"></circle>';
  }

  function shortAxis(value, unit) {
    if (unit === "%") return Math.round(value) + "%";
    if (value >= 1000) return (value / 1000).toFixed(1) + "G";
    return Math.round(value).toString();
  }

  function formatSmallTime(ts, minutes) {
    try {
      if (Number(minutes || 0) >= 1440) {
        return new Date(ts).toLocaleString(dateLocale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      }
      return new Date(ts).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
    } catch (error) {
      return "";
    }
  }

  function gaugeHtml(label, value, warn, danger, accent) {
    var severity = severityFor(value, warn, danger);
    var color = colorForSeverity(severity, accent);
    var safe = value === null ? 0 : clamp(value, 0, 100);
    return ''
      + '<div class="shm-gauge">'
      + '<div class="shm-gauge-ring" style="--value:' + safe.toFixed(1) + '%;--gauge-color:' + esc(color) + '"><span class="shm-gauge-value">' + esc(formatPercent(value)) + '</span></div>'
      + '<div class="shm-gauge-label">' + esc(label) + '</div>'
      + '</div>';
  }

  function metricHtml(label, value) {
    return '<div class="shm-metric"><small>' + esc(label) + '</small><strong>' + esc(value) + '</strong></div>';
  }

  function renderServerCards(results) {
    state.nodes.serverGrid.innerHTML = results.map(function (result) {
      var server = result.server;
      var f = server.fields;
      var cpu = metricValue(result, f.cpu);
      var ram = metricValue(result, f.ram);
      var temperature = metricValue(result, f.temperature);
      var netIn = metricValue(result, f.networkIn);
      var netOut = metricValue(result, f.networkOut);
      var diskUsed = metricValue(result, f.diskUsed);
      var diskTotal = metricValue(result, f.diskTotal);
      var diskPercent = diskUsed !== null && diskTotal ? diskUsed / diskTotal * 100 : null;
      var status = statusFor(result);
      var diskSeverity = severityFor(diskPercent, state.config.thresholds.diskWarn, state.config.thresholds.diskDanger);
      var diskColor = colorForSeverity(diskSeverity, server.accent);
      var healthSeries = combinedHealthSeries(result, diskTotal);
      var range = historyWindow();

      return ''
        + '<article class="shm-server-card" style="--server-accent:' + esc(server.accent) + '">'
        + '<header class="shm-server-head">'
        + '<div class="shm-server-title"><h3>' + esc(server.name) + '</h3><p>Device key · ' + esc(shortSession(server.sessionId)) + '</p></div>'
        + '<div class="shm-server-state"><span class="shm-dot" data-state="' + esc(status.state) + '"></span>' + esc(status.label) + '</div>'
        + '</header>'
        + '<div class="shm-card-metrics">'
        + metricHtml("CPU", formatPercent(cpu))
        + metricHtml("RAM", formatPercent(ram))
        + (temperature === null ? "" : metricHtml(t("cpuTemp", "CPU temp"), formatCelsius(temperature)))
        + metricHtml("Network", formatMbps((netIn || 0) + (netOut || 0)))
        + metricHtml("Disk", formatPercent(diskPercent))
        + '</div>'
        + '<div class="shm-disk-bar">'
        + '<div class="shm-disk-row"><span>' + esc(t("diskMain", "Primary disk")) + '</span><strong>' + esc(formatGb(diskUsed) + " / " + formatGb(diskTotal)) + '</strong></div>'
        + '<div class="shm-progress" style="--progress-color:' + esc(diskColor) + '"><span style="--progress:' + clamp(diskPercent || 0, 0, 100).toFixed(1) + '%"></span></div>'
        + '</div>'
        + '<div class="shm-card-foot"><span>' + esc(t("updated", "Updated") + " " + formatTime(result.lastSeen)) + '</span></div>'
        + seriesLegend(healthSeries)
        + '<div class="shm-mini-chart">' + lineChartSvg(healthSeries, { max: 100, unit: "%", range: range, empty: t("chartEmpty", "No server history") }) + '</div>'
        + '</article>';
    }).join("");
  }

  function updateClock() {
    if (state.nodes.clock) state.nodes.clock.textContent = formatTime(Date.now());
  }

  function renderStatic() {
    state.nodes.title.textContent = state.config.title;
    state.nodes.subtitle.textContent = state.config.subtitle;
    state.nodes.eyebrow.textContent = state.config.eyebrow;
  }

  function formatRangeLabel(minutes) {
    var value = normalizeHistoryMinutes(minutes);
    var locale = localeKey();
    if (value >= 1440 && value % 1440 === 0) {
      var days = value / 1440;
      return locale === "en" ? days + " " + t("day", "day") + (days === 1 ? "" : "s") : days + " " + t("day", "ngày");
    }
    if (value >= 60 && value % 60 === 0) {
      var hours = value / 60;
      return locale === "en" ? hours + " " + t("hour", "hour") + (hours === 1 ? "" : "s") : hours + " " + t("hour", "giờ");
    }
    return value + " " + t("minute", "min");
  }

  function syncRangeSelect() {
    var select = state.nodes.rangeSelect;
    if (!select) return;
    var wanted = String(state.historyMinutes);
    var hasOption = Array.prototype.some.call(select.options, function (option) {
      return String(option.value) === wanted;
    });
    if (!hasOption) {
      var option = document.createElement("option");
      option.value = wanted;
      option.textContent = formatRangeLabel(state.historyMinutes);
      select.appendChild(option);
    }
    select.value = wanted;
  }

  function renderAll() {
    if (!state.servers.length || !state.syncId) {
      state.nodes.statusDot.setAttribute("data-state", "offline");
      state.nodes.statusText.textContent = t("missingContext", "Missing Device key or SyncID");
      state.nodes.kpis.innerHTML = kpiHtml(t("status", "Status"), t("notConfigured", "Not configured"), t("checkSetup", "Check the template setup."));
      state.nodes.serverGrid.innerHTML = "";
      return;
    }
    var results = state.results.length ? state.results : state.servers.map(emptyResult);
    updateKpis(results);
    if (state.historyLoading) {
      state.nodes.statusDot.setAttribute("data-state", "loading");
      state.nodes.statusText.textContent = t("loadingHistory", "Loading history");
    }
    renderServerCards(results);
  }

  function handleStreamPayload(index, payload) {
    var result = state.results[index];
    if (!result || !payload || !payload.type) return;
    result.connectionState = "online";
    if (payload.type === "telemetry" && payload.payload && typeof payload.payload === "object") {
      Object.keys(payload.payload).forEach(function (field) {
        setPayloadValue(result, field, payload.payload[field], payload.serverTime || Date.now());
      });
      renderAll();
      return;
    }
    if (payload.type === "timeseries" && Array.isArray(payload.rows)) {
      appendTimeseriesRows(result, payload.rows);
      renderAll();
    }
  }

  function bootstrapServer(index, range) {
    var server = state.servers[index];
    if (!server) return Promise.resolve();
    return fetchServer(server, range).then(function (result) {
      mergeResult(index, result);
      renderAll();
    }).catch(function () {});
  }

  function refreshHistory() {
    if (!state.servers.length || !state.syncId) return Promise.resolve();
    var range = historyWindow();
    var token = state.historyRequestToken + 1;
    state.historyRequestToken = token;
    state.historyLoading = true;
    renderAll();
    return Promise.all(state.servers.map(function (server, index) {
      return fetchServerHistory(server, range).then(function (result) {
        return { index: index, result: result };
      }).catch(function () {
        return { index: index, result: null };
      });
    })).then(function (items) {
      if (token !== state.historyRequestToken) return;
      items.forEach(function (item) {
        if (item.result) replaceResultHistory(item.index, item.result, range);
      });
    }).finally(function () {
      if (token !== state.historyRequestToken) return;
      state.historyLoading = false;
      renderAll();
    });
  }

  function connectServerStream(index) {
    var server = state.servers[index];
    var result = state.results[index];
    var url = buildStreamUrl(server);
    if (!server || !result || !url || typeof EventSource === "undefined") return;
    try {
      if (state.streams[index]) state.streams[index].close();
      if (state.reconnectTimers[index]) window.clearTimeout(state.reconnectTimers[index]);
      result.connectionState = "connecting";
      state.streams[index] = new EventSource(url);
      state.streams[index].onopen = function () {
        result.connectionState = "online";
        renderAll();
      };
      state.streams[index].onmessage = function (event) {
        try {
          handleStreamPayload(index, JSON.parse(event.data));
        } catch (error) {}
      };
      state.streams[index].onerror = function () {
        if (state.streams[index]) state.streams[index].close();
        state.streams[index] = null;
        result.connectionState = "offline";
        renderAll();
        if (state.reconnectTimers[index]) window.clearTimeout(state.reconnectTimers[index]);
        state.reconnectTimers[index] = window.setTimeout(function () {
          state.reconnectTimers[index] = null;
          connectServerStream(index);
        }, RECONNECT_MS);
      };
    } catch (error) {
      result.connectionState = "offline";
      renderAll();
    }
  }

  function startDataFlow() {
    var range = historyWindow();
    state.results = state.servers.map(emptyResult);
    renderAll();
    state.servers.forEach(function (_server, index) {
      bootstrapServer(index, range).finally(function () {
        connectServerStream(index);
      });
    });
  }

  function cleanupStreams() {
    state.streams.forEach(function (stream) {
      if (stream) stream.close();
    });
    state.reconnectTimers.forEach(function (timer) {
      if (timer) window.clearTimeout(timer);
    });
  }

  function bindThemePicker() {
    var picker = byId("theme-picker");
    var toggle = byId("theme-picker-toggle");
    var menu = byId("theme-picker-menu");
    if (!picker || !toggle || !menu) return;

    function setOpen(isOpen) {
      picker.classList.toggle("is-open", !!isOpen);
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }

    function applyTheme(theme) {
      var nextTheme = theme || "neumorphism";
      document.documentElement.setAttribute("data-theme", nextTheme);
      try {
        window.localStorage.setItem("sample-dashboard-theme", nextTheme);
      } catch (error) {}
      var buttons = picker.querySelectorAll("[data-theme-option]");
      buttons.forEach(function (button) {
        var isActive = String(button.getAttribute("data-theme-option") || "") === nextTheme;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-checked", isActive ? "true" : "false");
      });
    }

    toggle.addEventListener("click", function () {
      setOpen(!picker.classList.contains("is-open"));
    });

    menu.addEventListener("click", function (event) {
      var button = event.target && typeof event.target.closest === "function"
        ? event.target.closest("[data-theme-option]")
        : null;
      if (!button) return;
      applyTheme(String(button.getAttribute("data-theme-option") || "neumorphism"));
      setOpen(false);
    });

    document.addEventListener("click", function (event) {
      if (picker.contains(event.target)) return;
      setOpen(false);
    });

    applyTheme(document.documentElement.getAttribute("data-theme") || "neumorphism");
  }

  function bindRangeSelect() {
    var select = state.nodes.rangeSelect;
    if (!select) return;
    if (!select.options.length) {
      (HISTORY_RANGE_OPTIONS[localeKey()] || HISTORY_RANGE_OPTIONS.vi).forEach(function (option) {
        var node = document.createElement("option");
        node.value = String(option.minutes);
        node.textContent = option.label;
        select.appendChild(node);
      });
    }
    syncRangeSelect();
    select.addEventListener("change", function () {
      var nextMinutes = normalizeHistoryMinutes(select.value);
      if (nextMinutes === state.historyMinutes) return;
      state.historyMinutes = nextMinutes;
      state.config.historyMinutes = nextMinutes;
      syncRangeSelect();
      refreshHistory();
    });
  }

  function init() {
    collectNodes();
    state.config = normalizeConfig(readConfig());
    state.servers = state.config.servers;
    state.syncId = state.config.syncId;
    state.historyMinutes = state.config.historyMinutes;
    renderStatic();
    bindThemePicker();
    bindRangeSelect();
    updateClock();
    window.setInterval(updateClock, 1000);
    state.statusTimer = window.setInterval(renderAll, 30000);
    window.addEventListener("beforeunload", cleanupStreams);
    startDataFlow();
  }

  init();
})();
