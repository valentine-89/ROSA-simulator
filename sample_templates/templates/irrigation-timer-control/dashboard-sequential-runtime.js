(function () {
  var configNode = document.getElementById("irrigation-sequential-config");
  var config = { title: "", syncId: "", history: {}, devices: [], ui: {} };
  try {
    config = JSON.parse(configNode && configNode.textContent ? configNode.textContent : "{}");
  } catch (error) {
    console.error("Invalid sequential irrigation config", error);
  }

  var searchParams = new URLSearchParams(window.location.search);
  var syncId = String(searchParams.get("syncId") || searchParams.get("syncid") || config.syncId || "").trim();
  var ui = config.ui || {};
  var heroTitle = document.getElementById("hero-title");
  var devicesTitle = document.getElementById("devices-title");
  var deviceList = document.getElementById("device-list");
  var controlCountChip = document.getElementById("control-count-chip");
  var controlsLive = document.getElementById("controls-live");
  var historyCard = document.getElementById("history-card");
  var historyToggle = document.getElementById("history-toggle");
  var historyContent = document.getElementById("history-content");
  var historyBody = document.getElementById("history-body");
  var historyRefreshButton = document.getElementById("history-refresh");
  var historySourceChip = document.getElementById("history-source-chip");
  var scheduleModal = document.getElementById("schedule-modal");
  var scheduleModalTitle = document.getElementById("schedule-modal-title");
  var scheduleModalDescription = document.getElementById("schedule-modal-description");
  var scheduleModalClose = document.getElementById("schedule-modal-close");
  var scheduleModalCancel = document.getElementById("schedule-modal-cancel");
  var scheduleModalSave = document.getElementById("schedule-modal-save");
  var scheduleBody = document.getElementById("schedule-body");
  var durationModal = document.getElementById("duration-modal");
  var durationModalTitle = document.getElementById("duration-modal-title");
  var durationModalDescription = document.getElementById("duration-modal-description");
  var durationModalClose = document.getElementById("duration-modal-close");
  var durationModalCancel = document.getElementById("duration-modal-cancel");
  var durationModalSave = document.getElementById("duration-modal-save");
  var durationValueInput = document.getElementById("duration-value");
  var durationUnitSelect = document.getElementById("duration-unit");
  var toastStack = document.getElementById("toast-stack");
  var themePickerToggle = document.getElementById("theme-picker-toggle");
  var themePickerMenu = document.getElementById("theme-picker-menu");

  var historyConfig = config.history || {};
  var historyState = {
    sessionId: String(historyConfig.sessionId || "").trim(),
    syncId: String(historyConfig.syncId || syncId || "").trim(),
    macro: String(historyConfig.macro || "").trim(),
    pageSize: Number(historyConfig.pageSize || 100) || 100,
    rows: []
  };
  var historyRequestId = 0;
  var historyEventSource = null;
  var historyReconnectTimer = null;
  var historyCooldownTimer = null;
  var historyRefreshQueued = false;
  var historyCooldownActive = false;
  var activeSchedulePump = null;
  var activeDurationTarget = null;
  var sessionStates = [];
  var devices = [];
  var liveTimer = null;
  var lastTelemetryAt = 0;

  function getUi(path, fallback) {
    var parts = String(path || "").split(".");
    var node = ui;
    for (var index = 0; index < parts.length; index += 1) {
      if (!node || typeof node !== "object" || !(parts[index] in node)) return fallback;
      node = node[parts[index]];
    }
    return node == null || node === "" ? fallback : node;
  }

  function formatUi(path, fallback, values) {
    var text = String(getUi(path, fallback) || "");
    Object.keys(values || {}).forEach(function (key) {
      text = text.replace(new RegExp("\\{" + key + "\\}", "g"), String(values[key]));
    });
    return text;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || String(fallback || "");
  }

  function unique(list) {
    var seen = {};
    return (list || []).filter(function (item) {
      var key = String(item || "").trim();
      var lower = key.toLowerCase();
      if (!key || seen[lower]) return false;
      seen[lower] = true;
      return true;
    });
  }

  function parseSessionContext(sessionId) {
    var normalized = String(sessionId || "").trim();
    var atIndex = normalized.indexOf("@");
    if (atIndex <= 0 || atIndex >= normalized.length - 1) return null;
    return { ioid: normalized.slice(0, atIndex), apikey: normalized.slice(atIndex + 1) };
  }

  function extractIoid(sessionId) {
    var context = parseSessionContext(sessionId);
    return context ? context.ioid : "";
  }

  function buildCommandApiUrl(sessionId) {
    var context = parseSessionContext(sessionId);
    if (!context) return "";
    return "https://iot.ioeasy.com/cmd/" + encodeURIComponent(context.ioid) + "?apiKey=" + encodeURIComponent(context.apikey);
  }

  function buildTelemetryUrl(sessionId, fields) {
    if (!sessionId || !syncId) return "";
    var params = new URLSearchParams();
    if (Array.isArray(fields) && fields.length) params.set("fields", fields.join(","));
    var suffix = params.toString();
    return "/api/" + encodeURIComponent(sessionId) + "/" + encodeURIComponent(syncId) + "/iotelemetry" + (suffix ? "?" + suffix : "");
  }

  function buildStreamUrl(sessionId, fields) {
    var params = new URLSearchParams();
    params.set("historyMs", "0");
    if (fields.length) params.set("fields", fields.join(","));
    return "/api/" + encodeURIComponent(sessionId) + "/stream?" + params.toString();
  }

  function buildIoDataUrl(sessionId, nextSyncId) {
    if (!sessionId || !nextSyncId) return "";
    return "/api/" + encodeURIComponent(sessionId) + "/" + encodeURIComponent(nextSyncId) + "/iodata";
  }

  function resolveCommandTemplate(command) {
    var resolver = window.AIBridgeCommandTemplate;
    var template = String(command == null ? "" : command);
    if (resolver && typeof resolver.resolveCommandTemplate === "function") {
      return resolver.resolveCommandTemplate(template);
    }
    return Promise.resolve(template.replace(/<<email>>/gi, "").replace(/<<username>>/gi, "").replace(/<<phone>>/gi, ""));
  }

  function postCommandRaw(commandApiUrl, command, timeoutMs) {
    return resolveCommandTemplate(command).then(function (resolvedCommand) {
      var controller = new AbortController();
      var timeoutId = window.setTimeout(function () { controller.abort(); }, timeoutMs || 5000);
      return fetch(commandApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: String(resolvedCommand || "") }),
        signal: controller.signal
      }).then(function (response) {
        return response.text().then(function (text) {
          if (!response.ok) {
            throw new Error(text || formatUi("network.requestFailedWithStatus", "Yêu cầu thất bại với mã {status}", { status: response.status }));
          }
          return text || "";
        });
      }).finally(function () {
        window.clearTimeout(timeoutId);
      });
    });
  }

  function responseHasOk(text) {
    var normalized = String(text || "").trim();
    if (!normalized) return false;
    return /(^|[^A-Z])OK(?=$|[^A-Z])/i.test(normalized) || /\bSUCCESS\b/i.test(normalized);
  }

  function responseMatchesCommandEcho(text, command) {
    var normalizedText = String(text || "").trim();
    var normalizedCommand = String(command || "").trim();
    if (!normalizedText || !normalizedCommand) return false;
    if (normalizedText.indexOf(normalizedCommand) >= 0) return true;
    var commandMatch = normalizedCommand.match(/^([^=]+?)=(.*)$/);
    if (!commandMatch) return false;
    var field = String(commandMatch[1] || "").trim();
    var expectedValue = String(commandMatch[2] || "").trim();
    if (!field || !expectedValue) return false;
    var responseMatch = normalizedText.match(new RegExp("(^|[^A-Za-z0-9_#])" + field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=\\s*([^\\r\\n]+)", "i"));
    return !!responseMatch && String(responseMatch[2] || "").trim() === expectedValue;
  }

  function delayMs(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
  }

  function runWriteCommand(sessionState, command, message, attemptsLeft) {
    var remaining = Number.isFinite(attemptsLeft) ? attemptsLeft : 3;
    if (!sessionState || !sessionState.commandApiUrl) return Promise.reject(new Error(message || getUi("network.requestFailed", "Yêu cầu thất bại.")));
    return postCommandRaw(sessionState.commandApiUrl, command, 5000).then(function (text) {
      if (responseHasOk(text) || responseMatchesCommandEcho(text, command) || !String(text || "").trim()) return text;
      if (remaining > 1) return delayMs(1200).then(function () { return runWriteCommand(sessionState, command, message, remaining - 1); });
      throw new Error(message || getUi("network.requestFailed", "Yêu cầu thất bại."));
    }).catch(function (error) {
      if (remaining > 1) return delayMs(1200).then(function () { return runWriteCommand(sessionState, command, message, remaining - 1); });
      throw error;
    });
  }

  function normalizeState(value) {
    var text = String(value == null ? "" : value).trim();
    var match = text.match(/=\s*([^,\r\n]+)/);
    var normalized = String(match ? match[1] : text).trim().toLowerCase();
    if (normalized === "on" || normalized === "1" || normalized === "true" || normalized === "open") return "on";
    if (normalized === "off" || normalized === "0" || normalized === "false" || normalized === "close" || normalized === "closed") return "off";
    return normalized ? "offline" : "unknown";
  }

  function normalizeCompactTimeValue(value) {
    var text = String(value == null ? "" : value).trim();
    if (!text) return "";
    text = text.replace(":", "");
    if (!/^\d{4}$/.test(text)) return "";
    var hour = Number(text.slice(0, 2));
    var minute = Number(text.slice(2, 4));
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
    return text;
  }

  function formatScheduleTime(value) {
    var compact = normalizeCompactTimeValue(value);
    return compact ? compact.slice(0, 2) + ":" + compact.slice(2, 4) : "";
  }

  function normalizeScheduleEnabledToken(value) {
    var normalized = String(value == null ? "" : value).trim().toLowerCase();
    if (normalized === "enable" || normalized === "enabled" || normalized === "on" || normalized === "true" || normalized === "1") return true;
    return false;
  }

  function createEmptyScheduleSnapshot() {
    return { enabled: false, time: "", action: "on", empty: true };
  }

  function cloneScheduleSnapshot(row) {
    var source = row || createEmptyScheduleSnapshot();
    return {
      enabled: !!source.enabled,
      time: String(source.time || ""),
      action: "on",
      empty: !!source.empty
    };
  }

  function scheduleSnapshotsEqual(left, right) {
    var a = cloneScheduleSnapshot(left);
    var b = cloneScheduleSnapshot(right);
    return a.enabled === b.enabled && a.time === b.time && a.empty === b.empty;
  }

  function parseScheduleTelemetryValue(rawText, fieldKey) {
    var text = stripFieldPrefix(rawText, fieldKey);
    if (!text) return createEmptyScheduleSnapshot();
    var parts = text.split(",").map(function (part) { return String(part == null ? "" : part).trim(); });
    var compactTime = normalizeCompactTimeValue(parts[0]);
    var enabled = normalizeScheduleEnabledToken(parts[1]);
    var empty = !compactTime || compactTime === "0000";
    return {
      enabled: empty ? false : enabled,
      time: empty ? "" : formatScheduleTime(compactTime),
      action: "on",
      empty: empty
    };
  }

  function buildScheduleTelemetryPayload(row) {
    if (!row || !row.fieldKey) return null;
    var compactTime = normalizeCompactTimeValue(String(row.time || "").replace(":", ""));
    var complete = !!compactTime && compactTime !== "0000";
    var payload = complete ? (compactTime + "," + (row.enabled ? "enable" : "disable") + ",ON") : "0000,disable,ON";
    return {
      command: row.fieldKey + "=" + payload,
      snapshot: {
        enabled: complete ? !!row.enabled : false,
        time: complete ? formatScheduleTime(compactTime) : "",
        action: "on",
        empty: !complete
      },
      empty: !complete
    };
  }

  function isScheduleRowDirty(row) {
    return row && !scheduleSnapshotsEqual(row, row.committed);
  }

  function rowHasCompleteSchedule(row) {
    var built = buildScheduleTelemetryPayload(row);
    return !!(built && !built.empty);
  }

  function stripFieldPrefix(rawText, fieldKey) {
    var text = String(rawText == null ? "" : rawText).trim();
    var normalizedFieldKey = String(fieldKey || "").trim();
    if (normalizedFieldKey) {
      var prefix = normalizedFieldKey + "=";
      if (text.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()) {
        text = text.slice(prefix.length).trim();
      }
    }
    return text;
  }

  function parseCsv(rawText, fieldKey) {
    var text = stripFieldPrefix(rawText, fieldKey);
    if (!text) return [];
    return text.split(",").map(function (part) { return String(part == null ? "" : part).trim(); });
  }

  function parseCsvInteger(value) {
    var text = String(value == null ? "" : value).trim();
    if (!text) return null;
    var number = Number(text);
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : null;
  }

  function padValveIndex(value) {
    return String(value).padStart(2, "0");
  }

  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined || seconds === "") return "";
    var value = Number(seconds);
    if (!Number.isFinite(value)) return "";
    return formatUi("valve.duration", "{seconds}s", { seconds: Math.max(0, Math.round(value)) });
  }

  function formatBattery(percent) {
    if (percent === null || percent === undefined || percent === "") return "";
    var value = Number(percent);
    if (!Number.isFinite(value)) return "";
    return formatUi("valve.battery", "{percent}%", { percent: Math.max(0, Math.min(100, Math.round(value))) });
  }

  function setLiveState(mode, label) {
    if (!controlsLive) return;
    controlsLive.setAttribute("data-state", mode);
    controlsLive.textContent = label;
  }

  function refreshLiveState() {
    var ageMs = lastTelemetryAt > 0 ? Date.now() - lastTelemetryAt : Infinity;
    if (ageMs < 30000) setLiveState("live", getUi("controls.live", "Hoạt động"));
    else if (ageMs < 120000) setLiveState("connecting", getUi("controls.stale", "Chậm dữ liệu"));
    else setLiveState("error", getUi("controls.offline", "Mất kết nối"));
  }

  function scheduleLiveCheck() {
    if (liveTimer) window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(function () {
      liveTimer = null;
      refreshLiveState();
      scheduleLiveCheck();
    }, 30000);
  }

  function showToast(message, type) {
    if (!toastStack) return;
    var toast = document.createElement("div");
    toast.className = "toast " + (type || "");
    toast.textContent = String(message || "");
    toastStack.appendChild(toast);
    window.setTimeout(function () { toast.remove(); }, 2800);
  }

  function setTheme(nextTheme) {
    document.documentElement.setAttribute("data-theme", nextTheme);
    try { window.localStorage.setItem("sample-dashboard-theme", nextTheme); } catch (error) {}
    if (!themePickerMenu) return;
    Array.prototype.forEach.call(themePickerMenu.querySelectorAll("[data-theme-option]"), function (button) {
      var isActive = String(button.getAttribute("data-theme-option") || "") === nextTheme;
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      button.setAttribute("aria-checked", isActive ? "true" : "false");
    });
  }

  function closeThemePickerMenu() {
    if (!themePickerMenu || !themePickerToggle) return;
    themePickerMenu.classList.remove("is-open");
    themePickerToggle.setAttribute("aria-expanded", "false");
  }

  function openThemePickerMenu() {
    if (!themePickerMenu || !themePickerToggle) return;
    themePickerMenu.classList.add("is-open");
    themePickerToggle.setAttribute("aria-expanded", "true");
  }

  function initializeThemePicker() {
    if (!themePickerMenu || !themePickerToggle) return;
    themePickerToggle.setAttribute("aria-label", getUi("theme.toggleAriaLabel", themePickerToggle.getAttribute("aria-label") || "Chọn giao diện"));
    themePickerMenu.setAttribute("aria-label", getUi("theme.menuAriaLabel", themePickerMenu.getAttribute("aria-label") || "Tùy chọn giao diện"));
    Array.prototype.forEach.call(themePickerMenu.querySelectorAll("[data-theme-option]"), function (button) {
      var themeKey = String(button.getAttribute("data-theme-option") || "").trim();
      button.textContent = getUi("theme.options." + themeKey, button.textContent.trim());
    });
    document.addEventListener("click", function (event) {
      var themeOption = event.target && typeof event.target.closest === "function" ? event.target.closest("[data-theme-option]") : null;
      if (themeOption) {
        setTheme(String(themeOption.getAttribute("data-theme-option") || "neumorphism"));
        closeThemePickerMenu();
        return;
      }
      var themeToggle = event.target && typeof event.target.closest === "function" ? event.target.closest("#theme-picker-toggle") : null;
      if (themeToggle) {
        if (themePickerMenu.classList.contains("is-open")) closeThemePickerMenu();
        else openThemePickerMenu();
        return;
      }
      if (!themePickerMenu.contains(event.target)) closeThemePickerMenu();
    });
    setTheme(document.documentElement.getAttribute("data-theme") || "neumorphism");
  }

  function scheduleIconHtml() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 3v4M17 3v4M4.5 9h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path><path d="M12 12v3l2 1.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  }

  function settingsIconHtml() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3v3M12 18v3M4.8 7.2l2.1 2.1M17.1 14.7l2.1 2.1M3 12h3M18 12h3M4.8 16.8l2.1-2.1M17.1 9.3l2.1-2.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"></circle></svg>';
  }

  function stateLabel(state) {
    if (state === "on") return getUi("state.on", "ON");
    if (state === "off") return getUi("state.off", "OFF");
    if (state === "pending") return getUi("state.pending", "ĐANG GỬI");
    if (state === "error") return getUi("state.error", "ERROR");
    if (state === "unknown") return getUi("state.unknown", "");
    return getUi("state.offline", "OFFLINE");
  }

  function createValveHtml(valve) {
    return ""
      + '<article class="valve-tile" data-valve-id="' + esc(valve.id) + '" data-state="unknown" data-battery="unknown" data-has-duration="false" title="' + esc(valve.label) + '">'
      + '<div class="valve-art"></div>'
      + '<button class="icon-button valve-settings-button" type="button" data-role="duration" aria-label="' + esc(formatUi("valve.settingsAria", "Cài thời gian tưới cho {label}", { label: valve.label })) + '">' + settingsIconHtml() + '</button>'
      + '<div class="valve-main">'
      + '<div class="valve-label"><strong>' + esc(valve.shortLabel) + '</strong><span class="state-pill" data-role="state" data-state="unknown"></span></div>'
      + '</div>'
      + '<div class="valve-meta">'
      + '<div class="battery-meter" data-role="battery-meter" data-empty="true"><span class="battery-shell" aria-hidden="true"><span data-role="battery-bar"></span></span><span data-role="battery"></span></div>'
      + '<span class="duration-label" data-role="duration-label"></span>'
      + '</div>'
      + '<div class="switch-control" data-role="valve-switch" data-state="unknown">'
      + '<button class="switch-zone" type="button" data-action="off" data-role="valve-off" aria-label="' + esc(formatUi("valve.turnOffAria", "Đóng {label}", { label: valve.label })) + '"></button>'
      + '<span class="switch-track" aria-hidden="true"><span class="switch-side">OFF</span><span class="switch-side">ON</span><span class="switch-thumb"></span></span>'
      + '<button class="switch-zone" type="button" data-action="on" data-role="valve-on" aria-label="' + esc(formatUi("valve.turnOnAria", "Mở {label}", { label: valve.label })) + '"></button>'
      + '</div>'
      + '</article>';
  }

  function createDeviceHtml(device) {
    var pump = device.pump;
    return ""
      + '<article class="device-card" data-device-id="' + esc(device.id) + '" data-flow="off">'
      + '<div class="device-header">'
      + '<div class="device-title"><strong>' + esc(device.title) + '</strong><span>' + esc(extractIoid(device.sessionId) || device.sessionId || "--") + '</span></div>'
      + '<div class="device-stats"><span class="mini-chip">' + esc(device.valves.length + " " + getUi(device.valves.length === 1 ? "controls.countSingular" : "controls.countPlural", "van")) + '</span></div>'
      + '</div>'
      + '<div class="device-flow">'
      + '<section class="pump-node" data-role="pump" data-state="unknown">'
      + '<div class="pump-art"></div>'
      + '<button class="icon-button node-corner-button" type="button" data-role="pump-schedule" aria-label="' + esc(formatUi("pump.scheduleAria", "Mở lịch tưới cho {label}", { label: pump.label })) + '">' + scheduleIconHtml() + '</button>'
      + '<div class="pump-main">'
      + '<div class="pump-label"><strong>' + esc(pump.label) + '</strong><span class="state-pill" data-role="pump-state" data-state="unknown"></span></div>'
      + '</div>'
      + '<div class="switch-control pump-switch" data-role="pump-switch" data-state="unknown">'
      + '<button class="switch-zone" type="button" data-action="off" data-role="pump-off" aria-label="' + esc(formatUi("pump.turnOffAria", "Tắt {label}", { label: pump.label })) + '"></button>'
      + '<span class="switch-track" aria-hidden="true"><span class="switch-side">OFF</span><span class="switch-side">ON</span><span class="switch-thumb"></span></span>'
      + '<button class="switch-zone" type="button" data-action="on" data-role="pump-on" aria-label="' + esc(formatUi("pump.turnOnAria", "Bật {label}", { label: pump.label })) + '"></button>'
      + '</div>'
      + '</section>'
      + '<div class="pipe-run"><div class="pipe-line" aria-hidden="true"></div><div class="valve-rail" data-role="valve-rail">' + device.valves.map(createValveHtml).join("") + '</div><div class="valve-scroll-control"><input type="range" min="0" max="1000" value="0" data-role="valve-scroll" aria-label="Kéo để xem các van trong tuyến"></div></div>'
      + '</div>'
      + '</article>';
  }

  function refreshDeviceFlow(device) {
    if (!device || !device.node) return;
    var flowing = device.pump.state === "on" || device.valves.some(function (valve) { return valve.state === "on"; });
    device.node.setAttribute("data-flow", flowing ? "on" : "off");
  }

  function setPumpVisual(device, state, label) {
    if (!device || !device.pump) return;
    device.pump.state = state || "unknown";
    if (device.pump.node) device.pump.node.setAttribute("data-state", device.pump.state);
    if (device.pump.stateNode) {
      device.pump.stateNode.setAttribute("data-state", device.pump.state);
      device.pump.stateNode.textContent = label || stateLabel(device.pump.state);
    }
    if (device.pump.switchNode) device.pump.switchNode.setAttribute("data-state", device.pump.state);
    refreshDeviceFlow(device);
  }

  function setValveVisual(device, valve) {
    if (!device || !valve || !valve.node) return;
    var nextState = valve.state || "unknown";
    valve.node.setAttribute("data-state", nextState);
    if (valve.stateNode) {
      valve.stateNode.setAttribute("data-state", nextState);
      valve.stateNode.textContent = stateLabel(nextState);
    }
    if (valve.switchNode) valve.switchNode.setAttribute("data-state", nextState);
    var batteryValue = Number(valve.batteryPercent);
    var hasBattery = valve.batteryPercent !== null && valve.batteryPercent !== undefined && valve.batteryPercent !== "" && Number.isFinite(batteryValue);
    var safeBattery = hasBattery ? Math.max(0, Math.min(100, Math.round(batteryValue))) : null;
    valve.node.setAttribute("data-battery", hasBattery && safeBattery <= 20 ? "low" : hasBattery ? "ok" : "unknown");
    valve.node.setAttribute("data-has-battery", hasBattery ? "true" : "false");
    if (valve.batteryNode) valve.batteryNode.textContent = formatBattery(hasBattery ? safeBattery : null);
    if (valve.batteryMeterNode) valve.batteryMeterNode.setAttribute("data-empty", hasBattery ? "false" : "true");
    if (valve.batteryBarNode) valve.batteryBarNode.style.setProperty("--battery-width", hasBattery ? safeBattery + "%" : "0%");
    var hasDuration = valve.durationSeconds !== null && valve.durationSeconds !== undefined && valve.durationSeconds !== "" && Number.isFinite(Number(valve.durationSeconds));
    valve.node.setAttribute("data-has-duration", hasDuration ? "true" : "false");
    if (valve.durationNode) valve.durationNode.textContent = formatDuration(hasDuration ? valve.durationSeconds : null);
    refreshDeviceFlow(device);
  }

  function refreshScheduleRowUi(row) {
    if (!row) return;
    if (row.enableInput) row.enableInput.checked = !!row.enabled;
    if (row.enableShell) row.enableShell.setAttribute("data-enabled", row.enabled ? "true" : "false");
    if (row.timeInput) row.timeInput.value = row.time || "";
    if (row.node) {
      row.node.classList.toggle("is-disabled", !row.enabled);
      row.node.classList.toggle("is-dirty", isScheduleRowDirty(row));
      row.node.classList.toggle("is-busy", !!row.busy);
      row.node.setAttribute("data-action", "on");
      row.node.setAttribute("data-dirty", isScheduleRowDirty(row) ? "true" : "false");
    }
  }

  function refreshScheduleSaveUi() {
    if (!scheduleModalSave || !activeSchedulePump) return;
    var dirtyCount = activeSchedulePump.scheduleRows.filter(isScheduleRowDirty).length;
    var saving = !!activeSchedulePump.scheduleSaving;
    scheduleModalSave.hidden = false;
    scheduleModalSave.disabled = saving || dirtyCount === 0 || !activeSchedulePump.sessionState.commandApiUrl;
    scheduleModalSave.textContent = saving ? getUi("schedule.saving", "Đang lưu...") : getUi("schedule.save", "Lưu lịch");
  }

  function updateScheduleRowState(row) {
    if (!row) return;
    row.empty = !rowHasCompleteSchedule(row);
    refreshScheduleRowUi(row);
    refreshScheduleSaveUi();
  }

  function setScheduleRowBusy(row, nextBusy) {
    row.busy = !!nextBusy;
    if (row.enableInput) row.enableInput.disabled = !!nextBusy;
    if (row.enableShell) row.enableShell.setAttribute("aria-disabled", nextBusy ? "true" : "false");
    if (row.timeInput) row.timeInput.disabled = !!nextBusy;
    refreshScheduleRowUi(row);
  }

  function renderScheduleRows(pump) {
    if (!scheduleBody) return;
    if (!pump || !pump.scheduleRows.length) {
      scheduleBody.innerHTML = '<tr><td colspan="2" class="empty-state">' + esc(getUi("schedule.empty", "Chưa có lịch tưới cho máy bơm này.")) + '</td></tr>';
      return;
    }
    scheduleBody.innerHTML = pump.scheduleRows.map(function (row) {
      return ""
        + '<tr class="schedule-row" data-index="' + row.index + '" data-action="on">'
        + '<td><label class="scheduler-enable" data-role="schedule-enable-shell"><input type="checkbox" data-role="schedule-enable" aria-label="' + esc(formatUi("schedule.enableAria", "Kích hoạt lịch {index}", { index: String(row.index + 1) })) + '"><span class="scheduler-enable-thumb"></span></label></td>'
        + '<td><input class="scheduler-time" type="time" data-role="schedule-time"></td>'
        + '</tr>';
    }).join("");
    Array.prototype.forEach.call(scheduleBody.querySelectorAll("[data-index]"), function (rowNode, index) {
      var row = pump.scheduleRows[index];
      if (!row) return;
      row.node = rowNode;
      row.enableShell = rowNode.querySelector("[data-role='schedule-enable-shell']");
      row.enableInput = rowNode.querySelector("[data-role='schedule-enable']");
      row.timeInput = rowNode.querySelector("[data-role='schedule-time']");
      refreshScheduleRowUi(row);
      if (row.enableInput) {
        row.enableInput.addEventListener("change", function () {
          if (row.busy || pump.scheduleSaving) return refreshScheduleRowUi(row);
          row.enabled = !!row.enableInput.checked;
          updateScheduleRowState(row);
        });
      }
      if (row.timeInput) {
        row.timeInput.addEventListener("input", function () {
          if (row.busy || pump.scheduleSaving) return refreshScheduleRowUi(row);
          row.time = String(row.timeInput.value || "");
          updateScheduleRowState(row);
        });
        row.timeInput.addEventListener("change", function () {
          if (row.busy || pump.scheduleSaving) return refreshScheduleRowUi(row);
          row.time = String(row.timeInput.value || "");
          updateScheduleRowState(row);
        });
      }
    });
  }

  function openScheduleModal(pump) {
    if (!pump || !scheduleModal) return;
    activeSchedulePump = pump;
    if (scheduleModalTitle) scheduleModalTitle.textContent = formatUi("schedule.title", "Lịch tưới | {label}", { label: pump.label });
    if (scheduleModalDescription) scheduleModalDescription.textContent = getUi("schedule.description", "Lịch bật máy bơm được lưu trực tiếp trên thiết bị.");
    if (scheduleModalClose) scheduleModalClose.setAttribute("aria-label", getUi("schedule.closeAria", "Đóng hộp thoại"));
    if (scheduleModalCancel) scheduleModalCancel.textContent = getUi("schedule.close", "Đóng");
    renderScheduleRows(pump);
    refreshScheduleSaveUi();
    scheduleModal.classList.add("is-open");
    scheduleModal.setAttribute("aria-hidden", "false");
  }

  function closeScheduleModal() {
    if (!scheduleModal) return;
    scheduleModal.classList.remove("is-open");
    scheduleModal.setAttribute("aria-hidden", "true");
    activeSchedulePump = null;
  }

  function persistScheduleRow(row) {
    var pump = row ? row.pump : null;
    var sessionState = pump ? pump.sessionState : null;
    var built = buildScheduleTelemetryPayload(row);
    if (!built || !pump || !sessionState || !sessionState.commandApiUrl || row.busy) return Promise.resolve(false);
    if (row.enabled && built.empty) {
      if (row.timeInput) row.timeInput.focus();
      return Promise.reject(new Error(getUi("schedule.invalid", "Lịch đã kích hoạt cần có thời điểm bật.")));
    }
    setScheduleRowBusy(row, true);
    return runWriteCommand(sessionState, built.command, getUi("schedule.failed", "Không thể lưu lịch tưới."), 3).then(function () {
      var snapshot = built.snapshot;
      row.enabled = snapshot.enabled;
      row.time = snapshot.time;
      row.action = "on";
      row.empty = snapshot.empty;
      row.committed = cloneScheduleSnapshot(snapshot);
      refreshScheduleRowUi(row);
      return true;
    }).finally(function () {
      setScheduleRowBusy(row, false);
      refreshScheduleSaveUi();
    });
  }

  function persistDirtyScheduleRows() {
    var pump = activeSchedulePump;
    if (!pump || pump.scheduleSaving) return Promise.resolve(false);
    var dirtyRows = pump.scheduleRows.filter(isScheduleRowDirty);
    if (!dirtyRows.length) {
      showToast(getUi("schedule.noChanges", "Không có thay đổi."), "success");
      return Promise.resolve(false);
    }
    var invalidRow = dirtyRows.find(function (row) { return !!row.enabled && !rowHasCompleteSchedule(row); });
    if (invalidRow) {
      if (invalidRow.timeInput) invalidRow.timeInput.focus();
      showToast(getUi("schedule.invalid", "Lịch đã kích hoạt cần có thời điểm bật."), "error");
      return Promise.resolve(false);
    }
    pump.scheduleSaving = true;
    refreshScheduleSaveUi();
    var chain = Promise.resolve();
    dirtyRows.forEach(function (row) {
      chain = chain.then(function () { return persistScheduleRow(row); });
    });
    return chain.then(function () {
      showToast(getUi("schedule.saved", "Đã lưu lịch tưới."), "success");
      return true;
    }).catch(function (error) {
      showToast((error && error.message) || getUi("schedule.failed", "Không thể lưu lịch tưới."), "error");
      return false;
    }).finally(function () {
      pump.scheduleSaving = false;
      refreshScheduleSaveUi();
    });
  }

  function openDurationModal(device, valve) {
    if (!durationModal || !device || !valve) return;
    activeDurationTarget = { device: device, valve: valve };
    if (durationModalTitle) durationModalTitle.textContent = formatUi("duration.title", "Thời gian tưới | {label}", { label: valve.label });
    if (durationModalDescription) durationModalDescription.textContent = getUi("duration.description", "Thời gian được ghi xuống field thời gian của tuyến van.");
    if (durationModalClose) durationModalClose.setAttribute("aria-label", getUi("duration.closeAria", "Đóng hộp thoại"));
    if (durationModalCancel) durationModalCancel.textContent = getUi("duration.close", "Đóng");
    if (durationModalSave) durationModalSave.textContent = getUi("duration.save", "Lưu thời gian");
    if (durationValueInput) {
      durationValueInput.value = valve.durationSeconds !== null && valve.durationSeconds !== undefined && valve.durationSeconds !== "" && Number.isFinite(Number(valve.durationSeconds))
        ? String(Math.round(Number(valve.durationSeconds)))
        : "";
    }
    if (durationUnitSelect) durationUnitSelect.value = "seconds";
    durationModal.classList.add("is-open");
    durationModal.setAttribute("aria-hidden", "false");
    if (durationValueInput) durationValueInput.focus();
  }

  function closeDurationModal() {
    if (!durationModal) return;
    durationModal.classList.remove("is-open");
    durationModal.setAttribute("aria-hidden", "true");
    activeDurationTarget = null;
  }

  function persistDuration() {
    var target = activeDurationTarget;
    if (!target || !target.device || !target.valve) return Promise.resolve(false);
    var device = target.device;
    var valve = target.valve;
    var sessionState = device.sessionState;
    var rawValue = durationValueInput ? Number(durationValueInput.value) : NaN;
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      showToast(getUi("duration.invalid", "Thời gian tưới chưa hợp lệ."), "error");
      if (durationValueInput) durationValueInput.focus();
      return Promise.resolve(false);
    }
    var seconds = Math.round(rawValue * (durationUnitSelect && durationUnitSelect.value === "minutes" ? 60 : 1));
    var fieldKey = device.valveConfig.durationField;
    if (!sessionState || !sessionState.commandApiUrl || !fieldKey) {
      showToast(getUi("duration.failed", "Không thể lưu thời gian tưới."), "error");
      return Promise.resolve(false);
    }
    var values = device.valves.map(function (entry) {
      var existing = Number(entry.durationSeconds);
      return Number.isFinite(existing) ? Math.max(0, Math.round(existing)) : 0;
    });
    values[valve.index] = seconds;
    var command = fieldKey + "=" + values.join(",");
    if (durationModalSave) {
      durationModalSave.disabled = true;
      durationModalSave.textContent = getUi("duration.saving", "Đang lưu...");
    }
    return runWriteCommand(sessionState, command, getUi("duration.failed", "Không thể lưu thời gian tưới."), 3).then(function () {
      device.durationValues = values;
      device.valves.forEach(function (entry, index) {
        entry.durationSeconds = values[index];
        setValveVisual(device, entry);
      });
      showToast(getUi("duration.saved", "Đã lưu thời gian tưới."), "success");
      closeDurationModal();
      return true;
    }).catch(function (error) {
      showToast((error && error.message) || getUi("duration.failed", "Không thể lưu thời gian tưới."), "error");
      return false;
    }).finally(function () {
      if (durationModalSave) {
        durationModalSave.disabled = false;
        durationModalSave.textContent = getUi("duration.save", "Lưu thời gian");
      }
    });
  }

  function extractConfiguredTelemetryValue(fieldKey, configuredField, value) {
    var key = String(fieldKey || "").trim().toLowerCase();
    var configured = String(configuredField || "").trim();
    if (!configured || key !== configured.toLowerCase()) return { matched: false, value: value };
    return { matched: true, value: stripFieldPrefix(value, configured) };
  }

  function applyScheduleSnapshot(row, snapshot) {
    var next = cloneScheduleSnapshot(snapshot);
    row.enabled = next.enabled;
    row.time = next.time;
    row.action = "on";
    row.empty = next.empty;
  }

  function applyValveStates(device, rawValue) {
    var values = parseCsv(rawValue, device.valveConfig.stateField);
    device.valves.forEach(function (valve, index) {
      if (index < values.length) valve.state = normalizeState(values[index]);
      setValveVisual(device, valve);
    });
  }

  function applyValveBatteries(device, rawValue) {
    var values = parseCsv(rawValue, device.valveConfig.batteryField);
    device.valves.forEach(function (valve, index) {
      if (index < values.length) valve.batteryPercent = parseCsvInteger(values[index]);
      setValveVisual(device, valve);
    });
  }

  function applyValveDurations(device, rawValue) {
    var values = parseCsv(rawValue, device.valveConfig.durationField).map(parseCsvInteger);
    device.durationValues = [];
    device.valves.forEach(function (valve, index) {
      if (index < values.length && values[index] !== null) valve.durationSeconds = values[index];
      device.durationValues[index] = valve.durationSeconds !== null && valve.durationSeconds !== undefined && valve.durationSeconds !== "" && Number.isFinite(Number(valve.durationSeconds))
        ? Math.round(Number(valve.durationSeconds))
        : null;
      setValveVisual(device, valve);
    });
  }

  function updateTelemetryField(sessionState, field, value, timestamp) {
    if (!sessionState) return;
    var key = String(field || "").trim().toLowerCase();
    sessionState.devices.forEach(function (device) {
      var pumpStateMatch = extractConfiguredTelemetryValue(key, device.pump.stateField, value);
      if (pumpStateMatch.matched) {
        var nextPumpState = normalizeState(pumpStateMatch.value);
        setPumpVisual(device, nextPumpState, stateLabel(nextPumpState));
      }
      var scheduleIndex = device.pump.scheduleFieldLookup[key];
      if (typeof scheduleIndex === "number") {
        var row = device.pump.scheduleRows[scheduleIndex];
        if (row) {
          var snapshot = parseScheduleTelemetryValue(value, row.fieldKey);
          var wasDirty = isScheduleRowDirty(row);
          row.committed = cloneScheduleSnapshot(snapshot);
          if (!wasDirty && !row.busy) applyScheduleSnapshot(row, snapshot);
          if (activeSchedulePump === device.pump) refreshScheduleRowUi(row);
        }
      }
      var stateMatch = extractConfiguredTelemetryValue(key, device.valveConfig.stateField, value);
      if (stateMatch.matched) applyValveStates(device, stateMatch.value);
      var batteryMatch = extractConfiguredTelemetryValue(key, device.valveConfig.batteryField, value);
      if (batteryMatch.matched) applyValveBatteries(device, batteryMatch.value);
      var durationMatch = extractConfiguredTelemetryValue(key, device.valveConfig.durationField, value);
      if (durationMatch.matched) applyValveDurations(device, durationMatch.value);
    });
    lastTelemetryAt = Math.max(lastTelemetryAt, Number(timestamp || Date.now()));
    refreshLiveState();
  }

  function handleStreamPayload(sessionState, payload) {
    if (!payload || !payload.type) return;
    if (payload.type === "telemetry" && payload.payload && typeof payload.payload === "object") {
      Object.keys(payload.payload).forEach(function (field) {
        updateTelemetryField(sessionState, field, payload.payload[field], payload.serverTime || Date.now());
      });
    } else if (payload.type === "timeseries" && Array.isArray(payload.rows)) {
      payload.rows.forEach(function (row) {
        updateTelemetryField(sessionState, row.field, typeof row.last !== "undefined" ? row.last : row.value, row.ts || Date.now());
      });
    }
  }

  function bootstrapSession(sessionState, fields) {
    var url = buildTelemetryUrl(sessionState.sessionId, fields || []);
    if (!url) return Promise.resolve();
    return fetch(url, { cache: "no-store" }).then(function (response) {
      if (!response.ok) return null;
      return response.json();
    }).then(function (payload) {
      var data = payload && payload.c2 && payload.c2.payload;
      if (!data || typeof data !== "object") return;
      Object.keys(data).forEach(function (field) {
        updateTelemetryField(sessionState, field, data[field], payload.c2.serverTime || Date.now());
      });
    }).catch(function () {});
  }

  function getSessionFields(sessionState) {
    return unique(sessionState.devices.reduce(function (list, device) {
      return list
        .concat(device.pump.stateField ? [device.pump.stateField] : [])
        .concat(device.pump.scheduleFields || [])
        .concat(device.valveConfig.stateField ? [device.valveConfig.stateField] : [])
        .concat(device.valveConfig.batteryField ? [device.valveConfig.batteryField] : [])
        .concat(device.valveConfig.durationField ? [device.valveConfig.durationField] : []);
    }, []));
  }

  function connectSession(sessionState) {
    if (!sessionState || !sessionState.sessionId) return;
    var fields = getSessionFields(sessionState);
    bootstrapSession(sessionState, fields).finally(function () {
      if (typeof EventSource === "undefined" || !fields.length) return;
      try {
        if (sessionState.eventSource) sessionState.eventSource.close();
        if (sessionState.reconnectTimer) window.clearTimeout(sessionState.reconnectTimer);
        sessionState.eventSource = new EventSource(buildStreamUrl(sessionState.sessionId, fields));
        sessionState.eventSource.onmessage = function (event) {
          try { handleStreamPayload(sessionState, JSON.parse(event.data)); } catch (error) {}
        };
        sessionState.eventSource.onerror = function () {
          if (sessionState.eventSource) sessionState.eventSource.close();
          sessionState.eventSource = null;
          if (sessionState.reconnectTimer) window.clearTimeout(sessionState.reconnectTimer);
          sessionState.reconnectTimer = window.setTimeout(function () {
            sessionState.reconnectTimer = null;
            connectSession(sessionState);
          }, 3000);
        };
      } catch (error) {
        sessionState.reconnectTimer = window.setTimeout(function () { connectSession(sessionState); }, 3000);
      }
    });
  }

  function sendPumpCommand(device, action) {
    var command = action === "on" ? device.pump.commandOn : device.pump.commandOff;
    var sessionState = device ? device.sessionState : null;
    if (!sessionState || !command || !sessionState.commandApiUrl || device.pump.busy) return;
    device.pump.busy = true;
    setPumpVisual(device, "pending", action === "on" ? getUi("pump.turningOn", "Đang bật") : getUi("pump.turningOff", "Đang tắt"));
    postCommandRaw(sessionState.commandApiUrl, command, 5000).then(function () {
      setPumpVisual(device, action, stateLabel(action));
      showToast(getUi("commands.sent", "Đã gửi lệnh."), "success");
    }).catch(function (error) {
      setPumpVisual(device, "error", stateLabel("error"));
      showToast((error && error.message) || getUi("commands.failed", "Gửi lệnh thất bại."), "error");
    }).finally(function () {
      device.pump.busy = false;
    });
  }

  function buildValveCommand(device, valve, action) {
    var template = String(device.valveConfig.commandTemplate || "");
    return template
      .replace(/\{action\}/g, action === "on" ? "ON" : "OFF")
      .replace(/\{valveId\}/g, String(valve.valveId))
      .replace(/\{index\}/g, String(valve.index))
      .replace(/\{label\}/g, valve.label);
  }

  function setValveButtonsBusy(valve, busy) {
    ["onButton", "offButton", "durationButton"].forEach(function (key) {
      if (valve[key]) valve[key].disabled = !!busy;
    });
  }

  function bindValveRailSlider(device) {
    if (!device || !device.railNode || !device.sliderNode) return;
    var syncFromRail = function () {
      var maxScroll = Math.max(0, device.railNode.scrollWidth - device.railNode.clientWidth);
      var hasOverflow = maxScroll > 2;
      device.sliderNode.disabled = !hasOverflow;
      if (device.sliderShellNode) device.sliderShellNode.hidden = !hasOverflow;
      if (!hasOverflow) {
        device.sliderNode.value = "0";
        return;
      }
      device.sliderNode.value = String(Math.round((device.railNode.scrollLeft / maxScroll) * 1000));
    };
    device.sliderNode.addEventListener("input", function () {
      var maxScroll = Math.max(0, device.railNode.scrollWidth - device.railNode.clientWidth);
      var ratio = Math.max(0, Math.min(1000, Number(device.sliderNode.value || 0))) / 1000;
      device.railNode.scrollLeft = maxScroll * ratio;
    });
    device.railNode.addEventListener("scroll", syncFromRail, { passive: true });
    if (window.ResizeObserver) {
      device.railResizeObserver = new ResizeObserver(syncFromRail);
      device.railResizeObserver.observe(device.railNode);
    }
    window.setTimeout(syncFromRail, 0);
  }

  function sendValveCommand(device, valve, action) {
    var sessionState = device ? device.sessionState : null;
    var command = buildValveCommand(device, valve, action);
    if (!sessionState || !command || !sessionState.commandApiUrl || valve.busy) return;
    valve.busy = true;
    setValveButtonsBusy(valve, true);
    valve.state = "pending";
    setValveVisual(device, valve);
    postCommandRaw(sessionState.commandApiUrl, command, 5000).then(function () {
      valve.state = action;
      setValveVisual(device, valve);
      showToast(getUi("commands.sent", "Đã gửi lệnh."), "success");
    }).catch(function (error) {
      valve.state = "error";
      setValveVisual(device, valve);
      showToast((error && error.message) || getUi("commands.failed", "Gửi lệnh thất bại."), "error");
    }).finally(function () {
      valve.busy = false;
      setValveButtonsBusy(valve, false);
    });
  }

  function postIoData(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) {
          throw new Error(data && data.error ? data.error : getUi("network.requestFailed", "Yêu cầu thất bại."));
        }
        return Array.isArray(data) ? data : [];
      }).catch(function (error) {
        if (!response.ok) throw error;
        throw new Error(getUi("network.unexpectedIoDataResponse", "Dữ liệu lịch sử không hợp lệ."));
      });
    });
  }

  function getEventTimeMs(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    var numeric = Number(value);
    if (Number.isFinite(numeric) && Math.abs(numeric) >= 100000000000) return numeric;
    var date = new Date(String(value).replace(" ", "T"));
    var time = date.getTime();
    return Number.isFinite(time) ? time : null;
  }

  function formatDateTime(value) {
    var time = getEventTimeMs(value);
    if (time === null) return value ? String(value) : "--";
    var date = new Date(time);
    return String(date.getDate()).padStart(2, "0") + "/" + String(date.getMonth() + 1).padStart(2, "0") + " "
      + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
  }

  function normalizeKeyword(value) {
    return String(value == null ? "" : value).trim().toLowerCase();
  }

  function severityFromEventType(eventType) {
    var normalized = normalizeKeyword(eventType);
    if (normalized === "on" || normalized === "control-on") return "control-on";
    if (normalized === "off" || normalized === "control-off") return "control-off";
    if (normalized === "schedule" || normalized === "timer") return "schedule";
    if (normalized === "manual") return "manual";
    return "neutral";
  }

  function eventTypeLabel(eventType) {
    var severity = severityFromEventType(eventType);
    if (severity === "control-on") return getUi("history.eventTypes.on", "Bật");
    if (severity === "control-off") return getUi("history.eventTypes.off", "Tắt");
    if (severity === "schedule") return getUi("history.eventTypes.schedule", "Hẹn giờ");
    if (severity === "manual") return getUi("history.eventTypes.manual", "Thủ công");
    return String(eventType || "--");
  }

  function scrollHistoryToLatest() {
    if (!historyContent) return;
    window.requestAnimationFrame(function () {
      historyContent.scrollTop = historyContent.scrollHeight;
    });
  }

  function renderHistoryRows(rows) {
    if (!historyBody) return;
    if (!rows || !rows.length) {
      historyBody.innerHTML = '<tr><td colspan="5" class="empty-state">' + esc(getUi("history.empty", "Chưa có dữ liệu lịch sử.")) + '</td></tr>';
      return;
    }
    historyBody.innerHTML = rows.map(function (row) {
      var eventType = row.event_type || row.type || row.c2 || "";
      var severity = severityFromEventType(eventType);
      var zone = row.zone_name || row.pond_name || row.zone || row.c1 || "--";
      return '<tr class="history-row" data-severity="' + esc(severity) + '">'
        + '<td>' + esc(formatDateTime(row.event_time_ms || row.event_time || row.time || row.t)) + '</td>'
        + '<td><span class="event-zone-pill">' + esc(zone) + '</span></td>'
        + '<td><span class="event-type-pill" data-severity="' + esc(severity) + '">' + esc(eventTypeLabel(eventType)) + '</span></td>'
        + '<td>' + esc(row.content || row.message || row.c3 || "") + '</td>'
        + '<td>' + esc(row.email || row.user || row.c4 || "") + '</td>'
        + '</tr>';
    }).join("");
    scrollHistoryToLatest();
  }

  function refreshHistory() {
    if (!historyState.sessionId || !historyState.syncId || !historyState.macro) {
      if (historyCard) historyCard.style.display = "none";
      return Promise.resolve();
    }
    if (historyCard) historyCard.style.display = "";
    var nextRequestId = ++historyRequestId;
    var url = buildIoDataUrl(historyState.sessionId, historyState.syncId);
    if (historySourceChip) historySourceChip.textContent = formatUi("history.sourceValue", "Nguồn {ioid}", { ioid: extractIoid(historyState.sessionId) || "history" });
    if (historyRefreshButton) historyRefreshButton.disabled = true;
    return postIoData(url, { macro: historyState.macro, page_size: historyState.pageSize, limit: historyState.pageSize, offset: 0 }).then(function (rows) {
      if (nextRequestId !== historyRequestId) return;
      historyState.rows = (rows || []).slice().sort(function (left, right) {
        return (getEventTimeMs(left.event_time_ms || left.event_time) || 0) - (getEventTimeMs(right.event_time_ms || right.event_time) || 0);
      }).slice(-historyState.pageSize);
      renderHistoryRows(historyState.rows);
    }).catch(function (error) {
      if (nextRequestId !== historyRequestId) return;
      renderHistoryRows([]);
      showToast((error && error.message) || getUi("history.loadFailed", "Không thể tải lịch sử."), "error");
    }).finally(function () {
      if (historyRefreshButton) historyRefreshButton.disabled = false;
    });
  }

  function armHistoryCooldown() {
    if (historyCooldownTimer) window.clearTimeout(historyCooldownTimer);
    historyCooldownActive = true;
    historyCooldownTimer = window.setTimeout(function () {
      historyCooldownTimer = null;
      historyCooldownActive = false;
      if (historyRefreshQueued) {
        historyRefreshQueued = false;
        refreshHistory();
        armHistoryCooldown();
      }
    }, 5000);
  }

  function handleHistoryChangedEvent() {
    if (!historyCooldownActive) {
      historyRefreshQueued = false;
      refreshHistory();
      armHistoryCooldown();
      return;
    }
    historyRefreshQueued = true;
  }

  function connectHistoryStream() {
    if (!historyState.sessionId || typeof EventSource === "undefined") return;
    if (historyEventSource) historyEventSource.close();
    if (historyReconnectTimer) window.clearTimeout(historyReconnectTimer);
    historyEventSource = new EventSource("/api/" + encodeURIComponent(historyState.sessionId) + "/stream?historyMs=0");
    historyEventSource.onmessage = function (event) {
      try {
        var payload = JSON.parse(event.data);
        if (payload && payload.type === "iodata_changed") handleHistoryChangedEvent();
      } catch (error) {}
    };
    historyEventSource.onerror = function () {
      if (historyEventSource) historyEventSource.close();
      historyEventSource = null;
      historyReconnectTimer = window.setTimeout(connectHistoryStream, 3000);
    };
  }

  function toggleHistory() {
    if (!historyContent || !historyToggle) return;
    var collapsed = !historyContent.hidden;
    historyContent.hidden = collapsed;
    historyToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    if (historyCard) historyCard.setAttribute("data-collapsed", collapsed ? "true" : "false");
    if (!collapsed) scrollHistoryToLatest();
  }

  function createScheduleRows(pump, fields) {
    return (fields || []).map(function (field, index) {
      var snapshot = createEmptyScheduleSnapshot();
      return Object.assign({
        index: index,
        fieldKey: field,
        pump: pump,
        committed: cloneScheduleSnapshot(snapshot)
      }, snapshot);
    });
  }

  function normalizeDevices() {
    var rawDevices = Array.isArray(config.devices) && config.devices.length ? config.devices : [];
    return rawDevices.map(function (entry, deviceIndex) {
      entry = entry || {};
      var pumpConfig = entry.pump || {};
      var valveConfig = entry.valves || {};
      var valveCount = Math.max(0, Math.min(50, Math.round(Number(valveConfig.count || 0) || 0)));
      var labels = Array.isArray(valveConfig.labels) ? valveConfig.labels : [];
      var device = {
        id: "device-" + deviceIndex,
        index: deviceIndex,
        title: safeText(entry.title, "Tuyến tưới " + String(deviceIndex + 1)),
        sessionId: safeText(entry.sessionId, ""),
        valveConfig: {
          count: valveCount,
          stateField: safeText(valveConfig.stateField, ""),
          batteryField: safeText(valveConfig.batteryField, ""),
          durationField: safeText(valveConfig.durationField, ""),
          commandTemplate: safeText(valveConfig.commandTemplate, "")
        },
        valves: [],
        durationValues: []
      };
      device.pump = {
        id: device.id + "-pump",
        device: device,
        label: safeText(pumpConfig.label, "Máy bơm"),
        stateField: safeText(pumpConfig.stateField, ""),
        commandOn: safeText(pumpConfig.commandOn, ""),
        commandOff: safeText(pumpConfig.commandOff, ""),
        scheduleFields: (Array.isArray(pumpConfig.scheduleFields) ? pumpConfig.scheduleFields : []).map(function (field) { return String(field || "").trim(); }).filter(Boolean),
        state: "unknown",
        scheduleSaving: false,
        busy: false
      };
      device.pump.scheduleRows = createScheduleRows(device.pump, device.pump.scheduleFields);
      device.pump.scheduleFieldLookup = {};
      device.pump.scheduleFields.forEach(function (field, fieldIndex) {
        device.pump.scheduleFieldLookup[String(field || "").trim().toLowerCase()] = fieldIndex;
      });
      for (var valveIndex = 0; valveIndex < valveCount; valveIndex += 1) {
        var valveId = valveIndex + 1;
        var shortLabel = "V" + padValveIndex(valveId);
        var label = safeText(labels[valveIndex], "Van " + padValveIndex(valveId));
        device.valves.push({
          id: device.id + "-valve-" + valveIndex,
          device: device,
          index: valveIndex,
          valveId: valveId,
          label: label,
          shortLabel: shortLabel,
          state: "unknown",
          batteryPercent: null,
          durationSeconds: null,
          busy: false
        });
      }
      return device;
    });
  }

  function groupDevicesBySession(nextDevices) {
    var statesBySession = {};
    nextDevices.forEach(function (device) {
      var sessionId = String(device.sessionId || "").trim();
      if (!statesBySession[sessionId]) {
        statesBySession[sessionId] = {
          sessionId: sessionId,
          commandApiUrl: buildCommandApiUrl(sessionId),
          devices: [],
          eventSource: null,
          reconnectTimer: null
        };
      }
      device.sessionState = statesBySession[sessionId];
      device.pump.sessionState = statesBySession[sessionId];
      statesBySession[sessionId].devices.push(device);
    });
    return Object.keys(statesBySession).map(function (key) { return statesBySession[key]; });
  }

  function bindDevices() {
    devices.forEach(function (device) {
      device.node = deviceList ? deviceList.querySelector('[data-device-id="' + device.id + '"]') : null;
      device.pump.node = device.node ? device.node.querySelector("[data-role='pump']") : null;
      device.pump.stateNode = device.node ? device.node.querySelector("[data-role='pump-state']") : null;
      device.pump.switchNode = device.node ? device.node.querySelector("[data-role='pump-switch']") : null;
      device.pump.scheduleButton = device.node ? device.node.querySelector("[data-role='pump-schedule']") : null;
      device.pump.onButton = device.node ? device.node.querySelector("[data-role='pump-on']") : null;
      device.pump.offButton = device.node ? device.node.querySelector("[data-role='pump-off']") : null;
      if (device.pump.scheduleButton) device.pump.scheduleButton.addEventListener("click", function () { openScheduleModal(device.pump); });
      if (device.pump.onButton) device.pump.onButton.addEventListener("click", function () { sendPumpCommand(device, "on"); });
      if (device.pump.offButton) device.pump.offButton.addEventListener("click", function () { sendPumpCommand(device, "off"); });
      setPumpVisual(device, device.pump.state, stateLabel(device.pump.state));
      device.railNode = device.node ? device.node.querySelector("[data-role='valve-rail']") : null;
      device.sliderNode = device.node ? device.node.querySelector("[data-role='valve-scroll']") : null;
      device.sliderShellNode = device.sliderNode ? device.sliderNode.closest(".valve-scroll-control") : null;
      bindValveRailSlider(device);
      device.valves.forEach(function (valve) {
        valve.node = device.node ? device.node.querySelector('[data-valve-id="' + valve.id + '"]') : null;
        valve.stateNode = valve.node ? valve.node.querySelector("[data-role='state']") : null;
        valve.switchNode = valve.node ? valve.node.querySelector("[data-role='valve-switch']") : null;
        valve.batteryNode = valve.node ? valve.node.querySelector("[data-role='battery']") : null;
        valve.batteryMeterNode = valve.node ? valve.node.querySelector("[data-role='battery-meter']") : null;
        valve.batteryBarNode = valve.node ? valve.node.querySelector("[data-role='battery-bar']") : null;
        valve.durationNode = valve.node ? valve.node.querySelector("[data-role='duration-label']") : null;
        valve.durationButton = valve.node ? valve.node.querySelector("[data-role='duration']") : null;
        valve.onButton = valve.node ? valve.node.querySelector("[data-role='valve-on']") : null;
        valve.offButton = valve.node ? valve.node.querySelector("[data-role='valve-off']") : null;
        if (valve.durationButton) valve.durationButton.addEventListener("click", function () { openDurationModal(device, valve); });
        if (valve.onButton) valve.onButton.addEventListener("click", function () { sendValveCommand(device, valve, "on"); });
        if (valve.offButton) valve.offButton.addEventListener("click", function () { sendValveCommand(device, valve, "off"); });
        setValveVisual(device, valve);
      });
    });
  }

  function initialize() {
    if (heroTitle) heroTitle.textContent = safeText(config.title, "Tưới cây tuần tự");
    if (devicesTitle) devicesTitle.textContent = getUi("controls.title", "Tuyến tưới");
    initializeThemePicker();
    devices = normalizeDevices();
    sessionStates = groupDevicesBySession(devices);
    if (deviceList) {
      deviceList.innerHTML = devices.map(createDeviceHtml).join("");
      bindDevices();
    }
    if (controlCountChip) {
      var valveCount = devices.reduce(function (total, device) { return total + device.valves.length; }, 0);
      var deviceLabel = devices.length === 1 ? getUi("controls.deviceSingular", "thiết bị") : getUi("controls.devicePlural", "thiết bị");
      var valveLabel = valveCount === 1 ? getUi("controls.countSingular", "van") : getUi("controls.countPlural", "van");
      controlCountChip.textContent = devices.length + " " + deviceLabel + " / " + valveCount + " " + valveLabel;
    }
    setLiveState("connecting", getUi("controls.connecting", "Đang kết nối"));
    scheduleLiveCheck();
    sessionStates.forEach(connectSession);

    if (historyRefreshButton) historyRefreshButton.addEventListener("click", refreshHistory);
    if (historyToggle) {
      if (!historyToggle.getAttribute("onclick")) {
        historyToggle.addEventListener("click", function (event) {
          var target = event.target;
          if (target && typeof target.closest === "function" && target.closest("#history-source-chip")) return;
          toggleHistory();
        });
      }
      historyToggle.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleHistory();
        }
      });
    }
    if (historyContent) historyContent.hidden = true;
    if (historyToggle) historyToggle.setAttribute("aria-expanded", "false");
    if (historyCard) historyCard.setAttribute("data-collapsed", "true");
    refreshHistory();
    connectHistoryStream();

    if (scheduleModalClose) scheduleModalClose.addEventListener("click", closeScheduleModal);
    if (scheduleModalCancel) scheduleModalCancel.addEventListener("click", closeScheduleModal);
    if (scheduleModalSave) scheduleModalSave.addEventListener("click", persistDirtyScheduleRows);
    if (scheduleModal) {
      scheduleModal.addEventListener("click", function (event) {
        if (event.target === scheduleModal) closeScheduleModal();
      });
    }
    if (durationModalClose) durationModalClose.addEventListener("click", closeDurationModal);
    if (durationModalCancel) durationModalCancel.addEventListener("click", closeDurationModal);
    if (durationModalSave) durationModalSave.addEventListener("click", persistDuration);
    if (durationModal) {
      durationModal.addEventListener("click", function (event) {
        if (event.target === durationModal) closeDurationModal();
      });
    }
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      if (durationModal && durationModal.classList.contains("is-open")) closeDurationModal();
      else if (scheduleModal && scheduleModal.classList.contains("is-open")) closeScheduleModal();
    });
  }

  initialize();
})();
