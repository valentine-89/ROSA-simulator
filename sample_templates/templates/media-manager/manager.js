(function () {
  'use strict';
  var M = window.MediaScreens, el = function (id) { return document.getElementById(id); };
  var config = JSON.parse(el('media-manager-config').textContent), context = { sessionId: config.sessionId, syncId: config.syncId };
  var publicNode = el('media-page-context');
  if (publicNode) context = JSON.parse(publicNode.textContent);
  var rows = [], editing = null, busy = false, pendingDelete = null;
  var ioid = context.ioid || (/^IO/.test(context.sessionId || '') ? String(context.sessionId).split('@')[0] : context.sessionId);
  el('title').textContent = config.title || 'Quản lý màn hình';
  function status(message, error) { el('status').textContent = message; el('status').dataset.error = String(!!error); }
  function lock(value) { busy = value; document.querySelectorAll('button').forEach(function (b) { b.disabled = value; }); }
  function preview() { try { el('field-preview').textContent = M.field(el('prefix').value); } catch (e) { el('field-preview').textContent = e.message; } }
  function reset() {
    editing = null; el('screen-form').reset(); el('form-title').textContent = 'Thêm màn hình'; el('save').textContent = 'Tạo cặp trang'; preview();
  }
  function edit(row) {
    editing = row; el('name').value = row.name; el('prefix').value = row.prefix;
    el('default-signal').value = row.default_signal; el('macros').value = JSON.parse(row.allowed_macros).join(', ');
    el('enabled').checked = !!Number(row.enabled);
    el('form-title').textContent = 'Sửa màn hình'; el('save').textContent = 'Lưu thay đổi'; preview(); el('name').focus();
  }
  function node(tag, text, className) { var item = document.createElement(tag); item.textContent = text; if (className) item.className = className; return item; }
  function render() {
    el('count').textContent = String(rows.length); el('screens').replaceChildren();
    if (!rows.length) el('screens').appendChild(node('p', 'Chưa có màn hình. Thêm màn hình đầu tiên bên dưới.', 'hint'));
    rows.forEach(function (row) {
      var card = node('article', '', 'screen-card'); card.dataset.screenId = row.screen_id;
      card.appendChild(node('span', Number(row.enabled) ? 'Đang bật' : 'Đã tắt', 'badge'));
      card.appendChild(node('h3', row.name)); card.appendChild(node('p', M.field(row.prefix), 'field'));
      var links = node('div', '', 'actions');
      [['Điều khiển', row.control_page_id], ['Hiển thị', row.display_page_id]].forEach(function (pair) {
        var link = node('a', pair[0], 'button'); link.href = '/iot-page/' + encodeURIComponent(ioid) + '/' + encodeURIComponent(pair[1]); link.target = '_blank'; link.rel = 'noopener'; links.appendChild(link);
      }); card.appendChild(links);
      var actions = node('div', '', 'actions');
      var editButton = node('button', 'Sửa'); editButton.type = 'button'; editButton.onclick = function () { if (!busy) edit(row); }; actions.appendChild(editButton);
      var remove = node('button', 'Xóa', 'danger'); remove.type = 'button'; remove.onclick = function () {
        if (busy) return; pendingDelete = row; el('delete-message').textContent = 'Xóa hai trang của “' + row.name + '”. Dữ liệu telemetry đã gửi vẫn được giữ.'; el('delete-dialog').showModal();
      }; actions.appendChild(remove); card.appendChild(actions); el('screens').appendChild(card);
    });
  }
  async function load() { rows = await M.macro(context, 'media-screens-list'); render(); }
  async function refresh() {
    if (busy) return; lock(true);
    try { await load(); status('Đã tải ' + rows.length + ' màn hình.'); }
    catch (e) { status('Không tải được danh sách. Kiểm tra profile và nạp cơ sở dữ liệu mẫu Media Only Manager. ' + e.message, true); }
    finally { lock(false); }
  }
  async function mutate(task, message) {
    if (busy) return; lock(true);
    try { await task(); reset(); await load(); status(message); }
    catch (e) {
      // The server may have committed before a response was lost. Read back;
      // never replay the mutation automatically or roll back another writer.
      try { await load(); } catch (_) {}
      status('Chưa xác nhận được thao tác. Kiểm tra danh sách rồi bấm Sửa để lấy bản mới trước khi thử lại. ' + e.message, true);
    } finally { lock(false); }
  }
  el('screen-form').addEventListener('submit', function (event) {
    event.preventDefault(); if (busy) return;
    try {
      var prefix = el('prefix').value.trim(); M.field(prefix);
      var params = { screen_id: editing ? editing.screen_id : crypto.randomUUID().replace(/-/g, ''), revision: editing ? editing.revision : 0,
        name: el('name').value.trim(), prefix: prefix, default_signal: el('default-signal').value.trim() || 'text@ani1:Chào mừng',
        allowed_macros: JSON.stringify(M.macros(el('macros').value)), enabled: el('enabled').checked ? 1 : 0, display_login: 0 };
      mutate(function () { return M.macro(context, 'media-screen-save', params); }, editing ? 'Đã cập nhật cặp trang. Tải lại các trang đang mở để dùng cấu hình mới.' : 'Đã tạo trang điều khiển và trang hiển thị.');
    } catch (e) { status(e.message, true); }
  });
  el('delete-dialog').addEventListener('close', function () {
    var row = pendingDelete; pendingDelete = null;
    if (el('delete-dialog').returnValue !== 'delete' || !row) return;
    mutate(function () { return M.macro(context, 'media-screen-delete', { screen_id: row.screen_id, revision: row.revision }); }, 'Đã xóa cặp trang.');
  });
  el('cancel').onclick = reset; el('refresh').onclick = refresh; el('prefix').oninput = preview;
  try { var theme = localStorage.getItem('sample-dashboard-theme'); if (Array.from(el('theme').options).some(function (o) { return o.value === theme; })) el('theme').value = theme; } catch (_) {}
  function setTheme() { document.documentElement.dataset.theme = el('theme').value; try { localStorage.setItem('sample-dashboard-theme', el('theme').value); } catch (_) {} }
  el('theme').onchange = setTheme; setTheme(); preview();
  if (context.pageId) { el('manager-link').hidden = true; refresh(); }
  else if (!context.sessionId || !context.syncId || context.syncId.includes('<<') || context.sessionId.includes('<<')) {
    status('Mở setup để lấy email và SyncID hệ thống của tài khoản.', true); lock(true);
  } else {
    if (!/^[a-f0-9]{32}$/.test(config.managerId || '')) {
      var storageKey = 'media-manager-id:' + ioid;
      try { config.managerId = localStorage.getItem(storageKey); } catch (_) {}
      if (!/^[a-f0-9]{32}$/.test(config.managerId || '')) config.managerId = crypto.randomUUID().replace(/-/g, '');
      try { localStorage.setItem(storageKey, config.managerId); } catch (_) {}
    }
    lock(true);
    M.macro(context, 'media-manager-publish', { manager_id: config.managerId, title: config.title || 'Quản lý màn hình' }).then(function (result) {
      el('manager-link').href = '/iot-page/' + encodeURIComponent(ioid) + '/' + result[0].page_id;
      el('manager-link').hidden = false; lock(false); refresh();
    }).catch(function (e) { status('Nạp database mẫu ở chế độ Gộp rồi mở lại dashboard. ' + e.message, true); lock(false); });
  }
})();
