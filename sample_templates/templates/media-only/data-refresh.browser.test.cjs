'use strict';
// Local-only SSE/macro fixtures; no production commands or account writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { displayHtml } = require('../media-manager/definition.cjs');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'output/media-data-refresh');
fs.mkdirSync(output, { recursive: true });
const baselineCommit = process.env.MEDIA_REFRESH_BASELINE || 'b071e87';
const before = execFileSync('git', ['show', baselineCommit + ':sample_templates/templates/media-only/dashboard.html'], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
const current = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8').replace(/\r\n/g, '\n');
const report = { ok: false, baselineCommit, sourceOnly: true, checks: [], errors: [], externalRequests: [], performance: [] };
const save = () => fs.writeFileSync(path.join(output, 'data-refresh-report.json'), JSON.stringify(report, null, 2));
let origin, signal = 'data@ani10:alpha', value = 'VALUE-1', requests = 0, duplicateTimer;
const streams = new Set(), delayed = new Set();
function send(stream) {
  if (stream.destroyed || stream.writableEnded) return;
  stream.write('data: ' + JSON.stringify({ type: 'telemetry', payload: { media: signal } }) + '\n\n');
  stream.write('data: ' + JSON.stringify({ type: 'timeseries', rows: [{ field: 'media', value: signal }] }) + '\n\n');
}
function publish(next = signal) { signal = next; for (const stream of streams) send(stream); }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname.endsWith('/stream') || url.pathname.includes('/iot-page-realtime/')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    streams.add(res); res.on('close', () => streams.delete(res)); send(res); return;
  }
  if (req.method === 'POST') {
    let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => {
      requests++; const { macro } = JSON.parse(body);
      const respond = () => { if (!res.destroyed) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([{ macro, value: macro === 'slow' ? 'STALE' : value }])); } };
      if (macro === 'slow') delayed.add(respond); else respond();
    }); return;
  }
  if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ c1: 'ok', c2: { payload: { media: signal } } })); }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/' || url.pathname === '/public') {
    const config = { sessionId: 'IOfixture@key', syncId: 'sync', field: 'media', historyMs: 0, defaultSignal: signal };
    let html = url.searchParams.has('before') ? before : current;
    if (url.pathname === '/public') html = displayHtml()
      .replace('__ROSA_IOT_PAGE_META__', JSON.stringify({ mediaScreen: config }))
      .replace('__ROSA_IOT_PAGE_CONTEXT__', JSON.stringify({ ioid: 'IOfixture', pageId: 'display' }));
    else html = html.replace(/(<script type="application\/json" id="ai-bridge-media-only-config">)[\s\S]*?(<\/script>)/, '$1' + JSON.stringify(config) + '$2');
    res.setHeader('Content-Type', 'text/html'); return res.end(html);
  }
  res.writeHead(404); res.end();
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function instrument() {
  let canvases = 0, paints = 0;
  const create = document.createElement, clear = CanvasRenderingContext2D.prototype.clearRect;
  document.createElement = function (...args) { const node = create.apply(this, args); if (String(args[0]).toLowerCase() === 'canvas') canvases++; return node; };
  CanvasRenderingContext2D.prototype.clearRect = function (x, y, w, h) { if (this.canvas.isConnected && this.canvas.classList.contains('fx-canvas')) paints++; return clear.call(this, x, y, w, h); };
  window.refreshProbe = { read: () => ({ canvases, paints }) };
}
function effectRegion(html) { return html.slice(html.indexOf('      function createFxCanvas() {'), html.indexOf('      function normalizeYouTubeUrl(input) {')); }
(async () => {
  assert.equal(effectRegion(current), effectRegion(before), 'Approved effect code changed');
  assert.equal(current.split('</style>')[0], before.split('</style>')[0], 'Approved CSS changed');
  report.checks.push('all-approved-effects-and-CSS-unchanged');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    context.setDefaultTimeout(10000); await context.addInitScript(instrument);
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { report.externalRequests.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
    for (const route of ['/', '/public']) {
      signal = 'data@ani10:alpha'; value = 'VALUE-1'; await page.goto(origin + route);
      await page.getByText(value, { exact: true }).waitFor();
      await page.evaluate(() => { window.firstFx = new WeakRef(document.querySelector('.fx-canvas')); });
      const first = await page.evaluate(() => refreshProbe.read());
      const reads = requests; value = 'VALUE-2'; publish(); await page.getByText(value, { exact: true }).waitFor();
      assert(requests > reads, 'Data stopped refreshing');
      value = 'VALUE-3'; publish('data@ani10:beta'); await page.getByText(value, { exact: true }).waitFor();
      assert(await page.evaluate(() => firstFx.deref() === document.querySelector('.fx-canvas')), 'Macro change restarted ripple');
      assert.equal((await page.evaluate(() => refreshProbe.read())).canvases, first.canvases);
      const requestCount = requests; publish('data@ani10:slow');
      await page.waitForFunction(() => document.querySelector('.data-title')?.textContent === 'Slow');
      while (requests === requestCount) await sleep(10);
      value = 'LATEST'; publish('data@ani10:beta'); await page.getByText('LATEST', { exact: true }).waitFor();
      for (const reply of delayed) reply(); delayed.clear(); await sleep(100);
      assert.equal(await page.getByText('STALE', { exact: true }).count(), 0);
      assert(await page.evaluate(() => firstFx.deref() === document.querySelector('.fx-canvas')));
      // Many refreshes must keep one live simulation while updating table data.
      for (let i = 0; i < 30; i++) { value = 'UPDATE-' + i; publish(); await page.getByText(value, { exact: true }).waitFor(); }
      const after = await page.evaluate(() => refreshProbe.read());
      assert.equal(after.canvases, first.canvases, 'Refresh allocated another water canvas');
      assert(after.paints > first.paints, 'Ripple animation stopped');
      publish('data@ani6:beta'); await page.locator('.style-ani6 .fx-canvas').waitFor();
      assert(await page.evaluate(() => firstFx.deref() !== document.querySelector('.fx-canvas')));
      publish('text@black:DONE'); await page.getByText('DONE', { exact: true }).waitFor();
      assert.equal(await page.locator('.fx-canvas').count(), 0);
      report.checks.push((route === '/' ? 'standalone' : 'public') + '-data-refresh-same-canvas-macro-change-stale-response-cleanup');
    }
    await page.setViewportSize({ width: 3840, height: 2160 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const seconds = Number(process.env.MEDIA_REFRESH_PERF_SECONDS || 30);
    for (const baseline of [true, false]) {
      signal = 'data@ani10:alpha'; value = 'PERFORMANCE';
      await page.goto(origin + (baseline ? '/?before=1' : '/'));
      await page.getByText(value, { exact: true }).waitFor(); await sleep(2000);
      duplicateTimer = setInterval(() => publish(), 2000);
      const start = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      const canvasStart = await page.evaluate(() => refreshProbe.read().canvases), time = Date.now();
      await sleep(seconds * 1000); clearInterval(duplicateTimer); duplicateTimer = null;
      const end = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      const result = { version: baseline ? 'before' : 'after', seconds: (Date.now() - time) / 1000,
        mainThreadBusyPct: (end.TaskDuration - start.TaskDuration) / ((Date.now() - time) / 1000) * 100,
        canvasesCreatedDuringRefresh: await page.evaluate(() => refreshProbe.read().canvases) - canvasStart };
      if (!baseline) assert.equal(result.canvasesCreatedDuringRefresh, 0);
      report.performance.push(result); save(); console.log(JSON.stringify(result));
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []);
    report.ok = true; save(); console.log(JSON.stringify({ ok: true, checks: report.checks }));
    await context.close();
  } finally {
    if (duplicateTimer) clearInterval(duplicateTimer);
    await browser.close(); for (const stream of streams) stream.end();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { report.error = error.stack; save(); console.error(error); process.exitCode = 1; });
