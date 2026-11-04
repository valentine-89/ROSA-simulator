'use strict';
// Local-only regression and rendering budget checks. No production requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'output/ani3-preview');
fs.mkdirSync(output, { recursive: true });
const original = execFileSync('git', ['show', '4b811cc:sample_templates/templates/media-only/dashboard.html'], { cwd: root, encoding: 'utf8' });
const current = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
const message = 'CHÀO MỪNG QUÝ KHÁCH';
const streams = new Set();
let origin, signal = 'text@ani3:' + message, macroReads = 0;
function send(stream) {
  if (stream.destroyed || stream.writableEnded) return;
  stream.write('data: ' + JSON.stringify({ type: 'telemetry', payload: { media: signal } }) + '\n\n');
  stream.write('data: ' + JSON.stringify({ type: 'timeseries', rows: [{ field: 'media', value: signal }] }) + '\n\n');
}
function publish(next) { signal = next; for (const stream of streams) send(stream); }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname.endsWith('/stream')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    streams.add(res); res.on('close', () => streams.delete(res)); send(res); return;
  }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname.endsWith('/data') && req.method === 'POST') {
      macroReads++; return res.end(JSON.stringify([{ name: 'Hôm nay', value: 12 }]));
    }
    return res.end(JSON.stringify({ c1: 'ok', c2: { payload: { media: signal } } }));
  }
  if (url.pathname === '/') {
    signal = 'text@ani3:' + message;
    const source = url.searchParams.has('before') ? original : current;
    const config = { sessionId: 'IOfixture@key', syncId: 'sync', field: 'media', historyMs: 0, defaultSignal: signal };
    res.setHeader('Content-Type', 'text/html');
    return res.end(source.replace(/(<script type="application\/json" id="ai-bridge-media-only-config">)[\s\S]*?(<\/script>)/, '$1' + JSON.stringify(config) + '$2'));
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end();
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function instrument() {
  const probe = window.sakuraProbe = { paints: 0, frames: [], gradients: 0, atlas: null, events: 0 };
  const pending = new Set(), listeners = new Map();
  window.sakuraHidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.sakuraHidden });
  const raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    let id = raf.call(window, now => {
      pending.delete(id); probe.inFrame = false;
      const start = performance.now(); callback(now);
      if (probe.inFrame) probe.frames.push(performance.now() - start);
    });
    pending.add(id); return id;
  };
  window.cancelAnimationFrame = function (id) { pending.delete(id); return cancel.call(window, id); };
  probe.pending = () => pending.size;
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (this.canvas.isConnected && this.canvas.classList.contains('fx-canvas')) {
      probe.paints++; probe.inFrame = true;
    }
    return clear.apply(this, args);
  };
  for (const method of ['createLinearGradient', 'createRadialGradient']) {
    const native = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function (...args) { probe.gradients++; return native.apply(this, args); };
  }
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
    if (this.canvas.isConnected && source instanceof HTMLCanvasElement && !source.isConnected) probe.atlas = source;
    return draw.call(this, source, ...args);
  };
  function track(target, type, fn, remove) {
    const kind = target === window ? 'window' : target === document ? 'document' : target instanceof MediaQueryList ? 'media' : '';
    if (!kind || !['resize', 'visibilitychange', 'change'].includes(type)) return;
    const key = kind + ':' + type;
    if (!listeners.has(key)) listeners.set(key, new Set());
    if (remove) listeners.get(key).delete(fn); else listeners.get(key).add(fn);
  }
  for (const method of ['addEventListener', 'removeEventListener']) {
    const native = EventTarget.prototype[method];
    EventTarget.prototype[method] = function (type, fn, options) {
      track(this, type, fn, method === 'removeEventListener'); return native.call(this, type, fn, options);
    };
  }
  for (const method of ['addListener', 'removeListener']) {
    const native = MediaQueryList.prototype[method];
    MediaQueryList.prototype[method] = function (fn) {
      track(this, 'change', fn, method === 'removeListener'); return native.call(this, fn);
    };
  }
  probe.listenerCounts = () => Object.fromEntries([...listeners].map(([key, set]) => [key, set.size]));
  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource {
    constructor(...args) { super(...args); this.addEventListener('message', () => probe.events++); }
  };
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  const errors = [], external = [];
  try {
    async function context() {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
      ctx.setDefaultTimeout(10000); await ctx.addInitScript(instrument);
      ctx.on('page', page => page.on('pageerror', e => errors.push(e.message)));
      await ctx.route('**/*', route => {
        if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
      });
      return ctx;
    }
    async function ready(page, before) {
      await page.goto(origin + (before ? '/?before=1' : '/'));
      await page.waitForFunction(() => document.querySelector('.fx-canvas') && sakuraProbe.events >= 2);
      await sleep(1600);
    }
    async function repeatedAni6(page) {
      publish('text@ani6:' + message);
      await page.waitForSelector('.style-ani6 .fx-canvas'); await sleep(100);
      await page.evaluate(() => { window.previousCanvas = document.querySelector('.fx-canvas'); });
      const events = await page.evaluate(() => sakuraProbe.events);
      publish(signal); await page.waitForFunction(n => sakuraProbe.events > n, events); await sleep(80);
      return page.evaluate(() => previousCanvas !== document.querySelector('.fx-canvas'));
    }

    const beforeContext = await context(), beforePage = await beforeContext.newPage();
    await ready(beforePage, true);
    await beforePage.screenshot({ path: path.join(output, 'sakura-before.png'), scale: 'css' });
    const originalAni6Replaces = await repeatedAni6(beforePage);
    await beforeContext.close();

    const ctx = await context(), page = await ctx.newPage();
    await ready(page, false);
    await page.screenshot({ path: path.join(output, 'sakura-preview.png'), scale: 'css' });
    const atlas = await page.evaluate(() => sakuraProbe.atlas && { width: sakuraProbe.atlas.width, height: sakuraProbe.atlas.height, png: sakuraProbe.atlas.toDataURL() });
    assert(atlas, 'Petals must use a pre-rendered atlas');
    assert(atlas.width * atlas.height <= 384 * 256, 'Atlas exceeds its rendering budget');
    fs.writeFileSync(path.join(output, 'sakura-atlas.png'), Buffer.from(atlas.png.split(',')[1], 'base64'));

    await page.evaluate(() => { window.previousCanvas = document.querySelector('.fx-canvas'); window.previousText = document.querySelector('.text-box'); });
    const events = await page.evaluate(() => sakuraProbe.events);
    publish(signal); await page.waitForFunction(n => sakuraProbe.events > n, events); await sleep(80);
    assert(await page.evaluate(() => previousCanvas === document.querySelector('.fx-canvas') && previousText === document.querySelector('.text-box')), 'Duplicate ani3 SSE must preserve the running scene');

    await page.setViewportSize({ width: 3840, height: 2160 });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable'); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await sleep(1800);
    await page.evaluate(() => { sakuraProbe.paints = 0; sakuraProbe.frames = []; sakuraProbe.gradients = 0; });
    const metricsBefore = (await cdp.send('Performance.getMetrics')).metrics;
    const start = Date.now(); await sleep(5000); const elapsed = (Date.now() - start) / 1000;
    const data = await page.evaluate(() => {
      const canvas = document.querySelector('.fx-canvas'), backdrop = document.querySelector('.backdrop');
      return { paints: sakuraProbe.paints, frames: sakuraProbe.frames, gradients: sakuraProbe.gradients,
        canvas: [canvas.width, canvas.height], dpr: devicePixelRatio,
        filters: [null, '::before', '::after'].map(pseudo => getComputedStyle(backdrop, pseudo).filter) };
    });
    const metricsAfter = (await cdp.send('Performance.getMetrics')).metrics;
    const metric = (metrics, name) => metrics.find(m => m.name === name).value;
    const times = data.frames.sort((a, b) => a - b), p95 = times[Math.floor(times.length * .95)] || 0;
    const fps = data.paints / elapsed;
    assert(data.canvas[0] <= 1280 && data.canvas[1] <= 720 && data.canvas[0] * data.canvas[1] <= 1280 * 720);
    assert(fps >= 20 && fps <= 31.5, 'Measured frame rate outside the 30 fps budget: ' + fps.toFixed(1));
    assert(p95 < 16, 'Drawing exceeds half the 30 fps frame budget under CPU throttle');
    assert.equal(data.gradients, 0, 'No gradients should be allocated during steady animation');
    assert(data.filters.every(f => f === 'none'), 'Sakura must not use full-screen CSS blur');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    await page.evaluate(() => { window.sakuraHidden = true; document.dispatchEvent(new Event('visibilitychange')); sakuraProbe.paints = 0; });
    await sleep(350);
    assert.equal(await page.evaluate(() => sakuraProbe.paints), 0, 'Hidden scene must stop drawing');
    assert.equal(await page.evaluate(() => sakuraProbe.pending()), 0, 'Hidden scene must stop RAF scheduling');
    await page.evaluate(() => { window.sakuraHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await page.emulateMedia({ reducedMotion: 'reduce' }); await sleep(100);
    await page.evaluate(() => { sakuraProbe.paints = 0; }); await sleep(350);
    assert.equal(await page.evaluate(() => sakuraProbe.paints), 0, 'Reduced-motion scene must stop drawing');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 540, height: 960 }); await sleep(120);
    assert(await page.evaluate(() => previousCanvas === document.querySelector('.fx-canvas')), 'Resize should retain the scene canvas');
    const portrait = await page.locator('.fx-canvas').evaluate(c => [c.width, c.height]);
    assert(portrait[0] <= 1280 && portrait[1] <= 720);
    await page.screenshot({ path: path.join(output, 'sakura-portrait.png'), scale: 'css' });
    await page.setViewportSize({ width: 1280, height: 720 }); await sleep(150);
    const listeners = await page.evaluate(() => sakuraProbe.listenerCounts());
    for (let i = 0; i < 12; i++) {
      publish('text@black:' + message); await page.waitForSelector('.style-black .text-box');
      publish('text@ani3:' + message); await page.waitForSelector('.style-ani3 .fx-canvas');
    }
    await sleep(150);
    assert.equal(await page.locator('.fx-canvas').count(), 1);
    assert.deepEqual(await page.evaluate(() => sakuraProbe.listenerCounts()), listeners, 'Style switching leaked listeners');
    assert.equal(await page.evaluate(() => sakuraProbe.pending()), 1, 'Only the active Sakura loop may remain scheduled');
    publish('text@black:' + message); await page.waitForSelector('.style-black .text-box'); await sleep(700);
    await page.evaluate(() => { sakuraProbe.paints = 0; }); await sleep(150);
    assert.equal(await page.evaluate(() => sakuraProbe.paints), 0);
    assert.equal(await page.evaluate(() => sakuraProbe.pending()), 0, 'Leaving Sakura must dispose its loop');

    const currentAni6Replaces = await repeatedAni6(page);
    assert.equal(currentAni6Replaces, originalAni6Replaces, 'Ani6 repeated-SSE behavior changed');
    assert(originalAni6Replaces, 'The baseline fixture should exercise ani6 reconstruction');
    publish('data@ani3:fixture'); await page.waitForSelector('.style-ani3 .data-box'); await sleep(180);
    const reads = macroReads; publish(signal); await sleep(180);
    assert(macroReads > reads, 'Identical data signals must still refresh macro data');
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    const report = { ok: true, sourceOnly: true, viewport: [3840, 2160], deviceScaleFactor: data.dpr, cpuThrottle: 4,
      canvas: data.canvas, atlas: [atlas.width, atlas.height], sampleSeconds: elapsed,
      fps: Number(fps.toFixed(2)), drawP95Ms: Number(p95.toFixed(2)), steadyFrameGradients: data.gradients,
      mainThreadPercent: Number(((metric(metricsAfter, 'TaskDuration') - metric(metricsBefore, 'TaskDuration')) / elapsed * 100).toFixed(2)),
      checks: ['ani3-duplicate-SSE-keeps-scene', 'ani6-SSE-semantics-unchanged', 'macro-data-still-refreshes', 'bounded-4K-DPR2-canvas', 'cached-petal-atlas', 'no-frame-gradients', 'no-fullscreen-blur', 'hidden-pauses', 'reduced-motion-pauses', 'resize-keeps-canvas', '12-switches-no-listener-or-RAF-leaks'],
      browserErrors: errors, externalRequests: external.length };
    fs.writeFileSync(path.join(output, 'sakura-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); await ctx.close();
  } finally {
    await browser.close(); for (const stream of streams) stream.end(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
