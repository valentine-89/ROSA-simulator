(function () {
  var configNode = document.getElementById("biomass-burner-config");
  var cfg = {
    title: "Quản lý lò đốt sinh khối",
    subtitle: "",
    databaseSessionId: "",
    syncId: "",
    pageSize: 50,
    telemetryRefreshMs: 30000,
    expirySoonDays: 30,
    co2KgPerBurnMinute: 2.77
  };

  try {
    cfg = Object.assign(cfg, JSON.parse(configNode && configNode.textContent ? configNode.textContent : "{}"));
  } catch (error) {
    console.error("Invalid biomass burner config", error);
  }

  var params = new URLSearchParams(window.location.search);
  var databaseSessionId = String(params.get("sessionId") || params.get("sessionid") || cfg.databaseSessionId || "").trim();
  var syncId = String(params.get("syncId") || params.get("syncid") || cfg.syncId || "").trim();

  var nodes = {
    title: document.getElementById("bb-title"),
    subtitle: document.getElementById("bb-subtitle"),
    status: document.getElementById("bb-status"),
    refresh: document.getElementById("bb-refresh"),
    addOpen: document.getElementById("bb-add-open"),
    search: document.getElementById("bb-search"),
    filterExpiry: document.getElementById("bb-filter-expiry"),
    pageSize: document.getElementById("bb-page-size"),
    applyFilter: document.getElementById("bb-apply-filter"),
    tableBody: document.getElementById("bb-table-body"),
    empty: document.getElementById("bb-empty"),
    prev: document.getElementById("bb-prev"),
    next: document.getElementById("bb-next"),
    pageInfo: document.getElementById("bb-page-info"),
    kpiTotal: document.getElementById("bb-kpi-total"),
    kpiTotalNote: document.getElementById("bb-kpi-total-note"),
    kpiPurchased: document.getElementById("bb-kpi-purchased"),
    kpiBurned: document.getElementById("bb-kpi-burned"),
    kpiRemaining: document.getElementById("bb-kpi-remaining"),
    kpiExpiring: document.getElementById("bb-kpi-expiring"),
    kpiExpiringNote: document.getElementById("bb-kpi-expiring-note"),
    kpiCo2: document.getElementById("bb-kpi-co2"),
    addModal: document.getElementById("bb-add-modal"),
    addForm: document.getElementById("bb-add-form"),
    addClose: document.getElementById("bb-add-close"),
    addCancel: document.getElementById("bb-add-cancel"),
    settingsModal: document.getElementById("bb-settings-modal"),
    settingsTitle: document.getElementById("bb-settings-title"),
    settingsSubtitle: document.getElementById("bb-settings-subtitle"),
    settingsClose: document.getElementById("bb-settings-close"),
    settingsCode: document.getElementById("bb-settings-code"),
    settingsReadState: document.getElementById("bb-settings-read-state"),
    settingsGrid: document.getElementById("bb-settings-grid"),
    contractForm: document.getElementById("bb-contract-form"),
    deleteBurner: document.getElementById("bb-delete-burner"),
    chartModal: document.getElementById("bb-chart-modal"),
    chartTitle: document.getElementById("bb-chart-title"),
    chartSubtitle: document.getElementById("bb-chart-subtitle"),
    chartClose: document.getElementById("bb-chart-close"),
    chartSvg: document.getElementById("bb-chart-svg"),
    chartEmpty: document.getElementById("bb-chart-empty"),
    toastStack: document.getElementById("bb-toast-stack"),
    themePicker: document.getElementById("theme-picker"),
    themeToggle: document.getElementById("theme-picker-toggle"),
    themeMenu: document.getElementById("theme-picker-menu")
  };

  var state = {
    page: 1,
    pageSize: Math.max(1, Number(cfg.pageSize || 50) || 50),
    totalRows: 0,
    rows: [],
    loading: false,
    telemetryRunId: 0,
    telemetryTimer: null,
    currentBurner: null,
    settingsRows: [],
    settingTelemetry: {},
    searchTimer: null
  };

  nodes.title.textContent = String(cfg.title || nodes.title.textContent || "").trim() || "Quản lý lò đốt sinh khối";
  nodes.subtitle.textContent = String(cfg.subtitle || nodes.subtitle.textContent || "").trim();
  nodes.pageSize.value = String(state.pageSize);
  nodes.kpiExpiringNote.textContent = String(Math.max(1, Number(cfg.expirySoonDays || 30) || 30)) + " ngày tới";

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function numberValue(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatNumber(value, digits) {
    var parsed = numberValue(value);
    if (parsed === null) return "--";
    return parsed.toLocaleString("vi-VN", {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits || 0
    });
  }

  function formatMinutes(value) {
    var parsed = numberValue(value);
    if (parsed === null) return "--";
    return formatNumber(Math.max(0, Math.round(parsed)), 0);
  }

  function formatTemperature(value) {
    var parsed = numberValue(value);
    return parsed === null ? "--" : formatNumber(parsed, 1) + " °C";
  }

  function formatDate(value) {
    var text = String(value || "").trim();
    if (!text) return "--";
    var date = new Date(text + (text.length <= 10 ? "T00:00:00" : ""));
    if (!Number.isFinite(date.getTime())) return text;
    return date.toLocaleDateString("vi-VN");
  }

  function formatDateTime(value) {
    var parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return new Date(parsed).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    }
    var text = String(value || "").trim();
    if (!text) return "--";
    var date = new Date(text);
    return Number.isFinite(date.getTime())
      ? date.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
      : text;
  }

  function normalizeDateInput(value) {
    var text = String(value || "").trim();
    if (!text) return "";
    return text.slice(0, 10);
  }

  function normalizeBurnerCode(value) {
    return String(value || "").trim().replace(/\D+/g, "").slice(0, 6);
  }

  function normalizeSessionId(value) {
    var text = String(value || "").trim();
    if (!text || text === "__ACTIVE_SESSION__") {
      return databaseSessionId;
    }
    return text
      .replace(/<<sessionid>>/gi, databaseSessionId)
      .replace(/<<syncid>>/gi, syncId);
  }

  function parseSessionContext(sessionId) {
    var raw = normalizeSessionId(sessionId);
    var at = raw.indexOf("@");
    if (at <= 0 || at >= raw.length - 1) return null;
    return { ioid: raw.slice(0, at), apikey: raw.slice(at + 1) };
  }

  function buildCommandApiUrl(sessionId) {
    var context = parseSessionContext(sessionId);
    if (!context) return "";
    return "https://iot.ioeasy.com/cmd/" + encodeURIComponent(context.ioid) + "?apiKey=" + encodeURIComponent(context.apikey);
  }

  function buildIoDataUrl() {
    if (!databaseSessionId || !syncId) return "";
    return "/api/" + encodeURIComponent(databaseSessionId) + "/" + encodeURIComponent(syncId) + "/iodata";
  }

  function buildTelemetryUrl(sessionId, fields) {
    var resolvedSession = normalizeSessionId(sessionId);
    if (!resolvedSession || !syncId) return "";
    var query = new URLSearchParams();
    if (fields && fields.length) query.set("fields", fields.join(","));
    return "/api/" + encodeURIComponent(resolvedSession) + "/" + encodeURIComponent(syncId) + "/iotelemetry" + (query.toString() ? "?" + query.toString() : "");
  }

  function buildTimeseriesUrl(sessionId, field, from, to) {
    var resolvedSession = normalizeSessionId(sessionId);
    if (!resolvedSession || !syncId) return "";
    var query = new URLSearchParams();
    query.set("from", String(from));
    query.set("to", String(to));
    query.set("fields", field);
    return "/api/" + encodeURIComponent(resolvedSession) + "/" + encodeURIComponent(syncId) + "/iotimeseries?" + query.toString();
  }

  function setStatus(text, mode) {
    nodes.status.textContent = String(text || "");
    nodes.status.setAttribute("data-state", mode || "loading");
  }

  function toast(message, type) {
    var node = document.createElement("div");
    node.className = "bb-toast" + (type === "error" ? " error" : "");
    node.textContent = String(message || "").trim();
    nodes.toastStack.appendChild(node);
    window.setTimeout(function () {
      node.remove();
    }, 3600);
  }

  function postIoData(payload) {
    var url = buildIoDataUrl();
    if (!url) return Promise.reject(new Error("Thiếu session hoặc SyncID để đọc database."));
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) {
          throw new Error(data && data.error ? data.error : "Không thể đọc database.");
        }
        return Array.isArray(data) ? data : [];
      });
    });
  }

  function getTelemetry(sessionId, fields) {
    var url = buildTelemetryUrl(sessionId, fields);
    if (!url) return Promise.resolve(null);
    return fetch(url, { cache: "no-store" }).then(function (response) {
      if (!response.ok) return null;
      return response.json().then(function (data) {
        return data && data.c2 ? data.c2 : null;
      }).catch(function () {
        return null;
      });
    }).catch(function () {
      return null;
    });
  }

  function resolveCommandTemplate(command) {
    var resolver = window.AIBridgeCommandTemplate;
    var template = String(command == null ? "" : command);
    if (resolver && typeof resolver.resolveCommandTemplate === "function") {
      return resolver.resolveCommandTemplate(template);
    }
    return Promise.resolve(template.replace(/<<email>>/gi, "").replace(/<<username>>/gi, ""));
  }

  function postCommandRaw(sessionId, command) {
    var commandApiUrl = buildCommandApiUrl(sessionId);
    if (!commandApiUrl) return Promise.reject(new Error("Session thiết bị không hợp lệ."));
    return resolveCommandTemplate(command).then(function (resolvedCommand) {
      var controller = new AbortController();
      var timeout = window.setTimeout(function () {
        controller.abort();
      }, 6000);
      return fetch(commandApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: String(resolvedCommand || "") }),
        signal: controller.signal
      }).then(function (response) {
        return response.text().then(function (text) {
          if (!response.ok) throw new Error(text || "Lệnh thiết bị thất bại.");
          return text || "";
        });
      }).finally(function () {
        window.clearTimeout(timeout);
      });
    });
  }

  function summaryPayload() {
    return {
      macro: "biomass-burner-summary",
      soon_days: Math.max(1, Number(cfg.expirySoonDays || 30) || 30),
      co2_kg_per_minute: Number(cfg.co2KgPerBurnMinute || 0) || 0
    };
  }

  function listPayload() {
    return {
      macro: "biomass-burner-list",
      search: nodes.search.value,
      expiry_filter: nodes.filterExpiry.value,
      soon_days: Math.max(1, Number(cfg.expirySoonDays || 30) || 30),
      page_size: state.pageSize,
      offset: (state.page - 1) * state.pageSize
    };
  }

  function renderSummary(row) {
    var data = row || {};
    nodes.kpiTotal.textContent = formatNumber(data.total_burners, 0);
    nodes.kpiTotalNote.textContent = formatNumber(data.active_burners, 0) + " còn hạn";
    nodes.kpiPurchased.textContent = formatMinutes(data.total_purchased_minutes);
    nodes.kpiBurned.textContent = formatMinutes(data.total_burned_minutes);
    nodes.kpiRemaining.textContent = formatMinutes(data.total_remaining_minutes);
    nodes.kpiExpiring.textContent = formatNumber(data.expiring_soon_burners, 0);
    nodes.kpiCo2.textContent = formatNumber(data.co2_kg_saved, 0);
  }

  function getRowState(row, isOn) {
    if (Number(row && row.is_expired || 0)) return "expired";
    if (Number(row && row.remaining_minutes || 0) <= 0) return "out-of-minutes";
    if (isOn) return "on";
    return "default";
  }

  function renderTable() {
    var rows = state.rows || [];
    nodes.empty.hidden = rows.length > 0;
    nodes.tableBody.innerHTML = rows.map(function (row) {
      var remaining = Math.max(0, Number(row.remaining_minutes || 0));
      var leaseClass = Number(row.is_expired || 0) ? "bb-live-chip" : "bb-small-chip";
      var leaseState = Number(row.is_expired || 0) ? "off" : "unknown";
      var rowState = getRowState(row, false);
      return ""
        + "<tr data-burner-code=\"" + esc(row.burner_code) + "\" data-row-state=\"" + esc(rowState) + "\">"
        + "<td><span class=\"bb-code\">" + esc(row.burner_code) + "</span></td>"
        + "<td><div class=\"bb-strong\">" + esc(row.display_name || row.burner_code) + "</div><div class=\"bb-muted\">" + esc([row.customer_name, row.site_name].filter(Boolean).join(" / ") || "Chưa có vị trí") + "</div></td>"
        + "<td><span class=\"" + leaseClass + "\" data-state=\"" + leaseState + "\">" + esc(formatDate(row.lease_expires_at)) + "</span></td>"
        + "<td>" + esc(formatMinutes(row.purchased_minutes)) + "</td>"
        + "<td>" + esc(formatMinutes(row.burned_minutes_current)) + "</td>"
        + "<td>" + esc(formatMinutes(remaining)) + "</td>"
        + "<td data-role=\"temp-cell\">--</td>"
        + "<td><span class=\"bb-live-chip\" data-state=\"unknown\" data-role=\"status-cell\">--</span></td>"
        + "<td data-role=\"updated-cell\">" + esc(formatDateTime(row.updated_at)) + "</td>"
        + "<td><span class=\"bb-actions\">"
        + "<button class=\"bb-icon-btn\" type=\"button\" title=\"Nhiệt độ\" data-action=\"chart\" data-code=\"" + esc(row.burner_code) + "\">⌁</button>"
        + "<button class=\"bb-icon-btn\" type=\"button\" title=\"Cài đặt\" data-action=\"settings\" data-code=\"" + esc(row.burner_code) + "\">⚙</button>"
        + "</span></td>"
        + "</tr>";
    }).join("");

    var totalPages = Math.max(1, Math.ceil(state.totalRows / state.pageSize));
    nodes.pageInfo.textContent = "Trang " + state.page + " / " + totalPages;
    nodes.prev.disabled = state.page <= 1;
    nodes.next.disabled = state.page >= totalPages;
  }

  function findRow(code) {
    return (state.rows || []).find(function (row) {
      return String(row.burner_code) === String(code);
    }) || null;
  }

  function setRowTelemetry(row, latest) {
    var tr = nodes.tableBody.querySelector("tr[data-burner-code=\"" + CSS.escape(String(row.burner_code)) + "\"]");
    if (!tr) return;
    var payload = latest && latest.payload ? latest.payload : {};
    var tempField = String(row.temperature_field || "temperature");
    var statusField = String(row.status_field || "status");
    var tempCell = tr.querySelector("[data-role='temp-cell']");
    var statusCell = tr.querySelector("[data-role='status-cell']");
    var updatedCell = tr.querySelector("[data-role='updated-cell']");
    var tempValue = payload[tempField];
    var statusValue = payload[statusField];

    if (tempCell) tempCell.textContent = tempValue == null ? "--" : formatTemperature(tempValue);
    if (statusCell) {
      var normalized = String(statusValue == null ? "" : statusValue).trim().toLowerCase();
      var on = statusValue === true || Number(statusValue) > 0 || ["on", "true", "yes", "bat", "bật", "1"].indexOf(normalized) >= 0;
      var off = statusValue === false || normalized === "off" || normalized === "false" || normalized === "0" || normalized === "tat" || normalized === "tắt";
      statusCell.textContent = on ? "ON" : off ? "OFF" : "--";
      statusCell.setAttribute("data-state", on ? "on" : off ? "off" : "unknown");
      tr.setAttribute("data-row-state", getRowState(row, on));
    }
    if (updatedCell && latest && latest.serverTime) updatedCell.textContent = formatDateTime(latest.serverTime);
  }

  function hydrateVisibleTelemetry() {
    var runId = ++state.telemetryRunId;
    var rows = (state.rows || []).slice();
    var index = 0;
    var workerCount = Math.min(4, rows.length);

    function next() {
      if (runId !== state.telemetryRunId) return Promise.resolve();
      var row = rows[index];
      index += 1;
      if (!row) return Promise.resolve();
      var fields = Array.from(new Set([row.temperature_field || "temperature", row.status_field || "status"].filter(Boolean)));
      return getTelemetry(row.session_id, fields).then(function (latest) {
        if (runId === state.telemetryRunId) setRowTelemetry(row, latest);
      }).then(next);
    }

    var workers = [];
    for (var i = 0; i < workerCount; i += 1) workers.push(next());
    return Promise.all(workers);
  }

  function loadDashboard() {
    if (state.loading) return;
    state.loading = true;
    setStatus("Đang tải", "loading");

    Promise.all([
      postIoData(summaryPayload()),
      postIoData(listPayload())
    ]).then(function (results) {
      var summaryRows = results[0] || [];
      var listRows = results[1] || [];
      state.rows = listRows;
      state.totalRows = Number(listRows[0] && listRows[0].total_rows || 0);
      if (!state.totalRows && listRows.length) state.totalRows = listRows.length;
      renderSummary(summaryRows[0] || {});
      renderTable();
      setStatus("Sẵn sàng", "ready");
      hydrateVisibleTelemetry();
    }).catch(function (error) {
      setStatus("Lỗi", "error");
      toast(error && error.message ? error.message : "Không thể tải dữ liệu.", "error");
    }).finally(function () {
      state.loading = false;
    });
  }

  function openModal(modal) {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeModal(modal) {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  function formToPayload(form) {
    var formData = new FormData(form);
    var payload = {};
    formData.forEach(function (value, key) {
      payload[key] = String(value == null ? "" : value).trim();
    });
    return payload;
  }

  function openAddModal() {
    nodes.addForm.reset();
    nodes.addForm.elements.session_id.value = databaseSessionId;
    nodes.addForm.elements.status_field.value = "status";
    nodes.addForm.elements.temperature_field.value = "temperature";
    nodes.addForm.elements.purchased_minutes.value = "0";
    nodes.addForm.elements.burned_minutes_current.value = "0";
    openModal(nodes.addModal);
    window.setTimeout(function () {
      nodes.addForm.elements.burner_code.focus();
    }, 0);
  }

  function submitAdd(event) {
    event.preventDefault();
    var payload = formToPayload(nodes.addForm);
    payload.macro = "biomass-burner-create";
    payload.burner_code = normalizeBurnerCode(payload.burner_code);
    postIoData(payload).then(function () {
      toast("Đã thêm lò " + payload.burner_code + ".");
      closeModal(nodes.addModal);
      state.page = 1;
      loadDashboard();
    }).catch(function (error) {
      toast(error.message || "Không thể thêm lò.", "error");
    });
  }

  function fillContractForm(row) {
    var form = nodes.contractForm;
    form.elements.display_name.value = row.display_name || "";
    form.elements.customer_name.value = row.customer_name || "";
    form.elements.site_name.value = row.site_name || "";
    form.elements.lease_expires_at.value = normalizeDateInput(row.lease_expires_at);
    form.elements.purchased_minutes.value = row.purchased_minutes || 0;
    form.elements.burned_minutes_current.value = row.burned_minutes_current || 0;
    form.elements.status_field.value = row.status_field || "status";
    form.elements.temperature_field.value = row.temperature_field || "temperature";
    form.elements.notes.value = row.notes || "";
  }

  function renderSettingsGrid(rows, telemetry) {
    state.settingsRows = rows || [];
    state.settingTelemetry = telemetry || {};
    if (!state.settingsRows.length) {
      nodes.settingsGrid.innerHTML = "<div class=\"bb-empty\">Chưa có mapping tham số cho profile này.</div>";
      return;
    }

    nodes.settingsGrid.innerHTML = state.settingsRows.map(function (setting, index) {
      var field = String(setting.telemetry_field || "");
      var value = state.settingTelemetry[field];
      var hasValue = value !== undefined && value !== null && value !== "";
      var numeric = hasValue && Number.isFinite(Number(value)) ? Number(value) : "";
      var min = setting.min_value == null || setting.min_value === "" ? 0 : Number(setting.min_value);
      var max = setting.max_value == null || setting.max_value === "" ? 100 : Number(setting.max_value);
      var step = setting.step_value == null || setting.step_value === "" ? 1 : Number(setting.step_value);
      var inputValue = numeric === "" ? "" : String(numeric);
      var rangeValue = numeric === "" ? String((Number(min) + Number(max)) / 2) : String(numeric);
      return ""
        + "<article class=\"bb-setting-card\" data-setting-index=\"" + index + "\">"
        + "<div class=\"bb-setting-head\"><div><strong>" + esc(setting.label || field) + "</strong><div><code>" + esc(field) + "</code></div></div><span class=\"bb-small-chip\">" + esc(setting.unit || "") + "</span></div>"
        + "<div class=\"bb-setting-value\" data-role=\"setting-value\">" + esc(hasValue ? formatNumber(value, Number(step) < 1 ? 1 : 0) + (setting.unit ? " " + setting.unit : "") : "N/A") + "</div>"
        + "<div class=\"bb-setting-control\">"
        + "<input class=\"bb-range\" type=\"range\" min=\"" + esc(min) + "\" max=\"" + esc(max) + "\" step=\"" + esc(step) + "\" value=\"" + esc(rangeValue) + "\" data-role=\"setting-range\" />"
        + "<input class=\"bb-input\" type=\"number\" min=\"" + esc(min) + "\" max=\"" + esc(max) + "\" step=\"" + esc(step) + "\" value=\"" + esc(inputValue) + "\" placeholder=\"N/A\" data-role=\"setting-input\" />"
        + "<button class=\"bb-btn bb-btn-primary\" type=\"button\" data-role=\"setting-save\">Lưu</button>"
        + "</div>"
        + "</article>";
    }).join("");
  }

  function openSettings(code) {
    var row = findRow(code);
    if (!row) return;
    state.currentBurner = row;
    nodes.settingsTitle.textContent = "Cài đặt lò " + row.burner_code;
    nodes.settingsSubtitle.textContent = row.display_name || row.site_name || "Đang tải tham số hiện tại từ thiết bị.";
    nodes.settingsCode.textContent = row.burner_code;
    nodes.settingsReadState.textContent = "Đang đọc";
    nodes.settingsGrid.innerHTML = "<div class=\"bb-empty\">Đang tải tham số...</div>";
    fillContractForm(row);
    openModal(nodes.settingsModal);

    Promise.all([
      postIoData({ macro: "biomass-burner-detail", burner_code: code }),
      postIoData({ macro: "biomass-burner-settings", burner_code: code })
    ]).then(function (results) {
      var detail = results[0] && results[0][0] ? results[0][0] : row;
      var settings = results[1] || [];
      state.currentBurner = detail;
      fillContractForm(detail);
      nodes.settingsSubtitle.textContent = normalizeSessionId(detail.session_id).split("@")[0] || "Thiết bị";
      renderSettingsGrid(settings, {});
      var fields = settings.map(function (item) { return String(item.telemetry_field || "").trim(); }).filter(Boolean);
      if (!fields.length) {
        nodes.settingsReadState.textContent = "Không có field";
        return null;
      }
      return getTelemetry(detail.session_id, fields).then(function (latest) {
        var payload = latest && latest.payload ? latest.payload : {};
        nodes.settingsReadState.textContent = latest ? "Đã đọc 1 lần" : "Không có telemetry";
        renderSettingsGrid(settings, payload);
      });
    }).catch(function (error) {
      nodes.settingsReadState.textContent = "Lỗi";
      nodes.settingsGrid.innerHTML = "<div class=\"bb-empty\">" + esc(error.message || "Không thể tải cài đặt.") + "</div>";
    });
  }

  function submitContract(event) {
    event.preventDefault();
    if (!state.currentBurner) return;
    var payload = formToPayload(nodes.contractForm);
    payload.macro = "biomass-burner-update-contract";
    payload.burner_code = state.currentBurner.burner_code;
    postIoData(payload).then(function () {
      toast("Đã lưu thông tin lò " + state.currentBurner.burner_code + ".");
      closeModal(nodes.settingsModal);
      loadDashboard();
    }).catch(function (error) {
      toast(error.message || "Không thể lưu thông tin.", "error");
    });
  }

  function saveSetting(card) {
    if (!state.currentBurner) return;
    var index = Number(card.getAttribute("data-setting-index"));
    var setting = state.settingsRows[index];
    if (!setting) return;
    var input = card.querySelector("[data-role='setting-input']");
    var value = String(input && input.value || "").trim();
    if (!value) {
      toast("Hãy nhập giá trị cho " + (setting.label || setting.telemetry_field) + ".", "error");
      return;
    }
    var command = String(setting.command_template || (setting.telemetry_field + "={value}")).replace(/\{value\}/g, value);
    var button = card.querySelector("[data-role='setting-save']");
    button.disabled = true;
    postCommandRaw(state.currentBurner.session_id, command).then(function () {
      toast("Đã gửi " + command + ".");
      var valueNode = card.querySelector("[data-role='setting-value']");
      if (valueNode) valueNode.textContent = formatNumber(value, Number(setting.step_value || 1) < 1 ? 1 : 0) + (setting.unit ? " " + setting.unit : "");
    }).catch(function (error) {
      toast(error.message || "Không thể gửi lệnh thiết bị.", "error");
    }).finally(function () {
      button.disabled = false;
    });
  }

  function deleteCurrentBurner() {
    if (!state.currentBurner) return;
    var code = state.currentBurner.burner_code;
    var confirmed = window.confirm("Xóa lò " + code + " khỏi danh sách quản lý?");
    if (!confirmed) return;
    postIoData({ macro: "biomass-burner-delete", burner_code: code }).then(function () {
      toast("Đã xóa lò " + code + ".");
      closeModal(nodes.settingsModal);
      loadDashboard();
    }).catch(function (error) {
      toast(error.message || "Không thể xóa lò.", "error");
    });
  }

  function openChart(code) {
    var row = findRow(code);
    if (!row) return;
    nodes.chartTitle.textContent = "Nhiệt độ lò " + row.burner_code;
    nodes.chartSubtitle.textContent = row.display_name || "5 giờ gần nhất";
    nodes.chartSvg.innerHTML = "";
    nodes.chartEmpty.hidden = false;
    nodes.chartEmpty.textContent = "Đang tải dữ liệu";
    openModal(nodes.chartModal);
    var to = Date.now();
    var from = to - 5 * 60 * 60 * 1000;
    var field = row.temperature_field || "temperature";
    var url = buildTimeseriesUrl(row.session_id, field, from, to);
    if (!url) {
      nodes.chartEmpty.textContent = "Thiếu session thiết bị";
      return;
    }
    fetch(url, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("Không thể đọc timeseries.");
      return response.json();
    }).then(function (data) {
      var rows = data && data.c2 && Array.isArray(data.c2.rows) ? data.c2.rows : [];
      var points = rows.map(function (item) {
        var value = item.value != null ? item.value : item.last;
        return {
          ts: Number(item.ts || 0),
          value: Number(value)
        };
      }).filter(function (item) {
        return Number.isFinite(item.ts) && Number.isFinite(item.value);
      });
      drawChart(points);
    }).catch(function (error) {
      nodes.chartEmpty.hidden = false;
      nodes.chartEmpty.textContent = error.message || "Không có dữ liệu nhiệt độ";
    });
  }

  function drawChart(points) {
    var svg = nodes.chartSvg;
    var width = 920;
    var height = 360;
    var left = 50;
    var right = 20;
    var top = 24;
    var bottom = 42;
    var plotW = width - left - right;
    var plotH = height - top - bottom;
    if (!points.length) {
      svg.innerHTML = "";
      nodes.chartEmpty.hidden = false;
      nodes.chartEmpty.textContent = "Chưa có dữ liệu nhiệt độ";
      return;
    }
    nodes.chartEmpty.hidden = true;
    points.sort(function (a, b) { return a.ts - b.ts; });
    var minTs = points[0].ts;
    var maxTs = points[points.length - 1].ts;
    if (maxTs <= minTs) maxTs = minTs + 1;
    var minValue = Math.min.apply(null, points.map(function (p) { return p.value; }));
    var maxValue = Math.max.apply(null, points.map(function (p) { return p.value; }));
    if (maxValue <= minValue) {
      maxValue += 5;
      minValue -= 5;
    }
    var pad = Math.max(2, (maxValue - minValue) * 0.12);
    minValue -= pad;
    maxValue += pad;
    function x(ts) { return left + ((ts - minTs) / (maxTs - minTs)) * plotW; }
    function y(value) { return top + (1 - ((value - minValue) / (maxValue - minValue))) * plotH; }
    var line = points.map(function (p) { return x(p.ts).toFixed(1) + "," + y(p.value).toFixed(1); }).join(" ");
    var area = left + "," + (top + plotH) + " " + line + " " + (left + plotW) + "," + (top + plotH);
    var parts = [];
    for (var i = 0; i <= 4; i += 1) {
      var gy = top + (plotH / 4) * i;
      var value = maxValue - ((maxValue - minValue) / 4) * i;
      parts.push("<line class=\"bb-chart-grid\" x1=\"" + left + "\" y1=\"" + gy + "\" x2=\"" + (left + plotW) + "\" y2=\"" + gy + "\" />");
      parts.push("<text class=\"bb-chart-label\" x=\"8\" y=\"" + (gy + 4) + "\">" + esc(formatNumber(value, 1)) + "</text>");
    }
    for (var j = 0; j <= 4; j += 1) {
      var gx = left + (plotW / 4) * j;
      var ts = minTs + ((maxTs - minTs) / 4) * j;
      parts.push("<line class=\"bb-chart-grid\" x1=\"" + gx + "\" y1=\"" + top + "\" x2=\"" + gx + "\" y2=\"" + (top + plotH) + "\" />");
      parts.push("<text class=\"bb-chart-label\" x=\"" + (gx - 26) + "\" y=\"" + (height - 14) + "\">" + esc(new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })) + "</text>");
    }
    parts.push("<line class=\"bb-chart-axis\" x1=\"" + left + "\" y1=\"" + (top + plotH) + "\" x2=\"" + (left + plotW) + "\" y2=\"" + (top + plotH) + "\" />");
    parts.push("<polygon class=\"bb-chart-area\" points=\"" + area + "\" />");
    parts.push("<polyline class=\"bb-chart-line\" points=\"" + line + "\" />");
    svg.innerHTML = parts.join("");
  }

  function applyFilter() {
    state.pageSize = Math.max(1, Number(nodes.pageSize.value || 50) || 50);
    state.page = 1;
    loadDashboard();
  }

  nodes.refresh.addEventListener("click", loadDashboard);
  nodes.applyFilter.addEventListener("click", applyFilter);
  nodes.pageSize.addEventListener("change", applyFilter);
  nodes.filterExpiry.addEventListener("change", applyFilter);
  nodes.search.addEventListener("input", function () {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(applyFilter, 300);
  });
  nodes.prev.addEventListener("click", function () {
    if (state.page > 1) {
      state.page -= 1;
      loadDashboard();
    }
  });
  nodes.next.addEventListener("click", function () {
    var totalPages = Math.max(1, Math.ceil(state.totalRows / state.pageSize));
    if (state.page < totalPages) {
      state.page += 1;
      loadDashboard();
    }
  });

  nodes.tableBody.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-action]");
    if (!button) return;
    var code = button.getAttribute("data-code");
    if (button.getAttribute("data-action") === "settings") openSettings(code);
    if (button.getAttribute("data-action") === "chart") openChart(code);
  });

  nodes.addOpen.addEventListener("click", openAddModal);
  nodes.addClose.addEventListener("click", function () { closeModal(nodes.addModal); });
  nodes.addCancel.addEventListener("click", function () { closeModal(nodes.addModal); });
  nodes.addForm.addEventListener("submit", submitAdd);
  nodes.settingsClose.addEventListener("click", function () { closeModal(nodes.settingsModal); });
  nodes.contractForm.addEventListener("submit", submitContract);
  nodes.deleteBurner.addEventListener("click", deleteCurrentBurner);
  nodes.chartClose.addEventListener("click", function () { closeModal(nodes.chartModal); });

  nodes.settingsGrid.addEventListener("input", function (event) {
    var card = event.target.closest(".bb-setting-card");
    if (!card) return;
    var range = card.querySelector("[data-role='setting-range']");
    var input = card.querySelector("[data-role='setting-input']");
    if (event.target === range && input) input.value = range.value;
    if (event.target === input && range && input.value !== "") range.value = input.value;
  });

  nodes.settingsGrid.addEventListener("click", function (event) {
    var button = event.target.closest("[data-role='setting-save']");
    if (!button) return;
    var card = button.closest(".bb-setting-card");
    if (card) saveSetting(card);
  });

  [nodes.addModal, nodes.settingsModal, nodes.chartModal].forEach(function (modal) {
    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeModal(modal);
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    [nodes.addModal, nodes.settingsModal, nodes.chartModal].forEach(function (modal) {
      if (modal.classList.contains("is-open")) closeModal(modal);
    });
  });

  if (nodes.themeToggle && nodes.themePicker) {
    nodes.themeToggle.addEventListener("click", function () {
      var isOpen = nodes.themePicker.classList.toggle("is-open");
      nodes.themeToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
    nodes.themeMenu.addEventListener("click", function (event) {
      var button = event.target.closest("[data-theme-option]");
      if (!button) return;
      var theme = button.getAttribute("data-theme-option");
      document.documentElement.setAttribute("data-theme", theme);
      try { window.localStorage.setItem("sample-dashboard-theme", theme); } catch (error) {}
      nodes.themePicker.classList.remove("is-open");
      nodes.themeToggle.setAttribute("aria-expanded", "false");
    });
  }

  loadDashboard();
  var refreshMs = Math.max(10000, Number(cfg.telemetryRefreshMs || 30000) || 30000);
  state.telemetryTimer = window.setInterval(function () {
    loadDashboard();
  }, refreshMs);
})();
