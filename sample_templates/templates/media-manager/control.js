(function () {
  'use strict';
  var M = window.MediaScreens, el = function (id) { return document.getElementById(id); };
  var page = JSON.parse(el('media-page-context').textContent), meta = JSON.parse(el('media-page-meta').textContent), screen = meta.mediaScreen;
  var busy = false, ready = false, stream = null;
  document.documentElement.dataset.theme = 'modern-flat';
  document.querySelectorAll('#refresh, #signal-preview, #controller > p.hint, #controller .eyebrow').forEach(function (item) { item.remove(); });
  el('current').previousElementSibling.textContent = 'Đang hiển thị';
  el('current').textContent = 'Chưa có nội dung'; el('send').textContent = 'Gửi'; el('waiting').textContent = 'Nội dung chờ';
  function status(message, error) { el('status').textContent = message; el('status').dataset.error = String(!!error); el('status').hidden = !message; }
  function lock(value) { busy = value; ['send', 'waiting'].forEach(function (id) { el(id).disabled = value || !ready; }); }
  function signal() { return el('kind').value === 'raw' ? el('content').value.trim() : el('kind').value + '@' + el('style').value + ':' + el('content').value.trim(); }
  function preview() {
    el('style').disabled = el('kind').value === 'raw';
    el('content-label').textContent = ({ text: 'Văn bản', data: 'Tên macro được phép hiển thị', raw: 'Chuỗi media đầy đủ' })[el('kind').value] || 'Đường dẫn HTTPS';
  }
  async function checkPage() {
    var current = (await M.macro(page, 'media-screen-get'))[0];
    if (!current || !Number(current.enabled) || current.screen_id !== screen.id) throw Error('Trang đã tắt hoặc bị xóa.');
    var latest = Object.assign({}, screen, { prefix: current.prefix, defaultSignal: current.default_signal });
    if (latest.prefix !== screen.prefix) throw Error('Prefix đã thay đổi. Hãy tải lại trang trước khi gửi.');
    screen = latest;
  }
  function connect() {
    if (stream) stream.close();
    stream = new EventSource('/api/iot-page-realtime/' + encodeURIComponent(page.ioid) + '/' + encodeURIComponent(page.pageId) + '?historyMs=0');
    stream.onopen = function () { if (!busy && el('status').dataset.error !== 'true') status(''); };
    stream.onmessage = function (event) {
      try {
        var data = JSON.parse(event.data), payload = data.type === 'telemetry' && data.payload;
        if (!payload || !Object.prototype.hasOwnProperty.call(payload, M.field(screen.prefix))) return;
        var value = String(payload[M.field(screen.prefix)] || '');
        var parsed = value.match(/^(?:text|image|web|video|youtube|audio|data)(?:@[^:]+)?:([\s\S]*)$/i);
        el('current').textContent = (parsed ? parsed[1] : value) || 'Chưa có nội dung';
      } catch (_) {}
    };
    stream.onerror = function () { if (el('status').dataset.error !== 'true') status('Đang kết nối lại…'); };
  }
  async function send(value) {
    if (busy || !ready) return;
    try { var payload = M.telemetry(screen.prefix, value); } catch (e) { status(e.message, true); return; }
    lock(true); status('Đang gửi…');
    try {
      await checkPage();
      await M.json('/api/iot-page-telemetry/' + encodeURIComponent(page.ioid) + '/' + encodeURIComponent(page.pageId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      status('');
    } catch (e) { status('Chưa xác nhận được lần gửi. ' + e.message, true); }
    finally { lock(false); }
  }
  el('title').textContent = screen.name; el('field').textContent = screen.prefix || ''; el('field').hidden = !screen.prefix;
  el('display-link').href = '/iot-page/' + encodeURIComponent(page.ioid) + '/media-display-' + screen.id;
  el('control-form').onsubmit = function (event) { event.preventDefault(); send(signal()); };
  el('waiting').onclick = function () { send(screen.defaultSignal); };
  ['kind', 'style', 'content'].forEach(function (id) { el(id).addEventListener('input', preview); }); preview();
  window.addEventListener('pagehide', function () { if (stream) { stream.close(); stream = null; } });
  window.addEventListener('pageshow', function (event) { if (event.persisted && ready) connect(); });
  checkPage().then(function () { ready = true; lock(false); status('Đang kết nối…'); connect(); }).catch(function (e) { status(e.message, true); });
})();
