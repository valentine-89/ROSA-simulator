const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const {
  composeDashboardEditableSections,
  parseDashboardEditableSections
} = require('./src/dashboardEditableSections');
const { SimulatorStore, normalizeIoDataKey, parseFieldsParam } = require('./src/store');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4177);
const SAMPLE_ROOT = path.join(ROOT, 'sample_templates');
const TEMPLATE_ROOT = path.join(SAMPLE_ROOT, 'templates');
const SHARED_ROOT = path.join(SAMPLE_ROOT, 'shared');
const LEGACY_ROOT = path.join(SAMPLE_ROOT, 'legacy');
const UI_ROOT = path.join(ROOT, 'simulator_ui');
const STATE_ROOT = path.join(ROOT, '.sim', 'state');
const DEFAULT_SESSION_ID = process.env.SIM_SESSION_ID || 'IO123abcd@simulate';
const DEFAULT_SYNC_ID = process.env.SIM_SYNC_ID || 'SIM_SYNC';

const store = new SimulatorStore({
  rootDir: ROOT,
  stateDir: STATE_ROOT,
  templateRoot: TEMPLATE_ROOT
});

const generatorTimers = new Map();

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function text(res, status, value, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(value),
    'Cache-Control': 'no-store'
  });
  res.end(value);
}

function errorJson(res, status, message) {
  json(res, status, { error: String(message || 'Request failed.') });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.sqlite') return 'application/octet-stream';
  return 'application/octet-stream';
}

function safeJoin(root, requestPath) {
  const cleaned = decodeURIComponent(String(requestPath || '')).replace(/^\/+/, '');
  const resolved = path.resolve(root, cleaned);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    return '';
  }
  return resolved;
}

function serveFile(res, filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    text(res, 404, 'Not found');
    return;
  }
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function staticFileFor(urlPath) {
  if (urlPath === '/' || urlPath === '/index.html') return path.join(UI_ROOT, 'index.html');
  if (urlPath.startsWith('/simulator/')) return safeJoin(UI_ROOT, urlPath.replace(/^\/simulator\//, ''));
  if (urlPath === '/sample_dashboards/manifest.json') return path.join(SAMPLE_ROOT, 'manifest.json');
  if (urlPath.startsWith('/sample_dashboards/')) return safeJoin(TEMPLATE_ROOT, urlPath.replace(/^\/sample_dashboards\//, ''));
  if (urlPath === '/dashboard-themes.css') return path.join(SHARED_ROOT, 'dashboard-themes.css');
  if (urlPath === '/dashboard-command-template.js') return path.join(SHARED_ROOT, 'dashboard-command-template.js');
  if (urlPath === '/dashboard-basic-cards-engine.js') return path.join(SHARED_ROOT, 'dashboard-basic-cards-engine.js');
  if (urlPath.startsWith('/legacy/')) return safeJoin(LEGACY_ROOT, urlPath.replace(/^\/legacy\//, ''));
  return '';
}

function loadManifest() {
  return JSON.parse(fs.readFileSync(path.join(SAMPLE_ROOT, 'manifest.json'), 'utf8'));
}

function findSample(templateId) {
  const manifest = loadManifest();
  return (manifest.samples || []).find((entry) => String(entry.id || '') === String(templateId || ''));
}

function findSampleLocale(sample, locale) {
  const normalized = String(locale || '').trim();
  if (normalized && sample && sample.locales && sample.locales[normalized]) return sample.locales[normalized];
  if (sample && sample.defaultLocale && sample.locales && sample.locales[sample.defaultLocale]) return sample.locales[sample.defaultLocale];
  return null;
}

function resolveSamplePath(publicPath) {
  const normalized = String(publicPath || '').split('?')[0].trim();
  if (!normalized) return '';
  if (normalized === '/sample_dashboards/manifest.json') return path.join(SAMPLE_ROOT, 'manifest.json');
  if (normalized.startsWith('/sample_dashboards/')) {
    return safeJoin(TEMPLATE_ROOT, normalized.replace(/^\/sample_dashboards\//, ''));
  }
  return safeJoin(SAMPLE_ROOT, normalized.replace(/^\/+/, ''));
}

function fillPlaceholders(html, sessionId = DEFAULT_SESSION_ID, syncId = DEFAULT_SYNC_ID) {
  return String(html || '')
    .replaceAll('<<sessionid>>', sessionId)
    .replaceAll('<<sessionId>>', sessionId)
    .replaceAll('<<syncid>>', syncId)
    .replaceAll('<<syncId>>', syncId);
}

function injectShim(html) {
  const snippet = `<script>window.ROSA_SIMULATOR_CONTEXT=${JSON.stringify({ sessionId: DEFAULT_SESSION_ID, syncId: DEFAULT_SYNC_ID })};</script>\n<script src="/simulator/shim.js"></script>\n`;
  if (String(html || '').includes('/simulator/shim.js')) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet}</head>`);
  return `${snippet}${html}`;
}

function renderDashboardHtml(htmlPath, config) {
  const filePath = resolveSamplePath(htmlPath);
  if (!filePath || !fs.existsSync(filePath)) throw new Error('Dashboard HTML not found.');
  const raw = fs.readFileSync(filePath, 'utf8');
  let html = fillPlaceholders(raw);
  let parsed = parseDashboardEditableSections(html);
  if (config !== undefined && parsed.hasMarkers && !parsed.parseError) {
    html = composeDashboardEditableSections(parsed, {
      ...parsed.sections,
      config: JSON.stringify(config || {}, null, 2)
    });
    parsed = parseDashboardEditableSections(html);
  }
  return {
    html: injectShim(html),
    config: parsed.hasMarkers && !parsed.parseError ? safeParseJson(parsed.sections.config, {}) : {},
    hasMarkers: parsed.hasMarkers,
    parseError: parsed.parseError
  };
}

function safeParseJson(textValue, fallback) {
  try { return JSON.parse(String(textValue || '')); } catch { return fallback; }
}

function resolveSampleDatabase(templateId, locale) {
  const sample = findSample(templateId);
  if (!sample) throw new Error('Sample template not found.');
  const localeEntry = findSampleLocale(sample, locale);
  const sampleDatabase = String((localeEntry && localeEntry.sampleDatabase) || sample.sampleDatabase || '').trim();
  if (!sampleDatabase) throw new Error('Sample database is not configured for this template.');
  const filePath = resolveSamplePath(sampleDatabase);
  if (!filePath || !fs.existsSync(filePath) || !/\.sqlite$/i.test(filePath)) {
    throw new Error('Sample database file not found.');
  }
  return filePath;
}

function fillContextValue(value) {
  return String(value || '')
    .replaceAll('<<sessionid>>', DEFAULT_SESSION_ID)
    .replaceAll('<<sessionId>>', DEFAULT_SESSION_ID)
    .replaceAll('<<syncid>>', DEFAULT_SYNC_ID)
    .replaceAll('<<syncId>>', DEFAULT_SYNC_ID);
}

function getDefaultFieldList(templateId, locale) {
  const sample = findSample(templateId);
  if (!sample) throw new Error('Sample template not found.');
  const localeEntry = findSampleLocale(sample, locale);
  if (localeEntry && Object.prototype.hasOwnProperty.call(localeEntry, 'default-fields')) {
    return Array.isArray(localeEntry['default-fields']) ? localeEntry['default-fields'] : [];
  }
  return Array.isArray(sample['default-fields']) ? sample['default-fields'] : [];
}

function hasNumber(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && !value.trim()) return false;
  return Number.isFinite(Number(value));
}

function defaultValueForField(field) {
  const normalized = String(field || '').trim();
  if (normalized.toLowerCase() === 'media') return 'text@tech:ROSA simulator';
  if (/^#10[2-9]\d/.test(normalized)) return '0000,disable,ON';
  return '';
}

function randomGeneratorIntervalMs() {
  return 2000 + Math.floor(Math.random() * 2001);
}

function isOnOffField(field) {
  return /^(O[\w.-]*|status|state|alarm\w*)$/i.test(String(field || '').trim());
}

function normalizeDefaultFieldKind(field, rawKind, minValue, maxValue) {
  const kind = String(rawKind || '').trim().toLowerCase();
  if (kind === 'timeseries' || kind === 'number' || kind === 'text' || kind === 'onoff') return kind;
  if (!kind || kind === 'telemetry') {
    if (hasNumber(minValue) || hasNumber(maxValue)) return 'number';
    if (isOnOffField(field)) return 'onoff';
    return 'text';
  }
  throw new Error(`Invalid default field kind for ${field}.`);
}

function modeForDefaultKind(kind) {
  if (kind === 'timeseries' || kind === 'number') return 'random-number';
  if (kind === 'onoff') return 'toggle';
  return 'fixed';
}

function defaultFieldToGenerator(entry) {
  const field = String(entry && entry.field || '').trim();
  const minValue = hasNumber(entry && entry.min) ? Number(entry.min) : null;
  const maxValue = hasNumber(entry && entry.max) ? Number(entry.max) : null;
  if (!field) throw new Error('default-fields item is missing field.');
  const kind = normalizeDefaultFieldKind(field, entry && entry.kind, minValue, maxValue);
  const numeric = kind === 'timeseries' || kind === 'number';
  const sessionId = fillContextValue(entry.deviceId || entry.sessionId || DEFAULT_SESSION_ID);
  return {
    sessionId,
    field,
    mode: modeForDefaultKind(kind),
    valueText: kind === 'text' ? defaultValueForField(field) : '',
    minValue: numeric ? minValue : null,
    maxValue: numeric ? maxValue : null,
    digits: 1,
    intervalMs: randomGeneratorIntervalMs(),
    writeTimeseries: kind === 'timeseries',
    enabled: true
  };
}

function defaultFieldSuggestions(templateId, locale) {
  const seen = new Set();
  return getDefaultFieldList(templateId, locale).map((entry, index) => {
    const generator = defaultFieldToGenerator(entry || {});
    const kind = normalizeDefaultFieldKind(generator.field, entry && entry.kind, generator.minValue, generator.maxValue);
    const key = `${generator.sessionId}\n${generator.field.toLowerCase()}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      id: `${generator.sessionId}:${generator.field}:${index}`,
      field: generator.field,
      kind,
      min: generator.minValue,
      max: generator.maxValue,
      sessionId: generator.sessionId,
      exists: store.generatorExists(generator.sessionId, generator.field),
      generator
    };
  }).filter(Boolean);
}

function scheduleGenerator(generator) {
  const id = Number(generator.id);
  if (!id) return;
  if (generatorTimers.has(id)) clearInterval(generatorTimers.get(id));
  if (!Number(generator.enabled || 0)) {
    generatorTimers.delete(id);
    return;
  }
  const intervalMs = Math.max(250, Number(generator.intervalMs || generator.interval_ms || 1000));
  const timer = setInterval(() => {
    try { store.tickGenerator(id); } catch (error) { console.warn('Generator tick failed:', error.message); }
  }, intervalMs);
  timer.unref?.();
  generatorTimers.set(id, timer);
}

function rescheduleAllGenerators() {
  for (const timer of generatorTimers.values()) clearInterval(timer);
  generatorTimers.clear();
  for (const generator of store.listGenerators()) scheduleGenerator(generator);
}

async function handleSimApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/sim/api/context') {
    json(res, 200, { sessionId: DEFAULT_SESSION_ID, syncId: DEFAULT_SYNC_ID, ioid: normalizeIoDataKey(DEFAULT_SESSION_ID) });
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/sim/api/manifest') {
    json(res, 200, loadManifest());
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/sim/api/render') {
    const htmlPath = url.searchParams.get('html') || '';
    json(res, 200, renderDashboardHtml(htmlPath));
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/sim/api/render') {
    const body = await readBody(req);
    json(res, 200, renderDashboardHtml(body.htmlPath, body.config));
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/sim/api/generators') {
    json(res, 200, store.listGenerators());
    return true;
  }
  if (req.method === 'DELETE' && url.pathname === '/sim/api/generators') {
    const result = store.clearGeneratorsAndTelemetry();
    rescheduleAllGenerators();
    json(res, 200, { ok: true, ...result });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/sim/api/default-fields') {
    const body = await readBody(req);
    json(res, 200, { fields: defaultFieldSuggestions(body.templateId, body.locale) });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/sim/api/generators') {
    const body = await readBody(req);
    const row = store.upsertGenerator(body);
    rescheduleAllGenerators();
    json(res, 200, row);
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/sim/api/generators/bulk') {
    const body = await readBody(req);
    const result = store.bulkInsertMissingGenerators(body.generators || []);
    rescheduleAllGenerators();
    json(res, 200, result);
    return true;
  }
  if (req.method === 'POST' && url.pathname.match(/^\/sim\/api\/generators\/\d+\/tick$/)) {
    const id = Number(url.pathname.split('/')[4]);
    json(res, 200, store.tickGenerator(id) || {});
    return true;
  }
  if (req.method === 'POST' && url.pathname.match(/^\/sim\/api\/generators\/\d+\/toggle$/)) {
    const id = Number(url.pathname.split('/')[4]);
    const body = await readBody(req);
    store.setGeneratorEnabled(id, !!body.enabled);
    rescheduleAllGenerators();
    json(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'DELETE' && url.pathname.match(/^\/sim\/api\/generators\/\d+$/)) {
    const id = Number(url.pathname.split('/')[4]);
    store.deleteGenerator(id);
    rescheduleAllGenerators();
    json(res, 200, { ok: true });
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/sim/api/commands') {
    json(res, 200, store.listCommandLog(Number(url.searchParams.get('limit') || 100)));
    return true;
  }
  if (req.method === 'DELETE' && url.pathname === '/sim/api/commands') {
    json(res, 200, { ok: true, deleted: store.clearCommandLog() });
    return true;
  }
  if (req.method === 'DELETE' && url.pathname === '/sim/api/iodata') {
    json(res, 200, { ok: true, deleted: store.clearIoDataFiles() });
    return true;
  }
  if (req.method === 'POST' && url.pathname.match(/^\/sim\/api\/cmd\/[^/]+$/)) {
    const ioid = decodeURIComponent(url.pathname.split('/').pop());
    const body = await readBody(req);
    const result = store.handleLocalCommand(ioid, body.cmd || body.command || '');
    text(res, 200, result);
    return true;
  }
  return false;
}

async function handleRuntimeApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/auth/google/status') {
    json(res, 200, {
      authenticated: true,
      user: {
        email: process.env.SIM_USER_EMAIL || 'developer@rosa.local',
        name: process.env.SIM_USER_NAME || 'ROSA Developer',
        phone: process.env.SIM_USER_PHONE || ''
      }
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/sample-dashboards/database') {
    const body = await readBody(req);
    const source = resolveSampleDatabase(body.templateId, body.locale);
    const result = store.replaceIoDataFile(body.sessionId || DEFAULT_SESSION_ID, source);
    json(res, 200, { ok: true, exists: false, overwritten: false, ...result });
    return true;
  }

  const streamMatch = url.pathname.match(/^\/api\/([^/]+)\/stream$/);
  if (req.method === 'GET' && streamMatch) {
    const sessionId = decodeURIComponent(streamMatch[1]);
    const fields = parseFieldsParam(url.searchParams.get('fields'));
    const fieldLookup = new Set(fields.map((field) => field.toLowerCase()));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    const latest = store.getLatestState(sessionId, fields);
    if (latest && latest.payload && Object.keys(latest.payload).length) {
      send({ type: 'telemetry', sessionId, serverTime: latest.serverTime, payload: latest.payload });
    }
    const unsubscribe = store.subscribe((event) => {
      if (event.sessionId && event.sessionId !== sessionId) return;
      if (event.type === 'telemetry' && fieldLookup.size > 0) {
        const payload = {};
        for (const [field, value] of Object.entries(event.payload || {})) {
          if (fieldLookup.has(field.toLowerCase())) payload[field] = value;
        }
        if (!Object.keys(payload).length) return;
        send({ ...event, payload });
        return;
      }
      if (event.type === 'timeseries' && fieldLookup.size > 0) {
        const rows = (event.rows || []).filter((row) => fieldLookup.has(String(row.field || '').toLowerCase()));
        if (!rows.length) return;
        send({ ...event, rows });
        return;
      }
      send(event);
    });
    req.on('close', unsubscribe);
    return true;
  }

  const apiMatch = url.pathname.match(/^\/api\/([^/]+)\/([^/]+)\/(iotelemetry|iotimeseries|iodata|dataquery)$/);
  if (!apiMatch) return false;
  const sessionId = decodeURIComponent(apiMatch[1]);
  const syncId = decodeURIComponent(apiMatch[2]);
  const action = apiMatch[3];

  if (action === 'iotelemetry' && req.method === 'GET') {
    const latest = store.getLatestState(sessionId, parseFieldsParam(url.searchParams.get('fields')));
    if (!latest) {
      json(res, 404, { c1: 'No telemetry available.', c2: 0 });
      return true;
    }
    json(res, 200, { c1: 'ok', c2: { sessionId, syncId, serverTime: latest.serverTime, payload: latest.payload } });
    return true;
  }
  if (action === 'iotelemetry' && req.method === 'POST') {
    const body = await readBody(req);
    store.ingestTelemetry(sessionId, syncId, body);
    json(res, 200, { c1: 'ok', c2: 0 });
    return true;
  }
  if (action === 'iotimeseries' && req.method === 'GET') {
    const to = Number(url.searchParams.get('to') || Date.now());
    const from = Number(url.searchParams.get('from') || (to - 60 * 60 * 1000));
    const result = store.queryTimeseries(sessionId, from, to, parseFieldsParam(url.searchParams.get('fields')));
    json(res, 200, { c1: 'ok', c2: result });
    return true;
  }
  if (action === 'iotimeseries' && req.method === 'POST') {
    const body = await readBody(req);
    store.ingestTimeseries(sessionId, syncId, body);
    json(res, 200, { c1: 'ok', c2: 0 });
    return true;
  }
  if ((action === 'iodata' || action === 'dataquery') && req.method === 'POST') {
    const body = await readBody(req);
    json(res, 200, store.executeMacro(sessionId, syncId, body));
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (await handleSimApi(req, res, url)) return;
    if (await handleRuntimeApi(req, res, url)) return;
    serveFile(res, staticFileFor(url.pathname));
  } catch (error) {
    console.error(error);
    errorJson(res, 400, error && error.message ? error.message : 'Request failed.');
  }
});

rescheduleAllGenerators();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ROSA-simulator running at http://localhost:${PORT}`);
});
