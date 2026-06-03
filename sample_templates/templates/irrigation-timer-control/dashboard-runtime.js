(function () {
  var configNode = document.getElementById("irrigation-timer-control-config");
  var config = { title: "", syncId: "", history: {}, groups: [], ui: {} };
  try {
    config = JSON.parse(configNode && configNode.textContent ? configNode.textContent : "{}");
  } catch (error) {
    console.error("Invalid irrigation timer config", error);
  }

  var searchParams = new URLSearchParams(window.location.search);
  var syncId = String(searchParams.get("syncId") || searchParams.get("syncid") || config.syncId || "").trim();
  var ui = config.ui || {};
  var heroTitle = document.getElementById("hero-title");
  var controlsTitle = document.getElementById("controls-title");
  var controlGrid = document.getElementById("control-grid");
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
  var activeScheduleControl = null;
  var sessionStates = [];
  var allControls = [];
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
      if (remaining > 1) {
        return delayMs(1200).then(function () { return runWriteCommand(sessionState, command, message, remaining - 1); });
      }
      throw new Error(message || getUi("network.requestFailed", "Yêu cầu thất bại."));
    }).catch(function (error) {
      if (remaining > 1) {
        return delayMs(1200).then(function () { return runWriteCommand(sessionState, command, message, remaining - 1); });
      }
      throw error;
    });
  }

  function normalizeContactorState(value) {
    var text = String(value == null ? "" : value).trim();
    var match = text.match(/=\s*([^,\r\n]+)/);
    var normalized = String(match ? match[1] : text).trim().toLowerCase();
    if (normalized === "on" || normalized === "1" || normalized === "true") return "on";
    if (normalized === "off" || normalized === "0" || normalized === "false") return "off";
    return normalized ? "offline" : "offline";
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
    if (normalized === "disable" || normalized === "disabled" || normalized === "off" || normalized === "false" || normalized === "0") return false;
    return false;
  }

  function normalizeScheduleAction(value) {
    var normalized = String(value == null ? "" : value).trim().toUpperCase();
    return normalized === "OFF" ? "off" : "on";
  }

  function createEmptyScheduleSnapshot() {
    return { enabled: false, time: "", action: "on", empty: true };
  }

  function cloneScheduleSnapshot(row) {
    var source = row || createEmptyScheduleSnapshot();
    return {
      enabled: !!source.enabled,
      time: String(source.time || ""),
      action: String(source.action || "on"),
      empty: !!source.empty
    };
  }

  function scheduleSnapshotsEqual(left, right) {
    var a = cloneScheduleSnapshot(left);
    var b = cloneScheduleSnapshot(right);
    return a.enabled === b.enabled && a.time === b.time && a.action === b.action && a.empty === b.empty;
  }

  function parseScheduleTelemetryValue(rawText, fieldKey) {
    var text = String(rawText == null ? "" : rawText).trim();
    var normalizedFieldKey = String(fieldKey || "").trim();
    if (normalizedFieldKey) {
      var prefix = normalizedFieldKey + "=";
      if (text.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()) {
        text = text.slice(prefix.length).trim();
      }
    }
    if (!text) return createEmptyScheduleSnapshot();
    var parts = text.split(",").map(function (part) { return String(part == null ? "" : part).trim(); });
    var compactTime = normalizeCompactTimeValue(parts[0]);
    var enabled = normalizeScheduleEnabledToken(parts[1]);
    var action = normalizeScheduleAction(parts[2]);
    var empty = !compactTime || compactTime === "0000";
    return {
      enabled: empty ? false : enabled,
      time: empty ? "" : formatScheduleTime(compactTime),
      action: action,
      empty: empty
    };
  }

  function buildScheduleTelemetryPayload(row) {
    if (!row || !row.fieldKey) return null;
    var compactTime = normalizeCompactTimeValue(String(row.time || "").replace(":", ""));
    var action = normalizeScheduleAction(row.action) === "off" ? "OFF" : "ON";
    var complete = !!compactTime && compactTime !== "0000";
    var payload = complete ? (compactTime + "," + (row.enabled ? "enable" : "disable") + "," + action) : "0000,disable,ON";
    return {
      command: row.fieldKey + "=" + payload,
      snapshot: {
        enabled: complete ? !!row.enabled : false,
        time: complete ? formatScheduleTime(compactTime) : "",
        action: complete ? (action === "OFF" ? "off" : "on") : "on",
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

  function setLiveState(mode, label) {
    if (!controlsLive) return;
    controlsLive.setAttribute("data-state", mode);
    controlsLive.textContent = label;
  }

  function refreshLiveState() {
    var ageMs = lastTelemetryAt > 0 ? Date.now() - lastTelemetryAt : Infinity;
    if (ageMs < 30000) {
      setLiveState("live", getUi("controls.live", "Hoạt động"));
    } else if (ageMs < 120000) {
      setLiveState("connecting", getUi("controls.stale", "Chậm dữ liệu"));
    } else {
      setLiveState("error", getUi("controls.offline", "Mất kết nối"));
    }
  }

  function scheduleLiveCheck() {
    if (liveTimer) window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(function () {
      liveTimer = null;
      refreshLiveState();
      scheduleLiveCheck();
    }, 30000);
  }

  function setControlVisual(control, state, label) {
    if (!control || !control.toggleNode || !control.stateNode) return;
    control.state = state || "offline";
    control.toggleNode.setAttribute("data-state", control.state);
    control.stateNode.innerHTML = "<span>" + esc(label || getUi("contactor.offline", "OFFLINE")) + "</span>";
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

  function createControlHtml(control) {
    var scheduleButtonHtml = control.scheduleRows.length
      ? '<button class="icon-button schedule-open-button" type="button" data-role="schedule" aria-label="' + esc(formatUi("contactor.scheduleAria", "Mở lịch hẹn giờ cho {label}", { label: control.label })) + '">' + scheduleIconHtml() + '</button>'
      : "";
    var subtitle = control.groupTitle ? '<div class="contactor-subtitle">' + esc(control.groupTitle) + '</div>' : "";
    return ""
      + '<section class="contactor-card" data-control-id="' + esc(control.id) + '" data-read-only="' + (control.readOnly ? "true" : "false") + '" data-has-schedule="' + (control.scheduleRows.length ? "true" : "false") + '">'
      + scheduleButtonHtml
      + '<div class="contactor-head"><div class="contactor-label">' + esc(control.label) + '</div>' + subtitle + '</div>'
      + '<div class="contactor-toggle" data-role="toggle" data-state="offline">'
      + '<button class="contactor-zone" data-action="on" data-role="on" type="button" aria-label="' + esc(formatUi("contactor.turnOnAria", "Bật {label}", { label: control.label })) + '"' + (control.readOnly ? " disabled" : "") + '></button>'
      + '<div class="contactor-lever" data-role="state"><span>' + esc(getUi("contactor.offline", "OFFLINE")) + '</span></div>'
      + '<button class="contactor-zone" data-action="off" data-role="off" type="button" aria-label="' + esc(formatUi("contactor.turnOffAria", "Tắt {label}", { label: control.label })) + '"' + (control.readOnly ? " disabled" : "") + '></button>'
      + '</div>'
      + '</section>';
  }

  function refreshScheduleRowUi(row) {
    if (!row) return;
    if (row.enableInput) row.enableInput.checked = !!row.enabled;
    if (row.enableShell) row.enableShell.setAttribute("data-enabled", row.enabled ? "true" : "false");
    if (row.timeInput) row.timeInput.value = row.time || "";
    if (row.actionToggle) {
      row.actionToggle.setAttribute("data-state", row.action || "on");
      row.actionToggle.setAttribute("aria-pressed", row.action === "off" ? "false" : "true");
    }
    if (row.node) {
      row.node.classList.toggle("is-disabled", !row.enabled);
      row.node.classList.toggle("is-dirty", isScheduleRowDirty(row));
      row.node.classList.toggle("is-busy", !!row.busy);
      row.node.setAttribute("data-action", row.action || "on");
      row.node.setAttribute("data-dirty", isScheduleRowDirty(row) ? "true" : "false");
    }
  }

  function refreshScheduleSaveUi() {
    if (!scheduleModalSave || !activeScheduleControl) return;
    var dirtyCount = activeScheduleControl.scheduleRows.filter(isScheduleRowDirty).length;
    var saving = !!activeScheduleControl.scheduleSaving;
    scheduleModalSave.hidden = false;
    scheduleModalSave.disabled = saving || dirtyCount === 0 || !activeScheduleControl.sessionState.commandApiUrl;
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
    if (row.actionToggle) row.actionToggle.disabled = !!nextBusy;
    refreshScheduleRowUi(row);
  }

  function renderScheduleRows(control) {
    if (!scheduleBody) return;
    if (!control || !control.scheduleRows.length) {
      scheduleBody.innerHTML = '<tr><td colspan="3" class="empty-state">' + esc(getUi("schedule.empty", "Chưa có lịch hẹn giờ cho công tắc này.")) + '</td></tr>';
      return;
    }
    scheduleBody.innerHTML = control.scheduleRows.map(function (row) {
      return ""
        + '<tr class="schedule-row" data-index="' + row.index + '" data-action="' + esc(row.action || "on") + '">'
        + '<td><label class="scheduler-enable" data-role="schedule-enable-shell"><input type="checkbox" data-role="schedule-enable" aria-label="' + esc(formatUi("schedule.enableAria", "Kích hoạt lịch {index}", { index: String(row.index + 1) })) + '"><span class="scheduler-enable-thumb"></span></label></td>'
        + '<td><input class="scheduler-time" type="time" data-role="schedule-time"></td>'
        + '<td><button class="scheduler-action-toggle" type="button" data-role="schedule-action" data-state="' + esc(row.action || "on") + '" aria-label="' + esc(formatUi("schedule.actionAria", "Đổi tác vụ lịch {index}", { index: String(row.index + 1) })) + '"><span class="scheduler-action-label" data-side="on">' + esc(getUi("schedule.actionOn", "ON")) + '</span><span class="scheduler-action-label" data-side="off">' + esc(getUi("schedule.actionOff", "OFF")) + '</span></button></td>'
        + '</tr>';
    }).join("");
    Array.prototype.forEach.call(scheduleBody.querySelectorAll("[data-index]"), function (rowNode, index) {
      var row = control.scheduleRows[index];
      if (!row) return;
      row.node = rowNode;
      row.enableShell = rowNode.querySelector("[data-role='schedule-enable-shell']");
      row.enableInput = rowNode.querySelector("[data-role='schedule-enable']");
      row.timeInput = rowNode.querySelector("[data-role='schedule-time']");
      row.actionToggle = rowNode.querySelector("[data-role='schedule-action']");
      refreshScheduleRowUi(row);
      if (row.enableInput) {
        row.enableInput.addEventListener("change", function () {
          if (row.busy || control.scheduleSaving) return refreshScheduleRowUi(row);
          row.enabled = !!row.enableInput.checked;
          updateScheduleRowState(row);
        });
      }
      if (row.timeInput) {
        row.timeInput.addEventListener("input", function () {
          if (row.busy || control.scheduleSaving) return refreshScheduleRowUi(row);
          row.time = String(row.timeInput.value || "");
          updateScheduleRowState(row);
        });
        row.timeInput.addEventListener("change", function () {
          if (row.busy || control.scheduleSaving) return refreshScheduleRowUi(row);
          row.time = String(row.timeInput.value || "");
          updateScheduleRowState(row);
        });
      }
      if (row.actionToggle) {
        row.actionToggle.addEventListener("click", function () {
          if (row.busy || control.scheduleSaving) return refreshScheduleRowUi(row);
          row.action = row.action === "off" ? "on" : "off";
          updateScheduleRowState(row);
        });
      }
    });
  }

  function openScheduleModal(control) {
    if (!control || !scheduleModal) return;
    activeScheduleControl = control;
    if (scheduleModalTitle) scheduleModalTitle.textContent = formatUi("schedule.title", "Lịch hẹn giờ | {label}", { label: control.label });
    if (scheduleModalDescription) scheduleModalDescription.textContent = getUi("schedule.description", "Lịch hẹn giờ được lưu trực tiếp trên thiết bị.");
    if (scheduleModalClose) scheduleModalClose.setAttribute("aria-label", getUi("schedule.closeAria", "Đóng hộp thoại"));
    if (scheduleModalCancel) scheduleModalCancel.textContent = getUi("schedule.close", "Đóng");
    renderScheduleRows(control);
    refreshScheduleSaveUi();
    scheduleModal.classList.add("is-open");
    scheduleModal.setAttribute("aria-hidden", "false");
  }

  function closeScheduleModal() {
    if (!scheduleModal) return;
    scheduleModal.classList.remove("is-open");
    scheduleModal.setAttribute("aria-hidden", "true");
    activeScheduleControl = null;
  }

  function persistScheduleRow(row) {
    var control = row ? row.control : null;
    var sessionState = control ? control.sessionState : null;
    var built = buildScheduleTelemetryPayload(row);
    if (!built || !control || !sessionState || !sessionState.commandApiUrl || row.busy) return Promise.resolve(false);
    if (row.enabled && built.empty) {
      if (row.timeInput) row.timeInput.focus();
      return Promise.reject(new Error(getUi("schedule.invalid", "Lịch đã kích hoạt cần có thời điểm chạy.")));
    }
    setScheduleRowBusy(row, true);
    return runWriteCommand(sessionState, built.command, getUi("schedule.failed", "Không thể lưu lịch hẹn giờ."), 3).then(function () {
      var snapshot = built.snapshot;
      row.enabled = snapshot.enabled;
      row.time = snapshot.time;
      row.action = snapshot.action;
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
    var control = activeScheduleControl;
    if (!control || control.scheduleSaving) return Promise.resolve(false);
    var dirtyRows = control.scheduleRows.filter(isScheduleRowDirty);
    if (!dirtyRows.length) {
      showToast(getUi("schedule.noChanges", "Không có thay đổi."), "success");
      return Promise.resolve(false);
    }
    var invalidRow = dirtyRows.find(function (row) { return !!row.enabled && !rowHasCompleteSchedule(row); });
    if (invalidRow) {
      if (invalidRow.timeInput) invalidRow.timeInput.focus();
      showToast(getUi("schedule.invalid", "Lịch đã kích hoạt cần có thời điểm chạy."), "error");
      return Promise.resolve(false);
    }
    control.scheduleSaving = true;
    refreshScheduleSaveUi();
    var chain = Promise.resolve();
    dirtyRows.forEach(function (row) {
      chain = chain.then(function () { return persistScheduleRow(row); });
    });
    return chain.then(function () {
      showToast(getUi("schedule.saved", "Đã lưu lịch hẹn giờ."), "success");
      return true;
    }).catch(function (error) {
      showToast((error && error.message) || getUi("schedule.failed", "Không thể lưu lịch hẹn giờ."), "error");
      return false;
    }).finally(function () {
      control.scheduleSaving = false;
      refreshScheduleSaveUi();
    });
  }

  function extractConfiguredTelemetryValue(fieldKey, configuredField, value) {
    var key = String(fieldKey || "").trim().toLowerCase();
    var configured = String(configuredField || "").trim();
    if (!configured || key !== configured.toLowerCase()) return { matched: false, value: value };
    var text = String(value == null ? "" : value).trim();
    var prefix = configured + "=";
    if (text.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()) {
      return { matched: true, value: text.slice(prefix.length).trim() };
    }
    return { matched: true, value: value };
  }

  function applyScheduleSnapshot(row, snapshot) {
    var next = cloneScheduleSnapshot(snapshot);
    row.enabled = next.enabled;
    row.time = next.time;
    row.action = next.action;
    row.empty = next.empty;
  }

  function updateTelemetryField(sessionState, field, value, timestamp) {
    if (!sessionState) return;
    var key = String(field || "").trim().toLowerCase();
    sessionState.controls.forEach(function (control) {
      var stateMatch = extractConfiguredTelemetryValue(key, control.stateField, value);
      if (stateMatch.matched) {
        var nextState = normalizeContactorState(stateMatch.value);
        setControlVisual(control, nextState, nextState === "on" ? "ON" : nextState === "off" ? "OFF" : getUi("contactor.offline", "OFFLINE"));
      }
      var scheduleIndex = control.scheduleFieldLookup[key];
      if (typeof scheduleIndex === "number") {
        var row = control.scheduleRows[scheduleIndex];
        if (row) {
          var snapshot = parseScheduleTelemetryValue(value, row.fieldKey);
          var wasDirty = isScheduleRowDirty(row);
          row.committed = cloneScheduleSnapshot(snapshot);
          if (!wasDirty && !row.busy) applyScheduleSnapshot(row, snapshot);
          if (activeScheduleControl === control) refreshScheduleRowUi(row);
        }
      }
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
    return unique(sessionState.controls.reduce(function (list, control) {
      return list.concat(control.stateField ? [control.stateField] : []).concat(control.scheduleFields || []);
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

  function sendControlCommand(control, command, pendingLabel, nextState) {
    var sessionState = control ? control.sessionState : null;
    if (!sessionState || !control || !command || !sessionState.commandApiUrl || sessionState.busy || control.readOnly) return;
    sessionState.busy = true;
    setControlVisual(control, "pending", pendingLabel);
    postCommandRaw(sessionState.commandApiUrl, command, 5000).then(function () {
      setControlVisual(control, nextState, nextState === "on" ? "ON" : "OFF");
      showToast(getUi("commands.sent", "Đã gửi lệnh."), "success");
    }).catch(function (error) {
      setControlVisual(control, "offline", getUi("contactor.error", "ERROR"));
      showToast((error && error.message) || getUi("commands.failed", "Gửi lệnh thất bại."), "error");
    }).finally(function () {
      sessionState.busy = false;
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

  function createScheduleRows(control, fields) {
    return (fields || []).map(function (field, index) {
      var snapshot = createEmptyScheduleSnapshot();
      return Object.assign({
        index: index,
        fieldKey: field,
        control: control,
        committed: cloneScheduleSnapshot(snapshot)
      }, snapshot);
    });
  }

  function normalizeControls() {
    var rawGroups = Array.isArray(config.groups) && config.groups.length ? config.groups : [{ sessionId: "", controls: [] }];
    var controls = [];
    rawGroups.forEach(function (group, groupIndex) {
      group = group || {};
      var sessionId = safeText(group.sessionId, "");
      var groupTitle = safeText(group.title, "");
      var rawControls = Array.isArray(group.controls) ? group.controls : [];
      rawControls.forEach(function (entry, controlIndex) {
        entry = entry || {};
        var control = {
          id: "control-" + groupIndex + "-" + controlIndex,
          groupIndex: groupIndex,
          index: controlIndex,
          groupTitle: groupTitle,
          sessionId: sessionId,
          label: safeText(entry.label, "Công tắc " + String(controls.length + 1)),
          stateField: safeText(entry.stateField || entry.field, ""),
          commandOn: safeText(entry.commandOn, ""),
          commandOff: safeText(entry.commandOff, ""),
          scheduleFields: (Array.isArray(entry.scheduleFields) ? entry.scheduleFields : []).map(function (field) { return String(field || "").trim(); }).filter(Boolean),
          readOnly: !(sessionId && entry.commandOn && entry.commandOff),
          state: "offline",
          scheduleSaving: false
        };
        control.stateKey = control.stateField.toLowerCase();
        control.scheduleRows = createScheduleRows(control, control.scheduleFields);
        control.scheduleFieldLookup = {};
        control.scheduleFields.forEach(function (field, fieldIndex) {
          control.scheduleFieldLookup[String(field || "").trim().toLowerCase()] = fieldIndex;
        });
        controls.push(control);
      });
    });
    return controls;
  }

  function groupControlsBySession(controls) {
    var statesBySession = {};
    controls.forEach(function (control) {
      var sessionId = String(control.sessionId || "").trim();
      if (!statesBySession[sessionId]) {
        statesBySession[sessionId] = {
          sessionId: sessionId,
          commandApiUrl: buildCommandApiUrl(sessionId),
          controls: [],
          busy: false,
          eventSource: null,
          reconnectTimer: null
        };
      }
      control.sessionState = statesBySession[sessionId];
      statesBySession[sessionId].controls.push(control);
    });
    return Object.keys(statesBySession).map(function (key) { return statesBySession[key]; });
  }

  function bindControls() {
    allControls.forEach(function (control) {
      control.node = controlGrid ? controlGrid.querySelector('[data-control-id="' + control.id + '"]') : null;
      control.toggleNode = control.node ? control.node.querySelector("[data-role='toggle']") : null;
      control.stateNode = control.node ? control.node.querySelector("[data-role='state']") : null;
      control.onButton = control.node ? control.node.querySelector("[data-role='on']") : null;
      control.offButton = control.node ? control.node.querySelector("[data-role='off']") : null;
      control.scheduleButton = control.node ? control.node.querySelector("[data-role='schedule']") : null;
      if (control.onButton) {
        control.onButton.addEventListener("click", function () {
          sendControlCommand(control, control.commandOn, getUi("contactor.turningOn", "Đang bật"), "on");
        });
      }
      if (control.offButton) {
        control.offButton.addEventListener("click", function () {
          sendControlCommand(control, control.commandOff, getUi("contactor.turningOff", "Đang tắt"), "off");
        });
      }
      if (control.scheduleButton) {
        control.scheduleButton.addEventListener("click", function () { openScheduleModal(control); });
      }
      setControlVisual(control, control.state, control.state === "on" ? "ON" : control.state === "off" ? "OFF" : getUi("contactor.offline", "OFFLINE"));
    });
  }

  function initialize() {
    if (heroTitle) heroTitle.textContent = safeText(config.title, "Hẹn giờ tưới tiêu");
    if (controlsTitle) controlsTitle.textContent = getUi("controls.title", "Điều khiển tưới tiêu");
    initializeThemePicker();
    allControls = normalizeControls();
    sessionStates = groupControlsBySession(allControls);
    if (controlGrid) {
      controlGrid.innerHTML = allControls.map(createControlHtml).join("");
      bindControls();
    }
    if (controlCountChip) {
      controlCountChip.textContent = allControls.length + " " + (allControls.length === 1 ? getUi("controls.countSingular", "công tắc") : getUi("controls.countPlural", "công tắc"));
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
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && scheduleModal && scheduleModal.classList.contains("is-open")) closeScheduleModal();
    });
  }

  initialize();
})();
