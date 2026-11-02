(function () {
  'use strict';
  var M = window.MediaScreens, el = function (id) { return document.getElementById(id); };
  var page = JSON.parse(el('media-page-context').textContent), meta = JSON.parse(el('media-page-meta').textContent), screen = meta.mediaScreen;
  var busy = false, ready = false;
  function status(message, error) { el('status').textContent = message; el('status').dataset.error = String(!!error); }
  function lock(value) { busy = value; ['send', 'waiting', 'refresh'].forEach(function (id) { el(id).disabled = value || !ready; }); }
  function signal() { return el('kind').value === 'raw' ? el('content').value.trim() : el('kind').value + '@' + el('style').value + ':' + el('content').value.trim(); }
  function preview() {
    el('signal-preview').textContent = signal(); el('style').disabled = el('kind').value === 'raw';
    el('content-label').textContent = ({ text: 'Văn bản', data: 'Tên macro được phép hiển thị', raw: 'Chuỗi media đầy đủ' })[el('kind').value] || 'Đường dẫn HTTPS';
  }
  async function checkPage() {
    var current = (await M.macro(page, 'media-screen-get'))[0];
    if (!current || !Number(current.enabled) || current.screen_id !== screen.id) throw Error('Trang đã tắt hoặc bị xóa.');
    var latest = Object.assign({}, screen, { prefix: current.prefix, defaultSignal: current.default_signal });
    if (latest.prefix !== screen.prefix) throw Error('Prefix đã thay đổi. Hãy tải lại trang trước khi gửi.');
    screen = latest;
  }
  async function read() {
    var data = await M.json('/api/iot-page-telemetry/' + encodeURIComponent(page.ioid) + '/' + encodeURIComponent(page.pageId));
    var payload = data.c2 && data.c2.payload;
    el('current').textContent = payload && Object.prototype.hasOwnProperty.call(payload, M.field(screen.prefix)) ? payload[M.field(screen.prefix)] : 'Chưa có nội dung telemetry.';
  }
  async function send(value) {
    if (busy || !ready) return;
    try { var payload = M.telemetry(screen.prefix, value); } catch (e) { status(e.message, true); return; }
    lock(true);
    try {
      await checkPage();
      await M.json('/api/iot-page-telemetry/' + encodeURIComponent(page.ioid) + '/' + encodeURIComponent(page.pageId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      el('current').textContent = value; status('Đã ghi nội dung vào ' + M.field(screen.prefix) + '.');
    } catch (e) { status('Chưa xác nhận được nội dung mới. Đọc lại trước khi gửi lại. ' + e.message, true); }
    finally { lock(false); }
  }
  el('title').textContent = screen.name; el('field').textContent = M.field(screen.prefix);
  el('display-link').href = '/iot-page/' + encodeURIComponent(page.ioid) + '/media-display-' + screen.id;
  el('control-form').onsubmit = function (event) { event.preventDefault(); send(signal()); };
  el('waiting').onclick = function () { send(screen.defaultSignal); };
  el('refresh').onclick = async function () { if (busy) return; lock(true); try { await checkPage(); await read(); status('Đã đọc lại nội dung.'); } catch (e) { status(e.message, true); } finally { lock(false); } };
  ['kind', 'style', 'content'].forEach(function (id) { el(id).addEventListener('input', preview); }); preview();
  checkPage().then(async function () { ready = true; lock(false); status('Sẵn sàng gửi nội dung.'); try { await read(); } catch (_) { el('current').textContent = 'Chưa đọc được telemetry. Có thể gửi nội dung đầu tiên.'; } }).catch(function (e) { status(e.message, true); });
})();
