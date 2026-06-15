(function () {
  "use strict";

  var nodes = {
    mode: document.getElementById("locker-mode"),
    title: document.getElementById("locker-title"),
    subtitle: document.getElementById("locker-subtitle"),
    session: document.getElementById("locker-session"),
    sync: document.getElementById("locker-sync"),
    stateMacro: document.getElementById("locker-state-macro"),
    pageSize: document.getElementById("locker-page-size"),
    monitorPrivacy: document.getElementById("locker-monitor-privacy"),
    kioskMode: document.getElementById("locker-kiosk-mode"),
    siteName: document.getElementById("locker-site-name"),
    siteAddress: document.getElementById("locker-site-address"),
    topupQr: document.getElementById("locker-topup-qr"),
    topupNote: document.getElementById("locker-topup-note"),
    cabinetCount: document.getElementById("locker-cabinet-count"),
    defaultCount: document.getElementById("locker-default-count"),
    defaultIoid: document.getElementById("locker-default-ioid"),
    regenerateCabinets: document.getElementById("locker-regenerate-cabinets"),
    addCabinet: document.getElementById("locker-add-cabinet"),
    cabinetEditor: document.getElementById("locker-cabinet-editor"),
    addRate: document.getElementById("locker-add-rate"),
    rateEditor: document.getElementById("locker-rate-editor"),
    importConfig: document.getElementById("locker-import-config"),
    exportConfig: document.getElementById("locker-export-config"),
    importFile: document.getElementById("locker-import-file")
  };

  var cabinetDrafts = [];
  var rateDrafts = [];

  var config = {
    mode: "admin",
    locale: "vi",
    title: "Quản lý tủ locker",
    subtitle: "Theo dõi trạng thái, người đang giữ đồ, log vận hành và QR mở tủ theo từng cụm locker.",
    eyebrow: "ROSA Locker Manager",
    databaseSessionId: "<<sessionid>>",
    syncId: "<<syncid>>",
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
    stream: { enabled: true, cooldownMs: 5000 },
    initialSetup: {
      site: {
        name: "ROSA Locker",
        address: "Trường mẫu ROSA, TP.HCM",
        topup_note: "Nạp tiền tại quầy quản lý trước khi gửi đồ.",
        topup_qr_url: ""
      },
      defaults: {
        cabinetCount: 2,
        defaultLockerCount: 30,
        defaultIoid: "<<ioid>>"
      },
      cabinets: [],
      rates: [
        { tier: "guest", open_fee: 0, note: "Khách vãng lai." },
        { tier: "member", open_fee: 0, note: "Hội viên/nhân viên." }
      ]
    }
  };

  function safeText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || String(fallback || "");
  }

  function numberValue(value, fallback, min, max) {
    var parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) parsed = fallback;
    parsed = Math.max(Number(min || 1), parsed);
    if (Number.isFinite(Number(max))) parsed = Math.min(Number(max), parsed);
    return parsed;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function letterFor(index) {
    if (index < 26) return String.fromCharCode(65 + index);
    return String(index + 1).padStart(2, "0");
  }

  function normalizeCabinetId(value, index) {
    var fallback = "CAB-" + letterFor(index);
    var text = safeText(value, fallback).toUpperCase().replace(/[^A-Z0-9_-]/g, "-");
    return safeText(text, fallback).slice(0, 24);
  }

  function normalizePageId(value, cabinetId) {
    var fallback = "locker-open-" + String(cabinetId || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    var text = safeText(value, fallback).toLowerCase().replace(/[^a-z0-9._:-]/g, "-");
    return safeText(text, fallback).slice(0, 128);
  }

  function normalizeTier(value, fallback) {
    var text = safeText(value, fallback || "guest").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    return safeText(text, fallback || "guest").slice(0, 32);
  }

  function normalizePrivacy(value) {
    var text = safeText(value, "maskedPhone");
    return ["stateOnly", "maskedPhone", "hiddenPhone", "summaryOnly"].indexOf(text) >= 0 ? text : "maskedPhone";
  }

  function normalizeRate(raw, index) {
    raw = raw || {};
    var tier = normalizeTier(raw.tier, index === 0 ? "guest" : "member");
    var fee = Number(raw.open_fee == null ? raw.openFee : raw.open_fee);
    if (!Number.isFinite(fee) || fee < 0) fee = 0;
    return {
      tier: tier,
      open_fee: fee,
      note: safeText(raw.note, tier === "guest" ? "Khách vãng lai." : "")
    };
  }

  function defaultRates() {
    return [
      normalizeRate({ tier: "guest", open_fee: 0, note: "Khách vãng lai." }, 0),
      normalizeRate({ tier: "member", open_fee: 0, note: "Hội viên/nhân viên." }, 1)
    ];
  }

  function defaultCabinet(index, overrides) {
    var cabinetId = normalizeCabinetId(overrides && overrides.cabinet_id, index);
    var prefix = safeText(overrides && overrides.locker_prefix, cabinetId.replace(/^CAB-/, "")).toUpperCase();
    return {
      cabinet_id: cabinetId,
      label: safeText(overrides && overrides.label, "Tủ " + cabinetId),
      location: safeText(overrides && overrides.location, ""),
      ioid: safeText(overrides && overrides.ioid, nodes.defaultIoid && nodes.defaultIoid.value || "<<ioid>>"),
      page_id: normalizePageId(overrides && overrides.page_id, cabinetId),
      locker_count: numberValue(overrides && overrides.locker_count, numberValue(nodes.defaultCount && nodes.defaultCount.value, 30, 1, 200), 1, 200),
      locker_prefix: prefix.slice(0, 12),
      hardware_pattern: safeText(overrides && overrides.hardware_pattern, "{cabinet}-{slot3}"),
      sort_order: numberValue(overrides && overrides.sort_order, index + 1, 0, 999),
      enabled: overrides && overrides.enabled === false ? false : Number(overrides && overrides.enabled) === 0 ? false : true
    };
  }

  function defaultCabinets(count) {
    var total = numberValue(count, 2, 1, 50);
    var list = [];
    for (var i = 0; i < total; i += 1) {
      list.push(defaultCabinet(i, {
        cabinet_id: "CAB-" + letterFor(i),
        label: "Tủ " + letterFor(i),
        locker_count: numberValue(nodes.defaultCount && nodes.defaultCount.value, 30, 1, 200),
        locker_prefix: letterFor(i),
        sort_order: i + 1
      }));
    }
    return list;
  }

  function readCabinetsFromDom() {
    if (!nodes.cabinetEditor) return cabinetDrafts.slice();
    var rows = Array.prototype.slice.call(nodes.cabinetEditor.querySelectorAll("[data-cabinet-index]"));
    if (!rows.length) return cabinetDrafts.slice();
    return rows.map(function (row, index) {
      function value(name) {
        var input = row.querySelector("[data-cabinet-field='" + name + "']");
        return input ? input.value : "";
      }
      var enabledInput = row.querySelector("[data-cabinet-field='enabled']");
      return defaultCabinet(index, {
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
      });
    });
  }

  function readRatesFromDom() {
    if (!nodes.rateEditor) return rateDrafts.slice();
    var rows = Array.prototype.slice.call(nodes.rateEditor.querySelectorAll("[data-rate-index]"));
    if (!rows.length) return rateDrafts.slice();
    return rows.map(function (row, index) {
      function value(name) {
        var input = row.querySelector("[data-rate-field='" + name + "']");
        return input ? input.value : "";
      }
      return normalizeRate({
        tier: value("tier"),
        open_fee: value("open_fee"),
        note: value("note")
      }, index);
    });
  }

  function renderCabinets() {
    if (!nodes.cabinetEditor) return;
    if (!cabinetDrafts.length) cabinetDrafts = defaultCabinets(nodes.cabinetCount && nodes.cabinetCount.value || 2);
    nodes.cabinetEditor.innerHTML = cabinetDrafts.map(function (cabinet, index) {
      return '<div class="setup-locker-cabinet" data-cabinet-index="' + index + '">' +
        '<div class="setup-locker-cabinet-head">' +
          '<strong>' + esc(cabinet.cabinet_id || ("Tủ " + (index + 1))) + '</strong>' +
          '<button type="button" class="setup-secondary-button" data-cabinet-remove="' + index + '">Xóa khỏi nháp</button>' +
        '</div>' +
        '<div class="setup-locker-cabinet-grid">' +
          fieldHtml("cabinet_id", "Mã tủ", cabinet.cabinet_id) +
          fieldHtml("label", "Tên tủ", cabinet.label) +
          fieldHtml("location", "Vị trí", cabinet.location) +
          fieldHtml("ioid", "IoID thiết bị", cabinet.ioid) +
          fieldHtml("page_id", "Page QR", cabinet.page_id) +
          fieldHtml("locker_count", "Số ngăn", cabinet.locker_count, "number") +
          fieldHtml("locker_prefix", "Prefix locker", cabinet.locker_prefix) +
          fieldHtml("hardware_pattern", "Pattern phần cứng", cabinet.hardware_pattern) +
          fieldHtml("sort_order", "Thứ tự", cabinet.sort_order, "number") +
          '<label class="setup-locker-check"><input data-cabinet-field="enabled" type="checkbox"' + (cabinet.enabled ? " checked" : "") + ' /> Bật tủ</label>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  function renderRates() {
    if (!nodes.rateEditor) return;
    if (!rateDrafts.length) rateDrafts = defaultRates();
    nodes.rateEditor.innerHTML =
      '<div><strong>Nhóm</strong></div><div><strong>Phí/lượt</strong></div><div><strong>Ghi chú</strong></div><div></div>' +
      rateDrafts.map(function (rate, index) {
        return '<div class="setup-rate-row" data-rate-index="' + index + '">' +
          '<label><span>Nhóm</span><input data-rate-field="tier" type="text" value="' + esc(rate.tier) + '" /></label>' +
          '<label><span>Phí/lượt</span><input data-rate-field="open_fee" type="number" min="0" step="1000" value="' + esc(rate.open_fee) + '" /></label>' +
          '<label><span>Ghi chú</span><input data-rate-field="note" type="text" value="' + esc(rate.note) + '" /></label>' +
          '<button type="button" class="setup-secondary-button" data-rate-remove="' + index + '">Xóa khỏi nháp</button>' +
        '</div>';
      }).join("");
  }

  function fieldHtml(name, label, value, type) {
    return '<label><span>' + esc(label) + '</span><input data-cabinet-field="' + esc(name) + '" type="' + esc(type || "text") + '" value="' + esc(value) + '" /></label>';
  }

  function apply(nextConfig) {
    config = Object.assign({}, config, nextConfig || {});
    var setup = config.initialSetup || {};
    var site = setup.site || {};
    var defaults = setup.defaults || {};
    var mode = safeText(config.mode, "admin") === "monitor" ? "monitor" : "admin";

    nodes.mode.value = mode;
    nodes.title.value = safeText(config.title, mode === "monitor" ? "Theo dõi tủ locker" : "Quản lý tủ locker");
    nodes.subtitle.value = safeText(config.subtitle, "");
    nodes.session.value = safeText(config.databaseSessionId || config.sessionId, "<<sessionid>>");
    nodes.sync.value = safeText(config.syncId, "<<syncid>>");
    nodes.stateMacro.value = safeText(config.stateMacro, mode === "monitor" ? "locker-monitor-state" : "locker-admin-state");
    nodes.pageSize.value = String(numberValue(config.eventPageSize, mode === "monitor" ? 50 : 80, 10, 200));
    if (nodes.monitorPrivacy) nodes.monitorPrivacy.value = normalizePrivacy(config.monitorPrivacy);
    if (nodes.kioskMode) nodes.kioskMode.checked = Boolean(config.kioskMode);
    nodes.siteName.value = safeText(site.name, "ROSA Locker");
    nodes.siteAddress.value = safeText(site.address, "");
    nodes.topupNote.value = safeText(site.topup_note || site.topupNote, "Nạp tiền tại quầy quản lý trước khi gửi đồ.");
    nodes.topupQr.value = safeText(site.topup_qr_url || site.topupQrUrl, "");
    nodes.cabinetCount.value = String(numberValue(defaults.cabinetCount, 2, 1, 50));
    nodes.defaultCount.value = String(numberValue(defaults.defaultLockerCount, 30, 1, 200));
    nodes.defaultIoid.value = safeText(defaults.defaultIoid, "<<ioid>>");

    cabinetDrafts = Array.isArray(setup.cabinets) && setup.cabinets.length
      ? setup.cabinets.map(function (item, index) { return defaultCabinet(index, item); })
      : defaultCabinets(nodes.cabinetCount.value);
    rateDrafts = Array.isArray(setup.rates) && setup.rates.length
      ? setup.rates.map(normalizeRate)
      : defaultRates();
    renderCabinets();
    renderRates();
  }

  function collect() {
    var mode = nodes.mode.value === "monitor" ? "monitor" : "admin";
    cabinetDrafts = readCabinetsFromDom();
    rateDrafts = readRatesFromDom();
    var site = {
      name: safeText(nodes.siteName.value, "ROSA Locker"),
      address: safeText(nodes.siteAddress.value, ""),
      topup_note: safeText(nodes.topupNote.value, ""),
      topup_qr_url: safeText(nodes.topupQr.value, "")
    };
    return {
      mode: mode,
      locale: "vi",
      title: safeText(nodes.title.value, mode === "monitor" ? "Theo dõi tủ locker" : "Quản lý tủ locker"),
      subtitle: safeText(nodes.subtitle.value, ""),
      eyebrow: mode === "monitor" ? "ROSA Locker Monitor" : "ROSA Locker Manager",
      databaseSessionId: safeText(nodes.session.value, "<<sessionid>>"),
      syncId: safeText(nodes.sync.value, "<<syncid>>"),
      stateMacro: safeText(nodes.stateMacro.value, mode === "monitor" ? "locker-monitor-state" : "locker-admin-state"),
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
      eventPageSize: numberValue(nodes.pageSize.value, mode === "monitor" ? 50 : 80, 10, 200),
      userPageSize: 50,
      monitorPrivacy: normalizePrivacy(nodes.monitorPrivacy && nodes.monitorPrivacy.value),
      kioskMode: Boolean(nodes.kioskMode && nodes.kioskMode.checked),
      stream: { enabled: true, cooldownMs: 5000 },
      initialSetup: {
        site: site,
        defaults: {
          cabinetCount: numberValue(nodes.cabinetCount.value, cabinetDrafts.length || 2, 1, 50),
          defaultLockerCount: numberValue(nodes.defaultCount.value, 30, 1, 200),
          defaultIoid: safeText(nodes.defaultIoid.value, "<<ioid>>")
        },
        cabinets: cabinetDrafts,
        rates: rateDrafts
      }
    };
  }

  nodes.mode.addEventListener("change", function () {
    var mode = nodes.mode.value === "monitor" ? "monitor" : "admin";
    if (!nodes.title.value.trim()) {
      nodes.title.value = mode === "monitor" ? "Theo dõi tủ locker" : "Quản lý tủ locker";
    }
    nodes.stateMacro.value = mode === "monitor" ? "locker-monitor-state" : "locker-admin-state";
    nodes.pageSize.value = mode === "monitor" ? "50" : "80";
  });

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

  function normalizeImportedConfig(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("File JSON không đúng định dạng.");
    }
    if (raw.initialSetup) return raw;
    if (raw.site || raw.defaults || raw.cabinets || raw.rates) {
      return Object.assign({}, collect(), {
        initialSetup: {
          site: raw.site || {},
          defaults: raw.defaults || {},
          cabinets: Array.isArray(raw.cabinets) ? raw.cabinets : [],
          rates: Array.isArray(raw.rates) ? raw.rates : []
        }
      });
    }
    throw new Error("JSON cần có initialSetup hoặc site/defaults/cabinets/rates.");
  }

  function exportConfig() {
    downloadJson("locker-template-config.json", collect());
  }

  function importConfigFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        apply(normalizeImportedConfig(JSON.parse(String(reader.result || "{}"))));
        window.DashboardSetupBridge.resize();
      } catch (error) {
        window.alert(error && error.message ? error.message : "Không thể import JSON.");
      }
      if (nodes.importFile) nodes.importFile.value = "";
    };
    reader.readAsText(file);
  }

  nodes.regenerateCabinets.addEventListener("click", function () {
    cabinetDrafts = defaultCabinets(nodes.cabinetCount.value);
    renderCabinets();
    window.DashboardSetupBridge.resize();
  });

  if (nodes.exportConfig) nodes.exportConfig.addEventListener("click", exportConfig);
  if (nodes.importConfig && nodes.importFile) {
    nodes.importConfig.addEventListener("click", function () { nodes.importFile.click(); });
    nodes.importFile.addEventListener("change", function () { importConfigFile(nodes.importFile.files && nodes.importFile.files[0]); });
  }

  nodes.addCabinet.addEventListener("click", function () {
    cabinetDrafts = readCabinetsFromDom();
    cabinetDrafts.push(defaultCabinet(cabinetDrafts.length, {}));
    nodes.cabinetCount.value = String(cabinetDrafts.length);
    renderCabinets();
    window.DashboardSetupBridge.resize();
  });

  nodes.cabinetEditor.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest("[data-cabinet-remove]") : null;
    if (!button) return;
    cabinetDrafts = readCabinetsFromDom();
    cabinetDrafts.splice(Number(button.getAttribute("data-cabinet-remove")), 1);
    nodes.cabinetCount.value = String(Math.max(1, cabinetDrafts.length));
    renderCabinets();
    window.DashboardSetupBridge.resize();
  });

  nodes.addRate.addEventListener("click", function () {
    rateDrafts = readRatesFromDom();
    rateDrafts.push(normalizeRate({ tier: "tier-" + (rateDrafts.length + 1), open_fee: 0, note: "" }, rateDrafts.length));
    renderRates();
    window.DashboardSetupBridge.resize();
  });

  nodes.rateEditor.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest("[data-rate-remove]") : null;
    if (!button) return;
    rateDrafts = readRatesFromDom();
    rateDrafts.splice(Number(button.getAttribute("data-rate-remove")), 1);
    if (!rateDrafts.length) rateDrafts = defaultRates();
    renderRates();
    window.DashboardSetupBridge.resize();
  });

  window.DashboardSetupBridge.start({
    onInit: function (payload) {
      apply(payload && payload.config ? payload.config : {});
    },
    onCollect: collect
  });

  apply(config);
})();
