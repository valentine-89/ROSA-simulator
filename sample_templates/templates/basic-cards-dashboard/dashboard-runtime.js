(function () {
  var scriptId = 'basic-cards-engine-loader';
  if (document.getElementById(scriptId)) {
    return;
  }
  var script = document.createElement('script');
  script.id = scriptId;
  script.src = '/dashboard-basic-cards-engine.js?v=2026.06.09.2';
  document.head.appendChild(script);
})();
