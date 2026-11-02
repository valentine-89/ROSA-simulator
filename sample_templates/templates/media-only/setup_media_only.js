(function () {
  "use strict";
  var base = {}, context = {};
  document.body.innerHTML = '<main class="shell"><header class="head"><div><h1>Cài đặt Media Only</h1><p>Mỗi màn hình dùng một Prefix riêng. Để trống để tiếp tục dùng field media như trước.</p></div></header>'
    + '<section class="panel"><div class="grid"><label>Prefix<input id="prefix" placeholder="frontdoor" maxlength="48" /></label><label>Field gốc<input id="field" value="media" /></label>'
    + '<p class="full">Telemetry: <strong id="field-preview">media</strong>. Ví dụ: frontdoor → frontdoor_media.</p>'
    + '<label class="full">Nội dung chờ<textarea id="defaultSignal"></textarea></label></div></section>'
    + '<details class="panel"><summary>Nâng cao</summary><div class="grid"><label>Email hoặc Device key<input id="sessionId" /></label><label>SyncID hệ thống<input id="syncId" /></label><label>Khoảng đọc stream (ms)<input id="historyMs" type="number" min="0" max="604800000" /></label></div></details></main>';
  var el = function (id) { return document.getElementById(id); };
  function preview() {
    var prefix = el('prefix').value.trim();
    el('field-preview').textContent = (prefix ? prefix + '_' : '') + (el('field').value.trim() || 'media');
  }
  el('prefix').addEventListener('input', preview);
  el('field').addEventListener('input', preview);
  DashboardSetupBridge.start({
    onInit: function (payload) {
      base = JSON.parse(JSON.stringify(payload.config || {})); context = payload.context || {};
      el('prefix').value = base.prefix || '';
      el('field').value = base.field || 'media';
      el('sessionId').value = base.sessionId && !base.sessionId.includes('<<') ? base.sessionId : context.sessionId || '';
      el('syncId').value = base.syncId && !base.syncId.includes('<<') ? base.syncId : context.syncId || '';
      el('defaultSignal').value = base.defaultSignal || 'text@ani1:Waiting for media';
      el('historyMs').value = base.historyMs == null ? 86400000 : base.historyMs;
      preview();
    },
    onCollect: function () {
      var prefix = el('prefix').value.trim(), field = el('field').value.trim() || 'media';
      if (!/^[A-Za-z0-9_-]{0,48}$/.test(prefix)) throw Error('Prefix tối đa 48 ký tự: chữ không dấu, số, dấu _ hoặc -.');
      if (!/^[A-Za-z0-9_.#-]{1,64}$/.test(field)) throw Error('Field gốc không hợp lệ.');
      var history = Number(el('historyMs').value);
      if (!Number.isInteger(history) || history < 0 || history > 604800000) throw Error('Khoảng đọc stream từ 0 đến 604800000 ms.');
      return Object.assign({}, base, { prefix: prefix, field: field,
        sessionId: el('sessionId').value.trim() || context.sessionId || '',
        syncId: el('syncId').value.trim() || context.syncId || '',
        defaultSignal: el('defaultSignal').value.trim() || 'text@ani1:Waiting for media', historyMs: history });
    }
  });
})();
