const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const {
  composeDashboardEditableSections,
  parseDashboardEditableSections
} = require('./src/dashboardEditableSections');
const { SimulatorStore, PublicPageError, normalizeIoDataKey, parseFieldsParam } = require('./src/store');

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
  templateRoot: TEMPLATE_ROOT,
  defaultSessionId: DEFAULT_SESSION_ID,
  defaultSyncId: DEFAULT_SYNC_ID
});

const generatorTimers = new Map();
const publicRateBuckets = new Map();

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

function binary(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function errorJson(res, status, message) {
  json(res, status, { error: String(message || 'Request failed.') });
}

function publicErrorJson(res, error, fallbackStatus = 400) {
  const status = error instanceof PublicPageError
    ? error.status
    : Number(error && error.status) || fallbackStatus;
  json(res, status, {
    ok: false,
    error: error && error.code ? error.code : 'REQUEST_FAILED',
    message: error && error.message ? error.message : 'Request failed.'
  });
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        reject(new PublicPageError(413, 'BODY_TOO_LARGE', `Request body exceeds ${maxBytes} bytes.`));
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
  if (ext === '.json' || ext === '.iodata') return 'application/json; charset=utf-8';
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

function sanitizeFileName(value, fallback = 'template') {
  const normalized = String(value || '').trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function shouldSkipExportFile(fileName) {
  const base = path.basename(String(fileName || ''));
  return !base
    || base === '.DS_Store'
    || base.endsWith('.sqlite-shm')
    || base.endsWith('.sqlite-wal');
}

function walkFiles(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const filePath = path.join(root, entry.name);
    if (shouldSkipExportFile(relativePath)) continue;
    if (entry.isDirectory()) {
      rows.push(...walkFiles(filePath, relativePath));
    } else if (entry.isFile()) {
      rows.push({ filePath, relativePath: relativePath.split(path.sep).join('/') });
    }
  }
  return rows;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    time: ((hours << 11) | (minutes << 5) | seconds) & 0xffff,
    date: (((year - 1980) << 9) | (month << 5) | day) & 0xffff
  };
}

function createZip(entries) {
  const fileParts = [];
  const centralParts = [];
  let offset = 0;
  const now = dosDateTime();

  entries.forEach((entry) => {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ''), 'utf8');
    const crc = crc32(data);

    if (nameBuffer.length > 0xffff) throw new Error(`ZIP file name is too long: ${entry.name}`);
    if (data.length > 0xffffffff) throw new Error(`ZIP entry is too large: ${entry.name}`);
    if (offset > 0xffffffff) throw new Error('ZIP package is too large.');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);

    fileParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  });

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...fileParts, ...centralParts, end]);
}

function rewritePackageManifestPaths(value) {
  if (Array.isArray(value)) return value.map(rewritePackageManifestPaths);
  if (value && typeof value === 'object') {
    const next = {};
    for (const [key, item] of Object.entries(value)) next[key] = rewritePackageManifestPaths(item);
    return next;
  }
  if (typeof value !== 'string') return value;
  return value
    .replace(/\/sample_templates\/templates\//g, '/sample_dashboards/')
    .replace(/\/sample_templates\/shared\/setup_bridge\.js/g, '/sample_dashboards/setup_bridge.js')
    .replace(/\/sample_templates\/shared\/setup_shared\.css/g, '/sample_dashboards/setup_shared.css')
    .replace(/\/sample_templates\/shared\/(dashboard-[A-Za-z0-9._-]+\.(?:js|css))/g, '/$1')
    .replace(/\/sample_templates\/legacy\/default\//g, '/sample_dashboards/default/');
}

function templateFolderFromPublicPath(publicPath) {
  const normalized = String(publicPath || '').split('?')[0].trim();
  let match = normalized.match(/^\/sample_dashboards\/([^/]+)\//);
  if (match) return match[1];
  match = normalized.match(/^\/sample_templates\/templates\/([^/]+)\//);
  if (match) return match[1];
  return '';
}

function collectTemplateFolderCandidates(sample) {
  const candidates = [];
  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
      return;
    }
    const folder = templateFolderFromPublicPath(value);
    if (folder) candidates.push(folder);
  }
  visit(sample);
  return candidates;
}

function buildTemplatePackage(templateId) {
  const manifest = loadManifest();
  const sample = (manifest.samples || []).find((entry) => String(entry.id || '') === String(templateId || ''));
  if (!sample) throw new Error('Sample template not found.');

  const folderCandidates = collectTemplateFolderCandidates(sample);
  const templateFolder = folderCandidates.find((folder) => fs.existsSync(path.join(TEMPLATE_ROOT, folder)))
    || sanitizeFileName(sample.id, 'template');
  const templateDir = path.join(TEMPLATE_ROOT, templateFolder);
  if (!fs.existsSync(templateDir) || !fs.statSync(templateDir).isDirectory()) {
    throw new Error(`Template folder not found: ${templateFolder}`);
  }

  const packageManifest = {
    samples: [rewritePackageManifestPaths(JSON.parse(JSON.stringify(sample)))]
  };
  const packageMeta = {
    format: 'rosa-template-package',
    version: 1,
    source: 'ROSA-simulator',
    createdAt: new Date().toISOString(),
    templateId: sample.id,
    templateFolder,
    name: sample.name || sample.id,
    entryManifest: 'sample_templates/manifest.json',
    pathProfile: 'sample_dashboards'
  };
  const entries = [
    {
      name: 'rosa-template-package.json',
      data: Buffer.from(JSON.stringify(packageMeta, null, 2), 'utf8')
    },
    {
      name: 'sample_templates/manifest.json',
      data: Buffer.from(JSON.stringify(packageManifest, null, 2), 'utf8')
    }
  ];

  walkFiles(templateDir).forEach((file) => {
    entries.push({
      name: `sample_templates/templates/${templateFolder}/${file.relativePath}`,
      data: fs.readFileSync(file.filePath)
    });
  });
  walkFiles(SHARED_ROOT).forEach((file) => {
    entries.push({
      name: `sample_templates/shared/${file.relativePath}`,
      data: fs.readFileSync(file.filePath)
    });
  });

  return {
    fileName: `${sanitizeFileName(sample.name || sample.id, templateFolder)}-${sanitizeFileName(sample.id, templateFolder)}.zip`,
    body: createZip(entries),
    fileCount: entries.length
  };
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
  if (urlPath === '/sample_dashboards/setup_bridge.js') return path.join(SHARED_ROOT, 'setup_bridge.js');
  if (urlPath === '/sample_dashboards/setup_shared.css') return path.join(SHARED_ROOT, 'setup_shared.css');
  if (urlPath.startsWith('/sample_dashboards/')) return safeJoin(TEMPLATE_ROOT, urlPath.replace(/^\/sample_dashboards\//, ''));
  if (/^\/dashboard-[A-Za-z0-9._-]+\.(?:js|css)$/.test(urlPath)) return path.join(SHARED_ROOT, path.basename(urlPath));
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

function requestClientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'local';
}

function sameOriginFromHeader(req, headerName) {
  const value = String(req.headers[headerName] || '').trim();
  if (!value) return true;
  try {
    const host = String(req.headers.host || '').trim().toLowerCase();
    const parsed = new URL(value);
    return parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function assertSameOrigin(req) {
  if (!sameOriginFromHeader(req, 'origin') || !sameOriginFromHeader(req, 'referer')) {
    throw new PublicPageError(403, 'CROSS_ORIGIN_REJECTED', 'Cross-origin public IoT request was rejected.');
  }
}

function checkPublicRateLimit(key, config) {
  const limit = Math.max(1, Math.min(600, Number(config && config.limit) || 600));
  const windowMs = Math.max(1000, Math.min(10 * 60 * 1000, Number(config && config.windowMs) || 60 * 1000));
  const now = Date.now();
  let bucket = publicRateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
  }
  bucket.count += 1;
  publicRateBuckets.set(key, bucket);
  if (publicRateBuckets.size > 5000) {
    for (const [bucketKey, item] of publicRateBuckets.entries()) {
      if (!item || item.resetAt <= now) publicRateBuckets.delete(bucketKey);
    }
  }
  if (bucket.count > limit) {
    throw new PublicPageError(429, 'RATE_LIMITED', 'Public IoT page rate limit exceeded.');
  }
}

function openTelemetryStream(req, res, sessionId, fields, options = {}) {
  const fieldLookup = new Set((fields || []).map((field) => String(field || '').toLowerCase()).filter(Boolean));
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const latest = store.getLatestState(sessionId, fields);
  if (latest && latest.payload && Object.keys(latest.payload).length) {
    send({
      type: 'telemetry',
      sessionId,
      syncId: options.syncId,
      serverTime: latest.serverTime,
      payload: latest.payload
    });
  }
  const unsubscribe = store.subscribe((event) => {
    if (event.sessionId && event.sessionId !== sessionId) return;
    if (event.type === 'telemetry' && fieldLookup.size > 0) {
      const payload = {};
      for (const [field, value] of Object.entries(event.payload || {})) {
        if (fieldLookup.has(field.toLowerCase())) payload[field] = value;
      }
      if (!Object.keys(payload).length) return;
      send({ ...event, syncId: options.syncId, payload });
      return;
    }
    if (event.type === 'timeseries' && fieldLookup.size > 0) {
      const rows = (event.rows || []).filter((row) => fieldLookup.has(String(row.field || '').toLowerCase()));
      if (!rows.length) return;
      send({ ...event, syncId: options.syncId, rows });
      return;
    }
    send({ ...event, syncId: options.syncId });
  });
  req.on('close', unsubscribe);
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
  if (req.method === 'GET' && url.pathname === '/sim/api/export-template') {
    const templateId = String(url.searchParams.get('templateId') || '').trim();
    const pkg = buildTemplatePackage(templateId);
    binary(res, 200, pkg.body, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${pkg.fileName}"`,
      'X-ROSA-Template-Files': String(pkg.fileCount)
    });
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

async function handlePublicPageApi(req, res, url) {
  const pageMatch = url.pathname.match(/^\/iot-page\/([^/]+)\/([^/]+)$/);
  if (req.method === 'GET' && pageMatch) {
    try {
      const ioid = decodeURIComponent(pageMatch[1]);
      const pageId = decodeURIComponent(pageMatch[2]);
      const rendered = store.renderPublicPage(ioid, pageId);
      text(res, 200, rewritePackageManifestPaths(rendered.html), 'text/html; charset=utf-8');
    } catch (error) {
      publicErrorJson(res, error, 404);
    }
    return true;
  }

  const telemetryMatch = url.pathname.match(/^\/api\/iot-page-telemetry\/([^/]+)\/([^/]+)$/);
  if (req.method === 'GET' && telemetryMatch) {
    try {
      const ioid = decodeURIComponent(telemetryMatch[1]);
      const pageId = decodeURIComponent(telemetryMatch[2]);
      const context = store.getPublicPageReadContext(ioid, pageId);
      const latest = store.getLatestState(context.publicSessionId, context.publicApi.fields);
      if (!latest || !latest.payload || !Object.keys(latest.payload).length) {
        json(res, 404, { c1: 'No telemetry available.', c2: 0 });
        return true;
      }
      json(res, 200, {
        c1: 'ok',
        c2: {
          sessionId: context.publicSessionId,
          syncId: 'public-page',
          serverTime: latest.serverTime,
          payload: latest.payload
        }
      });
    } catch (error) {
      publicErrorJson(res, error, 400);
    }
    return true;
  }

  const timeseriesMatch = url.pathname.match(/^\/api\/iot-page-timeseries\/([^/]+)\/([^/]+)$/);
  if (req.method === 'GET' && timeseriesMatch) {
    try {
      const ioid = decodeURIComponent(timeseriesMatch[1]);
      const pageId = decodeURIComponent(timeseriesMatch[2]);
      const context = store.getPublicPageReadContext(ioid, pageId);
      const to = Number(url.searchParams.get('to') || Date.now());
      const from = Number(url.searchParams.get('from') || (to - 60 * 60 * 1000));
      const result = store.queryTimeseries(context.publicSessionId, from, to, context.publicApi.fields);
      json(res, 200, {
        c1: 'ok',
        c2: {
          ...result,
          sessionId: context.publicSessionId,
          syncId: 'public-page'
        }
      });
    } catch (error) {
      publicErrorJson(res, error, 400);
    }
    return true;
  }

  const realtimeMatch = url.pathname.match(/^\/api\/iot-page-realtime\/([^/]+)\/([^/]+)$/);
  if (req.method === 'GET' && realtimeMatch) {
    try {
      const ioid = decodeURIComponent(realtimeMatch[1]);
      const pageId = decodeURIComponent(realtimeMatch[2]);
      const context = store.getPublicPageReadContext(ioid, pageId);
      checkPublicRateLimit(
        `realtime:${requestClientKey(req)}:${context.ioid}:${context.pageId}`,
        context.publicApi.rateLimit
      );
      openTelemetryStream(req, res, context.publicSessionId, context.publicApi.fields, { syncId: 'public-page' });
    } catch (error) {
      publicErrorJson(res, error, 400);
    }
    return true;
  }

  const macroMatch = url.pathname.match(/^\/api\/iot-page-macro\/([^/]+)\/([^/]+)$/);
  if (req.method === 'POST' && macroMatch) {
    try {
      assertSameOrigin(req);
      const ioid = decodeURIComponent(macroMatch[1]);
      const pageId = decodeURIComponent(macroMatch[2]);
      const context = store.getPublicPageContext(ioid, pageId);
      const body = await readBody(req, context.publicApi.maxBodyBytes);
      const macroName = String(body && body.macro || 'macro').trim() || 'macro';
      checkPublicRateLimit(
        `macro:${requestClientKey(req)}:${context.ioid}:${context.pageId}:${macroName}`,
        context.publicApi.rateLimit
      );
      const result = store.executePublicPageMacro(context.ioid, context.pageId, body);
      json(res, 200, result);
    } catch (error) {
      publicErrorJson(res, error, 400);
    }
    return true;
  }

  const streamMatch = url.pathname.match(/^\/api\/iot-page-stream\/([^/]+)\/([^/]+)$/);
  if (req.method === 'GET' && streamMatch) {
    try {
      const ioid = decodeURIComponent(streamMatch[1]);
      const pageId = decodeURIComponent(streamMatch[2]);
      const context = store.getPublicPageContext(ioid, pageId);
      if (!context.publicApi.stream) {
        throw new PublicPageError(403, 'PUBLIC_STREAM_DISABLED', 'Public IoData stream is not enabled for this page.');
      }
      checkPublicRateLimit(
        `stream:${requestClientKey(req)}:${context.ioid}:${context.pageId}`,
        context.publicApi.rateLimit
      );
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
      send({ type: 'ready', ioid: context.ioid, pageId: context.pageId, ts: Date.now() });
      const unsubscribe = store.subscribe((event) => {
        if (event.type !== 'iodata_changed') return;
        if (event.sessionId && normalizeIoDataKey(event.sessionId) !== context.ioid) return;
        if (event.macro && context.publicApi.macros.size && !context.publicApi.macros.has(event.macro)) return;
        send({
          type: 'iodata_changed',
          ioid: context.ioid,
          pageId: context.pageId,
          macro: event.macro || '',
          source: event.source || 'macro',
          ts: event.ts || Date.now()
        });
      });
      req.on('close', unsubscribe);
    } catch (error) {
      publicErrorJson(res, error, 400);
    }
    return true;
  }

  const cmdMatch = url.pathname.match(/^\/api\/iot-cmd\/([^/]+)\/([^/]+)$/);
  if (req.method === 'POST' && cmdMatch) {
    try {
      assertSameOrigin(req);
      const ioid = decodeURIComponent(cmdMatch[1]);
      const cmdId = decodeURIComponent(cmdMatch[2]);
      checkPublicRateLimit(`cmd:${requestClientKey(req)}:${ioid}:${cmdId}`, { limit: 120, windowMs: 60 * 1000 });
      const body = await readBody(req, 64 * 1024);
      const result = store.executeSystemCommand(ioid, cmdId, body);
      json(res, 200, result);
    } catch (error) {
      publicErrorJson(res, error, 400);
    }
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
        phone: process.env.SIM_USER_PHONE || '0912345123'
      }
    });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/sample-dashboards/database') {
    const body = await readBody(req);
    const source = resolveSampleDatabase(body.templateId, body.locale);
    const result = store.replaceIoDataFile(body.sessionId || DEFAULT_SESSION_ID, source, {
      syncId: body.syncId || DEFAULT_SYNC_ID
    });
    if (result.publicGenerators) rescheduleAllGenerators();
    json(res, 200, { ok: true, exists: false, overwritten: false, ...result });
    return true;
  }

  const streamMatch = url.pathname.match(/^\/api\/([^/]+)\/stream$/);
  if (req.method === 'GET' && streamMatch) {
    const sessionId = decodeURIComponent(streamMatch[1]);
    const fields = parseFieldsParam(url.searchParams.get('fields'));
    openTelemetryStream(req, res, sessionId, fields);
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
    if (await handlePublicPageApi(req, res, url)) return;
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
