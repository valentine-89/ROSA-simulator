'use strict';
// Pass an MP4 fixture at least 6 seconds long as argv[2]. No production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { displayHtml } = require('../media-manager/definition.cjs');
const clip = fs.readFileSync(path.resolve(process.argv[2]));
const standalone = fs.readFileSync(process.env.MEDIA_TEST_HTML || path.join(__dirname, 'dashboard.html'), 'utf8');
const streams = new Set();
let origin, signal, snapshots = 0;
function send(stream) {
  stream.write('data: ' + JSON.stringify({ type: 'telemetry', payload: { media: signal } }) + '\n\n');
  stream.write('data: ' + JSON.stringify({ type: 'timeseries', rows: [{ field: 'media', value: signal }] }) + '\n\n');
}
function publish(next) { signal = next; for (const stream of streams) send(stream); }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname === '/clip.mp4') {
    const range = String(req.headers.range || '').match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${clip.length}`, 'Content-Length': end - start + 1 });
      return res.end(clip.subarray(start, end + 1));
    }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': clip.length });
    return res.end(clip);
  }
  if (url.pathname.endsWith('/stream') || url.pathname.includes('/iot-page-realtime/')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    streams.add(res); snapshots++; send(res);
    req.on('close', () => streams.delete(res)); return;
  }
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ c1: 'ok', c2: { payload: { media: signal } } }));
  }
  if (url.pathname === '/public') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(displayHtml()
      .replace('__ROSA_IOT_PAGE_META__', JSON.stringify({ mediaScreen: { prefix: '', field: 'media', historyMs: 0 } }))
      .replace('__ROSA_IOT_PAGE_CONTEXT__', JSON.stringify({ ioid: 'IOfixture', pageId: 'display' })));
  }
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html');
    return res.end(standalone.replaceAll('<<sessionid>>', 'IOfixture@key').replaceAll('<<syncid>>', 'sync'));
  }
  res.writeHead(404); res.end();
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  signal = 'video@black:' + origin + '/clip.mp4';
  const timer = setInterval(() => { for (const stream of streams) send(stream); }, 1000);
  const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  try {
    const context = await browser.newContext(); context.setDefaultTimeout(15000);
    await context.addInitScript(() => {
      window.mediaEvents = 0;
      const NativeEventSource = window.EventSource;
      window.EventSource = class extends NativeEventSource {
        constructor(...args) { super(...args); this.addEventListener('message', () => window.mediaEvents++); }
      };
    });
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    const duration = await page.evaluate(() => {
      window.player = document.querySelector('video'); window.farthest = 0; window.looped = false;
      player.addEventListener('timeupdate', () => {
        if (window.farthest > player.duration - .7 && player.currentTime < 1) window.looped = true;
        window.farthest = Math.max(window.farthest, player.currentTime);
      });
      return player.duration;
    });
    assert(duration >= 6 && duration <= 30, 'Use a 6–30 second test clip');
    await page.waitForFunction(() => window.farthest > 4);
    assert(await page.evaluate(() => document.querySelector('video') === window.player), 'Duplicate telemetry must preserve the video node');
    await page.waitForFunction(() => window.looped, {}, { timeout: (duration + 3) * 1000 });
    const count = snapshots;
    for (const stream of streams) stream.end();
    await page.waitForFunction(n => window.mediaEvents > n, await page.evaluate(() => window.mediaEvents));
    assert(snapshots > count, 'SSE must reconnect and replay a snapshot');
    assert(await page.evaluate(() => document.querySelector('video') === window.player));
    publish('video@black:' + origin + '/clip.mp4?next=1');
    await page.waitForFunction(() => document.querySelector('video') !== window.player);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    const events = await page.evaluate(() => { window.player = document.querySelector('video'); player.pause(); return window.mediaEvents; });
    await page.waitForFunction(n => window.mediaEvents > n, events);
    assert(await page.evaluate(() => document.querySelector('video') === window.player && player.paused));
    for (const [type, selector, value] of [['audio', 'audio', origin + '/clip.mp4'], ['youtube', 'iframe', 'https://www.youtube.com/watch?v=fixture']]) {
      publish(type + '@black:' + value);
      await page.waitForSelector(selector);
      const seen = await page.evaluate(selector => { window.player = document.querySelector(selector); return window.mediaEvents; }, selector);
      await page.waitForFunction(n => window.mediaEvents > n, seen);
      assert(await page.evaluate(selector => document.querySelector(selector) === window.player, selector));
    }
    publish('text:Đổi nội dung'); await page.getByText('Đổi nội dung', { exact: true }).waitFor();
    publish('video@black:' + origin + '/clip.mp4');
    await page.goto(origin + '/public');
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.evaluate(() => { window.player = document.querySelector('video'); });
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 4);
    assert(await page.evaluate(() => document.querySelector('video') === window.player));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, duration, checks: ['play-past-4s', 'loop-after-end', 'SSE-reconnect-preserves-player', 'changed-URL-replaces-player', 'paused-state-preserved', 'audio-and-youtube-stable', 'content-change', 'public-page-playback'], browserErrors: errors }));
  } finally {
    clearInterval(timer); await browser.close(); for (const stream of streams) stream.end();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
