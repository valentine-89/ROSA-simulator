(function () {
  "use strict";

  var nodes = {
    title: document.getElementById("mixer-title-input"),
    eyebrow: document.getElementById("mixer-eyebrow-input"),
    subtitle: document.getElementById("mixer-subtitle-input"),
    distributor: document.getElementById("mixer-distributor-input"),
    machine: document.getElementById("mixer-machine-input"),
    ioid: document.getElementById("mixer-ioid-input"),
    pageid: document.getElementById("mixer-pageid-input"),
    stateMacro: document.getElementById("mixer-state-macro-input"),
    positionsMacro: document.getElementById("mixer-positions-macro-input"),
    stagesMacro: document.getElementById("mixer-stages-macro-input"),
    menuMacro: document.getElementById("mixer-menu-macro-input")
  };

  var currentConfig = {};
  var currentContext = {};

  function safeText(value, fallback) {
    var text = String(value == null ? "" : value).trim();
    return text || String(fallback || "");
  }

  function setValue(node, value) {
    if (node) node.value = safeText(value, "");
  }

  function value(node, fallback) {
    return safeText(node && node.value, fallback);
  }

  function onInit(payload) {
    payload = payload || {};
    currentConfig = payload.config || {};
    currentContext = payload.context || {};
    var setup = currentConfig.initialSetup || {};
    setValue(nodes.title, currentConfig.title || "Quản lý máy pha chế");
    setValue(nodes.eyebrow, currentConfig.eyebrow || "ROSA Mixer Manager");
    setValue(nodes.subtitle, currentConfig.subtitle || "Quản lý máy pha chế, nguyên liệu, công thức, link public và API thiết bị theo batch.");
    setValue(nodes.distributor, setup.distributorName || "ROSA Mixer Demo");
    setValue(nodes.machine, setup.machineName || "Mixer 01");
    setValue(nodes.ioid, setup.ioid || currentConfig.defaultIoid || currentContext.ioid || "<<ioid>>");
    setValue(nodes.pageid, setup.pageId || "mixer-link-demo");
    setValue(nodes.stateMacro, currentConfig.stateMacro || "mixer-admin-state");
    setValue(nodes.positionsMacro, currentConfig.positionsMacro || "mixer-io-get-positions-8");
    setValue(nodes.stagesMacro, currentConfig.stagesMacro || "mixer-io-get-allstages-8");
    setValue(nodes.menuMacro, currentConfig.menuByNumberMacro || "mixer-io-query-menu-bynum");
  }

  function onCollect() {
    var ioid = value(nodes.ioid, currentContext.ioid || "<<ioid>>");
    var pageId = value(nodes.pageid, "mixer-link-demo").toLowerCase().replace(/[^a-z0-9._:-]/g, "-").slice(0, 128);
    if (!ioid) throw new Error("Hãy nhập IoID mặc định.");
    if (!pageId) throw new Error("Hãy nhập Page ID.");
    return Object.assign({}, currentConfig, {
      mode: "admin",
      locale: "vi",
      title: value(nodes.title, "Quản lý máy pha chế"),
      eyebrow: value(nodes.eyebrow, "ROSA Mixer Manager"),
      subtitle: value(nodes.subtitle, "Quản lý máy pha chế, nguyên liệu, công thức, link public và API thiết bị theo batch."),
      databaseSessionId: safeText(currentConfig.databaseSessionId, currentContext.sessionId || "<<sessionid>>"),
      syncId: safeText(currentConfig.syncId, currentContext.syncId || "<<syncid>>"),
      defaultIoid: ioid,
      stateMacro: value(nodes.stateMacro, "mixer-admin-state"),
      positionsMacro: value(nodes.positionsMacro, "mixer-io-get-positions-8"),
      stagesMacro: value(nodes.stagesMacro, "mixer-io-get-allstages-8"),
      menuByNumberMacro: value(nodes.menuMacro, "mixer-io-query-menu-bynum"),
      initialSetup: Object.assign({}, currentConfig.initialSetup || {}, {
        distributorName: value(nodes.distributor, "ROSA Mixer Demo"),
        machineName: value(nodes.machine, "Mixer 01"),
        ioid: ioid,
        pageId: pageId
      })
    });
  }

  if (window.DashboardSetupBridge) {
    window.DashboardSetupBridge.start({ onInit: onInit, onCollect: onCollect });
  }
})();
