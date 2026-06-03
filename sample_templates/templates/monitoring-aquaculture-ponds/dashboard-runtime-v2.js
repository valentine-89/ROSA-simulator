(function () {
      var configNode = document.getElementById("monitoring-aquaculture-ponds-config");
      var config = { title: "", description: "", syncId: "", history: {}, sessions: [], ui: {} };
      try {
        config = JSON.parse(configNode && configNode.textContent ? configNode.textContent : '{"sessions":[]}');
      } catch (error) {
        console.error("Invalid monitoring aquaculture ponds config", error);
      }

      var searchParams = new URLSearchParams(window.location.search);
      var syncId = String(searchParams.get("syncId") || searchParams.get("syncid") || config.syncId || "").trim();
      var heroTitle = document.getElementById("hero-title");
      var pondGrid = document.getElementById("pond-grid");
      var pondCountChip = document.getElementById("pond-count-chip");
      var globalRange = document.getElementById("global-range");
      var historyCard = document.getElementById("history-card");
      var historyToggle = document.getElementById("history-toggle") || (historyCard ? historyCard.querySelector('.section-head') : null);
      var historyToggleHandledAt = 0;
      var historyContent = document.getElementById("history-content") || (historyCard ? historyCard.querySelector('.table-wrap') : null);
      var historyBody = document.getElementById("history-body");
      var historyScrollWrap = historyContent;
      var historyRefreshButton = document.getElementById("history-refresh");
      var historySourceChip = document.getElementById("history-source-chip");
      var toastStack = document.getElementById("toast-stack");
      var themePickerToggle = document.getElementById("theme-picker-toggle");
      var themePickerMenu = document.getElementById("theme-picker-menu");
      var thresholdModal = document.getElementById("threshold-modal");
      var thresholdModalTitle = document.getElementById("threshold-modal-title");
      var thresholdModalDescription = document.getElementById("threshold-modal-description");
      var thresholdModalClose = document.getElementById("threshold-modal-close");
      var thresholdModalCancel = document.getElementById("threshold-modal-cancel");
      var thresholdModalSubmit = document.getElementById("threshold-modal-submit");
      var thresholdForm = document.getElementById("threshold-form");
      var settingsPhoneGroup = document.getElementById("settings-phone-group");
      var settingsPhoneTitle = document.getElementById("settings-phone-title");
      var settingsAlarmPhoneInput = document.getElementById("settings-alarm-phone");
      var settingsPumpControls = [
        {
          key: "contactor1",
          tab: document.getElementById("settings-pump1-tab"),
          group: document.getElementById("settings-pump1-group"),
          title: document.getElementById("settings-pump1-title"),
          currentTitle: document.getElementById("settings-pump1-current-title"),
          currentLowInput: document.getElementById("settings-pump1-current-low"),
          currentHighInput: document.getElementById("settings-pump1-current-high"),
          runWindowTitle: document.getElementById("settings-pump1-run-window-title"),
          runWindowStartInput: document.getElementById("settings-pump1-run-window-start"),
          runWindowEndInput: document.getElementById("settings-pump1-run-window-end")
        },
        {
          key: "contactor2",
          tab: document.getElementById("settings-pump2-tab"),
          group: document.getElementById("settings-pump2-group"),
          title: document.getElementById("settings-pump2-title"),
          currentTitle: document.getElementById("settings-pump2-current-title"),
          currentLowInput: document.getElementById("settings-pump2-current-low"),
          currentHighInput: document.getElementById("settings-pump2-current-high"),
          runWindowTitle: document.getElementById("settings-pump2-run-window-title"),
          runWindowStartInput: document.getElementById("settings-pump2-run-window-start"),
          runWindowEndInput: document.getElementById("settings-pump2-run-window-end")
        }
      ];
      var settingsUpdateGroup = document.getElementById("settings-update-group");
      var settingsUpdateLabel = document.getElementById("settings-update-label");
      var settingsUpdateToggle = document.getElementById("settings-update-toggle");
      var meterModal = document.getElementById("meter-modal");
      var meterModalTitle = document.getElementById("meter-modal-title");
      var meterModalDescription = document.getElementById("meter-modal-description");
      var meterModalClose = document.getElementById("meter-modal-close");
      var meterEnergyTitle = document.getElementById("meter-energy-title");
      var meterEnergyValue = document.getElementById("meter-energy-value");
      var meterVoltageCard = document.getElementById("meter-voltage-card");
      var meterVoltageTitle = document.getElementById("meter-voltage-title");
      var meterVoltageInline = document.getElementById("meter-voltage-inline");
      var meterVoltageShell = document.getElementById("meter-voltage-shell");
      var meterVoltageGrid = document.getElementById("meter-voltage-grid");
      var meterVoltageMax = document.getElementById("meter-voltage-max");
      var meterVoltageMin = document.getElementById("meter-voltage-min");
      var meterVoltageEmpty = document.getElementById("meter-voltage-empty");
      var meterVoltagePath = document.getElementById("meter-voltage-path");
      var meterVoltageHoverLine = document.getElementById("meter-voltage-hover-line");
      var meterVoltagePoint = document.getElementById("meter-voltage-point");
      var meterVoltageHitbox = document.getElementById("meter-voltage-hitbox");
      var meterVoltageTooltip = document.getElementById("meter-voltage-tooltip");
      var meterCurrentCard = document.getElementById("meter-current-card");
      var meterCurrentTitle = document.getElementById("meter-current-title");
      var meterCurrent1Inline = document.getElementById("meter-current1-inline");
      var meterCurrent2Inline = document.getElementById("meter-current2-inline");
      var meterCurrent3Inline = document.getElementById("meter-current3-inline");
      var meterCurrentShell = document.getElementById("meter-current-shell");
      var meterCurrentGrid = document.getElementById("meter-current-grid");
      var meterCurrentMax = document.getElementById("meter-current-max");
      var meterCurrentMin = document.getElementById("meter-current-min");
      var meterCurrentEmpty = document.getElementById("meter-current-empty");
      var meterCurrentThresholdLow = document.getElementById("meter-current-threshold-low");
      var meterCurrentThresholdHigh = document.getElementById("meter-current-threshold-high");
      var meterCurrentPath1 = document.getElementById("meter-current-path-1");
      var meterCurrentPath2 = document.getElementById("meter-current-path-2");
      var meterCurrentPath3 = document.getElementById("meter-current-path-3");
      var meterCurrentHoverLine = document.getElementById("meter-current-hover-line");
      var meterCurrentPoint1 = document.getElementById("meter-current-point-1");
      var meterCurrentPoint2 = document.getElementById("meter-current-point-2");
      var meterCurrentPoint3 = document.getElementById("meter-current-point-3");
      var meterCurrentHitbox = document.getElementById("meter-current-hitbox");
      var meterCurrentTooltip = document.getElementById("meter-current-tooltip");
      var meterTemperatureCard = document.getElementById("meter-temperature-card");
      var meterTemperatureTitle = document.getElementById("meter-temperature-title");
      var meterTemperatureInline = document.getElementById("meter-temperature-inline");
      var meterTemperatureShell = document.getElementById("meter-temperature-shell");
      var meterTemperatureGrid = document.getElementById("meter-temperature-grid");
      var meterTemperatureMax = document.getElementById("meter-temperature-max");
      var meterTemperatureMin = document.getElementById("meter-temperature-min");
      var meterTemperatureEmpty = document.getElementById("meter-temperature-empty");
      var meterTemperatureThresholdLow = document.getElementById("meter-temperature-threshold-low");
      var meterTemperatureThresholdHigh = document.getElementById("meter-temperature-threshold-high");
      var meterTemperaturePath = document.getElementById("meter-temperature-path");
      var meterTemperatureHoverLine = document.getElementById("meter-temperature-hover-line");
      var meterTemperaturePoint = document.getElementById("meter-temperature-point");
      var meterTemperatureHitbox = document.getElementById("meter-temperature-hitbox");
      var meterTemperatureTooltip = document.getElementById("meter-temperature-tooltip");
      var thresholdModalState = { state: null };
      var meterModalState = { state: null, meterKey: '' };
      var meterModalChartState = {
        series: { voltage: [], current1: [], current2: [], current3: [], temperature: [] },
        thresholds: {}
      };
      var meterModalRenderFrame = null;
      var meterModalEventSource = null;
      var meterModalReconnectTimer = null;
      var historyTimer = null;
      var historyEventSource = null;
      var historyReconnectTimer = null;
      var historyCooldownTimer = null;
      var historyRefreshQueued = false;
      var historyCooldownActive = false;
      var historyRequestId = 0;
      var historyConfig = config.history || {};
      var uiConfig = config && typeof config.ui === "object" && config.ui ? config.ui : {};
      var historyState = {
        sessionId: String(historyConfig.sessionId || "").trim(),
        syncId: String(historyConfig.syncId || syncId || "").trim(),
        macro: String(historyConfig.macro || "").trim(),
        pageSize: Number(historyConfig.pageSize || 100) || 100,
        rows: []
      };

      heroTitle.textContent = String(config.title || heroTitle.textContent || "").trim() || "Monitoring Aquaculture Ponds";

      function safeText(value, fallback) {
        var normalized = String(value == null ? "" : value).trim();
        return normalized || fallback || "";
      }

      function esc(value) {
        return String(value == null ? "" : value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function getUi(path, fallback) {
        var parts = String(path || "").split(".");
        var current = uiConfig;
        for (var index = 0; index < parts.length; index += 1) {
          var key = parts[index];
          if (!key) continue;
          if (!current || typeof current !== "object" || !(key in current)) return fallback;
          current = current[key];
        }
        if (current == null || current === "") return fallback;
        return current;
      }

      function formatUi(path, fallback, values) {
        var template = String(getUi(path, fallback) || "");
        return template.replace(/\{([^}]+)\}/g, function (_, key) {
          return key in (values || {}) ? String(values[key]) : "";
        });
      }

      function setNodeText(node, value) {
        if (!node) return;
        node.textContent = String(value == null ? "" : value);
      }

      function normalizeKeyword(value) {
        return String(value == null ? "" : value).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
      }

      function parseSessionContext(sessionId) {
        var raw = String(sessionId || "").trim();
        var parts = raw.split("@");
        if (parts.length < 2) return null;
        return { ioid: parts[0], apikey: parts.slice(1).join("@") };
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

      function buildTelemetryUrl(sessionId) {
        if (!sessionId || !syncId) return "";
        return "/api/" + encodeURIComponent(sessionId) + "/" + encodeURIComponent(syncId) + "/iotelemetry";
      }

      function buildTimeseriesUrl(sessionId, fields, from, to) {
        if (!sessionId || !syncId) return "";
        var params = new URLSearchParams();
        params.set("from", String(from));
        params.set("to", String(to));
        if (fields && fields.length) params.set("fields", fields.join(","));
        return "/api/" + encodeURIComponent(sessionId) + "/" + encodeURIComponent(syncId) + "/iotimeseries?" + params.toString();
      }

      function buildStreamUrl(sessionId, fields, historyMs) {
        var params = new URLSearchParams();
        params.set("historyMs", String(historyMs));
        params.set("fields", fields.join(","));
        return "/api/" + encodeURIComponent(sessionId) + "/stream?" + params.toString();
      }

      function buildIoDataUrl(sessionId, nextSyncId) {
        if (!sessionId || !nextSyncId) return "";
        return "/api/" + encodeURIComponent(sessionId) + "/" + encodeURIComponent(nextSyncId) + "/iodata";
      }

      function numericValue(value) {
        if (typeof value === "number" && isFinite(value)) return value;
        var text = String(value == null ? "" : value).trim();
        if (!text) return null;
        var match = text.match(/-?\d+(\.\d+)?/);
        return match ? Number(match[0]) : null;
      }

      function normalizeCompactTimeValue(value) {
        var text = String(value == null ? "" : value).trim().replace(/\D+/g, "");
        if (!text) return "";
        if (!/^\d{4}$/.test(text)) return "";
        var hour = Number(text.slice(0, 2));
        var minute = Number(text.slice(2, 4));
        if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
        return text;
      }

      function parseWindowValue(value) {
        var rawText = String(value == null ? "" : value).trim();
        if (!rawText) return { start: "", end: "", raw: "" };
        var parts = rawText.split(",");
        var start = normalizeCompactTimeValue(parts[0] || "");
        var end = normalizeCompactTimeValue(parts[1] || "");
        return {
          start: start,
          end: end,
          raw: start && end ? (start + "," + end) : rawText
        };
      }

      function formatNumber(value, digits) {
        var numeric = Number(value);
        if (!Number.isFinite(numeric)) return "--";
        return numeric.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
      }

      function formatValue(value, digits, unit) {
        var numeric = numericValue(value);
        if (numeric === null) return "--";
        return formatNumber(numeric, digits) + (unit ? " " + unit : "");
      }

      function formatEnergy(valueWh) {
        var numeric = numericValue(valueWh);
        if (numeric === null) return "--";
        return formatNumber(numeric / 1000, 2) + " kWh";
      }

      function formatTime(timestamp) {
        if (!timestamp) return "--";
        try {
          return new Date(timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        } catch (error) {
          return "--";
        }
      }

      function getEventTimeMs(value) {
        if (value === null || value === undefined || value === '') return null;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
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
        return String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") + " " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
      }

      function getPondCountText(count) {
        var unit = getUi(count === 1 ? "hero.pondCountSingular" : "hero.pondCountPlural", count === 1 ? "pond" : "ponds");
        return String(count) + " " + unit;
      }

      function applyStaticUiText() {
        document.title = String(config.title || document.title || "").trim() || "Monitoring Aquaculture Ponds";
        setNodeText(heroTitle, String(config.title || heroTitle.textContent || "").trim() || "Monitoring Aquaculture Ponds");
        if (globalRange) globalRange.setAttribute("aria-label", String(getUi("hero.rangeAriaLabel", "Chart time range")));
        setNodeText(historyRefreshButton, getUi("hero.refreshHistory", "Refresh history"));
        setNodeText(pondCountChip, getPondCountText(0));

        var historyTitle = historyCard ? historyCard.querySelector(".section-head h2") : null;
        var historyHeadings = historyCard ? historyCard.querySelectorAll("thead th") : [];
        setNodeText(historyTitle, getUi("history.title", "Control and alarm history"));
        setNodeText(historySourceChip, getUi("history.sourceLabel", "History source"));
        setNodeText(historyHeadings[0], getUi("history.columns.time", "Time"));
        setNodeText(historyHeadings[1], getUi("history.columns.pond", "Pond"));
        setNodeText(historyHeadings[2], getUi("history.columns.type", "Type"));
        setNodeText(historyHeadings[3], getUi("history.columns.content", "Content"));
        setNodeText(historyHeadings[4], getUi("history.columns.email", "Email"));
        if (historyBody) {
          historyBody.innerHTML = '<tr><td colspan="5" class="empty-state">' + esc(getUi("history.waiting", "Waiting for history data.")) + '</td></tr>';
        }

        setNodeText(thresholdModalTitle, getUi("settingsModal.idleTitle", "Pond settings"));
        setNodeText(thresholdModalDescription, getUi("settingsModal.description", "Configure thresholds and the alarm phone number for this pond."));
        if (thresholdModalClose) thresholdModalClose.setAttribute("aria-label", String(getUi("settingsModal.closeAriaLabel", "Close dialog")));
        setNodeText(settingsPhoneTitle, getUi("settingsModal.phoneTitle", "Alarm phone number"));
        setNodeText(settingsUpdateLabel, getUi("settingsModal.updateLabel", "Update information"));
        if (settingsUpdateToggle) settingsUpdateToggle.setAttribute('aria-label', String(getUi("settingsModal.updateToggleAria", "Toggle update information")));
        settingsPumpControls.forEach(function (control, index) {
          var pumpTitle = getUi("settingsModal.pump" + (index + 1) + "Title", index === 0 ? "Pump 1" : "Pump 2");
          setNodeText(control.tab, pumpTitle);
          setNodeText(control.title, pumpTitle);
          setNodeText(control.currentTitle, getUi("settingsModal.currentTitle", "Current threshold"));
          setNodeText(control.runWindowTitle, getUi("settingsModal.runWindowTitle", "Run window"));
          setNodeText(thresholdForm ? thresholdForm.querySelector('label[for="' + control.currentLowInput.id + '"]') : null, getUi("settingsModal.lowLabel", "Low threshold"));
          setNodeText(thresholdForm ? thresholdForm.querySelector('label[for="' + control.currentHighInput.id + '"]') : null, getUi("settingsModal.highLabel", "High threshold"));
          setNodeText(thresholdForm ? thresholdForm.querySelector('label[for="' + control.runWindowStartInput.id + '"]') : null, getUi("settingsModal.startLabel", "Start"));
          setNodeText(thresholdForm ? thresholdForm.querySelector('label[for="' + control.runWindowEndInput.id + '"]') : null, getUi("settingsModal.endLabel", "End"));
        });
        if (settingsAlarmPhoneInput) settingsAlarmPhoneInput.setAttribute('aria-label', String(getUi("settingsModal.phoneLabel", "Phone number")));
        setNodeText(thresholdModalCancel, getUi("settingsModal.cancel", "Cancel"));
        setNodeText(thresholdModalSubmit, getUi("settingsModal.submit", "Save settings"));

        setNodeText(meterModalTitle, getUi("meterModal.idleTitle", "Electrical meter"));
        setNodeText(meterModalDescription, getUi("meterModal.description", "Voltage, current, temperature and energy for this contactor."));
        if (meterModalClose) meterModalClose.setAttribute("aria-label", String(getUi("meterModal.closeAriaLabel", "Close dialog")));
        setNodeText(meterEnergyTitle, getUi("meterModal.energyTitle", "Energy consumption"));
        setNodeText(meterVoltageTitle, getUi("meterModal.voltageTitle", "Voltage"));
        setNodeText(meterCurrentTitle, getUi("meterModal.currentTitle", "Current"));
        setNodeText(meterTemperatureTitle, getUi("meterModal.temperatureTitle", "Temperature"));

        if (themePickerToggle) themePickerToggle.setAttribute("aria-label", String(getUi("theme.toggleAriaLabel", "Choose theme")));
        if (themePickerMenu) themePickerMenu.setAttribute("aria-label", String(getUi("theme.menuAriaLabel", "Theme options")));
        if (themePickerMenu) {
          Array.prototype.forEach.call(themePickerMenu.querySelectorAll('[data-theme-option]'), function (button) {
            var themeKey = String(button.getAttribute('data-theme-option') || '').trim();
            setNodeText(button, getUi('theme.options.' + themeKey, button.textContent.trim()));
          });
        }
      }

      function showToast(message, type) {
        if (!toastStack) return;
        var toast = document.createElement("div");
        toast.className = "toast " + (type === "error" ? "error" : "success");
        toast.textContent = String(message || "").trim();
        toastStack.appendChild(toast);
        window.setTimeout(function () {
          toast.style.opacity = "0";
          toast.style.transform = "translateY(10px)";
          toast.style.transition = "opacity 0.18s ease, transform 0.18s ease";
          window.setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
          }, 180);
        }, 3200);
      }

      function setTheme(nextTheme) {
        document.documentElement.setAttribute("data-theme", nextTheme);
        try { window.localStorage.setItem("sample-dashboard-theme", nextTheme); } catch (error) {}
        Array.prototype.forEach.call(themePickerMenu.querySelectorAll("[data-theme-option]"), function (button) {
          var isActive = String(button.getAttribute("data-theme-option") || "") === nextTheme;
          button.setAttribute("aria-pressed", isActive ? "true" : "false");
          button.setAttribute("aria-checked", isActive ? "true" : "false");
        });
      }

      function closeThemePickerMenu() {
        themePickerMenu.classList.remove("is-open");
        themePickerToggle.setAttribute("aria-expanded", "false");
      }

      function openThemePickerMenu() {
        themePickerMenu.classList.add("is-open");
        themePickerToggle.setAttribute("aria-expanded", "true");
      }

      applyStaticUiText();

      var meterVoltageChart = null;
      var meterCurrentChart = null;
      var meterTemperatureChart = null;

      function initializeMeterModalCharts() {
        meterVoltageChart = meterVoltageCard ? {
          shell: meterVoltageShell,
          grid: meterVoltageGrid,
          max: meterVoltageMax,
          min: meterVoltageMin,
          empty: meterVoltageEmpty,
          hoverLine: meterVoltageHoverLine,
          hitbox: meterVoltageHitbox,
          tooltip: meterVoltageTooltip,
          left: 46,
          top: 16,
          width: 294,
          height: 182,
          floorMode: 'baseline',
          floorValue: 180,
          ceilingValue: 260,
          minRange: 80,
          series: [],
          baseSeries: [
            { key: 'voltage', label: getUi('meterModal.seriesLabels.voltage', 'V'), unit: 'V', digits: 1, color: 'var(--theme-series-1)', path: meterVoltagePath, point: meterVoltagePoint }
          ],
          thresholdKind: ''
        } : null;

        meterCurrentChart = meterCurrentCard ? {
          shell: meterCurrentShell,
          grid: meterCurrentGrid,
          max: meterCurrentMax,
          min: meterCurrentMin,
          empty: meterCurrentEmpty,
          hoverLine: meterCurrentHoverLine,
          hitbox: meterCurrentHitbox,
          tooltip: meterCurrentTooltip,
          lowLine: meterCurrentThresholdLow,
          highLine: meterCurrentThresholdHigh,
          left: 46,
          top: 16,
          width: 294,
          height: 182,
          floorMode: 'zero',
          minRange: 5,
          series: [],
          baseSeries: [
            { key: 'current1', label: getUi('meterModal.seriesLabels.current1', 'I1'), unit: 'A', digits: 2, color: 'var(--theme-series-3)', path: meterCurrentPath1, point: meterCurrentPoint1 },
            { key: 'current2', label: getUi('meterModal.seriesLabels.current2', 'I2'), unit: 'A', digits: 2, color: 'var(--theme-series-4)', path: meterCurrentPath2, point: meterCurrentPoint2 },
            { key: 'current3', label: getUi('meterModal.seriesLabels.current3', 'I3'), unit: 'A', digits: 2, color: 'var(--theme-series-5)', path: meterCurrentPath3, point: meterCurrentPoint3 }
          ],
          thresholdKind: 'current'
        } : null;

        meterTemperatureChart = meterTemperatureCard ? {
          shell: meterTemperatureShell,
          grid: meterTemperatureGrid,
          max: meterTemperatureMax,
          min: meterTemperatureMin,
          empty: meterTemperatureEmpty,
          hoverLine: meterTemperatureHoverLine,
          hitbox: meterTemperatureHitbox,
          tooltip: meterTemperatureTooltip,
          lowLine: meterTemperatureThresholdLow,
          highLine: meterTemperatureThresholdHigh,
          left: 46,
          top: 16,
          width: 294,
          height: 182,
          floorMode: 'zero',
          minRange: 20,
          series: [],
          baseSeries: [
            { key: 'temperature', label: getUi('meterModal.seriesLabels.temperature', 'Temp'), unit: '°C', digits: 1, color: 'var(--theme-series-5)', path: meterTemperaturePath, point: meterTemperaturePoint }
          ],
          thresholdKind: 'temperature'
        } : null;

        if (meterVoltageChart) bindChartHover(meterModalChartState, meterVoltageChart);
        if (meterCurrentChart) bindChartHover(meterModalChartState, meterCurrentChart);
        if (meterTemperatureChart) bindChartHover(meterModalChartState, meterTemperatureChart);
      }

      initializeMeterModalCharts();

      function getHistoryWindowMs() {
        var mapping = { "30m": 30 * 60 * 1000, "1h": 60 * 60 * 1000, "6h": 6 * 60 * 60 * 1000, "24h": 24 * 60 * 60 * 1000, "7d": 7 * 24 * 60 * 60 * 1000 };
        return mapping[String(globalRange.value || "6h")] || mapping["6h"];
      }

      function buildSqlWindow() {
        var end = new Date();
        var start = new Date(end.getTime() - getHistoryWindowMs());
        function sqlDate(date) {
          return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0") + " " + String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0") + ":" + String(date.getSeconds()).padStart(2, "0");
        }
        return { start_time: sqlDate(start), end_time: sqlDate(end) };
      }

      function postIoData(url, payload) {
        return fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok) {
              throw new Error(data && data.error ? data.error : getUi("network.requestFailed", "Request failed."));
            }
            return Array.isArray(data) ? data : [];
          }).catch(function (error) {
            if (!response.ok) {
              throw error;
            }
            throw new Error(getUi("network.unexpectedIoDataResponse", "Unexpected IoData response."));
          });
        });
      }

      function resolveCommandTemplate(command) {
        var resolver = window.AIBridgeCommandTemplate;
        var template = String(command == null ? '' : command);
        if (resolver && typeof resolver.resolveCommandTemplate === 'function') {
          return resolver.resolveCommandTemplate(template);
        }
        return Promise.resolve(template
          .replace(/<<email>>/gi, '')
          .replace(/<<username>>/gi, ''));
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
                throw new Error(text || formatUi("network.requestFailedWithStatus", "Request failed with status {status}", { status: response.status }));
              }
              return text || "";
            });
          }).finally(function () {
            window.clearTimeout(timeoutId);
          });
        });
      }

      function responseHasOk(text) {
        var normalized = String(text || '').trim();
        if (!normalized) return false;
        return /(^|[^A-Z])OK(?=$|[^A-Z])/i.test(normalized) || /\bSUCCESS\b/i.test(normalized);
      }

      function openNativeTimePicker(input) {
        if (!input || typeof input.showPicker !== 'function') return;
        window.setTimeout(function () {
          try {
            input.showPicker();
          } catch (error) {}
        }, 0);
      }

      function responseMatchesCommandEcho(text, command) {
        var normalizedText = String(text || '').trim();
        var normalizedCommand = String(command || '').trim();
        if (!normalizedText || !normalizedCommand) return false;
        if (normalizedText.indexOf(normalizedCommand) >= 0) return true;

        var commandMatch = normalizedCommand.match(/^([^=]+?)\.(\d+)=(.*)$/);
        if (!commandMatch) return false;
        var baseField = String(commandMatch[1] || '').trim();
        var itemIndex = Math.max(0, Number(commandMatch[2]) - 1);
        var expectedValue = String(commandMatch[3] || '').trim();
        if (!baseField || !expectedValue) return false;

        var responseMatch = normalizedText.match(new RegExp('(^|[^A-Za-z0-9_#])' + baseField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*([^\\r\\n]+)', 'i'));
        if (!responseMatch) return false;
        var values = String(responseMatch[2] || '').split(',').map(function (part) {
          return String(part || '').trim();
        });
        return values[itemIndex] === expectedValue;
      }

      function delayMs(ms) {
        return new Promise(function (resolve) {
          window.setTimeout(resolve, ms);
        });
      }

      /* ── Control overlay: dim + spinner + 5 s cooldown ── */
      var CONTROL_COOLDOWN_MS = 5000;

      function showControlOverlay(containerNode) {
        if (!containerNode) return null;
        var existing = containerNode.querySelector('.control-overlay');
        if (existing) return existing;
        var overlay = document.createElement('div');
        overlay.className = 'control-overlay';
        overlay.innerHTML = '<div class="control-overlay-spinner"></div>';
        containerNode.appendChild(overlay);
        return overlay;
      }

      function hideControlOverlay(containerNode, overlayNode) {
        var overlay = overlayNode || (containerNode ? containerNode.querySelector('.control-overlay') : null);
        if (!overlay) return;
        overlay.classList.add('is-leaving');
        window.setTimeout(function () {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 240);
      }

      function withControlCooldown(containerNode, promiseFn) {
        var overlay = showControlOverlay(containerNode);
        var startTime = Date.now();
        return promiseFn().finally(function () {
          var elapsed = Date.now() - startTime;
          var remaining = Math.max(0, CONTROL_COOLDOWN_MS - elapsed);
          window.setTimeout(function () {
            hideControlOverlay(containerNode, overlay);
          }, remaining);
        });
      }

      function activateSettingsPumpTab(activeKey) {
        settingsPumpControls.forEach(function (control) {
          var isActive = control.key === activeKey;
          if (control.tab) {
            control.tab.classList.toggle('is-active', isActive);
            control.tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
          }
          if (control.group) {
            control.group.classList.toggle('is-active', isActive);
            control.group.hidden = !isActive;
          }
        });
      }

      function responseLooksBusy(text) {
        return /\bBUSY\b/i.test(String(text || '').trim());
      }

      function runScheduleWriteCommand(commandApiUrl, command, message, attemptsLeft) {
        var remaining = Number.isFinite(attemptsLeft) ? attemptsLeft : 3;
        return postCommandRaw(commandApiUrl, command, 5000).then(function (text) {
          if (responseHasOk(text) || responseMatchesCommandEcho(text, command)) return text;
          if (remaining > 1) {
            return delayMs(2000).then(function () {
              return runScheduleWriteCommand(commandApiUrl, command, message, remaining - 1);
            });
          }
          throw new Error(message || getUi('schedule.commandFailed', 'Schedule command failed.'));
        }).catch(function (error) {
          if (remaining > 1) {
            return delayMs(2000).then(function () {
              return runScheduleWriteCommand(commandApiUrl, command, message, remaining - 1);
            });
          }
          throw error;
        });
      }

      function normalizeContactorState(value) {

        var normalized = String(value == null ? "" : value).trim().toUpperCase();
        if (normalized === "1" || normalized === "TRUE" || normalized === "ON" || normalized === "CLOSED") return "on";
        if (normalized === "0" || normalized === "FALSE" || normalized === "OFF" || normalized === "OPEN") return "off";
        return "offline";
      }

      function normalizeEnabledFlag(value) {
        var normalized = String(value == null ? "" : value).trim().toUpperCase();
        if (normalized === "1" || normalized === "TRUE" || normalized === "ON" || normalized === "ENABLED") return true;
        if (normalized === "0" || normalized === "FALSE" || normalized === "OFF" || normalized === "DISABLED") return false;
        return null;
      }

      function parseThresholdValue(raw) {
        var text = String(raw == null ? "" : raw).trim();
        if (!text) return { low: null, high: null, raw: "" };
        var parts = text.split(",");
        return {
          low: parts.length > 0 ? numericValue(parts[0]) : null,
          high: parts.length > 1 ? numericValue(parts[1]) : null,
          raw: text
        };
      }

      function createEmptyThresholdValue() {
        return { low: null, high: null, raw: "" };
      }

      function createEmptyPumpThresholds(raw) {
        return {
          contactor1: createEmptyThresholdValue(),
          contactor2: createEmptyThresholdValue(),
          raw: String(raw == null ? "" : raw).trim()
        };
      }

      function trimTrailingEmptyParts(parts) {
        var next = parts.slice();
        while (next.length && String(next[next.length - 1] == null ? "" : next[next.length - 1]).trim() === "") {
          next.pop();
        }
        return next.join(",");
      }

      function thresholdToRawParts(threshold) {
        return [
          threshold && threshold.low !== null ? String(threshold.low) : "",
          threshold && threshold.high !== null ? String(threshold.high) : ""
        ];
      }

      function parsePumpThresholdValue(raw) {
        var text = String(raw == null ? "" : raw).trim();
        if (!text) return createEmptyPumpThresholds("");
        var parts = text.split(",");
        var first = {
          low: parts.length > 0 ? numericValue(parts[0]) : null,
          high: parts.length > 1 ? numericValue(parts[1]) : null
        };
        first.raw = trimTrailingEmptyParts(thresholdToRawParts(first));
        var second = {
          low: parts.length > 2 ? numericValue(parts[2]) : null,
          high: parts.length > 3 ? numericValue(parts[3]) : null
        };
        second.raw = trimTrailingEmptyParts(thresholdToRawParts(second));
        return {
          contactor1: first,
          contactor2: second,
          raw: trimTrailingEmptyParts([
            first.low !== null ? String(first.low) : "",
            first.high !== null ? String(first.high) : "",
            second.low !== null ? String(second.low) : "",
            second.high !== null ? String(second.high) : ""
          ])
        };
      }

      function createEmptyPumpWindows(raw) {
        return {
          contactor1: { start: "", end: "", raw: "" },
          contactor2: { start: "", end: "", raw: "" },
          raw: String(raw == null ? "" : raw).trim()
        };
      }

      function parsePumpWindowValue(raw) {
        var text = String(raw == null ? "" : raw).trim();
        if (!text) return createEmptyPumpWindows("");
        var parts = text.split(",");
        var firstStart = normalizeCompactTimeValue(parts[0] || "");
        var firstEnd = normalizeCompactTimeValue(parts[1] || "");
        var secondStart = normalizeCompactTimeValue(parts[2] || "");
        var secondEnd = normalizeCompactTimeValue(parts[3] || "");
        var first = { start: firstStart, end: firstEnd, raw: firstStart && firstEnd ? (firstStart + "," + firstEnd) : "" };
        var second = { start: secondStart, end: secondEnd, raw: secondStart && secondEnd ? (secondStart + "," + secondEnd) : "" };
        return {
          contactor1: first,
          contactor2: second,
          raw: trimTrailingEmptyParts([firstStart, firstEnd, secondStart, secondEnd])
        };
      }

      function formatThresholdSummary(threshold, unit) {
        if (!threshold || (threshold.low === null && threshold.high === null)) return getUi("thresholds.none", "No threshold");
        var low = threshold.low === null ? "--" : formatNumber(threshold.low, unit === "A" ? 1 : 0);
        var high = threshold.high === null ? "--" : formatNumber(threshold.high, unit === "A" ? 1 : 0);
        return low + " - " + high + " " + unit;
      }

      function hasField(state, key) {
        return !!safeText(state && state.fields ? state.fields[key] : "", "");
      }

      function hasCommand(state, key) {
        return !!safeText(state && state.commands ? state.commands[key] : "", "");
      }

      function parseIndexedConfiguredField(fieldName) {
        var exactKey = String(fieldName || '').trim().toLowerCase();
        var match = exactKey.match(/^(.*)\.(\d+)$/);
        if (!match) {
          return { exactKey: exactKey, baseKey: exactKey, itemIndex: -1 };
        }
        return {
          exactKey: exactKey,
          baseKey: String(match[1] || '').trim().toLowerCase(),
          itemIndex: Math.max(0, Number(match[2]) - 1)
        };
      }

      function extractConfiguredTelemetryValue(telemetryKey, configuredField, rawValue) {
        var parsed = parseIndexedConfiguredField(configuredField);
        if (!parsed.exactKey) return { matched: false, value: undefined };
        if (telemetryKey === parsed.exactKey) {
          return { matched: true, value: rawValue };
        }
        if (parsed.itemIndex < 0 || telemetryKey !== parsed.baseKey) {
          return { matched: false, value: undefined };
        }
        var parts = String(rawValue == null ? '' : rawValue).split(',');
        return {
          matched: true,
          value: String(parts[parsed.itemIndex] == null ? '' : parts[parsed.itemIndex]).trim()
        };
      }

      function expandConfiguredStreamFields(fieldName) {
        var parsed = parseIndexedConfiguredField(fieldName);
        if (!parsed.exactKey) return [];
        if (parsed.itemIndex < 0 || !parsed.baseKey || parsed.baseKey === parsed.exactKey) {
          return [parsed.exactKey];
        }
        return [parsed.exactKey, parsed.baseKey];
      }

      function normalizeScheduleEnabledToken(value) {
        var normalized = String(value == null ? '' : value).trim().toLowerCase();
        if (normalized === 'enable' || normalized === 'enabled' || normalized === 'on' || normalized === 'true' || normalized === '1') return true;
        if (normalized === 'disable' || normalized === 'disabled' || normalized === 'off' || normalized === 'false' || normalized === '0') return false;
        return null;
      }

      function normalizeScheduleAction(value) {
        var normalized = String(value == null ? '' : value).trim().toUpperCase();
        return normalized === 'OFF' ? 'off' : 'on';
      }

      function normalizeScheduleOutputCode(value) {
        var normalized = String(value == null ? '' : value).trim();
        if (!normalized || normalized === '0' || /^null$/i.test(normalized)) return '';
        if (normalized === '12') return '12';
        return normalized === '1' || normalized === '2' ? normalized : '';
      }

      function normalizeScheduleOutputSelection(output1, output2) {
        var first = normalizeScheduleOutputCode(output1);
        var second = normalizeScheduleOutputCode(output2);
        if (first === '12' || second === '12') return '12';
        if ((first === '1' && second === '2') || (first === '2' && second === '1')) return '12';
        return first || second || '';
      }

      function getScheduleSelectionOutputs(selection) {
        var normalized = normalizeScheduleOutputSelection(selection, '');
        if (normalized === '12') return { selection: '12', first: '1', second: '2' };
        if (normalized === '1') return { selection: '1', first: '1', second: '0' };
        if (normalized === '2') return { selection: '2', first: '0', second: '2' };
        return { selection: '', first: '0', second: '0' };
      }

      function formatScheduleTime(compactTime) {
        var normalized = normalizeCompactTimeValue(compactTime);
        return normalized ? (normalized.slice(0, 2) + ':' + normalized.slice(2, 4)) : '';
      }

      function createEmptyScheduleSnapshot() {
        return {
          enabled: false,
          time: '',
          contactor: '',
          action: 'on',
          empty: true
        };
      }

      function parseScheduleTelemetryValue(rawText, fieldKey) {
        var text = String(rawText == null ? '' : rawText).trim();
        var normalizedFieldKey = String(fieldKey || '').trim();
        if (normalizedFieldKey) {
          var prefix = normalizedFieldKey + '=';
          if (text.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()) {
            text = text.slice(prefix.length).trim();
          }
        }
        if (!text) return createEmptyScheduleSnapshot();
        var parts = text.split(',').map(function (part) { return String(part == null ? '' : part).trim(); });
        if (parts.length < 5) return createEmptyScheduleSnapshot();
        var compactTime = normalizeCompactTimeValue(parts[0]);
        var enabled = normalizeScheduleEnabledToken(parts[1]) === true;
        var action = normalizeScheduleAction(parts[2]);
        var selection = normalizeScheduleOutputSelection(parts[3], parts[4]);
        var complete = !!compactTime && !!selection;
        return {
          enabled: complete ? enabled : false,
          time: complete ? formatScheduleTime(compactTime) : '',
          contactor: complete ? selection : '',
          action: action,
          empty: !complete
        };
      }

      function buildScheduleTelemetryPayload(row) {
        if (!row || !row.fieldKey) return null;
        var compactTime = normalizeCompactTimeValue(String(row.time || '').replace(':', ''));
        var outputs = getScheduleSelectionOutputs(row.contactor);
        var action = normalizeScheduleAction(row.action) === 'off' ? 'OFF' : 'ON';
        var complete = !!compactTime && !!outputs.selection;
        return {
          command: row.fieldKey + '=' + (complete ? compactTime : '0000') + ',' + ((row.enabled && complete) ? 'enable' : 'disable') + ',' + action + ',' + outputs.first + ',' + outputs.second,
          snapshot: {
            enabled: complete ? !!row.enabled : false,
            time: complete ? formatScheduleTime(compactTime) : '',
            contactor: complete ? outputs.selection : '',
            action: action === 'OFF' ? 'off' : 'on',
            empty: !complete
          },
          empty: !complete
        };
      }

      function cloneScheduleRowSnapshot(row) {
        return {
          enabled: !!row.enabled,
          time: String(row.time || ''),
          contactor: String(row.contactor || ''),
          action: String(row.action || 'on'),
          empty: !!row.empty
        };
      }

      function applyScheduleSnapshot(row, snapshot) {
        var nextSnapshot = snapshot || createEmptyScheduleSnapshot();
        row.enabled = !!nextSnapshot.enabled;
        row.time = String(nextSnapshot.time || '');
        row.contactor = String(nextSnapshot.contactor || '');
        row.action = String(nextSnapshot.action || 'on');
        row.empty = !!nextSnapshot.empty;
      }

      function scheduleSnapshotsEqual(left, right) {
        var leftSnapshot = left || createEmptyScheduleSnapshot();
        var rightSnapshot = right || createEmptyScheduleSnapshot();
        return !!leftSnapshot.enabled === !!rightSnapshot.enabled
          && String(leftSnapshot.time || '') === String(rightSnapshot.time || '')
          && String(leftSnapshot.contactor || '') === String(rightSnapshot.contactor || '')
          && String(leftSnapshot.action || 'on') === String(rightSnapshot.action || 'on')
          && !!leftSnapshot.empty === !!rightSnapshot.empty;
      }

      function isScheduleRowDirty(row) {
        if (!row) return false;
        return !scheduleSnapshotsEqual(row, row.committed);
      }

      function rowHasCompleteSchedule(row) {
        var built = buildScheduleTelemetryPayload(row);
        return !!(built && !built.empty);
      }

      function setToggleVisual(toggleNode, enabled) {

        if (!toggleNode) return;
        toggleNode.setAttribute("data-enabled", enabled ? "true" : "false");
        var input = toggleNode.querySelector('input[type="checkbox"]');
        if (input) input.checked = !!enabled;
      }

      function getConfiguredContactorTitle(state, contactorKey) {
        var meterConfig = state && state.meterConfig && typeof state.meterConfig === 'object' ? state.meterConfig[contactorKey] : null;
        return safeText(meterConfig && meterConfig.title, '');
      }

      function getContactorLabel(state, contactorKey, fallbackLabel) {
        return safeText(getConfiguredContactorTitle(state, contactorKey), fallbackLabel);
      }

      function getContactorDefinitions(state) {
        var definitions = [
          { key: "contactor1", fallbackLabel: "Contactor 1", code: "O1", onKey: "contactor1On", offKey: "contactor1Off" },
          { key: "contactor2", fallbackLabel: "Contactor 2", code: "O2", onKey: "contactor2On", offKey: "contactor2Off" },
          { key: "contactor3", fallbackLabel: "Contactor 3", code: "O3", onKey: "contactor3On", offKey: "contactor3Off" }
        ];
        return definitions.filter(function (entry) {
          return hasField(state, entry.key);
        }).map(function (entry) {
          entry.label = getContactorLabel(state, entry.key, entry.fallbackLabel);
          return entry;
        });
      }

      function normalizeScheduleFieldList(scheduleFields) {
        return (Array.isArray(scheduleFields) ? scheduleFields : []).map(function (field) {
          return String(field || '').trim();
        }).filter(Boolean).slice(0, 4);
      }

      function createScheduleFieldLookup(scheduleFields) {
        var lookup = {};
        (Array.isArray(scheduleFields) ? scheduleFields : []).forEach(function (field, index) {
          lookup[String(field || '').trim().toLowerCase()] = index;
        });
        return lookup;
      }

      function normalizeMeterFields(rawMeter) {
        var source = rawMeter && typeof rawMeter === 'object' ? rawMeter : {};
        return {
          title: safeText(source.title, ''),
          voltage: safeText(source.voltage, ''),
          current1: safeText(source.current1, ''),
          current2: safeText(source.current2, ''),
          current3: safeText(source.current3, ''),
          temperature: safeText(source.temperature, ''),
          energy: safeText(source.energy, '')
        };
      }

      function buildFallbackMeterConfig() {
        return {};
      }

      function hasConfiguredMeterField(fields) {
        return !!(fields && (fields.voltage || fields.current1 || fields.current2 || fields.current3 || fields.temperature || fields.energy));
      }

      function hasMeterField(meter, key) {
        return !!safeText(meter && meter.fields ? meter.fields[key] : '', '');
      }

      function createMeterStates(state) {
        var result = {};
        state.contactorDefinitions.forEach(function (definition) {
          var configuredFields = normalizeMeterFields((state.meterConfig && state.meterConfig[definition.key]) || buildFallbackMeterConfig(state, definition.key));
          if (!hasConfiguredMeterField(configuredFields)) return;
          result[definition.key] = {
            key: definition.key,
            label: getContactorLabel(state, definition.key, definition.label),
            fields: configuredFields,
            series: { voltage: [], current1: [], current2: [], current3: [], temperature: [] },
            latestValues: { voltage: NaN, current1: NaN, current2: NaN, current3: NaN, temperature: NaN },
            energyDisplay: '--'
          };
        });
        return result;
      }

      function createContactorCardHtml(definition, readOnly, hasMeter) {
        var meterButtonHtml = hasMeter
          ? '<button class="icon-button contactor-meter-button" type="button" data-role="' + definition.key + '-meter" aria-label="' + esc(formatUi("contactor.meterAria", "Open electrical meter for {label}", { label: definition.label })) + '"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 18h16M7 14l3-4 3 2 4-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="7" cy="14" r="1.4" fill="currentColor"></circle><circle cx="10" cy="10" r="1.4" fill="currentColor"></circle><circle cx="13" cy="12" r="1.4" fill="currentColor"></circle><circle cx="17" cy="6" r="1.4" fill="currentColor"></circle></svg></button>'
          : '';
        return ''
          + '<section class="contactor-card" data-read-only="' + (readOnly ? 'true' : 'false') + '">'
          + '<div class="contactor-head"><div class="contactor-label">' + esc(definition.label) + '</div>' + (meterButtonHtml ? '<div class="contactor-tools">' + meterButtonHtml + '</div>' : '') + '</div>'
          + '<div class="contactor-toggle" data-role="' + definition.key + '-toggle" data-state="offline">'
          + '<button class="contactor-zone" data-action="on" data-role="' + definition.key + '-on" type="button" aria-label="' + esc(formatUi("contactor.turnOnAria", "Turn {label} on", { label: definition.label })) + '"' + (readOnly ? ' disabled' : '') + '></button>'
          + '<div class="contactor-lever" data-role="' + definition.key + '-state"><span>' + esc(getUi("contactor.offline", "OFFLINE")) + '</span></div>'
          + '<button class="contactor-zone" data-action="off" data-role="' + definition.key + '-off" type="button" aria-label="' + esc(formatUi("contactor.turnOffAria", "Turn {label} off", { label: definition.label })) + '"' + (readOnly ? ' disabled' : '') + '></button>'
          + '</div>'
          + '</section>';
      }

      function createScheduleRowsHtml(rowCount) {
        var rows = '';
        var actionOnLabel = String(getUi("schedule.actionOn", "ON"));
        var actionOffLabel = String(getUi("schedule.actionOff", "OFF"));
        var outputOptionHtml = '<option value="">' + esc(getUi("schedule.selectPlaceholder", "Select")) + '</option>'
          + '<option value="1">' + esc(getUi("schedule.outputLabels.out1", "Out 1")) + '</option>'
          + '<option value="2">' + esc(getUi("schedule.outputLabels.out2", "Out 2")) + '</option>'
          + '<option value="12">' + esc(getUi("schedule.outputLabels.out12", "Out 1&2")) + '</option>';
        var totalRows = Math.max(0, Math.min(4, Number(rowCount || 0)));
        for (var index = 0; index < totalRows; index += 1) {
          rows += ''
            + '<tr class="scheduler-row is-disabled" data-role="schedule-row" data-index="' + index + '">'
            + '<td><label class="scheduler-enable" data-role="schedule-enable-shell"><input type="checkbox" data-role="schedule-enable" aria-label="' + esc(formatUi("schedule.enableAriaLabel", "Enable schedule {index}", { index: String(index + 1) })) + '"><span class="scheduler-enable-thumb"></span></label></td>'
            + '<td><input class="scheduler-time" type="time" data-role="schedule-time"></td>'
            + '<td><select class="scheduler-select" data-role="schedule-contactor">' + outputOptionHtml + '</select></td>'
            + '<td><button class="scheduler-action-toggle" type="button" data-role="schedule-action" data-state="on" aria-label="' + esc(formatUi("schedule.toggleActionAriaLabel", "Toggle schedule action {index}", { index: String(index + 1) })) + '"><span class="scheduler-action-label" data-side="on">' + esc(actionOnLabel) + '</span><span class="scheduler-action-label" data-side="off">' + esc(actionOffLabel) + '</span></button></td>'
            + '</tr>';
        }
        return rows;
      }

      function createPondContentHtml(state) {
        var contactorCardsHtml = state.contactorDefinitions.map(function (definition) {
          var readOnly = !(hasCommand(state, definition.onKey) && hasCommand(state, definition.offKey));
          return createContactorCardHtml(definition, readOnly, !!state.meterStates[definition.key]);
        }).join('');

        var canAlarmOff = !!state.commandApiUrl && hasCommand(state, 'alarmOff');
        var alarmCardHtml = (hasField(state, 'alarm') || canAlarmOff) ? ''
          + '<section class="metric-card metric-card--alarm" data-role="energy-card" data-alarm-active="false">'
          + '<div class="energy-alarm-shell" data-role="energy-alarm-shell"><div class="energy-alarm-text" data-role="energy-alarm-text">' + esc(getUi("alarmCard.empty", "No active alarm")) + '</div>' + (canAlarmOff ? '<button type="button" class="toolbar-button energy-alarm-button" data-role="energy-alarm-off" hidden aria-label="' + esc(formatUi("commands.alarmOffAria", "Turn off alarm for {title}", { title: state.title })) + '">' + esc(getUi("commands.alarmOff", "Turn off alarm")) + '</button>' : '') + '</div>'
          + '</section>'
          : '';

        var scheduleExpanded = window.innerWidth > 560;
        var schedulerHtml = state.commandApiUrl && state.scheduleFields.length ? ''
          + '<section class="schedule-card schedule-card--overview">'
          + '<div class="section-head section-head--schedule"><button class="section-toggle section-toggle--schedule" type="button" data-role="schedule-toggle" aria-expanded="' + (scheduleExpanded ? 'true' : 'false') + '"><span><h3>' + esc(getUi("schedule.title", "Schedule setup")) + '</h3></span><span class="section-toggle-indicator">&#9662;</span></button><div class="section-toolbar section-toolbar--schedule"><button class="toolbar-button schedule-save-button" type="button" data-role="schedule-save" hidden>' + esc(getUi("schedule.save", "Save")) + '</button></div></div>'
          + '<div class="table-wrap schedule-content" data-role="schedule-content"' + (scheduleExpanded ? '' : ' hidden') + '><table class="scheduler-table"><thead><tr><th>' + esc(getUi("schedule.columns.enable", "Enable")) + '</th><th>' + esc(getUi("schedule.columns.time", "Time")) + '</th><th>' + esc(getUi("schedule.columns.contactor", "Out")) + '</th><th>' + esc(getUi("schedule.columns.action", "Action")) + '</th></tr></thead><tbody data-role="schedule-body">' + createScheduleRowsHtml(state.scheduleFields.length) + '</tbody></table></div>'
          + '</section>'
          : '';

        return {
          html: '<div class="overview-grid">' + alarmCardHtml + contactorCardsHtml + schedulerHtml + '</div>',
          hasVoltageChart: false,
          hasCurrentChart: false,
          hasTemperatureChart: false
        };
      }

      function bindPondContent(state) {
        if (!state.contentInitialized || state.contentBound || !state.pondContent) return;
        state.contentBound = true;

        state.energyCard = state.pondContent.querySelector('[data-role="energy-card"]');
        state.energyAlarmShell = state.pondContent.querySelector('[data-role="energy-alarm-shell"]');
        state.energyAlarmText = state.pondContent.querySelector('[data-role="energy-alarm-text"]');
        state.energyAlarmButton = state.pondContent.querySelector('[data-role="energy-alarm-off"]');
        state.contactorControls = {};
        state.contactorDefinitions.forEach(function (definition) {
          state.contactorControls[definition.key] = {
            stateNode: state.pondContent.querySelector('[data-role="' + definition.key + '-state"]'),
            toggleNode: state.pondContent.querySelector('[data-role="' + definition.key + '-toggle"]'),
            onButton: state.pondContent.querySelector('[data-role="' + definition.key + '-on"]'),
            offButton: state.pondContent.querySelector('[data-role="' + definition.key + '-off"]'),
            meterButton: state.pondContent.querySelector('[data-role="' + definition.key + '-meter"]'),
            meter: state.meterStates[definition.key] || null,
            label: definition.label,
            onCommand: state.commands[definition.onKey],
            offCommand: state.commands[definition.offKey],
            readOnly: !(hasCommand(state, definition.onKey) && hasCommand(state, definition.offKey))
          };
        });
        state.scheduleToggle = state.pondContent.querySelector('[data-role="schedule-toggle"]');
        state.scheduleSaveButton = state.pondContent.querySelector('[data-role="schedule-save"]');
        state.scheduleContent = state.pondContent.querySelector('[data-role="schedule-content"]');
        state.scheduleBody = state.pondContent.querySelector('[data-role="schedule-body"]');
        state.scheduleRows = [];
        if (state.scheduleBody) {
          Array.prototype.forEach.call(state.scheduleBody.querySelectorAll('[data-role="schedule-row"]'), function (rowNode, index) {
            var snapshot = state.scheduleData[index] || createEmptyScheduleSnapshot();
            var row = {
              index: index,
              fieldKey: state.scheduleFields[index] || '',
              node: rowNode,
              enableShell: rowNode.querySelector('[data-role="schedule-enable-shell"]'),
              enableInput: rowNode.querySelector('[data-role="schedule-enable"]'),
              timeInput: rowNode.querySelector('[data-role="schedule-time"]'),
              contactorSelect: rowNode.querySelector('[data-role="schedule-contactor"]'),
              actionToggle: rowNode.querySelector('[data-role="schedule-action"]'),
              enabled: false,
              time: '',
              contactor: '',
              action: 'on',
              empty: true,
              busy: false,
              dirty: false,
              committed: cloneScheduleRowSnapshot(snapshot)
            };
            applyScheduleSnapshot(row, snapshot);
            state.scheduleRows.push(row);
          });
        }

        Object.keys(state.contactorControls).forEach(function (key) {
          var control = state.contactorControls[key];
          if (!control) return;
          if (!control.readOnly) {
            if (control.onButton) {
              control.onButton.addEventListener('click', function () {
                sendContactorCommand(state, control, control.onCommand, getUi('contactor.turningOn', 'Turning on'));
              });
            }
            if (control.offButton) {
              control.offButton.addEventListener('click', function () {
                sendContactorCommand(state, control, control.offCommand, getUi('contactor.turningOff', 'Turning off'));
              });
            }
          }
          if (control.meterButton && control.meter) {
            control.meterButton.addEventListener('click', function () {
              initializePondContent(state);
              ensurePondBootstrap(state).finally(function () {
                ensurePondConnection(state);
                openMeterModal(state, key);
              });
            });
          }
        });
        state.scheduleRows.forEach(function (row) { bindScheduleRow(state, row); });
        if (state.energyAlarmButton) {
          state.energyAlarmButton.addEventListener('click', function () {
            sendAlarmOffCommand(state);
          });
        }
        if (state.scheduleToggle) {
          state.scheduleToggle.addEventListener('click', function () {
            setScheduleCollapsed(state, !state.scheduleCollapsed);
          });
        }
        if (state.scheduleSaveButton) {
          state.scheduleSaveButton.addEventListener('click', function () {
            persistDirtyScheduleRows(state);
          });
        }

        setScheduleCollapsed(state, window.innerWidth <= 560);
        refreshScheduleSaveUi(state);
        hydratePondContent(state);
      }

      function initializePondContent(state) {
        if (!state || !state.pondContent) return;
        if (!state.contentInitialized) {
          state.pondContent.innerHTML = state.contentHtml;
          state.contentInitialized = true;
        }
        bindPondContent(state);
      }

      function hydratePondContent(state) {
        if (!state || !state.contentInitialized) return;
        updateEnergyAlarmUi(state);
        if (meterModalState.state === state) queueMeterModalRefresh();

        Object.keys(state.contactorControls).forEach(function (key) {
          var nextState = state.contactorStates[key] || 'offline';
          setContactorVisual(state.contactorControls[key], nextState, nextState === 'on' ? 'ON' : nextState === 'off' ? 'OFF' : 'OFFLINE');
        });
      }

      function renderPond(state) {
        var ioid = safeText(state.ioid, getUi("pond.unknown", "Unknown"));
        state.contactorDefinitions = getContactorDefinitions(state);
        state.meterStates = createMeterStates(state);
        state.controllableContactors = state.contactorDefinitions.filter(function (entry) {
          return hasCommand(state, entry.onKey) && hasCommand(state, entry.offKey);
        });
        state.hasSettings = !!state.commandApiUrl && (hasField(state, 'currentThreshold') || hasField(state, 'alarmPhone') || hasField(state, 'runWindow') || hasField(state, 'updateEnabled'));
        state.contentMeta = createPondContentHtml(state);
        state.contentHtml = state.contentMeta.html;
        state.contentInitialized = state.pondIndex === 0;
        state.contentBound = false;

        state.node = document.createElement('article');
        state.node.className = 'pond-card';
        state.node.innerHTML = ''
          + '<div class="pond-header">'
          + '<button class="section-toggle pond-toggle" type="button" data-role="pond-toggle" aria-expanded="false"><span class="pond-title"><h2>' + esc(state.title) + '</h2><p>' + esc(state.description || formatUi("pond.deviceDescription", "Device: {ioid}", { ioid: ioid })) + '</p></span><span class="section-toggle-indicator">&#9662;</span></button>'
          + '<div class="pond-toolbar">' + (state.hasSettings ? '<button type="button" class="toolbar-button pond-settings-button" data-role="settings-button" aria-label="' + esc(formatUi("pond.settingsButtonAria", "Open pond settings for {title}", { title: state.title })) + '">' + esc(getUi("pond.settingsButton", "Settings")) + '</button>' : '') + '<div class="live-pill" data-role="live" data-state="connecting">' + esc(getUi("pond.connecting", "Connecting")) + '</div></div>'
          + '</div>'
          + '<div class="pond-content" data-role="pond-content" hidden>' + (state.contentInitialized ? state.contentHtml : '') + '</div>';
        pondGrid.appendChild(state.node);

        state.pondToggle = state.node.querySelector('[data-role="pond-toggle"]');
        state.pondContent = state.node.querySelector('[data-role="pond-content"]');
        state.live = state.node.querySelector('[data-role="live"]');
        state.settingsButton = state.node.querySelector('[data-role="settings-button"]');
        state.energyCard = null;
        state.energyAlarmShell = null;
        state.energyAlarmText = null;
        state.energyAlarmButton = null;
        state.contactorControls = {};
        state.scheduleToggle = null;
        state.scheduleSaveButton = null;
        state.scheduleContent = null;
        state.scheduleBody = null;
        state.scheduleRows = [];
        state.scheduleCollapsed = true;
        state.scheduleLoaded = false;
        state.scheduleLoading = false;
        state.scheduleSaving = false;
        state.alarmText = '';
        state.lastUpdatedAt = 0;
        state.isBusy = false;
        state.staleTimer = null;
        state.bootstrapLoaded = false;
        state.bootstrapPromise = null;

        if (state.pondToggle) {
          state.pondToggle.addEventListener('click', function () {
            setPondCollapsed(state, !state.pondCollapsed);
          });
        }
        if (state.settingsButton) {
          state.settingsButton.addEventListener('click', function () {
            initializePondContent(state);
            ensurePondBootstrap(state).finally(function () {
              ensurePondConnection(state);
              openSettingsModal(state);
            });
          });
        }

        if (state.contentInitialized) initializePondContent(state);
        setPondCollapsed(state, state.pondIndex > 0);
      }

      function setContactorVisual(control, nextState, label) {
        if (!control || !control.stateNode || !control.toggleNode) return;
        control.toggleNode.setAttribute('data-state', nextState || 'offline');
        control.stateNode.innerHTML = '<span>' + esc(label || getUi('contactor.offline', 'OFFLINE')) + '</span>';
      }

      function setPondCollapsed(state, nextCollapsed) {
        if (!nextCollapsed) {
          initializePondContent(state);
          ensurePondConnection(state);
        }
        state.pondCollapsed = !!nextCollapsed;
        if (!nextCollapsed) {
          hydratePondContent(state);
        }
        if (state.pondContent) {
          state.pondContent.hidden = !!nextCollapsed;
        }
        if (state.pondToggle) {
          state.pondToggle.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
        }
      }

      function setScheduleCollapsed(state, nextCollapsed) {
        state.scheduleCollapsed = !!nextCollapsed;
        if (state.scheduleContent) {
          state.scheduleContent.hidden = !!nextCollapsed;
        }
        if (state.scheduleToggle) {
          state.scheduleToggle.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
        }
        if (!nextCollapsed) ensureScheduleRowsLoaded(state);
      }

      function setHistoryCollapsed(nextCollapsed) {
        if (historyContent) {
          historyContent.hidden = !!nextCollapsed;
        }
        if (historyToggle) {
          historyToggle.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
        }
        if (historyCard) {
          historyCard.setAttribute('data-collapsed', nextCollapsed ? 'true' : 'false');
        }
        if (!nextCollapsed) scrollHistoryToLatest();
      }

      function setPondBusy(state, nextBusy) {
        state.isBusy = !!nextBusy;
        Object.keys(state.contactorControls || {}).forEach(function (key) {
          var control = state.contactorControls[key];
          if (!control || control.readOnly) return;
          if (control.onButton) control.onButton.disabled = !!nextBusy;
          if (control.offButton) control.offButton.disabled = !!nextBusy;
        });
        if (state.settingsButton) state.settingsButton.disabled = !!nextBusy;
        if (state.energyAlarmButton) state.energyAlarmButton.disabled = !!nextBusy;
        if (thresholdModalState.state === state) refreshSettingsUpdateToggleUi(state);
      }

      function scheduleLiveStateCheck(state) {
        if (!state) return;
        if (state.staleTimer) window.clearTimeout(state.staleTimer);
        state.staleTimer = window.setTimeout(function () {
          state.staleTimer = null;
          refreshLiveState(state);
        }, 30050);
      }

      function ensureScheduleRowsLoaded(state) {
        if (!state || !state.contentInitialized || !state.scheduleRows.length || state.scheduleLoaded || state.scheduleLoading) return;
        state.scheduleLoading = true;
        loadScheduleRows(state).finally(function () {
          state.scheduleLoading = false;
          state.scheduleLoaded = true;
        });
      }

      function ensurePondBootstrap(state) {

        if (!state) return Promise.resolve();
        if (state.bootstrapLoaded) return Promise.resolve();
        if (state.bootstrapPromise) return state.bootstrapPromise;
        state.bootstrapPromise = bootstrapPond(state).then(function () {
          state.bootstrapLoaded = true;
        }).catch(function () {}).finally(function () {
          state.bootstrapPromise = null;
        });
        return state.bootstrapPromise;
      }

      function ensurePondConnection(state) {
        if (!state || state.connectionStarted) return;
        if (state.connectionWarmupTimer) {
          window.clearTimeout(state.connectionWarmupTimer);
          state.connectionWarmupTimer = null;
        }
        state.connectionStarted = true;
        connectPond(state);
      }

      function queuePondConnection(state, delayMs) {
        if (!state || state.connectionStarted || state.connectionWarmupTimer) return;
        state.connectionWarmupTimer = window.setTimeout(function () {
          state.connectionWarmupTimer = null;
          ensurePondConnection(state);
        }, Math.max(0, Number(delayMs || 0)));
      }

      function getSeriesMaxPoints(historyMs) {
        if (historyMs <= 2 * 60 * 60 * 1000) return 900;
        if (historyMs <= 24 * 60 * 60 * 1000) return 1800;
        if (historyMs <= 7 * 24 * 60 * 60 * 1000) return 2600;
        return 2400;
      }

      function appendSeriesPoint(series, point, historyMs) {
        if (series.length && Number(point.ts || 0) < Number(series[series.length - 1].ts || 0)) {
          series.push(point);
          series.sort(function (left, right) { return Number(left.ts || 0) - Number(right.ts || 0); });
        } else {
          series.push(point);
        }
        var cutoff = Date.now() - historyMs;
        var maxPoints = getSeriesMaxPoints(historyMs);
        while (series.length > maxPoints || (series.length > 1 && series[0].ts < cutoff)) {
          series.shift();
        }
      }

      function clearMeterSeries(state) {
        Object.keys(state && state.meterStates || {}).forEach(function (meterKey) {
          var meter = state.meterStates[meterKey];
          if (!meter || !meter.series) return;
          Object.keys(meter.series).forEach(function (seriesKey) {
            meter.series[seriesKey] = [];
          });
        });
      }

      function getMeterHistoryFields(state, meterKey) {
        var fields = [];
        var meter = state && state.meterStates ? state.meterStates[meterKey] : null;
        if (!meter || !meter.fields) return fields;
        [
          meter.fields.voltage,
          meter.fields.current1,
          meter.fields.current2,
          meter.fields.current3,
          meter.fields.temperature,
          meter.fields.energy
        ].forEach(function (field) {
          field = String(field || '').trim();
          if (field && fields.indexOf(field) < 0) fields.push(field);
        });
        return fields;
      }

      function loadMeterHistory(state, force) {
        if (!state || !state.sessionId) return Promise.resolve();
        var meterKey = meterModalState.state === state ? meterModalState.meterKey : '';
        if (!meterKey) return Promise.resolve();
        var historyMs = getHistoryWindowMs();
        var fields = getMeterHistoryFields(state, meterKey);
        if (!fields.length) return Promise.resolve();
        if (!force && state.meterHistoryMeterKey === meterKey && state.meterHistoryWindowMs === historyMs && state.meterHistoryLoaded) {
          return Promise.resolve();
        }
        if (state.meterHistoryPromise && !force) return state.meterHistoryPromise;

        var to = Date.now();
        var from = to - historyMs;
        var url = buildTimeseriesUrl(state.sessionId, fields, from, to);
        if (!url) return Promise.resolve();

        var requestId = (state.meterHistoryRequestId || 0) + 1;
        state.meterHistoryRequestId = requestId;
        state.meterHistoryPromise = fetch(url, { cache: 'no-store' }).then(function (response) {
          if (!response.ok) return null;
          return response.json();
        }).then(function (payload) {
          if (!payload || state.meterHistoryRequestId !== requestId) return;
          var rows = payload.c2 && Array.isArray(payload.c2.rows) ? payload.c2.rows : [];
          clearMeterSeries(state);
          rows.forEach(function (row) {
            var value = typeof row.last !== 'undefined'
              ? row.last
              : typeof row.value !== 'undefined'
                ? row.value
                : row.avg;
            updateTelemetryField(state, row.field, value, row.ts || Date.now());
          });
          state.meterHistoryMeterKey = meterKey;
          state.meterHistoryWindowMs = historyMs;
          state.meterHistoryLoaded = true;
          if (meterModalState.state === state) queueMeterModalRefresh();
        }).catch(function () {}).finally(function () {
          if (state.meterHistoryRequestId === requestId) {
            state.meterHistoryPromise = null;
          }
        });
        return state.meterHistoryPromise;
      }

      function hideChartTooltip(chartMeta) {
        if (!chartMeta || !chartMeta.tooltip || !chartMeta.hoverLine || !Array.isArray(chartMeta.series)) return;
        chartMeta.tooltip.style.opacity = '0';
        chartMeta.tooltip.style.transform = 'translate3d(0, 8px, 0)';
        chartMeta.hoverLine.style.opacity = '0';
        chartMeta.series.forEach(function (entry) {
          if (entry.point) entry.point.style.opacity = '0';
        });
      }

      function resolveChartBounds(values, chartMeta, threshold) {
        var minValue = Math.min.apply(null, values);
        var maxValue = Math.max.apply(null, values);
        if (threshold) {
          if (threshold.low !== null) minValue = Math.min(minValue, threshold.low);
          if (threshold.high !== null) maxValue = Math.max(maxValue, threshold.high);
        }
        if (chartMeta.floorMode === 'zero' && minValue > 0) minValue = 0;
        if (typeof chartMeta.floorValue === 'number' && isFinite(chartMeta.floorValue) && minValue > chartMeta.floorValue) minValue = chartMeta.floorValue;
        if (typeof chartMeta.ceilingValue === 'number' && isFinite(chartMeta.ceilingValue) && maxValue < chartMeta.ceilingValue) maxValue = chartMeta.ceilingValue;
        if (minValue === maxValue) { minValue -= 1; maxValue += 1; }
        var minRange = Number(chartMeta.minRange || 0);
        if (minRange > 0 && (maxValue - minValue) < minRange) {
          if (chartMeta.floorMode === 'zero' || typeof chartMeta.floorValue === 'number') {
            maxValue = minValue + minRange;
          } else {
            var midpoint = (minValue + maxValue) / 2;
            minValue = midpoint - (minRange / 2);
            maxValue = midpoint + (minRange / 2);
          }
        }
        return { minValue: minValue, maxValue: maxValue };
      }

      function updateThresholdLines(chartMeta, bounds, threshold) {
        if (!chartMeta || !chartMeta.lowLine || !chartMeta.highLine || !bounds) return;
        function positionLine(line, value) {
          if (!line) return;
          if (!Number.isFinite(value)) {
            line.style.opacity = '0';
            return;
          }
          var y = bounds.bottom - (((value - bounds.minValue) / (bounds.maxValue - bounds.minValue)) * bounds.height);
          line.setAttribute('y1', y.toFixed(2));
          line.setAttribute('y2', y.toFixed(2));
          line.style.opacity = '1';
        }
        positionLine(chartMeta.lowLine, threshold && threshold.low !== null ? threshold.low : NaN);
        positionLine(chartMeta.highLine, threshold && threshold.high !== null ? threshold.high : NaN);
      }

      function renderChart(state, chartMeta) {
        if (!chartMeta || !chartMeta.grid || !chartMeta.empty || !chartMeta.min || !chartMeta.max || !Array.isArray(chartMeta.series)) return;
        var left = chartMeta.left;
        var top = chartMeta.top;
        var width = chartMeta.width;
        var height = chartMeta.height;
        var bottom = top + height;
        var historyMs = getHistoryWindowMs();
        var startTs = Date.now() - historyMs;
        var tsSpan = historyMs;
        var visibleSeries = chartMeta.series.map(function (entry) {
          return state.series[entry.key].filter(function (point) { return point.ts >= startTs; });
        });
        var allPoints = visibleSeries.reduce(function (result, series) { return result.concat(series); }, []);
        var gridHtml = '';
        for (var row = 0; row <= 4; row += 1) {
          var y = top + ((height / 4) * row);
          gridHtml += '<line x1="' + left + '" y1="' + y.toFixed(2) + '" x2="' + (left + width) + '" y2="' + y.toFixed(2) + '"></line>';
        }
        chartMeta.grid.innerHTML = gridHtml;

        if (allPoints.length <= 1) {
          chartMeta.empty.setAttribute('d', 'M' + left + ' ' + (top + (height / 2)) + ' H' + (left + width));
          chartMeta.series.forEach(function (entry) { if (entry.path) entry.path.setAttribute('d', ''); });
          chartMeta.min.textContent = '0';
          chartMeta.max.textContent = '0';
          chartMeta.bounds = null;
          updateThresholdLines(chartMeta, null, null);
          hideChartTooltip(chartMeta);
          return;
        }

        var values = allPoints.map(function (point) { return point.value; });
        var threshold = chartMeta.thresholdKind ? state.thresholds[chartMeta.thresholdKind] : null;
        var bounds = resolveChartBounds(values, chartMeta, threshold);
        function pathFromSeries(series) {
          if (series.length <= 1) return '';
          var path = '';
          series.forEach(function (point, index) {
            var x = left + (((point.ts - startTs) / tsSpan) * width);
            var y = bottom - (((point.value - bounds.minValue) / (bounds.maxValue - bounds.minValue)) * height);
            path += (index === 0 ? 'M' : ' L') + x.toFixed(2) + ' ' + y.toFixed(2);
          });
          return path;
        }
        chartMeta.empty.setAttribute('d', '');
        chartMeta.series.forEach(function (entry, index) {
          if (entry.path) entry.path.setAttribute('d', pathFromSeries(visibleSeries[index]));
        });
        chartMeta.min.textContent = String(Math.round(bounds.minValue));
        chartMeta.max.textContent = String(Math.round(bounds.maxValue));
        chartMeta.bounds = {
          left: left,
          top: top,
          width: width,
          height: height,
          bottom: bottom,
          startTs: startTs,
          tsSpan: tsSpan,
          minValue: bounds.minValue,
          maxValue: bounds.maxValue
        };
        updateThresholdLines(chartMeta, chartMeta.bounds, threshold);
      }

      function bindChartHover(state, chartMeta) {
        if (!chartMeta || !chartMeta.hitbox || !chartMeta.tooltip) return;
        chartMeta.hitbox.addEventListener('mousemove', function (event) {
          if (!chartMeta.bounds) return;
          var bounds = chartMeta.bounds;
          var rect = chartMeta.hitbox.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          var relativeX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
          var targetTs = bounds.startTs + ((relativeX / rect.width) * bounds.tsSpan);
          var anchor = null;
          chartMeta.series.forEach(function (entry) {
            state.series[entry.key].forEach(function (point) {
              if (point.ts < bounds.startTs) return;
              if (!anchor || Math.abs(point.ts - targetTs) < Math.abs(anchor.ts - targetTs)) anchor = point;
            });
          });
          if (!anchor) return;
          var anchorX = null;
          var tooltipRows = '';
          chartMeta.series.forEach(function (entry) {
            var nearest = null;
            state.series[entry.key].forEach(function (point) {
              if (point.ts < bounds.startTs) return;
              if (!nearest || Math.abs(point.ts - anchor.ts) < Math.abs(nearest.ts - anchor.ts)) nearest = point;
            });
            if (!nearest) {
              if (entry.point) entry.point.style.opacity = '0';
              return;
            }
            var pointX = bounds.left + (((nearest.ts - bounds.startTs) / bounds.tsSpan) * bounds.width);
            var pointY = bounds.bottom - (((nearest.value - bounds.minValue) / (bounds.maxValue - bounds.minValue)) * bounds.height);
            if (anchorX === null) anchorX = pointX;
            if (entry.point) {
              entry.point.setAttribute('cx', pointX.toFixed(2));
              entry.point.setAttribute('cy', pointY.toFixed(2));
              entry.point.style.opacity = '1';
            }
            tooltipRows += '<div class="chart-tooltip-row"><span class="chart-tooltip-label"><span class="chart-legend-dot" style="--dot-color:' + esc(entry.color) + ';background:' + esc(entry.color) + ';"></span>' + esc(entry.label) + '</span><strong>' + esc(formatValue(nearest.value, entry.digits, entry.unit)) + '</strong></div>';
          });
          if (anchorX === null) return;
          chartMeta.hoverLine.setAttribute('x1', anchorX.toFixed(2));
          chartMeta.hoverLine.setAttribute('x2', anchorX.toFixed(2));
          chartMeta.hoverLine.style.opacity = '1';
          chartMeta.tooltip.innerHTML = '<strong>' + esc(formatTime(anchor.ts)) + '</strong>' + tooltipRows;
          chartMeta.tooltip.style.opacity = '1';
          chartMeta.tooltip.style.transform = 'translate3d(0, 0, 0)';
          var tooltipLeft = Math.min(Math.max(anchorX + 10, 8), Math.max(8, (chartMeta.shell.clientWidth || 360) - 192));
          chartMeta.tooltip.style.left = tooltipLeft + 'px';
          chartMeta.tooltip.style.top = '12px';
        });
        chartMeta.hitbox.addEventListener('mouseleave', function () { hideChartTooltip(chartMeta); });
      }

      function setLiveState(state, mode, label) {
        if (!state.live) return;
        state.live.setAttribute('data-state', mode);
        state.live.textContent = label;
      }

      function refreshLiveState(state) {
        var ageMs = state.lastUpdatedAt > 0 ? (Date.now() - state.lastUpdatedAt) : Infinity;
        if (ageMs < 30000) {
          setLiveState(state, 'live', getUi('pond.live', 'Live'));
          return;
        }
        if (state.eventSource) {
          setLiveState(state, 'connecting', getUi('pond.stale', 'Stale'));
          return;
        }
        setLiveState(state, 'error', getUi('pond.offline', 'Offline'));
      }

      function anyContactorOn(state) {
        return Object.keys(state.contactorStates).some(function (key) { return state.contactorStates[key] === 'on'; });
      }

      function normalizeAlarmText(value) {
        return String(value == null ? '' : value).trim();
      }

      function updateEnergyAlarmUi(state) {
        if (!state || !state.energyCard) return;
        var alarmText = normalizeAlarmText(state.alarmText);
        var isActive = !!alarmText;
        var isStandaloneAlarmCard = state.energyCard.classList.contains('metric-card--alarm');
        state.energyCard.hidden = isStandaloneAlarmCard && !isActive;
        state.energyCard.setAttribute('data-alarm-active', isActive ? 'true' : 'false');
        if (state.energyAlarmShell) state.energyAlarmShell.hidden = isStandaloneAlarmCard ? false : !isActive;
        if (state.energyAlarmText) {
          state.energyAlarmText.textContent = isActive ? alarmText : (isStandaloneAlarmCard ? getUi('alarmCard.empty', 'No active alarm') : '');
        }
        if (state.energyAlarmButton) {
          state.energyAlarmButton.hidden = !(isActive && !!state.commandApiUrl && hasCommand(state, 'alarmOff'));
          state.energyAlarmButton.disabled = !!state.isBusy;
        }
      }

      function updateMeterTelemetryField(state, key, value, eventTs) {
        var matched = false;
        Object.keys(state.meterStates || {}).forEach(function (meterKey) {
          var meter = state.meterStates[meterKey];
          if (!meter || !meter.fields) return;
          if (key === String(meter.fields.voltage || '').trim().toLowerCase()) {
            var voltage = numericValue(value);
            if (voltage !== null) {
              meter.latestValues.voltage = voltage;
              appendSeriesPoint(meter.series.voltage, { ts: eventTs, value: voltage }, getHistoryWindowMs());
            }
            matched = true;
          }
          if (key === String(meter.fields.current1 || '').trim().toLowerCase()) {
            var current1 = numericValue(value);
            if (current1 !== null) {
              meter.latestValues.current1 = current1;
              appendSeriesPoint(meter.series.current1, { ts: eventTs, value: current1 }, getHistoryWindowMs());
            }
            matched = true;
          }
          if (key === String(meter.fields.current2 || '').trim().toLowerCase()) {
            var current2 = numericValue(value);
            if (current2 !== null) {
              meter.latestValues.current2 = current2;
              appendSeriesPoint(meter.series.current2, { ts: eventTs, value: current2 }, getHistoryWindowMs());
            }
            matched = true;
          }
          if (key === String(meter.fields.current3 || '').trim().toLowerCase()) {
            var current3 = numericValue(value);
            if (current3 !== null) {
              meter.latestValues.current3 = current3;
              appendSeriesPoint(meter.series.current3, { ts: eventTs, value: current3 }, getHistoryWindowMs());
            }
            matched = true;
          }
          if (key === String(meter.fields.temperature || '').trim().toLowerCase()) {
            var meterTemperature = numericValue(value);
            if (meterTemperature !== null) {
              meter.latestValues.temperature = meterTemperature;
              appendSeriesPoint(meter.series.temperature, { ts: eventTs, value: meterTemperature }, getHistoryWindowMs());
            }
            matched = true;
          }
          if (key === String(meter.fields.energy || '').trim().toLowerCase()) {
            meter.energyDisplay = formatEnergy(value);
            matched = true;
          }
        });
        if (matched && meterModalState.state === state) queueMeterModalRefresh();
        return matched;
      }

      function updateTelemetryField(state, field, value, timestamp) {
        var key = String(field || '').trim().toLowerCase();
        var eventTs = Number(timestamp || Date.now());
        var meterMatched = updateMeterTelemetryField(state, key, value, eventTs);
        var matched = false;

        ['contactor1', 'contactor2', 'contactor3'].forEach(function (contactKey) {
          if (matched) return;
          var contactMatch = extractConfiguredTelemetryValue(key, state.fields[contactKey], value);
          if (contactMatch.matched) {
            var nextState = normalizeContactorState(contactMatch.value);
            state.contactorStates[contactKey] = nextState;
            var control = state.contactorControls[contactKey];
            setContactorVisual(control, nextState, nextState === 'on' ? 'ON' : nextState === 'off' ? 'OFF' : 'OFFLINE');
            matched = true;
          }
        });
        if (matched && !meterMatched) {
          state.lastUpdatedAt = eventTs;
          scheduleLiveStateCheck(state);
          refreshLiveState(state);
          return;
        }

        var alarmMatch = extractConfiguredTelemetryValue(key, state.fields.alarm, value);
        if (alarmMatch.matched) {
          state.alarmText = normalizeAlarmText(alarmMatch.value);
          updateEnergyAlarmUi(state);
          matched = true;
        }
        if (!matched) {
          var currentThresholdMatch = extractConfiguredTelemetryValue(key, state.fields.currentThreshold, value);
          if (currentThresholdMatch.matched) {
            state.thresholds.currentByPump = parsePumpThresholdValue(currentThresholdMatch.value);
            state.thresholds.current = state.thresholds.currentByPump.contactor1 || createEmptyThresholdValue();
            if (meterModalState.state === state) queueMeterModalRefresh();
            matched = true;
          }
        }
        if (!matched) {
          var alarmPhoneMatch = extractConfiguredTelemetryValue(key, state.fields.alarmPhone, value);
          if (alarmPhoneMatch.matched) {
            state.alarmPhone = String(alarmPhoneMatch.value == null ? '' : alarmPhoneMatch.value).trim();
            matched = true;
          }
        }
        if (!matched) {
          var runWindowMatch = extractConfiguredTelemetryValue(key, state.fields.runWindow, value);
          if (runWindowMatch.matched) {
            state.runWindows = parsePumpWindowValue(runWindowMatch.value);
            state.runWindow = state.runWindows.contactor1 || { start: "", end: "", raw: "" };
            matched = true;
          }
        }
        if (!matched) {
          var updateEnabledMatch = extractConfiguredTelemetryValue(key, state.fields.updateEnabled, value);
          if (updateEnabledMatch.matched) {
            state.updateEnabled = normalizeEnabledFlag(updateEnabledMatch.value);
            if (thresholdModalState.state === state) refreshSettingsUpdateToggleUi(state);
            matched = true;
          }
        }
        if (!matched && typeof state.scheduleFieldLookup[key] === 'number') {
          var scheduleIndex = state.scheduleFieldLookup[key];
          var scheduleSnapshot = parseScheduleTelemetryValue(value, state.scheduleFields[scheduleIndex] || '');
          state.scheduleData[scheduleIndex] = cloneScheduleRowSnapshot(scheduleSnapshot);
          if (state.scheduleRows[scheduleIndex]) {
            var scheduleRow = state.scheduleRows[scheduleIndex];
            var keepLocalChanges = scheduleRow.busy || isScheduleRowDirty(scheduleRow);
            scheduleRow.committed = cloneScheduleRowSnapshot(scheduleSnapshot);
            if (!keepLocalChanges) applyScheduleSnapshot(scheduleRow, scheduleSnapshot);
            updateScheduleRowState(state, scheduleRow);
          }
          matched = true;
        }

        if (matched || meterMatched) {
          state.lastUpdatedAt = eventTs;
          scheduleLiveStateCheck(state);
          refreshLiveState(state);
        }
      }

      function handleStreamPayload(state, payload) {
        if (!payload || !payload.type) return;
        if (payload.type === 'billing_blocked') {
          setLiveState(state, 'error', getUi('pond.billingBlocked', 'Top up needed'));
          return;
        }
        if (payload.type === 'telemetry' && payload.payload && typeof payload.payload === 'object') {
          Object.keys(payload.payload).forEach(function (field) {
            updateTelemetryField(state, field, payload.payload[field], payload.serverTime || Date.now());
          });
          refreshLiveState(state);
        } else if (payload.type === 'timeseries' && Array.isArray(payload.rows)) {
          payload.rows.forEach(function (row) {
            updateTelemetryField(state, row.field, typeof row.last !== 'undefined' ? row.last : row.value, row.ts || Date.now());
          });
          refreshLiveState(state);
        }
      }

      function scheduleHistoryRefresh(delayMs) {
        if (historyTimer) window.clearTimeout(historyTimer);
        historyTimer = window.setTimeout(function () {
          historyTimer = null;
          refreshHistory();
        }, Number.isFinite(delayMs) ? Math.max(0, delayMs) : 1200);
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
        if (!historyState.sessionId || typeof EventSource === 'undefined') return;
        if (historyEventSource) {
          historyEventSource.close();
          historyEventSource = null;
        }
        if (historyReconnectTimer) {
          window.clearTimeout(historyReconnectTimer);
          historyReconnectTimer = null;
        }
        var historyUrl = '/api/' + encodeURIComponent(historyState.sessionId) + '/stream?historyMs=0';
        historyEventSource = new EventSource(historyUrl);
        historyEventSource.onmessage = function (event) {
          try {
            var payload = JSON.parse(event.data);
            if (!payload || payload.type !== 'iodata_changed') return;
            handleHistoryChangedEvent();
          } catch (error) {}
        };
        historyEventSource.onerror = function () {
          if (historyEventSource) {
            historyEventSource.close();
            historyEventSource = null;
          }
          if (historyReconnectTimer) window.clearTimeout(historyReconnectTimer);
          historyReconnectTimer = window.setTimeout(function () {
            historyReconnectTimer = null;
            connectHistoryStream();
          }, 3000);
        };
      }

      function sendContactorCommand(state, control, command, pendingLabel) {
        if (!command || !state.commandApiUrl || state.isBusy || !control || control.readOnly) return;
        setPondBusy(state, true);
        setContactorVisual(control, 'pending', pendingLabel);
        withControlCooldown(state.node, function () {
          return postCommandRaw(state.commandApiUrl, command, 5000).then(function () {
            showToast(getUi('commands.sent', 'Command sent.'), 'success');
          }).catch(function (error) {
            setContactorVisual(control, 'offline', getUi('contactor.error', 'ERROR'));
            showToast((error && error.message) || getUi('commands.failed', 'Command failed.'), 'error');
          }).finally(function () {
            setPondBusy(state, false);
          });
        });
      }

      function sendAlarmOffCommand(state) {
        if (!state || !state.commandApiUrl || state.isBusy || !hasCommand(state, 'alarmOff')) return;
        setPondBusy(state, true);
        withControlCooldown(state.node, function () {
          return postCommandRaw(state.commandApiUrl, state.commands.alarmOff, 5000).then(function () {
            showToast(getUi('commands.alarmOffSent', 'Alarm off command sent.'), 'success');
          }).catch(function (error) {
            showToast((error && error.message) || getUi('commands.alarmOffFailed', 'Alarm off failed.'), 'error');
          }).finally(function () {
            setPondBusy(state, false);
          });
        });
      }

      function setScheduleRowBusy(row, nextBusy) {
        row.busy = !!nextBusy;
        if (row.node) row.node.classList.toggle('is-busy', !!nextBusy);
        [row.enableInput, row.timeInput, row.contactorSelect, row.actionToggle].forEach(function (node) {
          if (!node) return;
          node.disabled = !!nextBusy;
        });
        if (row.enableShell) row.enableShell.setAttribute('aria-disabled', nextBusy ? 'true' : 'false');
      }

      function refreshScheduleRowUi(row) {
        if (row.enableInput) row.enableInput.checked = !!row.enabled;
        if (row.enableShell) row.enableShell.setAttribute('data-enabled', row.enabled ? 'true' : 'false');
        if (row.timeInput) row.timeInput.value = row.time || '';
        if (row.contactorSelect) row.contactorSelect.value = row.contactor || '';
        if (row.actionToggle) {
          row.actionToggle.setAttribute('data-state', row.action || 'on');
          row.actionToggle.setAttribute('aria-pressed', row.action === 'off' ? 'false' : 'true');
        }
        if (row.node) {
          row.node.classList.toggle('is-disabled', !row.enabled);
          row.node.classList.toggle('is-dirty', isScheduleRowDirty(row));
          row.node.setAttribute('data-action', row.action || 'on');
          row.node.setAttribute('data-dirty', isScheduleRowDirty(row) ? 'true' : 'false');
        }
      }

      function refreshScheduleSaveUi(state) {
        if (!state || !state.scheduleSaveButton) return;
        var dirtyCount = (Array.isArray(state.scheduleRows) ? state.scheduleRows : []).filter(function (row) {
          return isScheduleRowDirty(row);
        }).length;
        var isSaving = !!state.scheduleSaving;
        state.scheduleSaveButton.hidden = !dirtyCount && !isSaving;
        state.scheduleSaveButton.disabled = isSaving || dirtyCount === 0 || !state.commandApiUrl;
        state.scheduleSaveButton.textContent = isSaving ? getUi('schedule.saving', 'Saving...') : getUi('schedule.save', 'Save');
      }

      function updateScheduleRowState(state, row) {
        if (!row) return;
        row.empty = !rowHasCompleteSchedule(row);
        row.dirty = isScheduleRowDirty(row);
        refreshScheduleRowUi(row);
        refreshScheduleSaveUi(state);
      }

      function focusScheduleRowForCompletion(row) {
        if (!row) return;
        if (!row.time && row.timeInput) {
          row.timeInput.focus();
          return;
        }
        if (!row.contactor && row.contactorSelect) {
          row.contactorSelect.focus();
          return;
        }
        if (row.enableInput) row.enableInput.focus();
      }

      function persistScheduleRow(state, row) {
        var built = buildScheduleTelemetryPayload(row);
        if (!built || !state.commandApiUrl || row.busy) return Promise.resolve(false);
        if (row.enabled && built.empty) {
          focusScheduleRowForCompletion(row);
          return Promise.reject(new Error(getUi('schedule.empty', 'Schedule is empty.')));
        }
        setScheduleRowBusy(row, true);
        return runScheduleWriteCommand(state.commandApiUrl, built.command, getUi('schedule.updateFailed', 'Schedule update failed.'), 3).then(function () {
          applyScheduleSnapshot(row, built.snapshot);
          row.committed = cloneScheduleRowSnapshot(built.snapshot);
          state.scheduleData[row.index] = cloneScheduleRowSnapshot(built.snapshot);
          updateScheduleRowState(state, row);
          return true;
        }).catch(function (error) {
          updateScheduleRowState(state, row);
          throw error;
        }).finally(function () {
          setScheduleRowBusy(row, false);
          refreshScheduleSaveUi(state);
        });
      }

      function persistDirtyScheduleRows(state) {
        if (!state || !state.commandApiUrl || state.scheduleSaving) return Promise.resolve(false);
        var dirtyRows = (Array.isArray(state.scheduleRows) ? state.scheduleRows : []).filter(function (row) {
          return isScheduleRowDirty(row);
        });
        if (!dirtyRows.length) {
          refreshScheduleSaveUi(state);
          return Promise.resolve(false);
        }
        var invalidRow = dirtyRows.find(function (row) {
          return !!row.enabled && !rowHasCompleteSchedule(row);
        });
        if (invalidRow) {
          setScheduleCollapsed(state, false);
          focusScheduleRowForCompletion(invalidRow);
          showToast(getUi('schedule.empty', 'Schedule is empty.'), 'error');
          refreshScheduleSaveUi(state);
          return Promise.resolve(false);
        }

        state.scheduleSaving = true;
        refreshScheduleSaveUi(state);
        return withControlCooldown(state.node, function () {
          var sequence = Promise.resolve();
          dirtyRows.forEach(function (row) {
            sequence = sequence.then(function () {
              return persistScheduleRow(state, row);
            });
          });
          return sequence.then(function () {
            showToast(getUi('schedule.updated', 'Schedule updated.'), 'success');
            return true;
          }).catch(function (error) {
            showToast((error && error.message) || getUi('schedule.updateFailed', 'Schedule update failed.'), 'error');
            return false;
          }).finally(function () {
            state.scheduleSaving = false;
            refreshScheduleSaveUi(state);
          });
        });
      }

      function bindScheduleRow(state, row) {
        refreshScheduleRowUi(row);
        if (row.timeInput) {
          var syncScheduleTimeValue = function () {
            row.time = String(row.timeInput.value || '');
            row.empty = !rowHasCompleteSchedule(row);
          };
          row.timeInput.addEventListener('pointerdown', function () {
            openNativeTimePicker(row.timeInput);
          });
          row.timeInput.addEventListener('focus', function () {
            openNativeTimePicker(row.timeInput);
          });
          row.timeInput.addEventListener('click', function () {
            openNativeTimePicker(row.timeInput);
          });
          row.timeInput.addEventListener('input', function () {
            if (row.busy || state.scheduleSaving) {
              refreshScheduleRowUi(row);
              return;
            }
            syncScheduleTimeValue();
            updateScheduleRowState(state, row);
          });
          row.timeInput.addEventListener('change', function () {
            if (row.busy || state.scheduleSaving) {
              refreshScheduleRowUi(row);
              return;
            }
            syncScheduleTimeValue();
            updateScheduleRowState(state, row);
          });
        }
        if (row.contactorSelect) {
          row.contactorSelect.addEventListener('change', function () {
            if (row.busy || state.scheduleSaving) {
              refreshScheduleRowUi(row);
              return;
            }
            row.contactor = String(row.contactorSelect.value || '');
            updateScheduleRowState(state, row);
          });
        }
        if (row.actionToggle) {
          row.actionToggle.addEventListener('click', function () {
            if (row.busy || state.scheduleSaving) {
              refreshScheduleRowUi(row);
              return;
            }
            row.action = row.action === 'off' ? 'on' : 'off';
            updateScheduleRowState(state, row);
          });
        }
        if (row.enableInput) {
          row.enableInput.addEventListener('change', function () {
            if (row.busy || state.scheduleSaving) {
              refreshScheduleRowUi(row);
              return;
            }
            row.enabled = !!row.enableInput.checked;
            updateScheduleRowState(state, row);
          });
        }
      }

      function loadScheduleRows(state) {
        if (!state.scheduleRows.length) return Promise.resolve();
        state.scheduleRows.forEach(function (row) {
          var snapshot = state.scheduleData[row.index] || createEmptyScheduleSnapshot();
          applyScheduleSnapshot(row, snapshot);
          row.committed = cloneScheduleRowSnapshot(snapshot);
          updateScheduleRowState(state, row);
        });
        refreshScheduleSaveUi(state);
        return Promise.resolve();
      }

      function bootstrapPond(state) {

        var url = buildTelemetryUrl(state.sessionId);
        if (!url) return Promise.resolve();
        return fetch(url, { cache: 'no-store' }).then(function (response) {
          if (!response.ok) return null;
          return response.json();
        }).then(function (payload) {
          var data = payload && payload.c2 && payload.c2.payload;
          if (!data || typeof data !== 'object') return;
          Object.keys(data).forEach(function (field) {
            updateTelemetryField(state, field, data[field], payload.c2.serverTime || Date.now());
          });
        }).catch(function () {});
      }

      function connectPond(state) {
        var streamFields = [
          state.fields.contactor1,
          state.fields.contactor2,
          state.fields.contactor3,
          state.fields.alarm,
          state.fields.currentThreshold,
          state.fields.alarmPhone,
          state.fields.runWindow,
          state.fields.updateEnabled
        ].reduce(function (result, value) {
          return result.concat(expandConfiguredStreamFields(value));
        }, [])
          .concat((state.scheduleFields || []).reduce(function (result, value) {
            return result.concat(expandConfiguredStreamFields(value));
          }, []))
          .filter(Boolean)
          .filter(function (value, index, list) { return list.indexOf(value) === index; });

        ensurePondBootstrap(state).finally(function () {
          setLiveState(state, 'connecting', getUi('pond.connecting', 'Connecting'));
          state.eventSource = new EventSource(buildStreamUrl(state.sessionId, streamFields, 0));
          state.eventSource.onmessage = function (event) {
            try { handleStreamPayload(state, JSON.parse(event.data)); } catch (error) {}
          };
          state.eventSource.onerror = function () {
            if (state.eventSource) {
              state.eventSource.close();
              state.eventSource = null;
            }
            setLiveState(state, 'connecting', getUi('pond.reconnecting', 'Reconnecting'));
            if (state.reconnectTimer) window.clearTimeout(state.reconnectTimer);
            state.reconnectTimer = window.setTimeout(function () {
              state.reconnectTimer = null;
              reconnectPond(state);
            }, 3000);
          };
        });
      }

      function reconnectPond(state) {
        if (state.reconnectTimer) {
          window.clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        if (state.eventSource) {
          state.eventSource.close();
          state.eventSource = null;
        }
        clearMeterSeries(state);
        state.meterHistoryLoaded = false;
        state.meterHistoryMeterKey = '';
        state.meterHistoryWindowMs = 0;
        if (meterModalState.state === state) queueMeterModalRefresh();
        connectPond(state);
      }

      function setSettingsGroupVisibility(node, visible) {
        if (!node) return;
        node.hidden = !visible;
      }

      function refreshSettingsUpdateToggleUi(state) {
        if (!settingsUpdateToggle) return;
        var enabled = !!state && state.updateEnabled === true;
        settingsUpdateToggle.setAttribute('data-enabled', enabled ? 'true' : 'false');
        settingsUpdateToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        settingsUpdateToggle.disabled = !state || !!state.isBusy;
      }

      function sendUpdateEnabledCommand(state, nextEnabled) {
        if (!state || !state.commandApiUrl || state.isBusy || !hasField(state, 'updateEnabled')) return;
        var modalCard = thresholdModal ? thresholdModal.querySelector('.modal-card') : null;
        var previous = state.updateEnabled;
        state.updateEnabled = !!nextEnabled;
        refreshSettingsUpdateToggleUi(state);
        setPondBusy(state, true);
        withControlCooldown(modalCard || state.node, function () {
          return postCommandRaw(state.commandApiUrl, state.fields.updateEnabled + '=' + (nextEnabled ? 'ON' : 'OFF'), 5000).then(function () {
            showToast(getUi(nextEnabled ? 'settingsModal.updateEnabled' : 'settingsModal.updateDisabled', nextEnabled ? 'Updates enabled.' : 'Updates disabled.'), 'success');
          }).catch(function (error) {
            state.updateEnabled = previous;
            refreshSettingsUpdateToggleUi(state);
            showToast((error && error.message) || getUi('settingsModal.updateFailed', 'Unable to update refresh mode.'), 'error');
          }).finally(function () {
            setPondBusy(state, false);
            refreshSettingsUpdateToggleUi(state);
          });
        });
      }

      function openSettingsModal(state) {
        if (!state || !state.commandApiUrl) return;
        thresholdModalState.state = state;
        thresholdModalTitle.textContent = formatUi('settingsModal.title', 'Pond settings | {title}', { title: state.title });
        thresholdModalDescription.textContent = getUi('settingsModal.description', 'Configure thresholds and the alarm phone number for this pond.');

        var hasCurrent = hasField(state, 'currentThreshold');
        var hasPhone = hasField(state, 'alarmPhone');
        var hasRunWindow = hasField(state, 'runWindow');
        var hasUpdateEnabled = hasField(state, 'updateEnabled');
        setSettingsGroupVisibility(settingsPhoneGroup, hasPhone);
        setSettingsGroupVisibility(settingsUpdateGroup, hasUpdateEnabled);
        settingsPumpControls.forEach(function (control) {
          var fallbackLabel = control.key === 'contactor1' ? 'Contactor 1' : 'Contactor 2';
          var pumpLabel = getContactorLabel(state, control.key, fallbackLabel);
          if (control.tab) {
            control.tab.textContent = pumpLabel;
            control.tab.setAttribute('aria-label', pumpLabel);
          }
          if (control.title) control.title.textContent = pumpLabel;
          var hasPump = hasCurrent || hasRunWindow;
          setSettingsGroupVisibility(control.group, hasPump);
          var currentThresholds = state.thresholds.currentByPump || createEmptyPumpThresholds("");
          var currentThreshold = currentThresholds[control.key] || createEmptyThresholdValue();
          var runWindows = state.runWindows || createEmptyPumpWindows("");
          var runWindow = runWindows[control.key] || { start: "", end: "", raw: "" };
          control.currentLowInput.value = hasCurrent && currentThreshold.low !== null ? String(currentThreshold.low) : '';
          control.currentHighInput.value = hasCurrent && currentThreshold.high !== null ? String(currentThreshold.high) : '';
          control.runWindowStartInput.value = hasRunWindow ? String(runWindow.start || '') : '';
          control.runWindowEndInput.value = hasRunWindow ? String(runWindow.end || '') : '';
          control.currentLowInput.placeholder = hasCurrent && currentThreshold.low === null ? getUi('thresholds.placeholders.currentLow', '0.5') : '';
          control.currentHighInput.placeholder = hasCurrent && currentThreshold.high === null ? getUi('thresholds.placeholders.currentHigh', '3.5') : '';
          control.runWindowStartInput.placeholder = hasRunWindow && !runWindow.start ? getUi('thresholds.placeholders.runWindowStart', '0700') : '';
          control.runWindowEndInput.placeholder = hasRunWindow && !runWindow.end ? getUi('thresholds.placeholders.runWindowEnd', '2359') : '';
        });
        settingsAlarmPhoneInput.value = hasPhone ? String(state.alarmPhone || '') : '';

        settingsAlarmPhoneInput.placeholder = hasPhone && !state.alarmPhone ? getUi('thresholds.placeholders.alarmPhone', '+84901234567') : '';
        if (settingsUpdateToggle) {
          settingsUpdateToggle.setAttribute('aria-label', formatUi('settingsModal.updateToggleAria', 'Toggle update information for {title}', { title: state.title }));
        }
        refreshSettingsUpdateToggleUi(state);
        activateSettingsPumpTab('contactor1');

        thresholdModal.classList.add('is-open');
        thresholdModal.setAttribute('aria-hidden', 'false');
      }

      function closeThresholdModal() {
        thresholdModal.classList.remove('is-open');
        thresholdModal.setAttribute('aria-hidden', 'true');
        thresholdModalState.state = null;
      }

      function queueMeterModalRefresh() {
        if (!meterModalState.state || meterModalRenderFrame) return;
        meterModalRenderFrame = window.requestAnimationFrame(function () {
          meterModalRenderFrame = null;
          refreshMeterModal();
        });
      }

      function closeMeterModalStream() {
        if (meterModalReconnectTimer) {
          window.clearTimeout(meterModalReconnectTimer);
          meterModalReconnectTimer = null;
        }
        if (meterModalEventSource) {
          meterModalEventSource.close();
          meterModalEventSource = null;
        }
      }

      function connectMeterModalStream(state, meterKey) {
        closeMeterModalStream();
        if (!state || !state.sessionId || !meterKey || typeof EventSource === 'undefined') return;
        var fields = getMeterHistoryFields(state, meterKey);
        if (!fields.length) return;
        try {
          meterModalEventSource = new EventSource(buildStreamUrl(state.sessionId, fields, 0));
          meterModalEventSource.onmessage = function (event) {
            if (meterModalState.state !== state || meterModalState.meterKey !== meterKey) return;
            try { handleStreamPayload(state, JSON.parse(event.data)); } catch (error) {}
          };
          meterModalEventSource.onerror = function () {
            closeMeterModalStream();
            if (meterModalState.state !== state || meterModalState.meterKey !== meterKey) return;
            meterModalReconnectTimer = window.setTimeout(function () {
              meterModalReconnectTimer = null;
              connectMeterModalStream(state, meterKey);
            }, 3000);
          };
        } catch (error) {
          meterModalReconnectTimer = window.setTimeout(function () {
            meterModalReconnectTimer = null;
            if (meterModalState.state === state && meterModalState.meterKey === meterKey) {
              connectMeterModalStream(state, meterKey);
            }
          }, 3000);
        }
      }

      function closeMeterModal() {
        var closingState = meterModalState.state;
        meterModalState.state = null;
        meterModalState.meterKey = '';
        closeMeterModalStream();
        if (closingState) {
          closingState.meterHistoryRequestId = (closingState.meterHistoryRequestId || 0) + 1;
          closingState.meterHistoryPromise = null;
        }
        if (meterModalRenderFrame) {
          window.cancelAnimationFrame(meterModalRenderFrame);
          meterModalRenderFrame = null;
        }
        if (meterModal) {
          meterModal.classList.remove('is-open');
          meterModal.setAttribute('aria-hidden', 'true');
        }
        hideChartTooltip(meterVoltageChart);
        hideChartTooltip(meterCurrentChart);
        hideChartTooltip(meterTemperatureChart);
      }

      function refreshMeterModal() {
        var state = meterModalState.state;
        var meterKey = meterModalState.meterKey;
        if (!state || !meterKey) return;
        var meter = state.meterStates && state.meterStates[meterKey];
        if (!meter) return;

        var meterLabel = safeText(meter.label, meterKey);
        setNodeText(meterModalTitle, formatUi('meterModal.title', 'Electrical meter | {label}', { label: meterLabel }));
        setNodeText(meterModalDescription, formatUi('meterModal.description', 'Voltage, current, temperature and energy for {label}.', { label: meterLabel }));
        setNodeText(meterEnergyValue, meter.energyDisplay || '--');
        setNodeText(meterVoltageInline, Number.isFinite(meter.latestValues.voltage) ? formatValue(meter.latestValues.voltage, 1, 'V') : '--');
        setNodeText(meterCurrent1Inline, Number.isFinite(meter.latestValues.current1) ? formatValue(meter.latestValues.current1, 2, 'A') : '--');
        setNodeText(meterCurrent2Inline, Number.isFinite(meter.latestValues.current2) ? formatValue(meter.latestValues.current2, 2, 'A') : '--');
        setNodeText(meterCurrent3Inline, Number.isFinite(meter.latestValues.current3) ? formatValue(meter.latestValues.current3, 2, 'A') : '--');
        setNodeText(meterTemperatureInline, Number.isFinite(meter.latestValues.temperature) ? formatValue(meter.latestValues.temperature, 1, '°C') : '--');

        if (meterVoltageCard) meterVoltageCard.hidden = !hasMeterField(meter, 'voltage');
        if (meterCurrentCard) meterCurrentCard.hidden = !(hasMeterField(meter, 'current1') || hasMeterField(meter, 'current2') || hasMeterField(meter, 'current3'));
        if (meterTemperatureCard) meterTemperatureCard.hidden = !hasMeterField(meter, 'temperature');

        meterModalChartState.series = meter.series;
        meterModalChartState.thresholds = Object.assign({}, state.thresholds || {});
        if (meterModalChartState.thresholds.currentByPump && meterModalChartState.thresholds.currentByPump[meterKey]) {
          meterModalChartState.thresholds.current = meterModalChartState.thresholds.currentByPump[meterKey];
        }

        if (meterVoltageChart) {
          meterVoltageChart.series = meterVoltageChart.baseSeries.filter(function (entry) {
            return hasMeterField(meter, entry.key);
          });
          hideChartTooltip(meterVoltageChart);
          if (!meterVoltageCard.hidden) renderChart(meterModalChartState, meterVoltageChart);
        }

        if (meterCurrentChart) {
          meterCurrentChart.series = meterCurrentChart.baseSeries.filter(function (entry) {
            return hasMeterField(meter, entry.key);
          });
          hideChartTooltip(meterCurrentChart);
          if (!meterCurrentCard.hidden) renderChart(meterModalChartState, meterCurrentChart);
        }

        if (meterTemperatureChart) {
          meterTemperatureChart.series = meterTemperatureChart.baseSeries.filter(function (entry) {
            return hasMeterField(meter, entry.key);
          });
          hideChartTooltip(meterTemperatureChart);
          if (!meterTemperatureCard.hidden) renderChart(meterModalChartState, meterTemperatureChart);
        }
      }

      function openMeterModal(state, meterKey) {
        var meter = state && state.meterStates ? state.meterStates[meterKey] : null;
        if (!meter) {
          showToast(getUi('meterModal.unavailable', 'Meter data is not configured for this contactor.'), 'error');
          return;
        }
        meterModalState.state = state;
        meterModalState.meterKey = meterKey;
        if (meterModal) {
          meterModal.classList.add('is-open');
          meterModal.setAttribute('aria-hidden', 'false');
        }
        refreshMeterModal();
        loadMeterHistory(state, false);
        connectMeterModalStream(state, meterKey);
      }

      function severityFromEventType(eventType) {
        var normalized = normalizeKeyword(eventType);
        if (!normalized) return 'neutral';
        if (normalized.indexOf('shaft_break') >= 0 || normalized.indexOf('shaft break') >= 0 || normalized.indexOf('gay truc') >= 0) return 'danger';
        if (normalized.indexOf('overload') >= 0 || normalized.indexOf('qua tai') >= 0) return 'warning';
        if (normalized.indexOf('disconnect') >= 0 || normalized.indexOf('mat ket noi') >= 0) return 'disconnect';
        if (normalized.indexOf('on_time') >= 0) return 'control-on';
        if (normalized.indexOf('off_time') >= 0) return 'control-off';
        if (normalized.indexOf('alarm_off') >= 0) return 'info';
        return 'neutral';
      }

      function resolveEventTypeLabelKey(eventType) {
        var normalized = normalizeKeyword(eventType);
        if (!normalized) return '';
        if (normalized.indexOf('shaft_break') >= 0 || normalized.indexOf('shaft break') >= 0 || normalized.indexOf('gay truc') >= 0) return 'shaftBreak';
        if (normalized.indexOf('overload') >= 0 || normalized.indexOf('qua tai') >= 0) return 'overload';
        if (normalized.indexOf('disconnect') >= 0 || normalized.indexOf('mat ket noi') >= 0) return 'disconnect';
        if (normalized.indexOf('off_time') >= 0) return 'offTime';
        if (normalized.indexOf('on_time') >= 0) return 'onTime';
        if (normalized.indexOf('alarm_off') >= 0) return 'alarmOff';
        return '';
      }

      function humanizeEventType(eventType) {
        var text = safeText(eventType, '--').replace(/[_-]+/g, ' ').trim();
        if (!text) return '--';
        return text.split(/\s+/).map(function (part) {
          if (!part) return '';
          return part.charAt(0).toUpperCase() + part.slice(1);
        }).join(' ');
      }


      function formatEventTypeLabel(eventType) {
        var key = resolveEventTypeLabelKey(eventType);
        if (!key) return humanizeEventType(eventType);
        return getUi('history.eventTypes.' + key, humanizeEventType(eventType));
      }

      function resolvePondLabel(row) {
        if (!row || typeof row !== 'object') return '--';
        return safeText(row.pond_name, '--');
      }

      function scrollHistoryToLatest() {
        if (!historyScrollWrap) return;
        window.requestAnimationFrame(function () {
          historyScrollWrap.scrollTop = historyScrollWrap.scrollHeight;
        });
      }

      function renderHistoryRows(rows) {
        if (!historyBody) return;
        if (!rows || !rows.length) {
          historyBody.innerHTML = '<tr><td colspan="5" class="empty-state">' + esc(getUi('history.empty', 'No history rows available.')) + '</td></tr>';
          if (historyScrollWrap) historyScrollWrap.scrollTop = 0;
          return;
        }
        historyBody.innerHTML = rows.map(function (row) {
          var severity = severityFromEventType(row.event_type);
          return ''
            + '<tr class="history-row" data-severity="' + esc(severity) + '">'
            + '<td>' + esc(formatDateTime(typeof row.event_time_ms !== 'undefined' ? row.event_time_ms : row.event_time)) + '</td>'
            + '<td><span class="event-pond-pill">' + esc(resolvePondLabel(row)) + '</span></td>'
            + '<td><span class="event-type-pill" data-severity="' + esc(severity) + '">' + esc(formatEventTypeLabel(row.event_type)) + '</span></td>'
            + '<td>' + esc(row.content || '--') + '</td>'
            + '<td>' + esc(row.email || '--') + '</td>'
            + '</tr>';
        }).join('');
        scrollHistoryToLatest();
      }

      function refreshHistory() {
        if (!historyState.sessionId || !historyState.syncId || !historyState.macro) {
          if (historyCard) historyCard.style.display = 'none';
          return Promise.resolve();
        }
        if (historyCard) historyCard.style.display = '';
        var nextRequestId = ++historyRequestId;
        var url = buildIoDataUrl(historyState.sessionId, historyState.syncId);
        if (!url) return Promise.resolve();
        historySourceChip.textContent = formatUi('history.sourceValue', 'Source {ioid}', { ioid: safeText(extractIoid(historyState.sessionId), 'history') });
        if (historyRefreshButton) historyRefreshButton.disabled = true;
        return postIoData(url, {
          macro: historyState.macro,
          page_size: historyState.pageSize,
          limit: historyState.pageSize,
          offset: 0
        }).then(function (rows) {
          if (nextRequestId !== historyRequestId) return;
          historyState.rows = (rows || []).slice().sort(function (left, right) {
            return (getEventTimeMs(left.event_time_ms || left.event_time) || 0) - (getEventTimeMs(right.event_time_ms || right.event_time) || 0);
          }).slice(-historyState.pageSize);
          renderHistoryRows(historyState.rows);
        }).catch(function (error) {
          if (nextRequestId !== historyRequestId) return;
          renderHistoryRows([]);
          showToast((error && error.message) || getUi('history.loadFailed', 'Unable to load event history.'), 'error');
        }).finally(function () {
          if (historyRefreshButton) historyRefreshButton.disabled = false;
        });
      }

      var pondStates = (Array.isArray(config.sessions) ? config.sessions : []).map(function (sessionConfig, index) {
        var sessionId = safeText(sessionConfig.sessionId, '');
        var ioid = extractIoid(sessionId);
        return {
          pondIndex: index,
          title: safeText(sessionConfig.title, formatUi('pond.fallbackTitle', 'Pond {index}', { index: String(index + 1) })),
          description: safeText(sessionConfig.description, formatUi('pond.deviceDescription', 'Device: {ioid}', { ioid: ioid })),
          sessionId: sessionId,
          ioid: ioid,
          fields: sessionConfig.fields || {},
          commands: sessionConfig.commands || {},
          meterConfig: sessionConfig.meters || {},
          scheduleFields: normalizeScheduleFieldList(sessionConfig.scheduleFields),
          commandApiUrl: buildCommandApiUrl(sessionId),
          eventSource: null,
          reconnectTimer: null,
          contactorStates: { contactor1: 'offline', contactor2: 'offline', contactor3: 'offline' },
          thresholds: { current: createEmptyThresholdValue(), currentByPump: createEmptyPumpThresholds("") },
          alarmPhone: '',
          runWindow: { start: "", end: "", raw: "" },
          runWindows: createEmptyPumpWindows(""),
          updateEnabled: null,
          meterStates: {},
          meterHistoryLoaded: false,
          meterHistoryMeterKey: '',
          meterHistoryWindowMs: 0,
          meterHistoryPromise: null,
          meterHistoryRequestId: 0,
          scheduleData: normalizeScheduleFieldList(sessionConfig.scheduleFields).map(function () { return createEmptyScheduleSnapshot(); }),
          scheduleFieldLookup: createScheduleFieldLookup(normalizeScheduleFieldList(sessionConfig.scheduleFields)),
          alarmText: ''
        };
      }).filter(function (state) { return state.sessionId; });

      // Shared history must come from an explicit IoData session. Do not silently fall back
      // to the first pond session, otherwise the UI appears to filter to one pond only.
      if (!historyState.syncId) historyState.syncId = syncId;

      pondStates.forEach(function (state) {
        renderPond(state);
        if (state.pondIndex > 0) {
          queuePondConnection(state, 900 + (state.pondIndex * 450));
        }
      });

      pondCountChip.textContent = getPondCountText(pondStates.length);
      refreshHistory();
      connectHistoryStream();

      globalRange.addEventListener('change', function () {
        pondStates.forEach(function (state) {
          state.meterHistoryLoaded = false;
          state.meterHistoryMeterKey = '';
          state.meterHistoryWindowMs = 0;
          if (state.connectionStarted) reconnectPond(state);
        });
        if (meterModalState.state) loadMeterHistory(meterModalState.state, true);
        refreshHistory();
      });

      if (historyRefreshButton) {
        historyRefreshButton.addEventListener('click', function () {
          refreshHistory();
        });
      }
      if (historyCard && historyContent) {
        var historyHead = historyCard.querySelector('.section-head') || historyToggle;
        var toggleHistoryCard = function () {
          historyToggleHandledAt = Date.now();
          setHistoryCollapsed(!(historyToggle.getAttribute('aria-expanded') === 'true'));
        };
        if (historyHead) {
          historyHead.setAttribute('role', 'button');
          historyHead.setAttribute('tabindex', '0');
          historyHead.setAttribute('aria-expanded', 'false');
          historyHead.addEventListener('click', function (event) {
            if (Date.now() - historyToggleHandledAt < 80) return;
            var target = event.target;
            if (target && typeof target.closest === 'function' && target.closest('#history-source-chip')) return;
            toggleHistoryCard();
          });
          historyHead.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggleHistoryCard();
            }
          });
        }
        setHistoryCollapsed(true);
      }
      if (settingsUpdateToggle) {
        settingsUpdateToggle.addEventListener('click', function () {
          var state = thresholdModalState.state;
          if (!state) return;
          sendUpdateEnabledCommand(state, !(state.updateEnabled === true));
        });
      }
      settingsPumpControls.forEach(function (control) {
        if (!control.tab) return;
        control.tab.addEventListener('click', function () {
          activateSettingsPumpTab(control.key);
        });
      });

      thresholdForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var state = thresholdModalState.state;
        if (!state || !state.commandApiUrl) {
          showToast(getUi('thresholds.missingContext', 'Missing command context for settings update.'), 'error');
          return;
        }

        var commands = [];
        var nextCurrentByPump = state.thresholds.currentByPump || createEmptyPumpThresholds("");
        var nextAlarmPhone = state.alarmPhone;
        var nextRunWindows = state.runWindows || createEmptyPumpWindows("");

        if (hasField(state, 'currentThreshold')) {
          var currentParts = [];
          var currentByPump = {};
          for (var currentIndex = 0; currentIndex < settingsPumpControls.length; currentIndex += 1) {
            var currentControl = settingsPumpControls[currentIndex];
            var lowRaw = String(currentControl.currentLowInput.value || '').trim();
            var highRaw = String(currentControl.currentHighInput.value || '').trim();
            var currentLow = numericValue(lowRaw);
            var currentHigh = numericValue(highRaw);
            if ((lowRaw && currentLow === null) || (highRaw && currentHigh === null)) {
              showToast(getUi('thresholds.bothRequired', 'Both low and high thresholds are required.'), 'error');
              return;
            }
            if ((currentLow !== null && currentHigh === null) || (currentLow === null && currentHigh !== null)) {
              showToast(getUi('thresholds.bothRequired', 'Both low and high thresholds are required.'), 'error');
              return;
            }
            if (currentLow !== null && currentHigh !== null && currentLow > currentHigh) {
              showToast(getUi('thresholds.invalidRange', 'Low threshold must be less than or equal to high threshold.'), 'error');
              return;
            }
            currentByPump[currentControl.key] = {
              low: currentLow,
              high: currentHigh,
              raw: currentLow !== null && currentHigh !== null ? (currentLow + ',' + currentHigh) : ''
            };
            currentParts.push(currentLow !== null ? String(currentLow) : '');
            currentParts.push(currentHigh !== null ? String(currentHigh) : '');
          }
          var currentRaw = trimTrailingEmptyParts(currentParts);
          nextCurrentByPump = {
            contactor1: currentByPump.contactor1 || createEmptyThresholdValue(),
            contactor2: currentByPump.contactor2 || createEmptyThresholdValue(),
            raw: currentRaw
          };
          if ((state.thresholds.currentByPump && state.thresholds.currentByPump.raw) !== currentRaw) {
            commands.push({
              command: state.fields.currentThreshold + '=' + currentRaw,
              apply: function () {
                state.thresholds.currentByPump = nextCurrentByPump;
                state.thresholds.current = nextCurrentByPump.contactor1 || createEmptyThresholdValue();
              }
            });
          }
        }


        if (hasField(state, 'alarmPhone')) {
          nextAlarmPhone = String(settingsAlarmPhoneInput.value || '').trim();
          if (String(state.alarmPhone || '') !== nextAlarmPhone) {
            commands.push({ command: state.fields.alarmPhone + '=' + nextAlarmPhone, apply: function () { state.alarmPhone = nextAlarmPhone; } });
          }
        }

        if (hasField(state, 'runWindow')) {
          var runWindowParts = [];
          var runWindowsByPump = {};
          for (var runIndex = 0; runIndex < settingsPumpControls.length; runIndex += 1) {
            var runControl = settingsPumpControls[runIndex];
            var runStartRaw = String(runControl.runWindowStartInput.value || '').trim();
            var runEndRaw = String(runControl.runWindowEndInput.value || '').trim();
            var runWindowStart = normalizeCompactTimeValue(runStartRaw);
            var runWindowEnd = normalizeCompactTimeValue(runEndRaw);
            if ((runStartRaw && !runWindowStart) || (runEndRaw && !runWindowEnd)) {
              showToast(getUi('thresholds.timeWindowInvalid', 'Time must use 4 digits in HHMM format.'), 'error');
              return;
            }
            if ((runWindowStart && !runWindowEnd) || (!runWindowStart && runWindowEnd)) {
              showToast(getUi('thresholds.timeWindowBothRequired', 'Both start and end times are required.'), 'error');
              return;
            }
            runWindowsByPump[runControl.key] = {
              start: runWindowStart,
              end: runWindowEnd,
              raw: runWindowStart && runWindowEnd ? (runWindowStart + ',' + runWindowEnd) : ''
            };
            runWindowParts.push(runWindowStart || '');
            runWindowParts.push(runWindowEnd || '');
          }
          var runWindowRaw = trimTrailingEmptyParts(runWindowParts);
          nextRunWindows = {
            contactor1: runWindowsByPump.contactor1 || { start: "", end: "", raw: "" },
            contactor2: runWindowsByPump.contactor2 || { start: "", end: "", raw: "" },
            raw: runWindowRaw
          };
          if ((state.runWindows && state.runWindows.raw) !== runWindowRaw) {
            commands.push({
              command: state.fields.runWindow + '=' + runWindowRaw,
              apply: function () {
                state.runWindows = nextRunWindows;
                state.runWindow = nextRunWindows.contactor1 || { start: "", end: "", raw: "" };
              }
            });
          }
        }

        if (!commands.length) {
          closeThresholdModal();
          return;
        }

        var settingsModalCard = thresholdModal ? thresholdModal.querySelector('.modal-card') : null;
        thresholdModalSubmit.disabled = true;
        var previousCurrent = state.thresholds.current;
        var previousCurrentByPump = state.thresholds.currentByPump;
        var previousAlarmPhone = state.alarmPhone;
        var previousRunWindow = state.runWindow;
        var previousRunWindows = state.runWindows;

        withControlCooldown(settingsModalCard, function () {
          var chain = Promise.resolve();
          commands.forEach(function (entry) {
            chain = chain.then(function () {
              return postCommandRaw(state.commandApiUrl, entry.command, 5000).then(function (text) {
                if (!responseHasOk(text) && !responseMatchesCommandEcho(text, entry.command)) {
                  throw new Error(getUi('thresholds.updateFailed', 'Settings update failed.'));
                }
                entry.apply();
              });
            });
          });
          return chain.then(function () {
            if (meterModalState.state === state) queueMeterModalRefresh();
            showToast(getUi('thresholds.updated', 'Settings updated.'), 'success');
            closeThresholdModal();
          }).catch(function (error) {
            state.thresholds.current = previousCurrent;
            state.thresholds.currentByPump = previousCurrentByPump;
            state.alarmPhone = previousAlarmPhone;
            state.runWindow = previousRunWindow;
            state.runWindows = previousRunWindows;
            if (meterModalState.state === state) queueMeterModalRefresh();
            showToast((error && error.message) || getUi('thresholds.updateFailed', 'Settings update failed.'), 'error');
          }).finally(function () {
            thresholdModalSubmit.disabled = false;
          });
        });
      });

      thresholdModalClose.addEventListener('click', closeThresholdModal);
      thresholdModalCancel.addEventListener('click', closeThresholdModal);
      thresholdModal.addEventListener('click', function (event) {
        if (event.target === thresholdModal) closeThresholdModal();
      });
      if (meterModalClose) meterModalClose.addEventListener('click', closeMeterModal);
      if (meterModal) {
        meterModal.addEventListener('click', function (event) {
          if (event.target === meterModal) closeMeterModal();
        });
      }

      document.addEventListener('click', function (event) {
        var themeOption = event.target && typeof event.target.closest === 'function' ? event.target.closest('[data-theme-option]') : null;
        if (themeOption) {
          setTheme(String(themeOption.getAttribute('data-theme-option') || 'neumorphism'));
          closeThemePickerMenu();
          return;
        }
        var themeToggle = event.target && typeof event.target.closest === 'function' ? event.target.closest('#theme-picker-toggle') : null;
        if (themeToggle) {
          if (themePickerMenu.classList.contains('is-open')) closeThemePickerMenu();
          else openThemePickerMenu();
          return;
        }
        if (!themePickerMenu.contains(event.target)) closeThemePickerMenu();
      });

      setTheme(document.documentElement.getAttribute('data-theme') || 'neumorphism');
    })();
