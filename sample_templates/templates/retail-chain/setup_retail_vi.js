(function () {
  "use strict";

  var ids = ["title", "subtitle", "databaseSessionId", "syncId", "storeId", "defaultView", "pageSize"];
  var defaults = {
    title: "ROSA Retail Chain",
    subtitle: "Điều hành bán hàng, tồn kho và thiết bị",
    databaseSessionId: "<<sessionid>>",
    syncId: "<<syncid>>",
    storeId: "",
    defaultView: "overview",
    pageSize: 80,
    stream: { enabled: true, cooldownMs: 1800 }
  };

  function value(id) {
    var node = document.getElementById(id);
    return node ? String(node.value || "").trim() : "";
  }

  function set(id, next) {
    var node = document.getElementById(id);
    if (node) node.value = next == null ? "" : String(next);
  }

  function apply(config) {
    var next = Object.assign({}, defaults, config || {});
    ids.forEach(function (id) { set(id, next[id]); });
    var status = document.getElementById("status");
    if (status) status.textContent = "Sẵn sàng cấu hình.";
    window.DashboardSetupBridge.resize();
  }

  function collect() {
    var pageSize = Math.max(20, Math.min(300, Number(value("pageSize")) || 80));
    var view = value("defaultView");
    if (["overview", "machines", "inventory", "sales", "links", "users"].indexOf(view) < 0) view = "overview";
    return {
      title: value("title") || defaults.title,
      subtitle: value("subtitle") || defaults.subtitle,
      eyebrow: "Retail Operations",
      databaseSessionId: value("databaseSessionId") || defaults.databaseSessionId,
      syncId: value("syncId") || defaults.syncId,
      storeId: value("storeId"),
      defaultView: view,
      pageSize: pageSize,
      stream: { enabled: true, cooldownMs: 1800 }
    };
  }

  window.DashboardSetupBridge.start({
    onInit: function (payload) { apply(payload && payload.config ? payload.config : {}); },
    onCollect: collect
  });
  apply(defaults);
})();
