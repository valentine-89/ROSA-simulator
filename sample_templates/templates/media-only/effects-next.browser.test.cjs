'use strict';
// Nine draft effects, tested locally against the approved ani3 release.
// No production requests or telemetry writes leave this fixture server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'output/effects-next');
fs.mkdirSync(output, { recursive: true });
const baselineCommit = '9a53456';
const baseline = execFileSync('git', ['show', baselineCommit + ':sample_templates/templates/media-only/dashboard.html'], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
const current = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8').replace(/\r\n/g, '\n');
const styles = ['ani1', 'ani2', 'ani4', 'ani5', 'ani6', 'ani7', 'ani8', 'ani9', 'ani10'];
const message = 'CHÀO MỪNG QUÝ KHÁCH';
const streams = new Set();
let origin, signal = 'text@black:' + message, macroReads = 0;
const report = { ok: false, sourceOnly: true, baselineCommit, viewport: [3840, 2160], deviceScaleFactor: 2, cpuThrottle: 4, styles: [], browserErrors: [], externalRequests: 0 };
function saveReport() { fs.writeFileSync(path.join(output, 'effects-next-report.json'), JSON.stringify(report, null, 2)); }

function functionSource(html, name) {
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(text => text.includes('function ' + name + '('));
  assert(script, 'Function script missing: ' + name);
  const tree = ts.createSourceFile('runtime.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = script.slice(node.getStart(tree), node.end);
    ts.forEachChild(node, visit);
  }
  visit(tree); assert(found, 'Function missing: ' + name); return found;
}

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
    const style = url.searchParams.get('style') || 'black';
    assert(/^(?:black|ani(?:[1-9]|10))$/.test(style));
    signal = 'text@' + style + ':' + message;
    const source = url.searchParams.has('before') ? baseline : current;
    const config = { sessionId: 'IOfixture@key', syncId: 'sync', field: 'media', historyMs: 0, defaultSignal: signal };
    res.setHeader('Content-Type', 'text/html');
    return res.end(source.replace(/(<script type="application\/json" id="ai-bridge-media-only-config">)[\s\S]*?(<\/script>)/, '$1' + JSON.stringify(config) + '$2'));
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end();
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function instrument() {
  const probe = window.effectsProbe = { paints: 0, frames: [], gradients: 0, events: 0, sources: new Set() };
  const pending = new Set(), listeners = new Map();
  window.effectsHidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.effectsHidden });
  const raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    let id = raf.call(window, now => {
      pending.delete(id); probe.inFrame = false; probe.inCallback = true;
      const start = performance.now();
      try { callback(now); } finally {
        if (probe.inFrame) probe.frames.push(performance.now() - start);
        probe.inCallback = false;
      }
    });
    pending.add(id); return id;
  };
  window.cancelAnimationFrame = function (id) { pending.delete(id); return cancel.call(window, id); };
  probe.pending = () => pending.size;
  // Some effects use destination-out fillRect for trails instead of clearRect.
  // Count a connected FX paint only once in each RAF callback, regardless of
  // which drawing primitive the effect uses.
  for (const method of ['clearRect', 'fillRect', 'drawImage', 'fill', 'stroke', 'strokeRect']) {
    const native = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function (...args) {
      if (this.canvas.isConnected && this.canvas.classList.contains('fx-canvas')) {
        if (probe.inCallback && !probe.inFrame) { probe.paints++; probe.inFrame = true; }
        if (method === 'drawImage' && args[0] instanceof HTMLCanvasElement && !args[0].isConnected) probe.sources.add(args[0]);
      }
      return native.apply(this, args);
    };
  }
  for (const method of ['createLinearGradient', 'createRadialGradient']) {
    const native = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function (...args) { probe.gradients++; return native.apply(this, args); };
  }
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
  probe.listenerCounts = () => Object.fromEntries([...listeners].filter(([, set]) => set.size).map(([key, set]) => [key, set.size]));
  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource {
    constructor(...args) { super(...args); this.addEventListener('message', () => probe.events++); }
  };
}

async function pixelHash(page) {
  return page.locator('.fx-canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    // Uniformly sample the actual rendered RGBA bitmap, not engine state.
    for (let i = 0; i < pixels.length; i += 28) {
      hash = Math.imul(hash ^ pixels[i], 16777619);
      hash = Math.imul(hash ^ pixels[i + 1], 16777619);
      hash = Math.imul(hash ^ pixels[i + 2], 16777619);
      hash = Math.imul(hash ^ pixels[i + 3], 16777619);
    }
    return (hash >>> 0).toString(16);
  });
}

(async () => {
  assert.equal(functionSource(current, 'renderSakuraEffect'), functionSource(baseline, 'renderSakuraEffect'), 'Approved ani3 renderer changed');
  const sakuraRules = html => html.match(/^[ \t]*\.style-ani3[^{}]*\{[^{}]*\}/gm);
  assert.deepEqual(sakuraRules(current), sakuraRules(baseline), 'Approved ani3 CSS changed');
  report.approvedAni3SourcePreserved = true;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  const external = [];
  try {
    async function context() {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
      ctx.setDefaultTimeout(10000); await ctx.addInitScript(instrument);
      ctx.on('page', page => page.on('pageerror', e => report.browserErrors.push(e.message)));
      await ctx.route('**/*', route => {
        if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); report.externalRequests = external.length; return route.abort(); }
        return route.continue();
      });
      return ctx;
    }
    async function ready(page, style, before) {
      await page.goto(origin + '/?style=' + style + (before ? '&before=1' : ''));
      await page.waitForFunction(() => document.querySelector('.text-box') && effectsProbe.events >= 2);
      if (!before && style !== 'black') await page.waitForSelector('.fx-canvas');
      await sleep(1600);
    }
    const beforeContext = await context(), beforePage = await beforeContext.newPage();
    for (const style of styles) {
      await ready(beforePage, style, true);
      await beforePage.screenshot({ path: path.join(output, style + '-before.png'), scale: 'css' });
    }
    await beforeContext.close();

    const ctx = await context(), page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await ready(page, 'black', false);
    const baseListeners = await page.evaluate(() => effectsProbe.listenerCounts());
    const styleListeners = {};
    for (const style of styles) {
      await page.setViewportSize({ width: 1280, height: 720 });
      await ready(page, style, false);
      await page.screenshot({ path: path.join(output, style + '-preview.png'), scale: 'css' });
      const firstHash = await pixelHash(page); await sleep(500);
      const secondHash = await pixelHash(page);
      assert.notEqual(firstHash, secondHash, style + ': rendered pixels do not change');
      await page.evaluate(() => { window.previousCanvas = document.querySelector('.fx-canvas'); window.previousText = document.querySelector('.text-box'); });
      const events = await page.evaluate(() => effectsProbe.events);
      publish(signal); await page.waitForFunction(n => effectsProbe.events > n, events); await sleep(80);
      assert(await page.evaluate(() => previousCanvas === document.querySelector('.fx-canvas') && previousText === document.querySelector('.text-box')), style + ': duplicate SSE recreated scene');
      styleListeners[style] = await page.evaluate(() => effectsProbe.listenerCounts());

      await page.setViewportSize({ width: 3840, height: 2160 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await sleep(1200);
      await page.evaluate(() => { effectsProbe.paints = 0; effectsProbe.frames = []; effectsProbe.gradients = 0; });
      const metricBefore = (await cdp.send('Performance.getMetrics')).metrics;
      const start = Date.now(); await sleep(3000); const elapsed = (Date.now() - start) / 1000;
      const data = await page.evaluate(() => {
        const canvas = document.querySelector('.fx-canvas'), backdrop = document.querySelector('.backdrop');
        return { paints: effectsProbe.paints, frames: effectsProbe.frames, gradients: effectsProbe.gradients,
          canvas: [canvas.width, canvas.height], dpr: devicePixelRatio,
          cachedCanvases: [...effectsProbe.sources].filter(c => c.width > 1 && c.height > 1).map(c => [c.width, c.height]),
          filters: [null, '::before', '::after'].map(pseudo => getComputedStyle(backdrop, pseudo).filter) };
      });
      const metricAfter = (await cdp.send('Performance.getMetrics')).metrics;
      const metric = (metrics, name) => metrics.find(m => m.name === name).value;
      const times = data.frames.sort((a, b) => a - b), p95 = times[Math.floor(times.length * .95)] || 0;
      const fps = data.paints / elapsed;
      // Preserve measured evidence even when a budget/lifecycle assertion below
      // fails. A failed run must not silently omit its slowest effect.
      const styleResult = { style, canvas: data.canvas, cachedCanvases: data.cachedCanvases, sampleSeconds: elapsed,
        fps: Number(fps.toFixed(2)), drawP95Ms: Number(p95.toFixed(2)), steadyFrameGradients: data.gradients,
        mainThreadPercent: Number(((metric(metricAfter, 'TaskDuration') - metric(metricBefore, 'TaskDuration')) / elapsed * 100).toFixed(2)),
        visibleMotion: true, duplicateSSEPreservesScene: true };
      report.styles.push(styleResult); saveReport();
      assert(data.canvas[0] <= 1280 && data.canvas[1] <= 720 && data.canvas[0] * data.canvas[1] <= 1280 * 720, style + ': oversized canvas');
      assert(fps >= 20 && fps <= 32, style + ': frame rate outside 30 fps budget: ' + fps.toFixed(2));
      assert(p95 < 25, style + ': p95 drawing exceeds budget: ' + p95.toFixed(2) + ' ms');
      assert.equal(data.gradients, 0, style + ': gradients allocated during steady animation');
      assert(data.filters.every(value => value === 'none'), style + ': fullscreen blur remains');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

      await page.evaluate(() => { window.effectsHidden = true; document.dispatchEvent(new Event('visibilitychange')); effectsProbe.paints = 0; });
      await sleep(350);
      assert.equal(await page.evaluate(() => effectsProbe.paints), 0, style + ': hidden scene still paints');
      assert.equal(await page.evaluate(() => effectsProbe.pending()), 0, style + ': hidden scene still schedules RAF');
      await page.evaluate(() => { window.effectsHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
      await page.emulateMedia({ reducedMotion: 'reduce' }); await sleep(100);
      await page.evaluate(() => { effectsProbe.paints = 0; }); await sleep(350);
      assert.equal(await page.evaluate(() => effectsProbe.paints), 0, style + ': reduced-motion scene still paints');
      assert.equal(await page.evaluate(() => effectsProbe.pending()), 0, style + ': reduced-motion scene still schedules RAF');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.setViewportSize({ width: 540, height: 960 }); await sleep(250);
      assert(await page.evaluate(() => previousCanvas === document.querySelector('.fx-canvas')), style + ': resize replaced canvas');
      const portrait = await page.locator('.fx-canvas').evaluate(canvas => [canvas.width, canvas.height]);
      assert(portrait[0] <= 1280 && portrait[1] <= 720, style + ': oversized portrait canvas');
      Object.assign(styleResult, { hiddenPauses: true, reducedMotionPauses: true, resizeKeepsCanvas: true });
      saveReport(); console.log(JSON.stringify({ style, fps: Number(fps.toFixed(2)), drawP95Ms: Number(p95.toFixed(2)), passed: true }));
    }

    await page.setViewportSize({ width: 1280, height: 720 }); await sleep(200);
    for (let i = 0; i < 12; i++) {
      const style = styles[i % styles.length];
      publish('text@' + style + ':' + message);
      await page.waitForSelector('.style-' + style + ' .fx-canvas'); await sleep(80);
      assert.equal(await page.locator('.fx-canvas').count(), 1, 'Multiple canvases after switch ' + i);
      assert.deepEqual(await page.evaluate(() => effectsProbe.listenerCounts()), styleListeners[style], 'Listeners leaked after switch to ' + style);
    }
    await sleep(900);
    assert.equal(await page.evaluate(() => effectsProbe.pending()), 1, 'Only the active effect RAF should remain');
    publish('text@black:' + message); await page.waitForSelector('.style-black .text-box'); await sleep(900);
    assert.equal(await page.evaluate(() => effectsProbe.pending()), 0, 'Leaving effects leaked a RAF');
    assert.deepEqual(await page.evaluate(() => effectsProbe.listenerCounts()), baseListeners, 'Leaving effects leaked listeners');
    publish('data@ani6:fixture'); await page.waitForSelector('.style-ani6 .data-box'); await sleep(180);
    const reads = macroReads; publish(signal); await sleep(180);
    assert(macroReads > reads, 'Repeated data signals must still refresh macro data');
    assert.deepEqual(report.browserErrors, []); assert.deepEqual(external, []);
    report.ok = true; report.externalRequests = external.length;
    report.checks = ['approved-ani3-renderer-and-CSS-unchanged', 'nine-actual-moving-canvases', 'duplicate-SSE-preserves-scenes',
      'bounded-4K-DPR2-canvas', '30fps-budget', 'no-steady-gradient-allocations', 'no-fullscreen-blur',
      'hidden-and-reduced-motion-pause', 'resize-keeps-canvas', '12-style-switches-no-listener-or-RAF-leaks', 'macro-data-still-refreshes'];
    saveReport(); console.log(JSON.stringify({ ok: true, styles: report.styles.length, checks: report.checks }));
    await ctx.close();
  } finally {
    await browser.close(); for (const stream of streams) stream.end(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { report.error = error.stack; saveReport(); console.error(error); process.exitCode = 1; });
