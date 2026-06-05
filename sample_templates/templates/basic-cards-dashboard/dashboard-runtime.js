(function () {
  var scriptId = 'basic-cards-engine-loader';
  if (document.getElementById(scriptId)) {
    return;
  }
  var script = document.createElement('script');
  script.id = scriptId;
  script.src = '/dashboard-basic-cards-engine.js';
  document.head.appendChild(script);
})();
