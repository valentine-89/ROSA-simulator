(function () {
  'use strict';
  var base = {}, get = function (id) { return document.getElementById(id); };
  DashboardSetupBridge.start({
    onInit: function (payload) {
      base = Object.assign({}, payload.config); var context = payload.context || {};
      get('title').value = base.title || 'Quản lý màn hình';
      ['sessionId', 'syncId'].forEach(function (key) { get(key).value = base[key] && !base[key].includes('<<') ? base[key] : context[key] || ''; });
    },
    onCollect: function () {
      var next = Object.assign({}, base, { title: get('title').value.trim(), sessionId: get('sessionId').value.trim(), syncId: get('syncId').value.trim() });
      if (!next.title) throw Error('Hãy nhập tên dashboard.');
      if (!/^(?:IO[^@\s]+@[^\s]+|[^\s@/]+@[^\s@/]+\.[^\s@/]+)$/.test(next.sessionId) || !next.syncId) throw Error('Cần email và SyncID hệ thống của email đó, hoặc profile IoT hợp lệ.');
      next.managerId = /^[a-f0-9]{32}$/.test(base.managerId || '') ? base.managerId : crypto.randomUUID().replace(/-/g, '');
      return next;
    }
  });
})();
