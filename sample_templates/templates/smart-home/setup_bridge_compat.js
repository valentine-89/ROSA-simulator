(function () {
  "use strict";

  var parentOrigin = "*";

  function post(type, payload) {
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage({ type: type, payload: payload || {} }, parentOrigin);
  }

  function resize() {
    window.requestAnimationFrame(function () {
      post("dashboardSetup:resize", {
        height: Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 560)
      });
    });
  }

  function error(message) {
    post("dashboardSetup:error", { message: String(message || "Cấu hình chưa hợp lệ.") });
  }

  function submit(config) {
    post("dashboardSetup:submit", { config: config });
  }

  function start(handlers) {
    var safeHandlers = handlers || {};
    window.addEventListener("message", function (event) {
      if (event.source !== window.parent) return;
      var data = event.data && typeof event.data === "object" ? event.data : null;
      if (!data || !data.type) return;
      if (event.origin && event.origin !== "null") parentOrigin = event.origin;

      if (data.type === "dashboardSetup:init" && typeof safeHandlers.onInit === "function") {
        safeHandlers.onInit(data.payload || {});
        resize();
        return;
      }
      if (data.type === "dashboardSetup:collect" && typeof safeHandlers.onCollect === "function") {
        try { submit(safeHandlers.onCollect()); }
        catch (collectError) { error(collectError && collectError.message ? collectError.message : "Cấu hình chưa hợp lệ."); }
      }
    });

    if (window.ResizeObserver) new ResizeObserver(resize).observe(document.body);
    post("dashboardSetup:ready");
    resize();
  }

  window.DashboardSetupBridge = { error: error, resize: resize, start: start, submit: submit };
})();
