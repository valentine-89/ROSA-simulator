(function () {
  'use strict';
  var M = window.MediaScreens, el = function (id) { return document.getElementById(id); };
  var config = JSON.parse(el('media-manager-config').textContent), context = { sessionId: config.sessionId, syncId: config.syncId };
  var publicNode = el('media-page-context');
  if (publicNode) context = JSON.parse(publicNode.textContent);
  // Build the interactive layout from the dashboard's stable form elements.
  // Saved dashboards keep their own HTML; all instances use this same renderer.
  var main = document.querySelector('main'); main.id = 'media-manager';
  main.querySelectorAll('header p, :scope > p.hint').forEach(function (item) { item.remove(); });
  var shareLink = el('manager-link'); if (shareLink) shareLink.parentElement.remove();
  var theme = el('theme'); if (theme) (theme.closest('label') || theme).remove();
  document.documentElement.dataset.theme = 'modern-flat';
  var form = el('screen-form'), formContainer = form.parentElement;
  var dialog = document.createElement('dialog'); dialog.id = 'screen-dialog';
  var formHeading = document.createElement('div'); formHeading.className = 'section-heading';
  var cancel = el('cancel'); cancel.textContent = '×'; cancel.setAttribute('aria-label', 'Đóng');
  formHeading.append(el('form-title'), cancel); dialog.append(formHeading, form);
  formContainer.remove(); document.body.appendChild(dialog);
  var fieldPreview = el('field-preview'); el('prefix').parentElement.appendChild(fieldPreview);
  fieldPreview.className = 'field-preview';
  form.querySelectorAll('p.hint').forEach(function (item) { item.remove(); });
  var formStatus = el('form-status'); if (formStatus) formStatus.remove();
  formStatus = document.createElement('p'); formStatus.id = 'form-status'; formStatus.setAttribute('role', 'status'); formStatus.hidden = true; form.appendChild(formStatus);
  var add = el('add'); if (add) add.remove();
  add = document.createElement('button'); add.id = 'add'; add.type = 'button'; add.className = 'primary'; add.textContent = 'Thêm màn hình';
  var refreshButton = el('refresh'), listHeading = refreshButton.closest('.section-heading');
  var toolbar = document.createElement('div'); toolbar.className = 'actions'; toolbar.append(refreshButton, add);
  listHeading.querySelectorAll('.actions').forEach(function (item) { item.remove(); }); listHeading.appendChild(toolbar);
  listHeading.parentElement.classList.remove('panel');
  var rows = [], editing = null, busy = false, pendingDelete = null;
  var ioid = context.ioid || (/^IO/.test(context.sessionId || '') ? String(context.sessionId).split('@')[0] : context.sessionId);
  el('title').textContent = config.title || 'Quản lý màn hình';
  function status(message, error) {
    ['status', 'form-status'].forEach(function (id) {
      el(id).textContent = message; el(id).dataset.error = String(!!error); el(id).hidden = !message;
    });
  }
  function lock(value) { busy = value; document.querySelectorAll('button').forEach(function (b) { b.disabled = value; }); }
  function preview() { try { el('field-preview').textContent = M.field(el('prefix').value); } catch (e) { el('field-preview').textContent = e.message; } }
  function reset() {
    editing = null; el('screen-form').reset(); el('form-title').textContent = 'Thêm màn hình'; el('save').textContent = 'Tạo màn hình'; preview();
  }
  function edit(row) {
    editing = row; el('name').value = row.name; el('prefix').value = row.prefix;
    el('default-signal').value = row.default_signal; el('macros').value = JSON.parse(row.allowed_macros).join(', ');
    el('enabled').checked = !!Number(row.enabled);
    el('form-title').textContent = 'Sửa màn hình'; el('save').textContent = 'Lưu thay đổi'; preview(); status(''); el('screen-dialog').showModal(); el('name').focus();
  }
  function node(tag, text, className) { var item = document.createElement(tag); item.textContent = text; if (className) item.className = className; return item; }
  function render() {
    el('count').textContent = String(rows.length); el('screens').replaceChildren();
    if (!rows.length) el('screens').appendChild(node('p', 'Chưa có màn hình.', 'hint'));
    rows.forEach(function (row) {
      var card = node('article', '', 'screen-card'); card.dataset.screenId = row.screen_id;
      var heading = node('div', '', 'screen-heading');
      heading.appendChild(node('h3', row.name)); heading.appendChild(node('span', Number(row.enabled) ? 'Đang bật' : 'Đã tắt', 'badge'));
      card.appendChild(heading); card.appendChild(node('p', M.field(row.prefix), 'field'));
      var links = node('div', '', 'actions');
      [['Điều khiển', row.control_page_id], ['Hiển thị', row.display_page_id]].forEach(function (pair) {
        var link = node('a', pair[0], 'button'); link.href = '/iot-page/' + encodeURIComponent(ioid) + '/' + encodeURIComponent(pair[1]); link.target = '_blank'; link.rel = 'noopener'; links.appendChild(link);
      }); card.appendChild(links);
      var actions = links;
      var editButton = node('button', 'Sửa'); editButton.type = 'button'; editButton.onclick = function () { if (!busy) edit(row); }; actions.appendChild(editButton);
      var remove = node('button', 'Xóa', 'danger'); remove.type = 'button'; remove.onclick = function () {
        if (busy) return; pendingDelete = row; el('delete-message').textContent = 'Xóa “' + row.name + '” và hai trang liên kết?'; el('delete-dialog').showModal();
      }; actions.appendChild(remove); card.appendChild(actions); el('screens').appendChild(card);
    });
  }
  async function load() {
    var result = await M.macro(context, 'media-screens-list');
    // ROSA represents an empty SQL result as [{c1: 'ok'}]. It is not a screen.
    rows = result.filter(function (row) {
      return row && /^[a-f0-9]{32}$/.test(row.screen_id || '') &&
        row.control_page_id === 'media-control-' + row.screen_id && row.display_page_id === 'media-display-' + row.screen_id;
    });
    render();
  }
  async function refresh() {
    if (busy) return; lock(true);
    try { await load(); status(''); }
    catch (e) { status('Không tải được danh sách. Kiểm tra profile và nạp cơ sở dữ liệu mẫu Media Only Manager. ' + e.message, true); }
    finally { lock(false); }
  }
  async function mutate(task) {
    if (busy) return; lock(true);
    try { await task(); reset(); el('screen-dialog').close(); await load(); status(''); }
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
      mutate(function () { return M.macro(context, 'media-screen-save', params); });
    } catch (e) { status(e.message, true); }
  });
  el('delete-dialog').addEventListener('close', function () {
    var row = pendingDelete; pendingDelete = null;
    if (el('delete-dialog').returnValue !== 'delete' || !row) return;
    mutate(function () { return M.macro(context, 'media-screen-delete', { screen_id: row.screen_id, revision: row.revision }); });
  });
  el('add').onclick = function () { reset(); status(''); el('screen-dialog').showModal(); };
  el('cancel').onclick = function () { el('screen-dialog').close(); }; el('refresh').onclick = refresh; el('prefix').oninput = preview;
  reset();
  if (context.pageId) { refresh(); }
  else if (!context.sessionId || !context.syncId || context.syncId.includes('<<') || context.sessionId.includes('<<')) {
    status('Mở setup để lấy email và SyncID hệ thống của tài khoản.', true); lock(true);
  } else {
    refresh();
  }
})();
