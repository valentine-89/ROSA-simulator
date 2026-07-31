(function () {
  var id = "smart-home-basic-cards-engine";
  if (document.getElementById(id)) return;
  var root = document.getElementById("basic-cards-root");
  function markReadOnlySensors() {
    document.querySelectorAll('.bc-card[data-tone="sensor"] .bc-switch-button, .bc-card[data-tone="alarm"] .bc-switch-button').forEach(function (button) {
      button.disabled = true;
      button.setAttribute("aria-label", "Chỉ hiển thị trạng thái cảm biến");
      button.setAttribute("title", "Cảm biến chỉ đọc");
    });
  }
  if (root && window.MutationObserver) {
    new MutationObserver(markReadOnlySensors).observe(root, { childList: true, subtree: true });
  }
  var script = document.createElement("script");
  script.id = id;
  script.src = "/dashboard-basic-cards-engine.js?v=2026.06.09.2";
  script.addEventListener("load", markReadOnlySensors);
  document.head.appendChild(script);
})();
