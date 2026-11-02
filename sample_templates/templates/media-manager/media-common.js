(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MediaScreens = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function field(prefix) {
    prefix = String(prefix || '').trim();
    if (!/^[A-Za-z0-9_-]{0,48}$/.test(prefix)) throw Error('Prefix tối đa 48 ký tự: chữ không dấu, số, dấu _ hoặc -.');
    return (prefix ? prefix + '_' : '') + 'media';
  }
  function macros(value) {
    var result = String(value || '').split(/[\s,]+/).filter(Boolean);
    if (result.length > 20 || result.some(function (name) { return !/^[A-Za-z0-9._:-]{1,128}$/.test(name); })) throw Error('Danh sách macro không hợp lệ (tối đa 20 tên).');
    return Array.from(new Set(result));
  }
  function telemetry(prefix, signal) {
    var payload = {}; payload[field(prefix)] = String(signal || '').trim();
    if (!payload[field(prefix)]) throw Error('Hãy nhập nội dung.');
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 4096) throw Error('Nội dung quá dài (tối đa 4096 byte gồm tên field).');
    return payload;
  }
  function profileContext(data, ioid) {
    var profile = (data.profiles || []).find(function (item) {
      return String(item.backendUrl || '').split('@')[0] === ioid && /^IO[^@\s]+@[^\s]+$/.test(item.backendUrl || '');
    });
    if (!profile) throw Error('Hãy đăng nhập tài khoản có profile của màn hình này.');
    var syncId = String(profile.syncId || data.defaultSyncId || '').trim();
    if (!syncId) throw Error('Profile chưa có AccountID tính phí.');
    return { sessionId: profile.backendUrl, syncId: syncId };
  }
  async function json(url, options) {
    var response = await fetch(url, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, options));
    var data = await response.json();
    if (!response.ok || data.ok === false || data.error || (typeof data.c1 === 'string' && data.c1 !== 'ok')) {
      throw Error(data.message || data.error || data.c1 || 'Không thể hoàn tất yêu cầu.');
    }
    return data;
  }
  function dataUrl(context, action) {
    return '/api/' + encodeURIComponent(context.sessionId) + '/' + encodeURIComponent(context.syncId) + '/' + action;
  }
  async function macro(context, name, params) {
    var result = await json(context.pageId ? '/api/iot-page-macro/' + encodeURIComponent(context.ioid) + '/' + encodeURIComponent(context.pageId) : dataUrl(context, 'data'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(context.pageId ? { macro: name, params: params || {} } : Object.assign({ macro: name }, params)) });
    return Array.isArray(result) ? result : result.rows || [];
  }
  return { field: field, macros: macros, telemetry: telemetry, profileContext: profileContext, json: json, dataUrl: dataUrl, macro: macro };
});
