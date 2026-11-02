'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { fixture, INPUT, publicApi } = require('./fixture.cjs');
const M = require('./media-common.js');
const { displayHtml, macros } = require('./definition.cjs');
function withDb(fn) { const f = fixture(); try { fn(f); } finally { f.db.close(); } }
test('three prefixed screens plus legacy blank create independent page pairs and scopes', () => withDb(f => {
  ['', 'frontdoor', 'backdoor', 'livingroom'].forEach((prefix, i) => f.save({ screen_id: String(i).repeat(32), prefix }));
  assert.equal(f.pages().length, 8);
  assert.equal(f.db.prepare('SELECT count(*) n FROM system_cmds').get().n, 0);
  for (const page of f.pages()) {
    const meta = JSON.parse(page.meta), config = publicApi.parsePublicPageApiConfig(page);
    assert.equal(config.fields.join(','), M.field(meta.mediaScreen.prefix));
    assert.equal(config.macros.size, meta.mediaScreen.role === 'control' ? 1 : 0);
    assert.equal(page.require_email, 0);
    assert.equal(config.writeFields.length, meta.mediaScreen.role === 'control' ? 1 : 0);
    assert.equal(page.sync_id, INPUT.sync_id);
    assert(!page.html.includes(INPUT.sync_id)); assert(!page.meta.includes(INPUT.sync_id));
  }
}));
test('rename and prefix edit keep links, update both page scopes, reject stale edits and deletes', () => withDb(f => {
  f.save(); const ids = f.pages().map(p => p.page_id);
  const changed = f.save({ revision: 1, name: 'Phòng khách', prefix: 'livingroom', display_login: 1, enabled: 0 })[0];
  assert.equal(changed.revision, 2); assert.deepEqual(f.pages().map(p => p.page_id), ids);
  for (const p of f.pages()) { assert.equal(p.enabled, 0); assert.equal(p.require_email, 0); assert.deepEqual(JSON.parse(p.meta).publicApi.fields, ['livingroom_media']); }
  assert.throws(() => f.save({ revision: 1 }));
  assert.throws(() => f.run('media-screen-delete', { screen_id: INPUT.screen_id, revision: 1 }));
  assert.equal(f.pages().length, 2);
}));
test('duplicate and blank prefixes may intentionally share fields', () => withDb(f => {
  f.save(); f.save({ screen_id: 'b'.repeat(32), prefix: 'frontdoor' });
  f.save({ screen_id: 'c'.repeat(32), prefix: '' });
  f.save({ screen_id: 'd'.repeat(32), prefix: '' });
  assert.equal(f.pages().length, 8);
  assert.throws(() => f.save({ prefix: 'bad prefix', revision: 1 }));
  assert.equal(f.run('media-screen-get', { screen_id: INPUT.screen_id })[0].prefix, 'frontdoor');
}));
test('failure creating second page rolls back first page and screen', () => withDb(f => {
  f.db.exec("CREATE TRIGGER fail_display BEFORE INSERT ON system_pages WHEN NEW.page_id LIKE 'media-control-%' BEGIN SELECT RAISE(ABORT,'FAULT'); END;");
  assert.throws(() => f.save(), /FAULT/); assert.equal(f.pages().length, 0); assert.equal(f.run('media-screens-list').length, 0);
}));
test('unrelated page collision is preserved and delete only removes selected owned pair', () => withDb(f => {
  const id = 'media-display-' + INPUT.screen_id;
  f.db.prepare('INSERT INTO system_pages(page_id,html,sync_id) VALUES(?,?,?)').run(id, 'keep', 'OTHER');
  assert.throws(() => f.save()); assert.equal(f.pages()[0].html, 'keep');
  f.save({ screen_id: 'b'.repeat(32) }); f.save({ screen_id: 'c'.repeat(32), prefix: 'backdoor' });
  f.run('media-screen-delete', { screen_id: 'b'.repeat(32), revision: 1 });
  assert.equal(f.pages().length, 3); assert.equal(f.db.prepare('SELECT html FROM system_pages WHERE page_id=?').get(id).html, 'keep');
  assert.equal(f.run('media-screens-list')[0].prefix, 'backdoor');
}));
test('external replacement of managed page is never overwritten or deleted', () => withDb(f => {
  f.save(); f.db.exec("UPDATE system_pages SET meta='{}',html='external' WHERE page_id LIKE 'media-display-%'");
  assert.throws(() => f.save({ revision: 1 }));
  assert.throws(() => f.run('media-screen-delete', { screen_id: INPUT.screen_id, revision: 1 }));
  assert.equal(f.pages().find(p => p.page_id.includes('display')).html, 'external');
}));
test('public macro allowlist includes only selected macros on display, never admin CRUD', () => withDb(f => {
  f.save({ allowed_macros: '["production-overview"]' });
  for (const p of f.pages()) {
    const config = publicApi.parsePublicPageApiConfig(p);
    assert.equal(config.macros.size, 1);
    assert.throws(() => publicApi.resolvePublicPageMacro(config, 'media-screen-save'));
  }
  assert.throws(() => f.save({ revision: 1, allowed_macros: '["bad name"]' }));
}));
test('telemetry payload changes one exact field, preserves Unicode and enforces byte limit', () => {
  assert.deepEqual(M.telemetry('frontdoor', 'text@ani1:Xin chào'), { frontdoor_media: 'text@ani1:Xin chào' });
  assert.deepEqual(M.telemetry('', 'text:x'), { media: 'text:x' });
  assert.throws(() => M.telemetry('frontdoor', 'ế'.repeat(2000)), /4096/);
  assert.throws(() => M.field('frontdoor,backdoor'));
});
test('anonymous manager grants CRUD while controller fixes screen context', () => withDb(f => {
  f.run('media-manager-publish', { manager_id: 'e'.repeat(32), title: 'Quản lý', sync_id: INPUT.sync_id });
  const manager = f.pages()[0], config = publicApi.parsePublicPageApiConfig(manager);
  assert.equal(manager.require_email, 0); assert.equal(config.macros.size, 3);
  assert(!manager.html.includes(INPUT.sync_id));
  const spec = publicApi.resolvePublicPageMacro(config, 'media-screen-save');
  const { sync_id, ...params } = INPUT;
  assert.equal(publicApi.normalizePublicPageParams(params, spec, config.context).prefix, 'frontdoor');
  f.save();
  const controller = f.pages().find(p => p.page_id.startsWith('media-control-'));
  const ctrl = publicApi.parsePublicPageApiConfig(controller);
  assert.equal(ctrl.context.screen_id, INPUT.screen_id);
  assert.throws(() => publicApi.normalizePublicPageParams({ screen_id: 'b'.repeat(32) }, publicApi.resolvePublicPageMacro(ctrl, 'media-screen-get'), ctrl.context));
}));
test('packaged database is empty and contains current generated renderer and macro sources', () => {
  const db = new DatabaseSync(path.join(__dirname, 'sample.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.equal(db.prepare('SELECT count(*) n FROM media_screens').get().n, 0);
    assert.equal(db.prepare('SELECT html FROM media_screen_templates WHERE role=?').get('display').html, displayHtml());
    assert.equal(db.prepare('SELECT html FROM media_screen_templates WHERE role=?').get('control').html, fs.readFileSync(path.join(__dirname, 'control.html'), 'utf8'));
    for (const m of macros) assert.equal(db.prepare('SELECT source FROM system_macros WHERE name=?').get(m.name).source, m.source);
  } finally { db.close(); }
});
