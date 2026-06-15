(function () {
  "use strict";

  var configNode = document.getElementById("locker-manager-config");
  var cfg = {
    mode: "admin",
    title: "Quản lý tủ locker",
    subtitle: "",
    eyebrow: "ROSA Locker Manager",
    databaseSessionId: "",
    syncId: "",
    stateMacro: "locker-admin-state",
    eventMacro: "locker-event-list",
    adminStatusMacro: "locker-admin-set-status",
    adminAuditMacro: "locker-admin-audit-action",
    userSearchMacro: "locker-admin-user-search",
    userDetailMacro: "locker-admin-user-detail",
    topupMacro: "locker-admin-topup-user",
    refundMacro: "locker-admin-refund-transaction",
    saveRateMacro: "locker-admin-save-rate",
    deleteRateMacro: "locker-admin-delete-rate",
    setUserTierMacro: "locker-admin-set-user-tier",
    configStateMacro: "locker-admin-config-state",
    saveSiteConfigMacro: "locker-admin-save-site-config",
    applyCabinetConfigMacro: "locker-admin-apply-cabinet-config",
    openCommandId: "locker-open-auto",
    eventPageSize: 80,
    userPageSize: 50,
    monitorPrivacy: "maskedPhone",
    kioskMode: false,
    initialSetup: { site: {}, defaults: {}, cabinets: [], rates: [] },
    stream: { enabled: true, cooldownMs: 5000 }
  };

  try {
    cfg = Object.assign(cfg, JSON.parse(configNode && configNode.textContent ? configNode.textContent : "{}"));
  } catch (error) {
    console.error("Invalid locker manager config", error);
  }

  function readJsonScript(id) {
    var node = document.getElementById(id);
    if (!node || !node.textContent) return {};
    try {
      var parsed = JSON.parse(node.textContent);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  var pageContext = readJsonScript("rosa-iot-page-context");
  var params = new URLSearchParams(window.location.search);
  var syncId = normalizeSyncId(params.get("syncId") || params.get("syncid") || cfg.syncId || "");
  var databaseSessionId = normalizeSessionId(params.get("sessionId") || params.get("sessionid") || cfg.databaseSessionId || cfg.sessionId || "");
  var publicIoid = String(pageContext.ioid || "").trim();
  var publicPageId = String(pageContext.pageId || "").trim();
  var mode = String(cfg.mode || "admin").trim().toLowerCase() === "monitor" ? "monitor" : "admin";
  var canAdmin = mode === "admin";
  var monitorPrivacy = normalizeMonitorPrivacy(cfg.monitorPrivacy);
  var kioskMode = Boolean(cfg.kioskMode);
  var selectedLocker = null;
  var selectedCabinet = null;
  var stateRequestId = 0;
  var eventSource = null;
  var reconnectTimer = null;
  var refreshCooldownTimer = null;
  var refreshQueued = false;
  var refreshCooldownActive = false;
  var currentState = createEmptyState();
  var userSearchState = { query: "", offset: 0, limit: Number(cfg.userPageSize || 50) || 50, lastCount: 0 };
  var logState = {
    dataset: "events",
    offset: 0,
    limit: Number(cfg.eventPageSize || 80) || 80,
    lastCount: 0,
    totalCount: null,
    filters: {}
  };
  var selectedUserPhone = "";
  var selectedUserDetail = null;
  var configDrafts = normalizeConfigDrafts(cfg.initialSetup && cfg.initialSetup.cabinets || []);
  var siteDraft = normalizeSiteDraft(cfg.initialSetup && cfg.initialSetup.site || {});
  var setupRateDrafts = normalizeRateDrafts(cfg.initialSetup && cfg.initialSetup.rates || []);
  var unsavedRateDrafts = [];
  var rateEditCache = [];

  var nodes = {
    root: document.getElementById("locker-root"),
    eyebrow: document.getElementById("locker-eyebrow"),
    title: document.getElementById("locker-title"),
    subtitle: document.getElementById("locker-subtitle"),
    refresh: document.getElementById("locker-refresh"),
    live: document.getElementById("locker-live"),
    kpis: document.getElementById("locker-kpis"),
    cabinets: document.getElementById("locker-cabinet-list"),
    eventBody: document.getElementById("locker-event-body"),
    logCount: document.getElementById("locker-log-count"),
    logDataset: document.getElementById("locker-log-dataset"),
    logCabinet: document.getElementById("locker-log-cabinet"),
    logLocker: document.getElementById("locker-log-locker"),
    logPhone: document.getElementById("locker-log-phone"),
    logEventType: document.getElementById("locker-log-event-type"),
    logStatus: document.getElementById("locker-log-status"),
    logFrom: document.getElementById("locker-log-from"),
    logTo: document.getElementById("locker-log-to"),
    logApply: document.getElementById("locker-log-apply"),
    logReset: document.getElementById("locker-log-reset"),
    logLoadMore: document.getElementById("locker-log-load-more"),
    logExport: document.getElementById("locker-log-export"),
    users: document.getElementById("locker-users"),
    userCount: document.getElementById("locker-user-count"),
    rates: document.getElementById("locker-rates"),
    notes: document.getElementById("locker-notes"),
    userSearch: document.getElementById("locker-user-search"),
    userSearchButton: document.getElementById("locker-user-search-button"),
    userLoadMore: document.getElementById("locker-user-load-more"),
    userTopupNew: document.getElementById("locker-user-topup-new"),
    userDetail: document.getElementById("locker-user-detail"),
    rateLoadSetup: document.getElementById("locker-rate-load-setup"),
    rateAdd: document.getElementById("locker-rate-add"),
    incidentPanel: document.getElementById("locker-incident-panel"),
    incidentState: document.getElementById("locker-incident-state"),
    detailGrid: document.getElementById("locker-detail-grid"),
    actionOpen: document.getElementById("locker-action-open"),
    statusSelect: document.getElementById("locker-status-select"),
    statusPhone: document.getElementById("locker-status-phone"),
    statusNote: document.getElementById("locker-status-note"),
    statusApply: document.getElementById("locker-status-apply"),
    commandPreview: document.getElementById("locker-command-preview"),
    topupModal: document.getElementById("locker-topup-modal"),
    topupForm: document.getElementById("locker-topup-form"),
    topupClose: document.getElementById("locker-topup-close"),
    topupPhone: document.getElementById("locker-topup-phone"),
    topupAmount: document.getElementById("locker-topup-amount"),
    topupName: document.getElementById("locker-topup-name"),
    topupEmail: document.getElementById("locker-topup-email"),
    topupNote: document.getElementById("locker-topup-note"),
    topupSubmit: document.getElementById("locker-topup-submit"),
    topupPreview: document.getElementById("locker-topup-preview"),
    configPanel: document.getElementById("locker-config-panel"),
    configLoadDb: document.getElementById("locker-config-load-db"),
    configLoadDraft: document.getElementById("locker-config-load-draft"),
    configImport: document.getElementById("locker-config-import"),
    configExport: document.getElementById("locker-config-export"),
    configImportFile: document.getElementById("locker-config-import-file"),
    configAddCabinet: document.getElementById("locker-config-add-cabinet"),
    configSiteName: document.getElementById("locker-config-site-name"),
    configSiteAddress: document.getElementById("locker-config-site-address"),
    configTopupQr: document.getElementById("locker-config-topup-qr"),
    configTopupNote: document.getElementById("locker-config-topup-note"),
    configSaveSite: document.getElementById("locker-config-save-site"),
    configList: document.getElementById("locker-config-list"),
    configPreview: document.getElementById("locker-config-preview"),
    configApply: document.getElementById("locker-config-apply"),
    toastStack: document.getElementById("locker-toast-stack"),
    themeToggle: document.getElementById("theme-picker-toggle"),
    themeMenu: document.getElementById("theme-picker-menu")
  };

  setText(nodes.eyebrow, cfg.eyebrow || "");
  setText(nodes.title, cfg.title || "");
  setText(nodes.subtitle, cfg.subtitle || "");
  if (nodes.root) {
    nodes.root.classList.toggle("locker-kiosk", kioskMode);
    nodes.root.classList.toggle("locker-summary-only", !canAdmin && monitorPrivacy === "summaryOnly");
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setText(node, value) {
    if (node) node.textContent = String(value == null ? "" : value);
  }

  function normalizeSessionId(value) {
    var text = String(value || "").trim();
    if (text === "<<sessionid>>") return "";
    return text.replace(/<<syncid>>/gi, syncId);
  }

  function normalizeSyncId(value) {
    var text = String(value || "").trim();
    return text === "<<syncid>>" ? "" : text;
  }

  function extractIoid(sessionId) {
    var text = String(sessionId || "").trim();
    var at = text.indexOf("@");
    return at > 0 ? text.slice(0, at) : text;
  }

  function resolveIoid(value) {
    var text = String(value || "").trim();
    if (!text || text === "<<ioid>>") return extractIoid(databaseSessionId) || text || "<<ioid>>";
    return text;
  }

  function createEmptyState() {
    return {
      site: {},
      cabinets: [],
      lockers: [],
      events: [],
      users: [],
      rates: [],
      notes: []
    };
  }

  function clampInt(value, fallback, min, max) {
    var parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) parsed = fallback;
    parsed = Math.max(Number(min || 0), parsed);
    if (Number.isFinite(Number(max))) parsed = Math.min(Number(max), parsed);
    return parsed;
  }

  function letterFor(index) {
    if (index < 26) return String.fromCharCode(65 + index);
    return String(index + 1).padStart(2, "0");
  }

  function normalizeConfigCabinet(raw, index) {
    raw = raw || {};
    var fallbackId = "CAB-" + letterFor(index);
    var cabinetId = String(raw.cabinet_id || raw.cabinetId || fallbackId).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 24) || fallbackId;
    var prefix = String(raw.locker_prefix || raw.lockerPrefix || cabinetId.replace(/^CAB-/, "")).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 12) || cabinetId.replace(/^CAB-/, "");
    var pageId = String(raw.page_id || raw.pageId || ("locker-open-" + cabinetId.toLowerCase().replace(/[^a-z0-9_-]/g, "-"))).trim().toLowerCase().replace(/[^a-z0-9._:-]/g, "-").slice(0, 128);
    return {
      cabinet_id: cabinetId,
      label: String(raw.label || ("Tủ " + cabinetId)).trim(),
      location: String(raw.location || "").trim(),
      ioid: resolveIoid(raw.ioid),
      page_id: pageId,
      locker_count: clampInt(raw.locker_count || raw.lockerCount, 30, 1, 200),
      locker_prefix: prefix,
      hardware_pattern: String(raw.hardware_pattern || raw.hardwarePattern || "{cabinet}-{slot3}").trim() || "{cabinet}-{slot3}",
      sort_order: clampInt(raw.sort_order || raw.sortOrder, index + 1, 0, 999),
      enabled: raw.enabled === false || Number(raw.enabled) === 0 ? false : true
    };
  }

  function normalizeConfigDrafts(list) {
    return (Array.isArray(list) ? list : []).map(normalizeConfigCabinet);
  }

  function normalizeSiteDraft(raw) {
    raw = raw || {};
    return {
      name: String(raw.name || "").trim(),
      address: String(raw.address || "").trim(),
      topup_note: String(raw.topup_note || raw.topupNote || "").trim(),
      topup_qr_url: String(raw.topup_qr_url || raw.topupQrUrl || "").trim()
    };
  }

  function normalizeRateTier(value, fallback) {
    var text = String(value == null ? "" : value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    text = text.replace(/^-+|-+$/g, "");
    var defaultTier = fallback == null ? "guest" : String(fallback);
    return (text || defaultTier).slice(0, 32);
  }

  function normalizeMonitorPrivacy(value) {
    var text = String(value || "maskedPhone").trim();
    return ["stateOnly", "maskedPhone", "hiddenPhone", "summaryOnly"].indexOf(text) >= 0 ? text : "maskedPhone";
  }

  function shouldHidePhone() {
    return !canAdmin && ["stateOnly", "hiddenPhone", "summaryOnly"].indexOf(monitorPrivacy) >= 0;
  }

  function shouldHideLogDetails() {
    return !canAdmin && ["stateOnly", "summaryOnly"].indexOf(monitorPrivacy) >= 0;
  }

  function normalizeRate(raw, index) {
    raw = raw || {};
    var tier = normalizeRateTier(raw.tier, index === 0 ? "guest" : "member");
    var fee = Number(raw.open_fee == null ? raw.openFee : raw.open_fee);
    if (!Number.isFinite(fee) || fee < 0) fee = 0;
    return {
      tier: tier,
      open_fee: fee,
      note: String(raw.note || "").trim()
    };
  }

  function normalizeRateDrafts(list) {
    var seen = {};
    return (Array.isArray(list) ? list : []).map(normalizeRate).filter(function (rate) {
      if (!rate.tier || seen[rate.tier]) return false;
      seen[rate.tier] = true;
      return true;
    });
  }

  function buildIoDataUrl() {
    if (databaseSessionId && syncId) {
      return "/api/" + encodeURIComponent(databaseSessionId) + "/" + encodeURIComponent(syncId) + "/iodata";
    }
    if (publicIoid && publicPageId) {
      return "/api/iot-page-macro/" + encodeURIComponent(publicIoid) + "/" + encodeURIComponent(publicPageId);
    }
    return "";
  }

  function buildPublicMacroBody(payload) {
    var body = { macro: payload && payload.macro ? String(payload.macro) : "", params: {} };
    Object.keys(payload || {}).forEach(function (key) {
      if (key === "macro") return;
      body.params[key] = payload[key];
    });
    return body;
  }

  function buildMacroRequestBody(payload) {
    if (databaseSessionId && syncId) return payload || {};
    return buildPublicMacroBody(payload || {});
  }

  function buildStreamUrl() {
    if (databaseSessionId) {
      return "/api/" + encodeURIComponent(databaseSessionId) + "/stream?historyMs=0";
    }
    if (publicIoid && publicPageId) {
      return "/api/iot-page-stream/" + encodeURIComponent(publicIoid) + "/" + encodeURIComponent(publicPageId);
    }
    return "";
  }

  function postIoData(payload) {
    var url = buildIoDataUrl();
    if (!url) return Promise.reject(new Error("Thiếu cấu hình đọc database."));
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildMacroRequestBody(payload))
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (data) {
        if (!response.ok) {
          throw new Error(data && data.error ? data.error : "Không thể đọc database.");
        }
        if (Array.isArray(data)) return data;
        return data && Array.isArray(data.rows) ? data.rows : [];
      });
    });
  }

  function formatNumber(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toLocaleString("vi-VN") : "0";
  }

  function formatMoney(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) parsed = 0;
    return parsed.toLocaleString("vi-VN", { maximumFractionDigits: 2 });
  }

  function formatTime(value) {
    var numeric = Number(value);
    var date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(String(value || ""));
    if (!Number.isFinite(date.getTime())) return String(value || "--");
    return date.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  }

  function normalizeState(value) {
    var text = String(value || "").trim().toLowerCase();
    if (text.indexOf("opening") === 0) return "opening";
    if (["free", "occupied", "disabled", "error"].indexOf(text) >= 0) return text;
    return text || "free";
  }

  function stateLabel(value) {
    var state = normalizeState(value);
    if (state === "free") return "Trống";
    if (state === "occupied") return "Đang dùng";
    if (state === "opening") return "Đang mở";
    if (state === "disabled") return "Tắt";
    if (state === "error") return "Lỗi";
    return state;
  }

  function parseRows(rows) {
    var parsed = createEmptyState();
    (rows || []).forEach(function (row) {
      var type = String(row.row_type || "").trim();
      if (type === "site") parsed.site = row;
      else if (type === "cabinet") parsed.cabinets.push(row);
      else if (type === "locker") parsed.lockers.push(row);
      else if (type === "event" || type === "session" || type === "wallet") parsed.events.push(row);
      else if (type === "user") parsed.users.push(normalizeUser(row));
      else if (type === "rate") parsed.rates.push(normalizeRate(row, parsed.rates.length));
      else if (type === "note") parsed.notes.push(row);
    });
    parsed.cabinets.sort(function (a, b) {
      return Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.cabinet_id || "").localeCompare(String(b.cabinet_id || ""));
    });
    parsed.lockers.sort(function (a, b) {
      return String(a.cabinet_id || "").localeCompare(String(b.cabinet_id || "")) || Number(a.slot_no || 0) - Number(b.slot_no || 0);
    });
    parsed.events.sort(function (a, b) {
      return Number(b.ts || b.event_time_ms || 0) - Number(a.ts || a.event_time_ms || 0);
    });
    parsed.rates.sort(function (a, b) {
      if (a.tier === "guest") return -1;
      if (b.tier === "guest") return 1;
      return String(a.tier || "").localeCompare(String(b.tier || ""));
    });
    return parsed;
  }

  function normalizeUser(row) {
    row = row || {};
    return Object.assign({}, row, {
      phone: String(row.phone || row.occupied_phone || "").trim(),
      display_name: String(row.display_name || row.name || "").trim(),
      email: String(row.email || row.address || "").trim(),
      tier: String(row.tier || "guest").trim(),
      role: String(row.role || "user").trim(),
      balance: Number(row.balance || 0),
      active_sessions: Number(row.active_sessions || row.session_count || 0)
    });
  }

  function parseUserRows(rows) {
    return (rows || []).filter(function (row) {
      return String(row.row_type || "").trim() === "user";
    }).map(normalizeUser);
  }

  function parseLogRows(rows) {
    var total = null;
    var list = [];
    (rows || []).forEach(function (row) {
      var type = String(row.row_type || "").trim();
      if (type === "total") {
        total = Number(row.total_count || row.count || 0);
      } else if (type === "event" || type === "session" || type === "wallet") {
        list.push(row);
        if (total == null && row.total_count != null) total = Number(row.total_count);
      }
    });
    return { rows: list, total: Number.isFinite(total) ? total : null };
  }

  function parseUserDetailRows(rows) {
    var detail = { user: null, activeSessions: [], sessions: [], wallet: [], events: [] };
    (rows || []).forEach(function (row) {
      var type = String(row.row_type || "").trim();
      if (type === "user") detail.user = normalizeUser(row);
      else if (type === "active_session") detail.activeSessions.push(row);
      else if (type === "session") detail.sessions.push(row);
      else if (type === "wallet") detail.wallet.push(row);
      else if (type === "event") detail.events.push(row);
    });
    return detail;
  }

  function setLive(text, state) {
    setText(nodes.live, text);
    if (nodes.live) nodes.live.setAttribute("data-state", state || "loading");
  }

  function toast(message, type) {
    if (!nodes.toastStack) return;
    var node = document.createElement("div");
    node.className = "locker-toast" + (type === "error" ? " error" : "");
    node.textContent = String(message || "");
    nodes.toastStack.appendChild(node);
    window.setTimeout(function () {
      node.remove();
    }, 3600);
  }

  function refreshState() {
    var macro = String(cfg.stateMacro || (canAdmin ? "locker-admin-state" : "locker-monitor-state")).trim();
    var requestId = ++stateRequestId;
    if (nodes.refresh) nodes.refresh.disabled = true;
    setLive("Đang tải", "loading");
    var payload = {
      macro: macro,
      limit: Number(cfg.eventPageSize || 80) || 80
    };
    if (!canAdmin) payload.privacy = monitorPrivacy;
    return postIoData(payload).then(function (rows) {
      if (requestId !== stateRequestId) return;
      var previousUsers = currentState.users || [];
      currentState = parseRows(rows);
      currentState.users = previousUsers;
      renderState();
      refreshLogRows({ silent: true, preserveOffset: false });
      setLive("Đã cập nhật " + new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }), "live");
    }).catch(function (error) {
      setLive("Lỗi dữ liệu", "error");
      toast(error && error.message ? error.message : "Không thể tải dữ liệu locker.", "error");
    }).finally(function () {
      if (nodes.refresh) nodes.refresh.disabled = false;
    });
  }

  function countsFor(lockers) {
    return (lockers || []).reduce(function (acc, locker) {
      var state = normalizeState(locker.state);
      acc.total += 1;
      acc[state] = (acc[state] || 0) + 1;
      return acc;
    }, { total: 0, free: 0, occupied: 0, opening: 0, disabled: 0, error: 0 });
  }

  function renderKpis() {
    if (!nodes.kpis) return;
    var counts = countsFor(currentState.lockers);
    var items = [
      ["Tổng locker", counts.total],
      ["Trống", counts.free],
      ["Đang dùng", counts.occupied],
      ["Đang mở", counts.opening],
      ["Lỗi/Tắt", (counts.error || 0) + (counts.disabled || 0)]
    ];
    nodes.kpis.innerHTML = items.map(function (item) {
      return '<div class="locker-kpi"><span>' + esc(item[0]) + '</span><strong>' + esc(formatNumber(item[1])) + '</strong></div>';
    }).join("");
  }

  function cabinetLockers(cabinetId) {
    return currentState.lockers.filter(function (locker) {
      return String(locker.cabinet_id || "") === String(cabinetId || "");
    });
  }

  function formatQrUrl(cabinet) {
    var ioid = String(cabinet.ioid || extractIoid(databaseSessionId) || "<<ioid>>").trim();
    var raw = String(cabinet.qr_url || cabinet.page_url || "").trim();
    if (!raw && cabinet.page_id) raw = "/iot-page/" + encodeURIComponent(ioid) + "/" + encodeURIComponent(String(cabinet.page_id || ""));
    return raw.replace(/<<ioid>>/gi, encodeURIComponent(ioid));
  }

  function renderCabinets() {
    if (!nodes.cabinets) return;
    if (!currentState.cabinets.length) {
      nodes.cabinets.innerHTML = '<section class="locker-panel">Chưa có dữ liệu tủ locker.</section>';
      return;
    }
    if (!canAdmin && monitorPrivacy === "summaryOnly") {
      nodes.cabinets.innerHTML = currentState.cabinets.map(function (cabinet) {
        var counts = countsFor(cabinetLockers(cabinet.cabinet_id));
        return '<section class="locker-cabinet locker-cabinet-summary" data-cabinet-id="' + esc(cabinet.cabinet_id) + '">' +
          '<div class="locker-cabinet-head">' +
            '<div class="locker-cabinet-title"><h2>' + esc(cabinet.label || cabinet.cabinet_id) + '</h2><p>' + esc(cabinet.location || currentState.site.address || "") + '</p></div>' +
          '</div>' +
          '<div class="locker-summary-grid">' +
            '<div><span>Tổng</span><strong>' + esc(counts.total || 0) + '</strong></div>' +
            '<div><span>Trống</span><strong>' + esc(counts.free || 0) + '</strong></div>' +
            '<div><span>Đang dùng</span><strong>' + esc(counts.occupied || 0) + '</strong></div>' +
            '<div><span>Bảo trì/lỗi</span><strong>' + esc((counts.disabled || 0) + (counts.error || 0)) + '</strong></div>' +
          '</div>' +
        '</section>';
      }).join("");
      return;
    }
    nodes.cabinets.innerHTML = currentState.cabinets.map(function (cabinet) {
      var lockers = cabinetLockers(cabinet.cabinet_id);
      var counts = countsFor(lockers);
      var qrUrl = formatQrUrl(cabinet);
      var qr = qrUrl
        ? '<a class="locker-qr-link" href="' + esc(qrUrl) + '" target="_blank" rel="noreferrer">QR mở tủ: ' + esc(qrUrl) + '</a>'
        : '<span class="locker-qr-link">Chưa cấu hình QR</span>';
      return '<section class="locker-cabinet" data-cabinet-id="' + esc(cabinet.cabinet_id) + '">' +
        '<div class="locker-cabinet-head">' +
          '<div class="locker-cabinet-title">' +
            '<h2>' + esc(cabinet.label || cabinet.cabinet_id) + '</h2>' +
            '<p>' + esc(cabinet.location || currentState.site.address || "") + '</p>' +
          '</div>' +
          '<div class="locker-cabinet-meta">' +
            '<span class="locker-chip">Trống ' + esc(counts.free || 0) + '</span>' +
            '<span class="locker-chip">Đang dùng ' + esc(counts.occupied || 0) + '</span>' +
            '<span class="locker-chip">Lỗi/Tắt ' + esc((counts.error || 0) + (counts.disabled || 0)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="locker-qr-row">' + qr + '</div>' +
        '<div class="locker-grid">' + lockers.map(function (locker) { return renderLockerTile(locker, cabinet); }).join("") + '</div>' +
      '</section>';
    }).join("");

    if (canAdmin) {
      nodes.cabinets.querySelectorAll(".locker-tile").forEach(function (button) {
        button.addEventListener("click", function () {
          var lockerId = button.getAttribute("data-locker-id");
          var cabinetId = button.getAttribute("data-cabinet-id");
          openLockerModal(lockerId, cabinetId);
        });
      });
    }
  }

  function renderLockerTile(locker, cabinet) {
    var state = normalizeState(locker.state);
    var phone = String(locker.occupied_phone || locker.phone || "").trim();
    if (shouldHidePhone()) phone = "";
    var tag = canAdmin ? "button" : "div";
    var buttonAttrs = canAdmin ? ' type="button"' : ' role="group"';
    return '<' + tag + buttonAttrs + ' class="locker-tile" data-state="' + esc(state) + '" data-locker-id="' + esc(locker.locker_id) + '" data-cabinet-id="' + esc(cabinet.cabinet_id) + '">' +
      '<strong>' + esc(locker.display_label || locker.locker_id) + '</strong>' +
      '<span class="locker-state-row"><span class="locker-state-dot"></span>' + esc(stateLabel(state)) + '</span>' +
      '<span class="locker-phone">' + esc(phone || "-----") + '</span>' +
    '</' + tag + '>';
  }

  function renderLogFilterOptions() {
    if (!nodes.logCabinet) return;
    var selected = nodes.logCabinet.value || "";
    nodes.logCabinet.innerHTML = '<option value="">Tất cả</option>' + currentState.cabinets.map(function (cabinet) {
      var id = String(cabinet.cabinet_id || "");
      return '<option value="' + esc(id) + '"' + (id === selected ? ' selected' : '') + '>' + esc(cabinet.label || id) + '</option>';
    }).join("");
  }

  function dateInputToMs(node) {
    var value = String(node && node.value || "").trim();
    if (!value) return "";
    var time = new Date(value).getTime();
    return Number.isFinite(time) ? String(time) : "";
  }

  function readLogFiltersFromDom() {
    return {
      dataset: String(nodes.logDataset && nodes.logDataset.value || logState.dataset || "events").trim() || "events",
      cabinet_id: String(nodes.logCabinet && nodes.logCabinet.value || "").trim(),
      locker_id: String(nodes.logLocker && nodes.logLocker.value || "").trim(),
      phone: String(nodes.logPhone && nodes.logPhone.value || "").trim(),
      event_type: String(nodes.logEventType && nodes.logEventType.value || "").trim(),
      status: String(nodes.logStatus && nodes.logStatus.value || "").trim(),
      from_ts: dateInputToMs(nodes.logFrom),
      to_ts: dateInputToMs(nodes.logTo)
    };
  }

  function buildLogPayload(options) {
    options = options || {};
    var filters = options.filters || logState.filters || {};
    var payload = {
      macro: cfg.eventMacro || "locker-event-list",
      dataset: filters.dataset || logState.dataset || "events",
      limit: options.limit || logState.limit,
      offset: options.offset == null ? logState.offset : options.offset
    };
    ["cabinet_id", "locker_id", "phone", "event_type", "status", "from_ts", "to_ts"].forEach(function (key) {
      if (filters[key] !== "" && filters[key] != null) payload[key] = filters[key];
    });
    if (!canAdmin) payload.privacy = monitorPrivacy;
    return payload;
  }

  function refreshLogRows(options) {
    options = options || {};
    if (!cfg.eventMacro || !nodes.eventBody) return Promise.resolve();
    var append = Boolean(options.append);
    var filters = append || options.preserveOffset ? logState.filters : readLogFiltersFromDom();
    if (!append) {
      logState.dataset = filters.dataset || "events";
      logState.filters = filters;
      logState.offset = 0;
    }
    if (nodes.logApply) nodes.logApply.disabled = true;
    if (nodes.logLoadMore) nodes.logLoadMore.disabled = true;
    return postIoData(buildLogPayload({
      filters: logState.filters,
      offset: append ? logState.offset : 0,
      limit: logState.limit
    })).then(function (rows) {
      var parsed = parseLogRows(rows);
      logState.lastCount = parsed.rows.length;
      logState.totalCount = parsed.total;
      currentState.events = append ? currentState.events.concat(parsed.rows) : parsed.rows;
      logState.offset = currentState.events.length;
      renderEvents();
      if (!options.silent) toast("Đã tải dữ liệu vận hành.");
    }).catch(function (error) {
      if (!options.silent) toast(error && error.message ? error.message : "Không thể tải dữ liệu vận hành.", "error");
    }).finally(function () {
      if (nodes.logApply) nodes.logApply.disabled = false;
      if (nodes.logLoadMore) nodes.logLoadMore.disabled = logState.lastCount < logState.limit;
    });
  }

  function resetLogFilters() {
    [nodes.logLocker, nodes.logPhone, nodes.logEventType, nodes.logStatus, nodes.logFrom, nodes.logTo].forEach(function (node) {
      if (node) node.value = "";
    });
    if (nodes.logCabinet) nodes.logCabinet.value = "";
    if (nodes.logDataset) nodes.logDataset.value = "events";
    logState.filters = {};
    logState.dataset = "events";
    refreshLogRows({ silent: false });
  }

  function csvCell(value) {
    var text = String(value == null ? "" : value);
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function logRowForCsv(row) {
    return [
      row.row_type || logState.dataset,
      formatTime(row.ts || row.started_at),
      row.cabinet_id || "",
      row.locker_id || "",
      row.event_type || row.wallet_type || "",
      row.status || "",
      row.actor_phone || row.phone || "",
      row.request_id || "",
      row.session_id || row.tx_id || "",
      row.amount == null ? "" : row.amount,
      row.balance_after == null ? "" : row.balance_after,
      row.detail || row.note || ""
    ];
  }

  function downloadCsv(filename, rows) {
    var header = ["row_type", "time", "cabinet_id", "locker_id", "event_type", "status", "phone", "request_id", "ref_id", "amount", "balance_after", "detail"];
    var csv = [header].concat((rows || []).map(logRowForCsv)).map(function (row) {
      return row.map(csvCell).join(",");
    }).join("\n");
    var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function exportLogCsv() {
    if (!cfg.eventMacro) return;
    var filters = readLogFiltersFromDom();
    var dataset = filters.dataset || "events";
    return postIoData(buildLogPayload({ filters: filters, offset: 0, limit: 10000 })).then(function (rows) {
      downloadCsv("locker-" + dataset + "-" + new Date().toISOString().slice(0, 10) + ".csv", parseLogRows(rows).rows);
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Không thể xuất CSV.", "error");
    });
  }

  function renderEvents() {
    if (!nodes.eventBody) return;
    renderLogFilterOptions();
    var events = currentState.events.slice(0, Math.max(Number(cfg.eventPageSize || 80) || 80, currentState.events.length));
    var totalText = logState.totalCount == null ? "" : (" / " + formatNumber(logState.totalCount));
    if (nodes.logCount) nodes.logCount.textContent = events.length + totalText + " dòng";
    if (!events.length) {
      nodes.eventBody.innerHTML = '<tr><td colspan="6">Chưa có log.</td></tr>';
      return;
    }
    nodes.eventBody.innerHTML = events.map(function (event) {
      var kind = String(event.row_type || "event");
      var eventName = event.event_type || event.wallet_type || (kind === "session" ? ("session_" + (event.status || "")) : "");
      var actor = shouldHidePhone() ? "" : (event.actor_phone || event.phone || "");
      var detail = shouldHideLogDetails() ? "" : (event.detail || event.note || "");
      if (kind === "wallet") {
        detail = shouldHideLogDetails() ? "" : [event.note || "", "amount=" + formatMoney(event.amount), "balance=" + formatMoney(event.balance_after)].filter(Boolean).join(" | ");
      } else if (kind === "session") {
        detail = shouldHideLogDetails() ? "" : ["session=" + (event.session_id || ""), "status=" + (event.status || ""), "fee=" + formatMoney(event.charged_cost)].join(" | ");
      }
      return '<tr>' +
        '<td>' + esc(formatTime(event.ts || event.event_time_ms || event.started_at)) + '</td>' +
        '<td>' + esc(event.cabinet_id || "") + '</td>' +
        '<td>' + esc(event.locker_id || "") + '</td>' +
        '<td>' + esc(eventName || kind) + '</td>' +
        '<td>' + esc(actor || "") + '</td>' +
        '<td>' + esc(detail || "") + '</td>' +
      '</tr>';
    }).join("");
  }

  function rateByTierMap(list) {
    return (list || []).reduce(function (acc, rate, index) {
      var normalized = normalizeRate(rate, index);
      if (normalized.tier) acc[normalized.tier] = normalized;
      return acc;
    }, {});
  }

  function readRateRowsFromDom() {
    if (!nodes.rates) return [];
    return Array.prototype.slice.call(nodes.rates.querySelectorAll("[data-rate-row]")).map(function (row, index) {
      function value(name) {
        var input = row.querySelector("[data-rate-field='" + name + "']");
        return input ? input.value : "";
      }
      var tierInput = row.querySelector("[data-rate-field='tier']");
      return Object.assign(normalizeRate({
        tier: value("tier"),
        open_fee: value("open_fee"),
        note: value("note")
      }, index), {
        source: row.getAttribute("data-rate-source") || "db",
        raw_tier: tierInput ? String(tierInput.value || "") : ""
      });
    });
  }

  function mergedRateRows() {
    var cached = rateByTierMap(rateEditCache);
    var staged = rateByTierMap(unsavedRateDrafts);
    var existingTiers = {};
    var rows = (currentState.rates || []).map(function (rate, index) {
      var tier = String(rate.tier || "");
      existingTiers[tier] = true;
      var override = staged[tier] || cached[tier];
      return Object.assign({}, normalizeRate(rate, index), override || {}, {
        tier: tier,
        source: "db",
        dirty: Boolean(staged[tier] || cached[tier])
      });
    });
    unsavedRateDrafts.forEach(function (rate, index) {
      if (!existingTiers[rate.tier]) {
        rows.push(Object.assign({}, normalizeRate(rate, index), { source: "draft", dirty: true }));
      }
    });
    rows.sort(function (a, b) {
      if (a.tier === "guest") return -1;
      if (b.tier === "guest") return 1;
      return String(a.tier || "").localeCompare(String(b.tier || ""));
    });
    return rows;
  }

  function renderRateEditor() {
    if (!nodes.rates) return;
    var rows = mergedRateRows();
    var hasGuest = rows.some(function (rate) { return rate.tier === "guest"; });
    var warning = hasGuest ? "" : '<div class="locker-rate-warning">Thiếu nhóm giá guest. QR precheck vẫn fallback 0 nếu không có rate phù hợp. <button class="locker-button" type="button" data-rate-create-guest>Thêm guest</button></div>';
    if (!rows.length) {
      nodes.rates.innerHTML = warning + '<div class="locker-list-item">Chưa có bảng giá. Bấm “Thêm nhóm giá” hoặc “Nạp pricing từ setup”.</div>';
      return;
    }
    nodes.rates.innerHTML = warning +
      '<div class="locker-rate-table" role="table" aria-label="Bảng giá locker">' +
        '<div class="locker-rate-head" role="row">' +
          '<span>Nhóm</span><span>Phí/lượt</span><span>Ghi chú</span><span>Thao tác</span>' +
        '</div>' +
        rows.map(function (rate) {
          var isDraft = rate.source === "draft";
          return '<div class="locker-rate-row" data-rate-row data-rate-source="' + esc(rate.source || "db") + '" data-rate-tier="' + esc(rate.tier) + '">' +
            '<input class="locker-input" data-rate-field="tier" value="' + esc(rate.tier) + '"' + (isDraft ? '' : ' readonly') + ' />' +
            '<input class="locker-input" data-rate-field="open_fee" type="number" min="0" step="1000" value="' + esc(rate.open_fee) + '" />' +
            '<input class="locker-input" data-rate-field="note" value="' + esc(rate.note || "") + '" />' +
            '<div class="locker-rate-row-actions">' +
              '<button class="locker-button" type="button" data-rate-save>Lưu</button>' +
              '<button class="locker-button" type="button" data-rate-delete' + (rate.tier === "guest" && !isDraft ? ' disabled title="Không xóa nhóm guest"' : '') + '>Xóa</button>' +
            '</div>' +
          '</div>';
        }).join("") +
      '</div>';
  }

  function clearRateEditCache() {
    rateEditCache = [];
    if (nodes.rates) nodes.rates.innerHTML = "";
  }

  function renderUsersAndRates() {
    if (nodes.users) {
      nodes.users.innerHTML = currentState.users.length ? currentState.users.map(function (user) {
        var subtitle = [
          user.display_name || "Chưa đặt tên",
          user.email || "Chưa có email",
          (user.tier || "guest") + " | " + (user.role || "user"),
          user.active_sessions ? ("Đang dùng: " + user.active_sessions) : ""
        ].filter(Boolean).join(" · ");
        return '<div class="locker-list-item locker-user-card" data-user-phone="' + esc(user.phone || "") + '" data-selected="' + esc(String(user.phone || "") === selectedUserPhone ? "true" : "false") + '">' +
          '<div><strong>' + esc(user.phone || "") + '</strong>' +
          '<span>' + esc(subtitle) + '</span>' +
          '<span class="locker-user-balance">Số dư: ' + esc(formatMoney(user.balance)) + '</span></div>' +
          (canAdmin ? '<button class="locker-button" type="button" data-topup-phone="' + esc(user.phone || "") + '">Nạp</button>' : '') +
        '</div>';
      }).join("") : '<div class="locker-list-item">Nhập tên, email hoặc SĐT để tìm user. Để trống và bấm Tìm sẽ tải các user cập nhật gần nhất.</div>';
      if (canAdmin) {
        nodes.users.querySelectorAll("[data-user-phone]").forEach(function (card) {
          card.addEventListener("click", function (event) {
            if (event.target && event.target.getAttribute("data-topup-phone")) return;
            selectUser(card.getAttribute("data-user-phone"));
          });
        });
        nodes.users.querySelectorAll("[data-topup-phone]").forEach(function (button) {
          button.addEventListener("click", function (event) {
            event.stopPropagation();
            openTopupModal(findUser(button.getAttribute("data-topup-phone")));
          });
        });
      }
      if (nodes.userCount) {
        nodes.userCount.textContent = currentState.users.length
          ? ("Đang hiển thị " + currentState.users.length + " user")
          : "Tìm kiếm phân trang";
      }
      if (nodes.userLoadMore) {
        nodes.userLoadMore.disabled = !canAdmin || userSearchState.lastCount < userSearchState.limit;
      }
    }
    renderRateEditor();
  }

  function renderUserDetail() {
    if (!nodes.userDetail) return;
    if (!selectedUserPhone || !selectedUserDetail || !selectedUserDetail.user) {
      nodes.userDetail.innerHTML = '<div class="locker-empty-state">Chọn một user để xem lịch sử session, ví và hoàn tiền giao dịch lỗi.</div>';
      return;
    }
    var user = selectedUserDetail.user;
    var profile = '<div class="locker-detail-grid">' + [
      ["SĐT", user.phone],
      ["Tên", user.display_name || "--"],
      ["Email", user.email || "--"],
      ["Nhóm", user.tier || "guest"],
      ["Số dư", formatMoney(user.balance)],
      ["Phiên active", user.active_sessions || 0]
    ].map(function (item) {
      return '<div class="locker-detail-item"><span>' + esc(item[0]) + '</span><strong>' + esc(item[1]) + '</strong></div>';
    }).join("") + '</div>';
    nodes.userDetail.innerHTML =
      '<div class="locker-panel-head"><h2>' + esc(user.phone) + '</h2><button class="locker-button" type="button" data-user-topup-detail="' + esc(user.phone) + '">Nạp tiền</button></div>' +
      profile +
      renderUserTierControl(user) +
      renderSessionTable("Phiên đang dùng", selectedUserDetail.activeSessions) +
      renderSessionTable("Lịch sử session", selectedUserDetail.sessions) +
      renderWalletTable(selectedUserDetail.wallet) +
      renderEventTable("Event gần nhất", selectedUserDetail.events);
    var topupButton = nodes.userDetail.querySelector("[data-user-topup-detail]");
    if (topupButton) topupButton.addEventListener("click", function () { openTopupModal(user); });
    nodes.userDetail.querySelectorAll("[data-refund-tx]").forEach(function (button) {
      button.addEventListener("click", function () {
        refundTransaction(button.getAttribute("data-refund-tx"));
      });
    });
    var tierButton = nodes.userDetail.querySelector("[data-user-tier-save]");
    if (tierButton) tierButton.addEventListener("click", setSelectedUserTier);
  }

  function renderUserTierControl(user) {
    if (!canAdmin) return "";
    var rates = currentState.rates || [];
    if (!rates.length) {
      return '<section class="locker-detail-section"><h3>Nhóm giá</h3><div class="locker-list-item">Chưa có bảng giá để đổi nhóm user.</div></section>';
    }
    var currentTier = String(user.tier || "guest").trim();
    var hasCurrent = rates.some(function (rate) { return String(rate.tier || "") === currentTier; });
    var options = (hasCurrent ? rates : [{ tier: currentTier, note: "Nhóm hiện tại chưa có trong bảng giá", open_fee: 0 }].concat(rates)).map(function (rate) {
      var tier = String(rate.tier || "").trim();
      return '<option value="' + esc(tier) + '"' + (tier === currentTier ? ' selected' : '') + '>' + esc(tier + " - " + formatMoney(rate.open_fee) + " credit") + '</option>';
    }).join("");
    return '<section class="locker-detail-section locker-tier-control">' +
      '<h3>Nhóm giá</h3>' +
      '<div class="locker-tier-row">' +
        '<select class="locker-input" data-user-tier-select>' + options + '</select>' +
        '<button class="locker-button" type="button" data-user-tier-save>Lưu nhóm</button>' +
      '</div>' +
    '</section>';
  }

  function renderSessionTable(title, sessions) {
    sessions = sessions || [];
    if (!sessions.length) {
      return '<section class="locker-detail-section"><h3>' + esc(title) + '</h3><div class="locker-list-item">Không có dữ liệu.</div></section>';
    }
    return '<section class="locker-detail-section"><h3>' + esc(title) + '</h3><table class="locker-mini-table"><thead><tr><th>Thời gian</th><th>Tủ</th><th>Locker</th><th>Trạng thái</th><th>Phí</th></tr></thead><tbody>' +
      sessions.map(function (row) {
        return '<tr><td>' + esc(formatTime(row.started_at || row.ts)) + '</td><td>' + esc(row.cabinet_id || "") + '</td><td>' + esc(row.locker_id || "") + '</td><td>' + esc(row.status || "") + '</td><td>' + esc(formatMoney(row.charged_cost)) + '</td></tr>';
      }).join("") + '</tbody></table></section>';
  }

  function renderWalletTable(wallet) {
    wallet = wallet || [];
    if (!wallet.length) {
      return '<section class="locker-detail-section"><h3>Ví</h3><div class="locker-list-item">Chưa có giao dịch ví.</div></section>';
    }
    return '<section class="locker-detail-section"><h3>Ví</h3><table class="locker-mini-table"><thead><tr><th>Thời gian</th><th>Loại</th><th>Số tiền</th><th>Số dư</th><th>Ghi chú</th><th></th></tr></thead><tbody>' +
      wallet.map(function (row) {
        var type = String(row.wallet_type || row.type || "").trim();
        var amount = Number(row.amount || 0);
        var refundable = type === "open_fee" && amount < 0 && !Number(row.refunded || 0);
        return '<tr><td>' + esc(formatTime(row.ts)) + '</td><td>' + esc(type) + '</td><td>' + esc(formatMoney(amount)) + '</td><td>' + esc(formatMoney(row.balance_after)) + '</td><td>' + esc(row.note || row.tx_id || "") + '</td><td>' +
          (refundable ? '<button class="locker-button" type="button" data-refund-tx="' + esc(row.tx_id || "") + '">Hoàn tiền</button>' : (Number(row.refunded || 0) ? '<span class="locker-status-pill">Đã hoàn</span>' : '')) +
          '</td></tr>';
      }).join("") + '</tbody></table></section>';
  }

  function renderEventTable(title, events) {
    events = events || [];
    if (!events.length) {
      return '<section class="locker-detail-section"><h3>' + esc(title) + '</h3><div class="locker-list-item">Không có event.</div></section>';
    }
    return '<section class="locker-detail-section"><h3>' + esc(title) + '</h3><table class="locker-mini-table"><thead><tr><th>Thời gian</th><th>Tủ</th><th>Locker</th><th>Sự kiện</th><th>Nội dung</th></tr></thead><tbody>' +
      events.map(function (row) {
        return '<tr><td>' + esc(formatTime(row.ts)) + '</td><td>' + esc(row.cabinet_id || "") + '</td><td>' + esc(row.locker_id || "") + '</td><td>' + esc(row.event_type || "") + '</td><td>' + esc(row.detail || "") + '</td></tr>';
      }).join("") + '</tbody></table></section>';
  }

  function renderNotes() {
    if (!nodes.notes) return;
    nodes.notes.innerHTML = currentState.notes.map(function (note) {
      return '<li>' + esc(note.detail || note.note || "") + '</li>';
    }).join("");
  }

  function cabinetStats(cabinetId, nextCount) {
    var lockers = cabinetLockers(cabinetId);
    var total = lockers.length;
    var activeBeyond = lockers.filter(function (locker) {
      return Number(locker.slot_no || 0) > Number(nextCount || 0)
        && (normalizeState(locker.state) === "occupied" || String(locker.session_id || "").trim());
    }).length;
    var disableFree = lockers.filter(function (locker) {
      return Number(locker.slot_no || 0) > Number(nextCount || 0)
        && normalizeState(locker.state) !== "occupied"
        && !String(locker.session_id || "").trim();
    }).length;
    return {
      current: total,
      add: Math.max(0, Number(nextCount || 0) - total),
      disableFree: disableFree,
      keepActive: activeBeyond
    };
  }

  function currentCabinetsAsDrafts() {
    var defaults = cfg.initialSetup && cfg.initialSetup.defaults || {};
    return currentState.cabinets.map(function (cabinet, index) {
      var lockers = cabinetLockers(cabinet.cabinet_id);
      var firstLocker = lockers[0] || {};
      var prefix = String(firstLocker.locker_id || cabinet.cabinet_id || "").replace(/-\d+$/, "").replace(/^CAB-/, "");
      return normalizeConfigCabinet({
        cabinet_id: cabinet.cabinet_id,
        label: cabinet.label,
        location: cabinet.location,
        ioid: resolveIoid(cabinet.ioid || defaults.defaultIoid),
        page_id: cabinet.page_id,
        locker_count: lockers.length || defaults.defaultLockerCount || 30,
        locker_prefix: prefix || String(cabinet.cabinet_id || "").replace(/^CAB-/, ""),
        hardware_pattern: "{cabinet}-{slot3}",
        sort_order: cabinet.sort_order || index + 1,
        enabled: Number(cabinet.enabled || 0) !== 0
      }, index);
    });
  }

  function syncConfigSiteInputs() {
    if (!nodes.configPanel) return;
    if (nodes.configSiteName) nodes.configSiteName.value = siteDraft.name || currentState.site.name || "";
    if (nodes.configSiteAddress) nodes.configSiteAddress.value = siteDraft.address || currentState.site.address || "";
    if (nodes.configTopupNote) nodes.configTopupNote.value = siteDraft.topup_note || currentState.site.note || "";
    if (nodes.configTopupQr) nodes.configTopupQr.value = siteDraft.topup_qr_url || currentState.site.topup_qr_url || "";
  }

  function readConfigDraftsFromDom() {
    if (!nodes.configList) return configDrafts.slice();
    var rows = Array.prototype.slice.call(nodes.configList.querySelectorAll("[data-config-index]"));
    if (!rows.length) return configDrafts.slice();
    return rows.map(function (row, index) {
      function value(name) {
        var input = row.querySelector("[data-config-field='" + name + "']");
        return input ? input.value : "";
      }
      var enabledInput = row.querySelector("[data-config-field='enabled']");
      return normalizeConfigCabinet({
        cabinet_id: value("cabinet_id"),
        label: value("label"),
        location: value("location"),
        ioid: value("ioid"),
        page_id: value("page_id"),
        locker_count: value("locker_count"),
        locker_prefix: value("locker_prefix"),
        hardware_pattern: value("hardware_pattern"),
        sort_order: value("sort_order"),
        enabled: enabledInput ? enabledInput.checked : true
      }, index);
    });
  }

  function renderConfigPanel() {
    if (!canAdmin || !nodes.configPanel || !nodes.configList) return;
    if (!configDrafts.length && currentState.cabinets.length) {
      configDrafts = currentCabinetsAsDrafts();
    }
    syncConfigSiteInputs();
    nodes.configList.innerHTML = configDrafts.length ? configDrafts.map(function (cabinet, index) {
      var stats = cabinetStats(cabinet.cabinet_id, cabinet.locker_count);
      return '<div class="locker-config-card" data-config-index="' + index + '">' +
        '<div class="locker-config-card-head">' +
          '<strong>' + esc(cabinet.cabinet_id) + '</strong>' +
          '<span>Hiện có ' + esc(stats.current) + ' ngăn | thêm ' + esc(stats.add) + ' | disable ' + esc(stats.disableFree) + ' | giữ active ' + esc(stats.keepActive) + '</span>' +
          '<button class="locker-button" type="button" data-config-remove="' + index + '">Bỏ khỏi nháp</button>' +
        '</div>' +
        '<div class="locker-config-grid">' +
          configField("cabinet_id", "Mã tủ", cabinet.cabinet_id) +
          configField("label", "Tên tủ", cabinet.label) +
          configField("location", "Vị trí", cabinet.location) +
          configField("ioid", "IoID thiết bị", cabinet.ioid) +
          configField("page_id", "Page QR", cabinet.page_id) +
          configField("locker_count", "Số ngăn", cabinet.locker_count, "number") +
          configField("locker_prefix", "Prefix locker", cabinet.locker_prefix) +
          configField("hardware_pattern", "Pattern phần cứng", cabinet.hardware_pattern) +
          configField("sort_order", "Thứ tự", cabinet.sort_order, "number") +
          '<label class="locker-config-enabled"><input data-config-field="enabled" type="checkbox"' + (cabinet.enabled ? ' checked' : '') + ' /> Bật tủ</label>' +
        '</div>' +
      '</div>';
    }).join("") : '<div class="locker-empty-state">Chưa có cấu hình tủ. Bấm “Nạp từ setup” hoặc “Thêm tủ”.</div>';
    renderConfigPreview();
  }

  function configField(name, label, value, type) {
    return '<label>' + esc(label) + '<input class="locker-input" data-config-field="' + esc(name) + '" type="' + esc(type || "text") + '" value="' + esc(value) + '" /></label>';
  }

  function renderConfigPreview() {
    if (!nodes.configPreview) return;
    var drafts = readConfigDraftsFromDom();
    var lines = drafts.map(function (cabinet) {
      var stats = cabinetStats(cabinet.cabinet_id, cabinet.locker_count);
      return [
        cabinet.cabinet_id + " (" + (cabinet.enabled ? "enabled" : "disabled") + ")",
        "target=" + cabinet.locker_count,
        "current=" + stats.current,
        "add=" + stats.add,
        "disable_free=" + stats.disableFree,
        "keep_active=" + stats.keepActive,
        "ioid=" + cabinet.ioid,
        "qr=" + cabinet.page_id
      ].join(" | ");
    });
    nodes.configPreview.textContent = lines.length ? lines.join("\n") : "Chưa có cấu hình tủ.";
  }

  function renderState() {
    renderKpis();
    renderCabinets();
    renderEvents();
    renderUsersAndRates();
    renderUserDetail();
    renderIncidentPanel();
    renderConfigPanel();
    renderNotes();
  }

  function findLocker(lockerId, cabinetId) {
    return currentState.lockers.find(function (locker) {
      return String(locker.locker_id || "") === String(lockerId || "") && String(locker.cabinet_id || "") === String(cabinetId || "");
    }) || null;
  }

  function findCabinet(cabinetId) {
    return currentState.cabinets.find(function (cabinet) {
      return String(cabinet.cabinet_id || "") === String(cabinetId || "");
    }) || null;
  }

  function findUser(phone) {
    return currentState.users.find(function (user) {
      return String(user.phone || "") === String(phone || "");
    }) || { phone: String(phone || "") };
  }

  function performUserSearch(options) {
    if (!canAdmin || !cfg.userSearchMacro) return;
    options = options || {};
    var query = String(nodes.userSearch && nodes.userSearch.value || "").trim();
    var append = Boolean(options.append);
    if (!append) {
      userSearchState.query = query;
      userSearchState.offset = 0;
    }
    if (nodes.userSearchButton) nodes.userSearchButton.disabled = true;
    if (nodes.userLoadMore) nodes.userLoadMore.disabled = true;
    return postIoData({
      macro: cfg.userSearchMacro,
      q: userSearchState.query,
      limit: userSearchState.limit,
      offset: userSearchState.offset
    }).then(function (rows) {
      var users = parseUserRows(rows);
      userSearchState.lastCount = users.length;
      if (append) currentState.users = currentState.users.concat(users);
      else currentState.users = users;
      userSearchState.offset = currentState.users.length;
      renderUsersAndRates();
      toast(userSearchState.query ? ("Đã tìm user theo: " + userSearchState.query) : "Đã tải danh sách user.");
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Không thể tìm user.", "error");
    }).finally(function () {
      if (nodes.userSearchButton) nodes.userSearchButton.disabled = false;
      if (nodes.userLoadMore) nodes.userLoadMore.disabled = userSearchState.lastCount < userSearchState.limit;
    });
  }

  function selectUser(phone) {
    selectedUserPhone = String(phone || "").trim();
    selectedUserDetail = null;
    renderUsersAndRates();
    renderUserDetail();
    return loadUserDetail(selectedUserPhone);
  }

  function loadUserDetail(phone) {
    if (!canAdmin || !cfg.userDetailMacro || !phone) return Promise.resolve();
    if (nodes.userDetail) nodes.userDetail.innerHTML = '<div class="locker-empty-state">Đang tải chi tiết user...</div>';
    return postIoData({
      macro: cfg.userDetailMacro,
      phone: phone,
      limit: 40
    }).then(function (rows) {
      selectedUserDetail = parseUserDetailRows(rows);
      if (!selectedUserDetail.user) {
        selectedUserDetail = null;
        toast("Không tìm thấy user " + phone + ".", "error");
      }
      renderUsersAndRates();
      renderUserDetail();
    }).catch(function (error) {
      selectedUserDetail = null;
      renderUserDetail();
      toast(error && error.message ? error.message : "Không thể tải chi tiết user.", "error");
    });
  }

  function refundTransaction(txId) {
    txId = String(txId || "").trim();
    if (!cfg.refundMacro || !txId) return;
    if (!window.confirm("Hoàn toàn bộ phí của giao dịch " + txId + "?")) return;
    return postIoData({
      macro: cfg.refundMacro,
      tx_id: txId,
      note: "Admin hoàn tiền giao dịch lỗi",
      request_id: createRequestId().replace(/^REQ-/, "REFUND-")
    }).then(function (rows) {
      var result = rows && rows[0] || {};
      if (String(result.c1 || "").toUpperCase() !== "OK") {
        throw new Error(result.code || result.message || "Hoàn tiền thất bại.");
      }
      toast(result.code === "ALREADY_REFUNDED" ? "Giao dịch này đã được hoàn trước đó." : "Đã hoàn tiền: " + formatMoney(result.amount));
      if (selectedUserPhone) loadUserDetail(selectedUserPhone);
      refreshState();
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Hoàn tiền thất bại.", "error");
    });
  }

  function addRateDraft(preferredTier) {
    var existing = {};
    currentState.rates.concat(unsavedRateDrafts).forEach(function (rate) {
      existing[String(rate.tier || "")] = true;
    });
    var base = normalizeRateTier(preferredTier || "tier-" + (Object.keys(existing).length + 1), "tier");
    var tier = base;
    var suffix = 2;
    while (existing[tier]) {
      tier = (base + "-" + suffix).slice(0, 32);
      suffix += 1;
    }
    unsavedRateDrafts.push(normalizeRate({ tier: tier, open_fee: 0, note: "" }));
    rateEditCache = [];
    renderRateEditor();
  }

  function loadRatesFromSetup() {
    setupRateDrafts = normalizeRateDrafts(cfg.initialSetup && cfg.initialSetup.rates || []);
    if (!setupRateDrafts.length) {
      toast("Setup chưa có pricing nháp.", "error");
      return;
    }
    unsavedRateDrafts = setupRateDrafts.slice();
    rateEditCache = setupRateDrafts.slice();
    renderRateEditor();
    toast("Đã nạp pricing nháp từ setup. Bấm Lưu từng nhóm để ghi DB.");
  }

  function saveRateFromRow(row) {
    if (!cfg.saveRateMacro || !row) return;
    var tierInput = row.querySelector("[data-rate-field='tier']");
    var feeInput = row.querySelector("[data-rate-field='open_fee']");
    var noteInput = row.querySelector("[data-rate-field='note']");
    var tier = normalizeRateTier(tierInput && tierInput.value, "");
    var openFee = Number(feeInput && feeInput.value);
    var note = String(noteInput && noteInput.value || "").trim();
    if (!tier) {
      toast("Nhóm giá không được để trống.", "error");
      return;
    }
    if (!Number.isFinite(openFee) || openFee < 0) {
      toast("Phí/lượt phải là số không âm.", "error");
      return;
    }
    if (tierInput) tierInput.value = tier;
    var button = row.querySelector("[data-rate-save]");
    if (button) button.disabled = true;
    return postIoData({
      macro: cfg.saveRateMacro,
      tier: tier,
      open_fee: openFee,
      note: note,
      request_id: createRequestId().replace(/^REQ-/, "RATE-")
    }).then(function (rows) {
      var result = rows && rows[0] || {};
      if (String(result.c1 || "").toUpperCase() !== "OK") {
        throw new Error(result.code || result.message || "Lưu bảng giá thất bại.");
      }
      unsavedRateDrafts = unsavedRateDrafts.filter(function (rate) { return rate.tier !== tier; });
      rateEditCache = rateEditCache.filter(function (rate) { return rate.tier !== tier; });
      clearRateEditCache();
      toast("Đã lưu nhóm giá " + tier + ".");
      refreshState();
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Lưu bảng giá thất bại.", "error");
    }).finally(function () {
      if (button) button.disabled = false;
    });
  }

  function deleteRateFromRow(row) {
    if (!row) return;
    var tierInput = row.querySelector("[data-rate-field='tier']");
    var tier = normalizeRateTier(tierInput && tierInput.value, "");
    var source = row.getAttribute("data-rate-source") || "db";
    if (!tier) return;
    if (source === "draft") {
      unsavedRateDrafts = unsavedRateDrafts.filter(function (rate) { return rate.tier !== tier; });
      rateEditCache = rateEditCache.filter(function (rate) { return rate.tier !== tier; });
      renderRateEditor();
      return;
    }
    if (tier === "guest") {
      toast("Không xóa nhóm guest.", "error");
      return;
    }
    if (!cfg.deleteRateMacro) return;
    if (!window.confirm("Xóa nhóm giá " + tier + "? Chỉ xóa được khi chưa có user thuộc nhóm này.")) return;
    var button = row.querySelector("[data-rate-delete]");
    if (button) button.disabled = true;
    return postIoData({
      macro: cfg.deleteRateMacro,
      tier: tier,
      request_id: createRequestId().replace(/^REQ-/, "RATE-DEL-")
    }).then(function (rows) {
      var result = rows && rows[0] || {};
      if (String(result.c1 || "").toUpperCase() !== "OK") {
        throw new Error(result.code || result.message || "Xóa nhóm giá thất bại.");
      }
      rateEditCache = rateEditCache.filter(function (rate) { return rate.tier !== tier; });
      clearRateEditCache();
      toast("Đã xóa nhóm giá " + tier + ".");
      refreshState();
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Xóa nhóm giá thất bại.", "error");
    }).finally(function () {
      if (button) button.disabled = false;
    });
  }

  function setSelectedUserTier() {
    if (!selectedUserDetail || !selectedUserDetail.user || !cfg.setUserTierMacro) return;
    var select = nodes.userDetail && nodes.userDetail.querySelector("[data-user-tier-select]");
    var tier = normalizeRateTier(select && select.value, "");
    var phone = String(selectedUserDetail.user.phone || selectedUserPhone || "").trim();
    if (!phone || !tier) return;
    if (tier === String(selectedUserDetail.user.tier || "guest")) {
      toast("User đã ở nhóm giá " + tier + ".");
      return;
    }
    if (!window.confirm("Đổi nhóm giá của " + phone + " sang " + tier + "?")) return;
    return postIoData({
      macro: cfg.setUserTierMacro,
      phone: phone,
      tier: tier,
      request_id: createRequestId().replace(/^REQ-/, "TIER-")
    }).then(function (rows) {
      var result = rows && rows[0] || {};
      if (String(result.c1 || "").toUpperCase() !== "OK") {
        throw new Error(result.code || result.message || "Đổi nhóm giá thất bại.");
      }
      toast("Đã đổi nhóm giá user sang " + tier + ".");
      loadUserDetail(phone);
      performUserSearch({ append: false });
      refreshState();
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Đổi nhóm giá thất bại.", "error");
    });
  }

  function openTopupModal(user) {
    if (!nodes.topupModal || !nodes.topupForm) return;
    user = normalizeUser(user || {});
    nodes.topupModal.hidden = false;
    if (nodes.topupPhone) nodes.topupPhone.value = user.phone || "";
    if (nodes.topupName) nodes.topupName.value = user.display_name || "";
    if (nodes.topupEmail) nodes.topupEmail.value = user.email || "";
    if (nodes.topupAmount) nodes.topupAmount.value = "";
    if (nodes.topupNote) nodes.topupNote.value = "";
    if (nodes.topupPreview) {
      nodes.topupPreview.textContent = user.phone
        ? "Số dư hiện tại: " + formatMoney(user.balance)
        : "Nhập SĐT để tạo nhanh user mới và ghi nhận nạp tiền.";
    }
    window.setTimeout(function () {
      if (nodes.topupAmount) nodes.topupAmount.focus();
    }, 0);
  }

  function closeTopupModal() {
    if (nodes.topupModal) nodes.topupModal.hidden = true;
  }

  function submitTopup(event) {
    if (event) event.preventDefault();
    if (!cfg.topupMacro) return;
    var phone = String(nodes.topupPhone && nodes.topupPhone.value || "").trim();
    var amount = Number(nodes.topupAmount && nodes.topupAmount.value || 0);
    if (!phone) {
      toast("Vui lòng nhập SĐT.", "error");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast("Số tiền nạp phải lớn hơn 0.", "error");
      return;
    }
    var payload = {
      macro: cfg.topupMacro,
      phone: phone,
      display_name: String(nodes.topupName && nodes.topupName.value || "").trim(),
      email: String(nodes.topupEmail && nodes.topupEmail.value || "").trim(),
      amount: amount,
      note: String(nodes.topupNote && nodes.topupNote.value || "").trim(),
      request_id: createRequestId().replace(/^REQ-/, "TOPUP-")
    };
    if (nodes.topupSubmit) nodes.topupSubmit.disabled = true;
    return postIoData(payload).then(function (rows) {
      var result = rows && rows[0] || {};
      if (String(result.c1 || "").toUpperCase() !== "OK") {
        throw new Error(result.message || result.c2 || "Nạp tiền thất bại.");
      }
      toast("Đã nạp tiền. Số dư mới: " + formatMoney(result.balance_after));
      closeTopupModal();
      if (selectedUserPhone === phone) loadUserDetail(phone);
      performUserSearch({ append: false });
      refreshState();
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Nạp tiền thất bại.", "error");
    }).finally(function () {
      if (nodes.topupSubmit) nodes.topupSubmit.disabled = false;
    });
  }

  function openLockerModal(lockerId, cabinetId) {
    selectedLocker = findLocker(lockerId, cabinetId);
    selectedCabinet = findCabinet(cabinetId);
    renderIncidentPanel();
    if (nodes.incidentPanel && selectedLocker) {
      nodes.incidentPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function renderIncidentPanel() {
    if (!nodes.detailGrid) return;
    if (selectedLocker) {
      selectedLocker = findLocker(selectedLocker.locker_id, selectedLocker.cabinet_id) || selectedLocker;
      selectedCabinet = findCabinet(selectedLocker.cabinet_id) || selectedCabinet;
    }
    if (!selectedLocker || !selectedCabinet) {
      if (nodes.incidentState) nodes.incidentState.textContent = "Chưa chọn locker";
      nodes.detailGrid.innerHTML = '<div class="locker-empty-state">Chọn một locker trên lưới để thao tác.</div>';
      if (nodes.actionOpen) nodes.actionOpen.disabled = true;
      if (nodes.statusApply) nodes.statusApply.disabled = true;
      if (nodes.commandPreview) nodes.commandPreview.textContent = "Chọn một locker trên lưới để thao tác.";
      return;
    }
    if (nodes.incidentState) nodes.incidentState.textContent = (selectedCabinet.label || selectedCabinet.cabinet_id) + " | " + stateLabel(selectedLocker.state);
    nodes.detailGrid.innerHTML = [
      ["Tủ", selectedCabinet.label || selectedCabinet.cabinet_id],
      ["Locker", selectedLocker.locker_id],
      ["Vị trí phần cứng", selectedLocker.hardware_addr || ""],
      ["Trạng thái", stateLabel(selectedLocker.state)],
      ["SĐT", selectedLocker.occupied_phone || ""],
      ["Phiên", selectedLocker.session_id || ""]
    ].map(function (item) {
      return '<div class="locker-detail-item"><span>' + esc(item[0]) + '</span><strong>' + esc(item[1] || "--") + '</strong></div>';
    }).join("");
    if (nodes.statusSelect) nodes.statusSelect.value = normalizeState(selectedLocker.state);
    if (nodes.statusPhone) nodes.statusPhone.value = selectedLocker.occupied_phone || "";
    if (nodes.actionOpen) nodes.actionOpen.disabled = false;
    if (nodes.statusApply) nodes.statusApply.disabled = false;
    if (nodes.commandPreview) nodes.commandPreview.textContent = buildManualOpenPreview(selectedLocker, selectedCabinet);
  }

  function closeLockerModal() {
    selectedLocker = null;
    selectedCabinet = null;
    renderIncidentPanel();
  }

  function buildManualOpenPreview(locker, cabinet) {
    var ioid = resolveIoid(cabinet && cabinet.ioid);
    return [
      "Secure command mẫu:",
      "POST /api/iot-cmd/" + ioid + "/" + String(cfg.openCommandId || "locker-open-auto"),
      JSON.stringify({
        action: "manual_open",
        cabinet_id: cabinet && cabinet.cabinet_id,
        locker_id: locker && locker.locker_id,
        slot_no: Number(locker && locker.slot_no || 0),
        hardware_addr: locker && locker.hardware_addr,
        request_id: createRequestId()
      }, null, 2)
    ].join("\n");
  }

  function createRequestId() {
    return "REQ-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  function sendManualOpen() {
    if (!selectedLocker || !selectedCabinet) return;
    var ioid = resolveIoid(selectedCabinet.ioid);
    if (!ioid) {
      toast("Thiếu ioid để gửi lệnh mở tay.", "error");
      return;
    }
    var payload = {
      action: "manual_open",
      cabinet_id: selectedCabinet.cabinet_id,
      locker_id: selectedLocker.locker_id,
      slot_no: Number(selectedLocker.slot_no || 0),
      hardware_addr: selectedLocker.hardware_addr || "",
      request_id: createRequestId()
    };
    if (nodes.actionOpen) nodes.actionOpen.disabled = true;
    return fetch("/api/iot-cmd/" + encodeURIComponent(ioid) + "/" + encodeURIComponent(String(cfg.openCommandId || "locker-open-auto")), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || data.ok === false) throw new Error(data.message || data.error || "Gửi lệnh thất bại.");
        toast("Đã gửi lệnh mở tay.");
        if (nodes.commandPreview) nodes.commandPreview.textContent = "Đã gửi request_id " + payload.request_id + ". Thiết bị cần báo lại bằng IO-locker-report.";
        auditAdminAction("admin_manual_open_sent", payload.request_id, "Sent manual open command to " + payload.cabinet_id + "/" + payload.locker_id);
      });
    }).catch(function (error) {
      auditAdminAction("admin_manual_open_failed", payload.request_id, error && error.message ? error.message : "Manual open command failed");
      toast(error && error.message ? error.message : "Gửi lệnh thất bại.", "error");
    }).finally(function () {
      if (nodes.actionOpen) nodes.actionOpen.disabled = false;
    });
  }

  function auditAdminAction(eventType, requestId, detail) {
    if (!selectedLocker || !cfg.adminAuditMacro) return Promise.resolve();
    return postIoData({
      macro: cfg.adminAuditMacro,
      cabinet_id: selectedLocker.cabinet_id,
      locker_id: selectedLocker.locker_id,
      event_type: eventType,
      request_id: requestId || createRequestId(),
      detail: detail || ""
    }).catch(function () {
      return null;
    });
  }

  function setSelectedStatus() {
    if (!selectedLocker || !cfg.adminStatusMacro) return;
    var nextState = String(nodes.statusSelect && nodes.statusSelect.value || "").trim();
    var phone = String(nodes.statusPhone && nodes.statusPhone.value || "").trim();
    var note = String(nodes.statusNote && nodes.statusNote.value || "").trim();
    if (nextState === "occupied" && !phone) {
      toast("Set occupied cần nhập SĐT.", "error");
      return;
    }
    if (!window.confirm("Áp dụng trạng thái " + stateLabel(nextState) + " cho " + selectedLocker.locker_id + "?")) return;
    var requestId = createRequestId().replace(/^REQ-/, "ADMIN-");
    var payload = {
      macro: cfg.adminStatusMacro,
      locker_id: selectedLocker.locker_id,
      cabinet_id: selectedLocker.cabinet_id,
      next_state: nextState,
      phone: phone,
      detail: note,
      request_id: requestId
    };
    if (nodes.statusApply) nodes.statusApply.disabled = true;
    return postIoData(payload).then(function () {
      toast("Đã cập nhật trạng thái " + selectedLocker.locker_id + ".");
      refreshState();
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Không thể cập nhật trạng thái.", "error");
    }).finally(function () {
      if (nodes.statusApply) nodes.statusApply.disabled = false;
    });
  }

  function loadConfigFromDb() {
    if (!cfg.configStateMacro) {
      configDrafts = currentCabinetsAsDrafts();
      siteDraft = normalizeSiteDraft({
        name: currentState.site.name,
        address: currentState.site.address,
        topup_note: currentState.site.note || currentState.site.topup_note,
        topup_qr_url: currentState.site.topup_qr_url
      });
      renderConfigPanel();
      toast("Đã nạp cấu hình hiện tại từ DB.");
      return;
    }
    if (nodes.configLoadDb) nodes.configLoadDb.disabled = true;
    return postIoData({ macro: cfg.configStateMacro }).then(function (rows) {
      var siteRow = (rows || []).find(function (row) { return String(row.row_type || "") === "site_config"; }) || {};
      var cabinetRows = (rows || []).filter(function (row) { return String(row.row_type || "") === "cabinet_config"; });
      siteDraft = normalizeSiteDraft(siteRow);
      configDrafts = cabinetRows.map(function (row, index) {
        var current = findCabinet(row.cabinet_id) || {};
        return normalizeConfigCabinet({
          cabinet_id: row.cabinet_id,
          label: row.label,
          location: row.location,
          ioid: row.ioid,
          page_id: row.page_id,
          locker_count: row.locker_count,
          locker_prefix: String((cabinetLockers(row.cabinet_id)[0] || {}).locker_id || row.cabinet_id || "").replace(/-\d+$/, "").replace(/^CAB-/, ""),
          hardware_pattern: current.hardware_pattern || "{cabinet}-{slot3}",
          sort_order: row.sort_order || index + 1,
          enabled: Number(row.enabled || 0) !== 0
        }, index);
      });
      if (!configDrafts.length) configDrafts = currentCabinetsAsDrafts();
      renderConfigPanel();
      toast("Đã nạp cấu hình hiện tại từ DB.");
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Không thể nạp cấu hình DB.", "error");
    }).finally(function () {
      if (nodes.configLoadDb) nodes.configLoadDb.disabled = false;
    });
  }

  function loadConfigFromSetup() {
    configDrafts = normalizeConfigDrafts(cfg.initialSetup && cfg.initialSetup.cabinets || []);
    siteDraft = normalizeSiteDraft(cfg.initialSetup && cfg.initialSetup.site || {});
    renderConfigPanel();
    toast("Đã nạp cấu hình nháp từ setup.");
  }

  function addConfigCabinet() {
    configDrafts = readConfigDraftsFromDom();
    configDrafts.push(normalizeConfigCabinet({}, configDrafts.length));
    renderConfigPanel();
  }

  function removeConfigCabinet(index) {
    configDrafts = readConfigDraftsFromDom();
    configDrafts.splice(Number(index), 1);
    renderConfigPanel();
  }

  function readSiteDraftFromInputs() {
    return normalizeSiteDraft({
      name: nodes.configSiteName && nodes.configSiteName.value,
      address: nodes.configSiteAddress && nodes.configSiteAddress.value,
      topup_note: nodes.configTopupNote && nodes.configTopupNote.value,
      topup_qr_url: nodes.configTopupQr && nodes.configTopupQr.value
    });
  }

  function saveSiteConfig() {
    if (!canAdmin || !cfg.saveSiteConfigMacro) return;
    siteDraft = readSiteDraftFromInputs();
    if (!siteDraft.name) {
      toast("Tên đơn vị không được để trống.", "error");
      return;
    }
    if (nodes.configSaveSite) nodes.configSaveSite.disabled = true;
    return postIoData({
      macro: cfg.saveSiteConfigMacro,
      site_id: "default",
      name: siteDraft.name,
      address: siteDraft.address,
      topup_note: siteDraft.topup_note,
      topup_qr_url: siteDraft.topup_qr_url,
      request_id: createRequestId().replace(/^REQ-/, "SITE-")
    }).then(function (rows) {
      var result = rows && rows[0] || {};
      if (String(result.c1 || "").toUpperCase() !== "OK") {
        throw new Error(result.code || result.message || "Lưu site thất bại.");
      }
      toast("Đã lưu thông tin site.");
      refreshState();
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Lưu site thất bại.", "error");
    }).finally(function () {
      if (nodes.configSaveSite) nodes.configSaveSite.disabled = false;
    });
  }

  function applyCabinetConfig() {
    if (!canAdmin || !cfg.applyCabinetConfigMacro) return;
    configDrafts = readConfigDraftsFromDom();
    if (!configDrafts.length) {
      toast("Chưa có cấu hình tủ để áp dụng.", "error");
      return;
    }
    renderConfigPreview();
    var plannedAdded = configDrafts.reduce(function (sum, cabinet) { return sum + cabinetStats(cabinet.cabinet_id, cabinet.locker_count).add; }, 0);
    var plannedDisabled = configDrafts.reduce(function (sum, cabinet) { return sum + cabinetStats(cabinet.cabinet_id, cabinet.locker_count).disableFree; }, 0);
    var plannedKept = configDrafts.reduce(function (sum, cabinet) { return sum + cabinetStats(cabinet.cabinet_id, cabinet.locker_count).keepActive; }, 0);
    if (!window.confirm("Áp dụng cấu hình " + configDrafts.length + " tủ xuống database? Locker đang active sẽ được giữ nguyên.")) return;
    if (nodes.configApply) nodes.configApply.disabled = true;
    var results = [];
    var sequence = configDrafts.reduce(function (promise, cabinet, index) {
      return promise.then(function () {
        return postIoData({
          macro: cfg.applyCabinetConfigMacro,
          cabinet_id: cabinet.cabinet_id,
          label: cabinet.label,
          location: cabinet.location,
          ioid: resolveIoid(cabinet.ioid),
          page_id: cabinet.page_id,
          locker_count: cabinet.locker_count,
          locker_prefix: cabinet.locker_prefix,
          hardware_pattern: cabinet.hardware_pattern,
          sort_order: cabinet.sort_order,
          enabled: cabinet.enabled ? 1 : 0,
          request_id: createRequestId().replace(/^REQ-/, "CFG-")
        }).then(function (rows) {
          var result = rows && rows[0] || {};
          results.push(result);
          if (String(result.c1 || "").toUpperCase() !== "OK") {
            throw new Error((result.cabinet_id || cabinet.cabinet_id) + ": " + (result.code || "APPLY_FAILED"));
          }
          if (nodes.configPreview) {
            nodes.configPreview.textContent = "Đã áp dụng " + (index + 1) + "/" + configDrafts.length + " tủ...";
          }
        });
      });
    }, Promise.resolve());

    return sequence.then(function () {
      var disabled = results.reduce(function (sum, row) { return sum + Number(row.disabled_count || 0); }, 0);
      var kept = results.reduce(function (sum, row) { return sum + Number(row.kept_active_count || 0); }, 0);
      toast("Đã áp dụng cấu hình. Dự kiến thêm " + plannedAdded + ", disable " + Math.max(plannedDisabled, disabled) + ", giữ active " + Math.max(plannedKept, kept) + ".");
      refreshState();
    }).catch(function (error) {
      toast(error && error.message ? error.message : "Áp dụng cấu hình thất bại.", "error");
      refreshState();
    }).finally(function () {
      if (nodes.configApply) nodes.configApply.disabled = false;
    });
  }

  function downloadJson(filename, value) {
    var blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function exportConfigJson() {
    if (!canAdmin) return;
    configDrafts = readConfigDraftsFromDom();
    siteDraft = readSiteDraftFromInputs();
    downloadJson("locker-topology-config.json", {
      site: siteDraft,
      cabinets: configDrafts,
      rates: mergedRateRows().map(function (rate, index) { return normalizeRate(rate, index); })
    });
  }

  function normalizeImportedConfig(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("File JSON không đúng định dạng.");
    var setup = raw.initialSetup || raw;
    return {
      site: normalizeSiteDraft(setup.site || {}),
      cabinets: normalizeConfigDrafts(setup.cabinets || []),
      rates: normalizeRateDrafts(setup.rates || [])
    };
  }

  function importConfigJson(file) {
    if (!canAdmin || !file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = normalizeImportedConfig(JSON.parse(String(reader.result || "{}")));
        siteDraft = imported.site;
        configDrafts = imported.cabinets;
        if (imported.rates.length) {
          unsavedRateDrafts = imported.rates.slice();
          rateEditCache = imported.rates.slice();
        }
        renderConfigPanel();
        renderRateEditor();
        toast("Đã import JSON vào bản nháp. Bấm lưu/apply để ghi DB.");
      } catch (error) {
        toast(error && error.message ? error.message : "Không thể import JSON.", "error");
      }
      if (nodes.configImportFile) nodes.configImportFile.value = "";
    };
    reader.readAsText(file);
  }

  function armRefreshCooldown() {
    refreshCooldownActive = true;
    if (refreshCooldownTimer) window.clearTimeout(refreshCooldownTimer);
    refreshCooldownTimer = window.setTimeout(function () {
      refreshCooldownActive = false;
      if (refreshQueued) {
        refreshQueued = false;
        refreshState();
        armRefreshCooldown();
      }
    }, Math.max(1000, Number(cfg.stream && cfg.stream.cooldownMs || 5000)));
  }

  function handleDatabaseChanged() {
    if (!refreshCooldownActive) {
      refreshQueued = false;
      refreshState();
      armRefreshCooldown();
      return;
    }
    refreshQueued = true;
  }

  function connectStream() {
    if (!cfg.stream || cfg.stream.enabled === false || typeof EventSource === "undefined") return;
    var url = buildStreamUrl();
    if (!url) return;
    if (eventSource) eventSource.close();
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    eventSource = new EventSource(url);
    eventSource.onmessage = function (event) {
      try {
        var payload = JSON.parse(event.data);
        if (payload && payload.type === "iodata_changed") handleDatabaseChanged();
      } catch (error) {}
    };
    eventSource.onerror = function () {
      if (eventSource) eventSource.close();
      eventSource = null;
      reconnectTimer = window.setTimeout(function () {
        reconnectTimer = null;
        connectStream();
      }, 3000);
    };
  }

  function initThemePicker() {
    if (!nodes.themeToggle || !nodes.themeMenu) return;
    nodes.themeToggle.addEventListener("click", function () {
      var expanded = nodes.themeToggle.getAttribute("aria-expanded") === "true";
      nodes.themeToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      nodes.themeMenu.classList.toggle("open", !expanded);
    });
    nodes.themeMenu.querySelectorAll("[data-theme-option]").forEach(function (button) {
      button.addEventListener("click", function () {
        var theme = button.getAttribute("data-theme-option");
        document.documentElement.setAttribute("data-theme", theme);
        try { window.localStorage.setItem("sample-dashboard-theme", theme); } catch (error) {}
        nodes.themeToggle.setAttribute("aria-expanded", "false");
        nodes.themeMenu.classList.remove("open");
      });
    });
    document.addEventListener("click", function (event) {
      if (!nodes.themeMenu.contains(event.target) && event.target !== nodes.themeToggle) {
        nodes.themeToggle.setAttribute("aria-expanded", "false");
        nodes.themeMenu.classList.remove("open");
      }
    });
  }

  if (nodes.refresh) nodes.refresh.addEventListener("click", refreshState);
  if (nodes.logApply) nodes.logApply.addEventListener("click", function () { refreshLogRows({ silent: false }); });
  if (nodes.logReset) nodes.logReset.addEventListener("click", resetLogFilters);
  if (nodes.logLoadMore) nodes.logLoadMore.addEventListener("click", function () { refreshLogRows({ append: true, silent: false }); });
  if (nodes.logExport) nodes.logExport.addEventListener("click", exportLogCsv);
  if (nodes.logDataset) nodes.logDataset.addEventListener("change", function () { refreshLogRows({ silent: true }); });
  if (nodes.userSearchButton) nodes.userSearchButton.addEventListener("click", function () { performUserSearch({ append: false }); });
  if (nodes.userLoadMore) nodes.userLoadMore.addEventListener("click", function () { performUserSearch({ append: true }); });
  if (nodes.userSearch) {
    nodes.userSearch.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        performUserSearch({ append: false });
      }
    });
  }
  if (nodes.userTopupNew) nodes.userTopupNew.addEventListener("click", function () { openTopupModal({}); });
  if (nodes.rateLoadSetup) nodes.rateLoadSetup.addEventListener("click", loadRatesFromSetup);
  if (nodes.rateAdd) nodes.rateAdd.addEventListener("click", function () { addRateDraft(); });
  if (nodes.rates) {
    nodes.rates.addEventListener("input", function () {
      rateEditCache = readRateRowsFromDom();
    });
    nodes.rates.addEventListener("click", function (event) {
      var guestButton = event.target && event.target.closest ? event.target.closest("[data-rate-create-guest]") : null;
      if (guestButton) {
        addRateDraft("guest");
        return;
      }
      var saveButton = event.target && event.target.closest ? event.target.closest("[data-rate-save]") : null;
      if (saveButton) {
        saveRateFromRow(saveButton.closest("[data-rate-row]"));
        return;
      }
      var deleteButton = event.target && event.target.closest ? event.target.closest("[data-rate-delete]") : null;
      if (deleteButton) {
        deleteRateFromRow(deleteButton.closest("[data-rate-row]"));
      }
    });
  }
  if (nodes.topupClose) nodes.topupClose.addEventListener("click", closeTopupModal);
  if (nodes.topupModal) {
    nodes.topupModal.addEventListener("click", function (event) {
      if (event.target === nodes.topupModal) closeTopupModal();
    });
  }
  if (nodes.topupForm) nodes.topupForm.addEventListener("submit", submitTopup);
  if (nodes.actionOpen) nodes.actionOpen.addEventListener("click", sendManualOpen);
  if (nodes.statusApply) nodes.statusApply.addEventListener("click", setSelectedStatus);
  if (nodes.configLoadDb) nodes.configLoadDb.addEventListener("click", loadConfigFromDb);
  if (nodes.configLoadDraft) nodes.configLoadDraft.addEventListener("click", loadConfigFromSetup);
  if (nodes.configExport) nodes.configExport.addEventListener("click", exportConfigJson);
  if (nodes.configImport && nodes.configImportFile) {
    nodes.configImport.addEventListener("click", function () { nodes.configImportFile.click(); });
    nodes.configImportFile.addEventListener("change", function () { importConfigJson(nodes.configImportFile.files && nodes.configImportFile.files[0]); });
  }
  if (nodes.configAddCabinet) nodes.configAddCabinet.addEventListener("click", addConfigCabinet);
  if (nodes.configSaveSite) nodes.configSaveSite.addEventListener("click", saveSiteConfig);
  if (nodes.configApply) nodes.configApply.addEventListener("click", applyCabinetConfig);
  if (nodes.configList) {
    nodes.configList.addEventListener("input", renderConfigPreview);
    nodes.configList.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("[data-config-remove]") : null;
      if (button) removeConfigCabinet(button.getAttribute("data-config-remove"));
    });
  }

  initThemePicker();
  refreshState();
  if (canAdmin && nodes.users) performUserSearch({ append: false });
  connectStream();
})();
