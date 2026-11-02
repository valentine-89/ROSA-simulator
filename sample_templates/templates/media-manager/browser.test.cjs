'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { fixture, root, publicApi } = require('./fixture.cjs');
const f = fixture(), payload = {}, streams = new Set(), requests = [], errors = [];
let owner = true, dropSave = false;
const jsonSafe = value => JSON.stringify(value).replace(/</g, '\\u003c');
const pageRow = id => f.db.prepare('SELECT * FROM system_pages WHERE page_id=?').get(id);
function allowed(id) { const row = pageRow(id); if (!row) throw Error('PAGE_NOT_FOUND'); if (!row.enabled) throw Error('PAGE_DISABLED'); return publicApi.parsePublicPageApiConfig(row); }
function filtered(fields) { return Object.fromEntries(fields.filter(k => Object.hasOwn(payload, k)).map(k => [k, payload[k]])); }
function broadcast() { for (const s of streams) { const fields = s.pageId ? allowed(s.pageId).fields : s.fields; s.res.write('data: ' + JSON.stringify({ type: 'telemetry', payload: filtered(fields) }) + '\n\n'); } }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'), parts = url.pathname.split('/').map(decodeURIComponent);
  function json(value, code = 200) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
  try {
    if (url.pathname.startsWith('/api/')) requests.push({ method: req.method, path: url.pathname });
    if (url.pathname === '/api/user/profiles') return json({ profiles: owner ? [{ backendUrl: 'IOfixture@fixture-key', syncId: 'fixture-sync' }] : [], defaultSyncId: 'fixture-sync' });
    if (url.pathname === '/api/iot-pages') {
      assert.equal(url.searchParams.get('sessionId'), 'IOfixture@fixture-key');
      const row = pageRow(url.searchParams.get('pageId')); return row ? json({ ok: true, page: row }) : json({ error: 'PAGE_NOT_FOUND' }, 404);
    }
    if (parts[1] === 'api' && parts[2] === 'IOfixture@fixture-key' && parts[3] === 'fixture-sync') {
      if (parts[4] === 'data') {
        const chunks = []; for await (const c of req) chunks.push(c); const body = JSON.parse(Buffer.concat(chunks));
        const rows = f.run(body.macro, { ...body, sync_id: 'fixture-sync' });
        if (dropSave && body.macro === 'media-screen-save') {
          dropSave = false;
          // Send a partial response before disconnecting so Chromium does not
          // transparently retry an apparently unused keep-alive connection.
          res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' });
          res.write('{"ok":'); setTimeout(() => res.destroy(), 20); return;
        }
        return json(rows);
      }
      if (parts[4] === 'iotelemetry') {
        if (req.method === 'POST') {
          const chunks = []; for await (const c of req) chunks.push(c); const body = JSON.parse(Buffer.concat(chunks));
          assert.equal(Object.keys(body).length, 1); Object.assign(payload, body); broadcast(); return json({ c1: 'ok', c2: 1 });
        }
        return json({ c1: 'ok', c2: { payload: filtered((url.searchParams.get('fields') || '').split(',')) } });
      }
    }
    if (parts[2] === 'iot-page-telemetry') {
      const api = allowed(parts[4]);
      if (req.method === 'POST') {
        const chunks = []; for await (const c of req) chunks.push(c); const body = JSON.parse(Buffer.concat(chunks));
        assert(Object.keys(body).every(k => api.writeFields.includes(k)));
        Object.assign(payload, body); broadcast(); return json({ c1: 'ok', c2: 1 });
      }
      return json({ c1: 'ok', c2: { payload: filtered(api.fields) } });
    }
    if (parts[2] === 'iot-page-realtime' || (parts[2] === 'IOfixture@fixture-key' && parts[3] === 'stream')) {
      const entry = { res, pageId: parts[2] === 'iot-page-realtime' ? parts[4] : '', fields: (url.searchParams.get('fields') || '').split(',') };
      const fields = entry.pageId ? allowed(entry.pageId).fields : entry.fields;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: ' + JSON.stringify({ type: 'telemetry', payload: filtered(fields) }) + '\n\n'); streams.add(entry);
      req.on('close', () => streams.delete(entry)); return;
    }
    if (parts[2] === 'iot-page-macro') {
      const chunks = []; for await (const c of req) chunks.push(c); const body = JSON.parse(Buffer.concat(chunks));
      const api = allowed(parts[4]), spec = publicApi.resolvePublicPageMacro(api, body.macro);
      const params = publicApi.normalizePublicPageParams(body.params, spec, api.context);
      if (body.macro.startsWith('media-')) return json({ ok: true, rows: f.run(body.macro, { ...api.context, ...params, sync_id: 'fixture-sync' }) });
      return json({ ok: true, rows: [{ area: 'Front door', count: 7 }] });
    }
    if (parts[1] === 'iot-page') {
      const row = pageRow(parts[3]); if (!row || !row.enabled) return json({ error: 'PAGE_DISABLED' }, 404);
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; media-src 'self' https: blob:; frame-src 'self' https:; object-src 'none'" });
      return res.end(row.html.replaceAll('__ROSA_IOT_PAGE_META__', jsonSafe(JSON.parse(row.meta))).replaceAll('__ROSA_IOT_PAGE_CONTEXT__', jsonSafe({ ioid: 'IOfixture', pageId: row.page_id })));
    }
    if (url.pathname === '/setup-fixture') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<iframe id="setup" src="/sample_dashboards/media-only/setup.html" style="width:100%;height:800px"></iframe><script>window.collected=null;addEventListener("message",e=>{if(e.data.type==="dashboardSetup:ready")e.source.postMessage({type:"dashboardSetup:init",payload:{context:{sessionId:"IOfixture@fixture-key",syncId:"fixture-sync"},config:{field:"custom",historyMs:0,customOption:"keep"}}},location.origin);if(e.data.type==="dashboardSetup:submit")window.collected=e.data.payload.config;});</script>');
    }
    let filename = url.pathname === '/' ? 'sample_templates/templates/media-manager/dashboard.html' : url.pathname.slice(1);
    if (!filename.startsWith('sample_templates/')) { res.writeHead(404); return res.end(); }
    const absolute = path.resolve(root, filename);
    if (!absolute.startsWith(path.join(root, 'sample_templates') + path.sep)) throw Error('Invalid path');
    const type = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html';
    let text = fs.readFileSync(absolute, 'utf8');
    if (filename.endsWith('.html')) text = text.replaceAll('<<sessionid>>', 'IOfixture@fixture-key').replaceAll('<<syncid>>', 'fixture-sync').replace('"managerId":""', '"managerId":"' + 'f'.repeat(32) + '"');
    if (filename.endsWith('media-only/dashboard.html') && url.searchParams.has('fixturePrefix')) text = text.replace('"prefix": ""', '"prefix": ' + jsonSafe(url.searchParams.get('fixturePrefix')));
    res.writeHead(200, { 'Content-Type': type }); res.end(text);
  } catch (e) { json({ error: e.message }, 400); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port, output = path.join(root, 'output/media-manager'); fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
    context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
    const manager = await context.newPage(); await manager.goto(base);
    await manager.waitForFunction(() => document.getElementById('status').textContent.includes('Đã tải'));
    async function create(name, prefix, count) {
      await manager.fill('#name', name); await manager.fill('#prefix', prefix); await manager.click('#save');
      await manager.waitForFunction(n => document.getElementById('count').textContent === String(n), count);
    }
    await create('Cửa trước', 'frontdoor', 1); await create('Cửa sau', 'backdoor', 2); await create('Mặc định', '', 3); console.log('CRUD create passed');
    const publicManager = await context.newPage(); await publicManager.goto(base + await manager.getAttribute('#manager-link', 'href'));
    await publicManager.waitForFunction(() => document.getElementById('count').textContent === '3');
    assert.equal(await publicManager.locator('#manager-link:visible').count(), 0);
    const rows = f.run('media-screens-list'), front = rows.find(r => r.prefix === 'frontdoor'), back = rows.find(r => r.prefix === 'backdoor'), blank = rows.find(r => r.prefix === '');
    const frontDisplay = await context.newPage(), backDisplay = await context.newPage(), blankDisplay = await context.newPage(), control = await context.newPage();
    await frontDisplay.goto(base + '/iot-page/IOfixture/' + front.display_page_id);
    await backDisplay.goto(base + '/iot-page/IOfixture/' + back.display_page_id);
    await blankDisplay.goto(base + '/iot-page/IOfixture/' + blank.display_page_id);
    await control.goto(base + '/iot-page/IOfixture/' + front.control_page_id);
    await control.waitForFunction(() => !document.getElementById('send').disabled);
    await control.fill('#content', 'Xin chào cửa trước'); await control.click('#send');
    await frontDisplay.waitForFunction(() => document.getElementById('content-layer').textContent.includes('Xin chào cửa trước'));
    assert(!String(await backDisplay.textContent('#content-layer')).includes('Xin chào cửa trước'));
    assert(!String(await blankDisplay.textContent('#content-layer')).includes('Xin chào cửa trước'));
    assert.deepEqual(Object.keys(payload), ['frontdoor_media']);
    // Server-escaped markup must remain text in display and manager.
    await control.waitForFunction(() => !document.getElementById('send').disabled);
    await control.fill('#content', '</script><img src=x onerror=alert(1)>'); await control.click('#send');
    await control.waitForFunction(() => document.getElementById('current').textContent.includes('</script>')).catch(async e => { console.log({status:await control.textContent('#status'),payload}); throw e; });
    await frontDisplay.waitForFunction(() => document.getElementById('content-layer').textContent.includes('</script>'));
    assert.equal(await frontDisplay.locator('#content-layer img').count(), 0);
    const backControl = await context.newPage(); await backControl.goto(base + '/iot-page/IOfixture/' + back.control_page_id);
    await backControl.waitForFunction(() => !document.getElementById('send').disabled); await backControl.fill('#content', 'Nội dung cửa sau'); await backControl.click('#send');
    await backDisplay.waitForFunction(() => document.getElementById('content-layer').textContent.includes('Nội dung cửa sau'));
    const blankControl = await context.newPage(); await blankControl.goto(base + '/iot-page/IOfixture/' + blank.control_page_id);
    await blankControl.waitForFunction(() => !document.getElementById('send').disabled); await blankControl.fill('#content', 'Màn hình mặc định'); await blankControl.click('#send');
    await blankDisplay.waitForFunction(() => document.getElementById('content-layer').textContent.includes('Màn hình mặc định'));
    assert.equal(payload.media, 'text@black:Màn hình mặc định'); console.log('Three independent displays passed');
    await manager.locator('[data-screen-id="' + front.screen_id + '"]').getByRole('button', { name: 'Sửa', exact: true }).click();
    await manager.fill('#prefix', 'livingroom'); await manager.fill('#name', 'Phòng khách'); await manager.locator('summary').click(); await manager.fill('#macros', 'production-overview'); await manager.click('#save');
    await manager.waitForFunction(() => document.getElementById('status').textContent.includes('Đã cập nhật'));
    await control.fill('#content', 'Stale must not send'); await control.click('#send');
    await control.waitForFunction(() => document.getElementById('status').textContent.includes('Prefix đã thay đổi'));
    assert.equal(payload.livingroom_media, undefined);
    await frontDisplay.reload(); await control.reload(); await control.waitForFunction(() => !document.getElementById('send').disabled);
    await control.fill('#content', 'Phòng khách đang sẵn sàng'); await control.click('#send');
    await frontDisplay.waitForFunction(() => document.getElementById('content-layer').textContent.includes('Phòng khách đang sẵn sàng'));
    await control.selectOption('#kind', 'data'); await control.fill('#content', 'production-overview'); await control.click('#send');
    await frontDisplay.waitForFunction(() => document.getElementById('content-layer').textContent.includes('Front door'));
    await control.selectOption('#kind', 'text'); await control.fill('#content', 'Chào mừng về nhà'); await control.click('#send');
    await frontDisplay.waitForFunction(() => document.getElementById('content-layer').textContent.includes('Chào mừng về nhà'));
    console.log('Edit, stale controller, public macro passed');
    await manager.screenshot({ path: path.join(output, 'manager-desktop.png'), fullPage: true });
    await control.screenshot({ path: path.join(output, 'controller-desktop.png'), fullPage: true });
    await frontDisplay.screenshot({ path: path.join(output, 'display.png'), fullPage: true });
    await manager.setViewportSize({ width: 390, height: 844 }); await manager.screenshot({ path: path.join(output, 'manager-mobile.png'), fullPage: true });
    await control.setViewportSize({ width: 320, height: 700 }); await control.screenshot({ path: path.join(output, 'controller-mobile.png'), fullPage: true });
    for (const p of [manager, control]) assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // Lost create response commits once; UI reads back without resending.
    dropSave = true; const savesBefore = requests.filter(r => r.path.endsWith('/data')).length;
    await create('Mất phản hồi', 'network', 4);
    assert.equal(f.run('media-screens-list').filter(r => r.prefix === 'network').length, 1);
    await manager.waitForFunction(() => document.getElementById('status').textContent.includes('Chưa xác nhận'));
    assert.equal(requests.filter(r => r.path.endsWith('/data')).length - savesBefore, 2);
    await manager.locator('[data-screen-id="' + front.screen_id + '"]').getByRole('button', { name: 'Xóa', exact: true }).click();
    await manager.click('#delete-confirm'); await manager.waitForFunction(() => document.getElementById('count').textContent === '3');
    await control.fill('#content', 'Deleted must not send'); await control.click('#send');
    await control.waitForFunction(() => document.getElementById('status').textContent.includes('PAGE_NOT_FOUND'));
    assert.equal(payload.livingroom_media, 'text@black:Chào mừng về nhà');
    // An anonymous link holder may control the screen without profile access.
    owner = false; const stranger = await context.newPage(); await stranger.goto(base + '/iot-page/IOfixture/' + back.control_page_id);
    await stranger.waitForFunction(() => !document.getElementById('send').disabled);
    await stranger.fill('#content', 'Điều khiển qua link'); await stranger.click('#send');
    await backDisplay.waitForFunction(() => document.getElementById('content-layer').textContent.includes('Điều khiển qua link'));
    const setup = await context.newPage(); await setup.goto(base + '/setup-fixture');
    const frame = setup.frameLocator('#setup'); await frame.locator('#field').waitFor();
    await frame.locator('#prefix').fill('backdoor');
    await setup.evaluate(() => document.getElementById('setup').contentWindow.postMessage({ type: 'dashboardSetup:collect' }, location.origin));
    await setup.waitForFunction(() => window.collected);
    assert.deepEqual(await setup.evaluate(() => ({ prefix: collected.prefix, field: collected.field, historyMs: collected.historyMs, customOption: collected.customOption })), { prefix: 'backdoor', field: 'custom', historyMs: 0, customOption: 'keep' });
    await setup.screenshot({ path: path.join(output, 'legacy-setup.png'), fullPage: true });
    // Existing standalone template, including blank-prefix compatibility.
    const legacy = await context.newPage(); await legacy.goto(base + '/sample_dashboards/media-only/dashboard.html');
    await legacy.waitForFunction(() => document.getElementById('content-layer').textContent.includes('Màn hình mặc định'));
    await legacy.goto(base + '/sample_dashboards/media-only/dashboard.html?fixturePrefix=backdoor');
    await legacy.waitForFunction(() => document.getElementById('content-layer').textContent.includes('Điều khiển qua link'));
    const publicRequests = requests.filter(r => /iot-page-(telemetry|realtime|macro)/.test(r.path));
    assert(publicRequests.every(r => !r.path.includes('fixture-key') && !r.path.includes('fixture-sync')));
    assert.deepEqual(errors, []);
    const report = { ok: true, checks: ['CRUD-pairs', 'anonymous-manager-link', 'three-real-SSE-displays', 'single-field-writes', 'blank-prefix', 'stable-links-after-edit', 'stale-controller', 'public-data-macro', 'lost-response-readback', 'delete', 'anonymous-controller', 'setup-bridge-preservation', 'legacy-renderer', 'desktop-mobile-no-overflow'], browserErrors: errors };
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { await browser.close(); for (const s of streams) s.res.end(); server.closeAllConnections(); await new Promise(r => server.close(r)); f.db.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
