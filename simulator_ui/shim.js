(function () {
  "use strict";
  if (window.__rosaSimulatorShimInstalled) return;
  window.__rosaSimulatorShimInstalled = true;

  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!nativeFetch) return;

  function commandUrl(input) {
    var raw = "";
    if (typeof input === "string") raw = input;
    else if (input && input.url) raw = input.url;
    if (!/^https:\/\/iot\.ioeasy\.com\/cmd\//i.test(raw)) return null;
    try {
      var url = new URL(raw);
      var parts = url.pathname.split("/");
      return "/sim/api/cmd/" + encodeURIComponent(decodeURIComponent(parts[2] || ""));
    } catch (error) {
      return null;
    }
  }

  window.fetch = function (input, init) {
    var localUrl = commandUrl(input);
    if (!localUrl) return nativeFetch(input, init);
    return nativeFetch(localUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: init && init.body ? init.body : JSON.stringify({ cmd: "" })
    });
  };
})();
