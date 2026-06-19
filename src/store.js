const fs = require('fs');
const path = require('path');

function requireDatabaseModule() {
  const bootstrapModules = process.env.ROSA_SIMULATOR_NODE_MODULES;
  if (bootstrapModules) {
    const bootstrapModule = path.join(bootstrapModules, 'better-sqlite3');
    if (fs.existsSync(bootstrapModule)) return require(bootstrapModule);
  }

  const bundledModule = path.join(__dirname, '..', 'runtime', 'node_modules', 'better-sqlite3');
  if (process.platform === 'win32' && fs.existsSync(bundledModule)) {
    return require(bundledModule);
  }
  return require('better-sqlite3');
}

const Database = requireDatabaseModule();

const RESERVED_MACRO_BINDINGS = new Set(['sync_id', 'syncid', 'session_id', 'sessionid', 'ioid']);
const PUBLIC_SESSION_SUFFIX = 'public-page';
const PUBLIC_IOT_PAGE_DEFAULT_BODY_BYTES = 4 * 1024;
const PUBLIC_IOT_PAGE_HARD_BODY_BYTES = 64 * 1024;
const PUBLIC_IOT_PAGE_MAX_RATE_LIMIT = 600;
const PUBLIC_IOT_PAGE_DEFAULT_WINDOW_MS = 60 * 1000;
const PUBLIC_IOT_PAGE_MIN_WINDOW_MS = 1000;
const PUBLIC_IOT_PAGE_MAX_WINDOW_MS = 10 * 60 * 1000;
const ID_PATTERN = /^[A-Za-z0-9._-]{1,96}$/;
const PAGE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MACRO_NAME_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;
const SAFE_DEFAULT_PARAM_PATTERN = /^[A-Za-z0-9_.:@/+ -]{0,128}$/;
const PLACEHOLDER_PATTERN = /<<([A-Za-z_][A-Za-z0-9_]*)>>/g;
const PUBLIC_PARAM_RESERVED_KEYS = new Set([
  'email',
  'username',
  'phone',
  'apikey',
  'api_key',
  'syncid',
  'sync_id',
  'sessionid',
  'session_id',
  'ioid',
  'macro',
  '__proto__',
  'prototype',
  'constructor'
]);

class PublicPageError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeIoDataKey(sessionId) {
  const raw = String(sessionId || '').trim();
  const beforeAt = raw.includes('@') ? raw.slice(0, raw.indexOf('@')) : raw;
  const sanitized = beforeAt.replace(/[^A-Za-z0-9._-]/g, '_').trim();
  if (!sanitized) throw new Error('Invalid sessionId.');
  return sanitized;
}

function parseFieldsParam(value) {
  return String(value || '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isTruthy(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return value === true || value === 1 || ['1', 'true', 'yes', 'on'].includes(normalized);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function safeJsonObject(value) {
  if (!value) return {};
  if (isRecord(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function quoteIdentifier(value) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

function normalizePublicIoid(value) {
  const normalized = String(value || '').trim();
  if (!ID_PATTERN.test(normalized) || !normalized.startsWith('IO')) {
    throw new PublicPageError(400, 'INVALID_IOID', 'Invalid ioid.');
  }
  return normalized;
}

function normalizePageId(value) {
  const normalized = String(value || '').trim();
  if (!PAGE_ID_PATTERN.test(normalized)) {
    throw new PublicPageError(400, 'INVALID_PAGE_ID', 'Invalid pageid.');
  }
  return normalized;
}

function normalizeMacroName(value, errorStatus = 400) {
  const normalized = String(value || '').trim();
  if (!MACRO_NAME_PATTERN.test(normalized)) {
    throw new PublicPageError(errorStatus, 'INVALID_MACRO', 'Macro name is invalid.');
  }
  return normalized;
}

function normalizeParamName(value, errorStatus = 400) {
  const normalized = String(value || '').trim();
  if (!NAME_PATTERN.test(normalized)) {
    throw new PublicPageError(errorStatus, 'INVALID_PARAM_NAME', `Parameter "${value}" has an invalid name.`);
  }
  return normalized;
}

function isReservedParamKey(value) {
  return PUBLIC_PARAM_RESERVED_KEYS.has(String(value || '').trim().toLowerCase());
}

function normalizeScalarValue(key, value, rule, options = {}) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    throw new PublicPageError(
      options.trustedConfig ? 500 : 400,
      'INVALID_PARAM_VALUE',
      `Parameter "${key}" must be a scalar value.`
    );
  }

  const expectedType = String(rule && rule.type || '').trim().toLowerCase();
  let text = '';
  if (expectedType === 'integer') {
    const numeric = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isInteger(numeric)) {
      throw new PublicPageError(400, 'INVALID_PARAM_VALUE', `Parameter "${key}" must be an integer.`);
    }
    if (Number.isFinite(rule && rule.min) && numeric < Number(rule.min)) {
      throw new PublicPageError(400, 'INVALID_PARAM_VALUE', `Parameter "${key}" is below the minimum value.`);
    }
    if (Number.isFinite(rule && rule.max) && numeric > Number(rule.max)) {
      throw new PublicPageError(400, 'INVALID_PARAM_VALUE', `Parameter "${key}" is above the maximum value.`);
    }
    text = String(numeric);
  } else if (expectedType === 'number') {
    const numeric = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(numeric)) {
      throw new PublicPageError(400, 'INVALID_PARAM_VALUE', `Parameter "${key}" must be a number.`);
    }
    if (Number.isFinite(rule && rule.min) && numeric < Number(rule.min)) {
      throw new PublicPageError(400, 'INVALID_PARAM_VALUE', `Parameter "${key}" is below the minimum value.`);
    }
    if (Number.isFinite(rule && rule.max) && numeric > Number(rule.max)) {
      throw new PublicPageError(400, 'INVALID_PARAM_VALUE', `Parameter "${key}" is above the maximum value.`);
    }
    text = String(numeric);
  } else if (expectedType === 'boolean') {
    if (typeof value === 'boolean') {
      text = value ? 'true' : 'false';
    } else {
      const normalized = String(value).trim().toLowerCase();
      if (!['true', 'false', '1', '0'].includes(normalized)) {
        throw new PublicPageError(400, 'INVALID_PARAM_VALUE', `Parameter "${key}" must be a boolean.`);
      }
      text = normalized === 'true' || normalized === '1' ? 'true' : 'false';
    }
  } else {
    if (!['', 'string'].includes(expectedType)) {
      throw new PublicPageError(500, 'INVALID_PARAM_SCHEMA', `Unsupported type for parameter "${key}".`);
    }
    text = String(value);
  }

  if (CONTROL_CHAR_PATTERN.test(text)) {
    throw new PublicPageError(
      options.trustedConfig ? 500 : 400,
      'INVALID_PARAM_VALUE',
      `Parameter "${key}" contains control characters.`
    );
  }

  const maxLength = Number.isFinite(rule && rule.maxLength) ? Number(rule.maxLength) : (rule ? 512 : 128);
  const minLength = Number.isFinite(rule && rule.minLength) ? Number(rule.minLength) : 0;
  if (text.length < minLength || text.length > maxLength) {
    throw new PublicPageError(400, 'INVALID_PARAM_VALUE', `Parameter "${key}" length is invalid.`);
  }

  if (rule && Array.isArray(rule.enum)) {
    const allowed = new Set(rule.enum.map((item) => String(item)));
    if (!allowed.has(text)) {
      throw new PublicPageError(400, 'INVALID_PARAM_VALUE', `Parameter "${key}" is not an allowed value.`);
    }
  }

  if (rule && rule.pattern) {
    let regexp;
    try {
      regexp = new RegExp(String(rule.pattern));
    } catch {
      throw new PublicPageError(500, 'INVALID_PARAM_SCHEMA', `Invalid pattern for parameter "${key}".`);
    }
    if (!regexp.test(text)) {
      throw new PublicPageError(400, 'INVALID_PARAM_VALUE', `Parameter "${key}" does not match the required pattern.`);
    }
  } else if (!rule && !SAFE_DEFAULT_PARAM_PATTERN.test(text)) {
    throw new PublicPageError(400, 'INVALID_PARAM_VALUE', `Parameter "${key}" contains unsafe characters.`);
  }

  return text;
}

function normalizeParamRules(raw) {
  if (raw == null || raw === '') return {};
  if (!isRecord(raw)) {
    throw new PublicPageError(500, 'INVALID_PUBLIC_API_CONFIG', 'publicApi macro params must be an object.');
  }
  const rules = {};
  for (const [rawKey, rawRule] of Object.entries(raw)) {
    const key = normalizeParamName(rawKey, 500);
    if (isReservedParamKey(key)) {
      throw new PublicPageError(500, 'INVALID_PUBLIC_API_CONFIG', `publicApi parameter "${key}" is reserved.`);
    }
    if (rawRule != null && !isRecord(rawRule)) {
      throw new PublicPageError(500, 'INVALID_PUBLIC_API_CONFIG', `publicApi parameter "${key}" rule must be an object.`);
    }
    rules[key] = rawRule || {};
  }
  return rules;
}

function normalizeContext(raw) {
  if (raw == null || raw === '') return {};
  if (!isRecord(raw)) {
    throw new PublicPageError(500, 'INVALID_PUBLIC_API_CONFIG', 'publicApi.context must be an object.');
  }
  const context = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = normalizeParamName(rawKey, 500);
    if (isReservedParamKey(key)) {
      throw new PublicPageError(500, 'INVALID_PUBLIC_API_CONFIG', `publicApi.context key "${key}" is reserved.`);
    }
    context[key] = normalizeScalarValue(key, rawValue, undefined, { trustedConfig: true });
  }
  return context;
}

function normalizePublicFields(raw) {
  if (raw == null || raw === '') return [];
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null;
  if (!values) {
    throw new PublicPageError(500, 'INVALID_PUBLIC_API_CONFIG', 'publicApi.fields must be an array or comma-separated string.');
  }
  const seen = new Set();
  const fields = [];
  for (const item of values) {
    if (typeof item !== 'string' && typeof item !== 'number') {
      throw new PublicPageError(500, 'INVALID_PUBLIC_API_CONFIG', 'publicApi.fields entries must be strings.');
    }
    const field = String(item || '').trim();
    if (!field) continue;
    if (CONTROL_CHAR_PATTERN.test(field) || field.length > 128 || field.includes(',')) {
      throw new PublicPageError(500, 'INVALID_PUBLIC_API_CONFIG', `publicApi field "${field}" is invalid.`);
    }
    const lookupKey = field.toLowerCase();
    if (seen.has(lookupKey)) continue;
    seen.add(lookupKey);
    fields.push(field);
  }
  return fields;
}

function parsePublicPageApiConfig(meta) {
  const pageMeta = safeJsonObject(meta && meta.meta);
  const rawPublicApi = isRecord(pageMeta.publicApi) ? pageMeta.publicApi : {};
  const context = normalizeContext(rawPublicApi.context);
  const fields = normalizePublicFields(rawPublicApi.fields);
  const macros = new Map();
  const rawMacros = rawPublicApi.macros;
  if (Array.isArray(rawMacros)) {
    for (const item of rawMacros) {
      const name = normalizeMacroName(item, 500);
      macros.set(name, { name, params: {} });
    }
  } else if (isRecord(rawMacros)) {
    for (const [rawName, rawSpec] of Object.entries(rawMacros)) {
      const name = normalizeMacroName(rawName, 500);
      const spec = isRecord(rawSpec) ? rawSpec : {};
      const rules = normalizeParamRules(spec.params);
      for (const key of Object.keys(rules)) {
        if (Object.prototype.hasOwnProperty.call(context, key)) {
          throw new PublicPageError(500, 'INVALID_PUBLIC_API_CONFIG', `Parameter "${key}" collides with publicApi.context.`);
        }
      }
      macros.set(name, { name, params: rules });
    }
  }
  const rawRateLimit = isRecord(rawPublicApi.rateLimit) ? rawPublicApi.rateLimit : {};
  const rawLimit = Number(rawRateLimit.limit);
  return {
    stream: isTruthy(rawPublicApi.stream),
    fields,
    maxBodyBytes: clampInteger(
      rawPublicApi.maxBodyBytes,
      PUBLIC_IOT_PAGE_DEFAULT_BODY_BYTES,
      1,
      PUBLIC_IOT_PAGE_HARD_BODY_BYTES
    ),
    rateLimit: {
      limit: Number.isFinite(rawLimit) ? clampInteger(rawLimit, PUBLIC_IOT_PAGE_MAX_RATE_LIMIT, 1, PUBLIC_IOT_PAGE_MAX_RATE_LIMIT) : PUBLIC_IOT_PAGE_MAX_RATE_LIMIT,
      windowMs: clampInteger(
        rawRateLimit.windowMs,
        PUBLIC_IOT_PAGE_DEFAULT_WINDOW_MS,
        PUBLIC_IOT_PAGE_MIN_WINDOW_MS,
        PUBLIC_IOT_PAGE_MAX_WINDOW_MS
      )
    },
    context,
    macros
  };
}

function normalizePublicPageParams(rawParams, spec, context) {
  if (rawParams == null) rawParams = {};
  if (!isRecord(rawParams)) throw new PublicPageError(400, 'INVALID_PARAMS', 'params must be an object.');
  const params = {};
  const allowedKeys = new Set(Object.keys(spec.params || {}));
  for (const rawKey of Object.keys(rawParams)) {
    const key = normalizeParamName(rawKey);
    if (isReservedParamKey(key)) {
      throw new PublicPageError(400, 'RESERVED_PARAM_REJECTED', `Parameter "${key}" is reserved.`);
    }
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      throw new PublicPageError(400, 'CONTEXT_PARAM_REJECTED', `Parameter "${key}" is provided by page context.`);
    }
    if (!allowedKeys.has(key)) {
      throw new PublicPageError(400, 'UNKNOWN_PARAM', `Parameter "${key}" is not allowed for this macro.`);
    }
    params[key] = normalizeScalarValue(key, rawParams[rawKey], spec.params[key]);
  }
  for (const [key, rule] of Object.entries(spec.params || {})) {
    if (rule && rule.required && !Object.prototype.hasOwnProperty.call(rawParams, key)) {
      throw new PublicPageError(400, 'MISSING_PARAM', `Parameter "${key}" is required.`);
    }
  }
  return params;
}

function hasInputNumber(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && !value.trim()) return false;
  return Number.isFinite(Number(value));
}

function normalizeJsonValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const next = {};
    for (const [key, nested] of Object.entries(value)) next[key] = normalizeJsonValue(nested);
    return next;
  }
  return value;
}

function randomGeneratorIntervalMs() {
  return 2000 + Math.floor(Math.random() * 2001);
}

function sqliteValueToText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < String(sql || '').length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (inLineComment) {
      current += char;
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (char === '-' && next === '-') {
        current += char + next;
        index += 1;
        inLineComment = true;
        continue;
      }
      if (char === '/' && next === '*') {
        current += char + next;
        index += 1;
        inBlockComment = true;
        continue;
      }
    }
    if (char === '\'' && !inDouble && !inBacktick) {
      if (inSingle && next === '\'') {
        current += char + next;
        index += 1;
        continue;
      }
      inSingle = !inSingle;
      current += char;
      continue;
    }
    if (char === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      current += char;
      continue;
    }
    if (char === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      current += char;
      continue;
    }
    if (char === ';' && !inSingle && !inDouble && !inBacktick) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += char;
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

function isQueryStatement(sql) {
  return /^(select|with|pragma|show|describe|explain)\b/i.test(String(sql || '').trim());
}

function isDmlStatement(sql) {
  return /^(insert|update|delete|replace)\b/i.test(String(sql || '').trim());
}

function compileNamedSql(sql, bindings) {
  const params = [];
  const compiledSql = String(sql || '').replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
    params.push(Object.prototype.hasOwnProperty.call(bindings, name) ? bindings[name] : null);
    return '?';
  });
  return { sql: compiledSql, params };
}

function toResultRows(rows) {
  if (!Array.isArray(rows) || rows.length <= 0) return [{ c1: 'ok' }];
  return rows.map((row) => {
    const next = {};
    for (const key of Object.keys(row || {})) next[key] = normalizeJsonValue(row[key]);
    return next;
  });
}

function parseParamsSchema(raw) {
  const normalized = String(raw || '').trim();
  if (!normalized) return null;
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new PublicPageError(500, 'INVALID_PARAMS_SCHEMA', 'Command params_schema is not valid JSON.');
  }
  if (!isRecord(parsed)) {
    throw new PublicPageError(500, 'INVALID_PARAMS_SCHEMA', 'Command params_schema must be an object.');
  }
  return parsed;
}

function normalizeCommandParams(rawParams, schema) {
  const body = isRecord(rawParams) ? rawParams : {};
  const rules = schema || {};
  if (schema) {
    const allowedKeys = new Set(Object.keys(rules));
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) {
        throw new PublicPageError(400, 'UNKNOWN_PARAM', `Parameter "${key}" is not allowed for this command.`);
      }
    }
  }
  const params = {};
  for (const [key, value] of Object.entries(body)) {
    const normalizedKey = normalizeParamName(key);
    if (isReservedParamKey(normalizedKey)) {
      throw new PublicPageError(400, 'SENSITIVE_PARAM_REJECTED', `Parameter "${normalizedKey}" is not accepted.`);
    }
    params[normalizedKey] = normalizeScalarValue(normalizedKey, value, rules[normalizedKey]);
  }
  for (const [key, rule] of Object.entries(rules)) {
    if (rule && rule.required && !Object.prototype.hasOwnProperty.call(body, key)) {
      throw new PublicPageError(400, 'MISSING_PARAM', `Parameter "${key}" is required.`);
    }
  }
  return params;
}

function resolveCommandTemplate(template, identity, params) {
  const unresolved = new Set();
  const command = String(template || '').replace(PLACEHOLDER_PATTERN, (_match, rawName) => {
    const name = String(rawName || '').trim();
    const normalized = name.toLowerCase();
    if (normalized === 'email') return identity.email;
    if (normalized === 'username') return identity.username;
    if (normalized === 'phone') return identity.phone;
    if (Object.prototype.hasOwnProperty.call(params, name)) return params[name];
    unresolved.add(name);
    return '';
  });
  if (unresolved.size) {
    throw new PublicPageError(400, 'MISSING_PARAM', `Missing parameter(s): ${Array.from(unresolved).join(', ')}.`);
  }
  if (!command.trim()) {
    throw new PublicPageError(500, 'EMPTY_COMMAND_TEMPLATE', 'Command template resolved to an empty command.');
  }
  if (CONTROL_CHAR_PATTERN.test(command)) {
    throw new PublicPageError(400, 'INVALID_COMMAND', 'Resolved command contains control characters.');
  }
  return command;
}

function htmlScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function publicSessionIdForIoid(ioid) {
  return `${normalizePublicIoid(ioid)}@${PUBLIC_SESSION_SUFFIX}`;
}

function defaultPublicValueForField(field) {
  const normalized = String(field || '').toLowerCase();
  if (normalized.endsWith('_name')) return 'Phòng khám A';
  if (normalized.endsWith('_text1')) return 'Quầy 1';
  if (normalized.endsWith('_order1')) return '001,002,003';
  if (normalized.endsWith('_text2')) return 'Quầy 2';
  if (normalized.endsWith('_order2')) return '004,005';
  if (normalized.endsWith('_media') || normalized.endsWith('_alert')) return '';
  if (normalized.endsWith('_note')) return 'Mời khách theo số thứ tự.';
  if (/(percent|temperature|voltage|current|energy|power|disk|ram|cpu|mbps|gb)$/i.test(field)) return '50';
  return 'Demo';
}

function isNumericPublicField(field) {
  return /(percent|temperature|voltage|current|energy|power|disk|ram|cpu|mbps|gb)$/i.test(String(field || ''));
}

class SimulatorStore {
  constructor(options) {
    this.rootDir = options.rootDir;
    this.stateDir = options.stateDir;
    this.templateRoot = options.templateRoot;
    this.defaultSessionId = options.defaultSessionId || process.env.SIM_SESSION_ID || 'IO123abcd@simulate';
    this.defaultSyncId = options.defaultSyncId || process.env.SIM_SYNC_ID || 'SIM_SYNC';
    this.iodataDir = path.join(this.stateDir, 'iodata');
    ensureDir(this.stateDir);
    ensureDir(this.iodataDir);
    this.db = new Database(path.join(this.stateDir, 'simulator.sqlite'));
    this.subscribers = new Set();
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telemetry_latest (
        session_id TEXT NOT NULL,
        field TEXT NOT NULL,
        value TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, field)
      );
      CREATE TABLE IF NOT EXISTS timeseries_rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        field TEXT NOT NULL,
        ts INTEGER NOT NULL,
        value REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timeseries_session_field_ts
        ON timeseries_rows(session_id, field, ts);
      CREATE TABLE IF NOT EXISTS command_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ioid TEXT NOT NULL,
        command TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS generators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        field TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'fixed',
        value_text TEXT NOT NULL DEFAULT '',
        min_value REAL,
        max_value REAL,
        digits INTEGER NOT NULL DEFAULT 1,
        interval_ms INTEGER NOT NULL DEFAULT 1000,
        write_timeseries INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  emit(event) {
    for (const callback of this.subscribers) {
      try { callback(event); } catch {}
    }
  }

  filterPayload(payload, fields) {
    if (!fields || fields.length <= 0) return payload;
    const lookup = new Set(fields.map((field) => field.toLowerCase()));
    const next = {};
    for (const [field, value] of Object.entries(payload || {})) {
      if (lookup.has(String(field).toLowerCase())) next[field] = value;
    }
    return next;
  }

  getLatestState(sessionId, fields) {
    const rows = this.db.prepare(`
      SELECT field, value, updated_at
      FROM telemetry_latest
      WHERE session_id = ?
    `).all(sessionId);
    if (!rows.length) return null;
    const payload = {};
    let serverTime = 0;
    for (const row of rows) {
      payload[row.field] = row.value;
      serverTime = Math.max(serverTime, Number(row.updated_at || 0));
    }
    return {
      sessionId,
      serverTime: serverTime || Date.now(),
      payload: this.filterPayload(payload, fields)
    };
  }

  setTelemetry(sessionId, payload, options = {}) {
    const now = Number(options.serverTime || Date.now());
    const entries = Object.entries(payload || {}).filter(([field]) => String(field || '').trim());
    if (!entries.length) return { updated: 0, serverTime: now, payload: {} };
    const stmt = this.db.prepare(`
      INSERT INTO telemetry_latest (session_id, field, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id, field) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    const tsStmt = this.db.prepare(`
      INSERT INTO timeseries_rows (session_id, field, ts, value)
      VALUES (?, ?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const [field, value] of entries) {
        stmt.run(sessionId, field, sqliteValueToText(value), now);
        if (options.writeTimeseries) {
          const numeric = Number(value);
          if (Number.isFinite(numeric)) tsStmt.run(sessionId, field, now, numeric);
        }
      }
    });
    tx();
    const normalizedPayload = {};
    for (const [field, value] of entries) normalizedPayload[field] = sqliteValueToText(value);
    this.emit({ type: 'telemetry', sessionId, serverTime: now, payload: normalizedPayload });
    return { updated: entries.length, serverTime: now, payload: normalizedPayload };
  }

  ingestTelemetry(sessionId, _syncId, body) {
    const payload = body && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : body;
    return this.setTelemetry(sessionId, payload || {}, { writeTimeseries: false });
  }

  ingestTimeseries(sessionId, _syncId, body) {
    const now = Number(body && body.ts) || Date.now();
    const payload = body && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : body;
    const rows = [];
    for (const [field, value] of Object.entries(payload || {})) {
      const numeric = Number(value);
      if (!String(field || '').trim() || !Number.isFinite(numeric)) continue;
      rows.push({ ts: now, field, value: numeric });
    }
    const stmt = this.db.prepare(`
      INSERT INTO timeseries_rows (session_id, field, ts, value)
      VALUES (?, ?, ?, ?)
    `);
    const tx = this.db.transaction(() => {
      for (const row of rows) stmt.run(sessionId, row.field, row.ts, row.value);
    });
    tx();
    if (rows.length) this.emit({ type: 'timeseries', sessionId, rows });
    this.setTelemetry(sessionId, payload || {}, { serverTime: now, writeTimeseries: false });
    return { rows };
  }

  queryTimeseries(sessionId, from, to, fields) {
    const normalizedFields = Array.isArray(fields) ? fields.filter(Boolean) : [];
    const params = [sessionId, Number(from) || 0, Number(to) || Date.now()];
    let fieldFilter = '';
    if (normalizedFields.length) {
      fieldFilter = `AND lower(field) IN (${normalizedFields.map(() => '?').join(',')})`;
      params.push(...normalizedFields.map((field) => field.toLowerCase()));
    }
    const rows = this.db.prepare(`
      SELECT ts, field, value, value AS last
      FROM timeseries_rows
      WHERE session_id = ?
        AND ts >= ?
        AND ts <= ?
        ${fieldFilter}
      ORDER BY ts ASC
      LIMIT 5000
    `).all(params);
    return { rows, bucket: 0 };
  }

  getIoDataFilePath(sessionId) {
    return path.join(this.iodataDir, `${normalizeIoDataKey(sessionId)}.sqlite`);
  }

  hasIoDataFile(sessionId) {
    return fs.existsSync(this.getIoDataFilePath(sessionId));
  }

  replaceIoDataFile(sessionId, sourcePath, options = {}) {
    if (!fs.existsSync(sourcePath)) throw new Error('Sample database file not found.');
    const target = this.getIoDataFilePath(sessionId);
    ensureDir(path.dirname(target));
    fs.copyFileSync(sourcePath, target);
    const ioid = normalizeIoDataKey(sessionId);
    const syncId = String(options.syncId || this.defaultSyncId || '').trim();
    this.replaceIoDataPlaceholders(target, {
      ioid,
      sessionId: String(sessionId || this.defaultSessionId),
      syncId
    });
    const publicGenerators = this.seedPublicPageGenerators(ioid);
    return { ioid, size: fs.statSync(target).size, publicGenerators };
  }

  getTableColumns(db, tableName) {
    return db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
      .map((column) => ({
        name: String(column.name || ''),
        type: String(column.type || '').toUpperCase()
      }))
      .filter((column) => column.name);
  }

  replaceIoDataPlaceholders(filePath, context) {
    const db = new Database(filePath);
    const replacements = [
      ['<<ioid>>', context.ioid],
      ['<<ioId>>', context.ioid],
      ['<<IOID>>', context.ioid],
      ['<<sessionid>>', context.sessionId],
      ['<<sessionId>>', context.sessionId],
      ['<<SESSIONID>>', context.sessionId],
      ['<<syncid>>', context.syncId],
      ['<<syncId>>', context.syncId],
      ['<<sync_id>>', context.syncId],
      ['<<SYNCID>>', context.syncId]
    ];
    try {
      const tables = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
      `).all();
      const tx = db.transaction(() => {
        for (const table of tables) {
          const tableName = String(table.name || '');
          const columns = this.getTableColumns(db, tableName)
            .filter((column) => !column.type || column.type.includes('TEXT') || column.type.includes('CHAR') || column.type.includes('CLOB'));
          for (const column of columns) {
            for (const [placeholder, value] of replacements) {
              if (!placeholder || value === undefined || value === null) continue;
              db.prepare(`
                UPDATE ${quoteIdentifier(tableName)}
                SET ${quoteIdentifier(column.name)} = replace(${quoteIdentifier(column.name)}, ?, ?)
                WHERE instr(${quoteIdentifier(column.name)}, ?) > 0
              `).run(placeholder, String(value), placeholder);
            }
          }
        }
      });
      tx();
    } finally {
      db.close();
    }
  }

  seedPublicPageGenerators(ioid) {
    const publicSessionId = publicSessionIdForIoid(ioid);
    const filePath = this.getIoDataFilePath(ioid);
    if (!fs.existsSync(filePath)) return 0;
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    const fields = [];
    try {
      const table = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'system_pages'
        LIMIT 1
      `).get();
      if (!table) return 0;
      const rows = db.prepare(`SELECT meta, enabled FROM system_pages`).all();
      const seen = new Set();
      for (const row of rows) {
        if (Number(row.enabled || 0) === 0) continue;
        let publicApi;
        try {
          publicApi = parsePublicPageApiConfig({ meta: String(row.meta || '') });
        } catch (error) {
          if (!(error instanceof PublicPageError)) throw error;
          continue;
        }
        for (const field of publicApi.fields) {
          const key = field.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          fields.push(field);
        }
      }
    } finally {
      db.close();
    }

    const generators = [];
    const initialPayload = {};
    for (const field of fields) {
      const numeric = isNumericPublicField(field);
      const value = defaultPublicValueForField(field);
      initialPayload[field] = value;
      if (this.generatorExists(publicSessionId, field)) continue;
      generators.push({
        sessionId: publicSessionId,
        field,
        mode: numeric ? 'random-number' : 'fixed',
        valueText: numeric ? '' : value,
        minValue: numeric ? 0 : null,
        maxValue: numeric ? 100 : null,
        digits: 1,
        intervalMs: randomGeneratorIntervalMs(),
        writeTimeseries: numeric ? 1 : 0,
        enabled: 1
      });
    }
    for (const generator of generators) this.insertGeneratorRow(generator);
    if (Object.keys(initialPayload).length) {
      this.setTelemetry(publicSessionId, initialPayload, { writeTimeseries: false });
    }
    return generators.length;
  }

  clearIoDataFiles() {
    ensureDir(this.iodataDir);
    let deleted = 0;
    for (const fileName of fs.readdirSync(this.iodataDir)) {
      if (!/\.sqlite$/i.test(fileName)) continue;
      fs.unlinkSync(path.join(this.iodataDir, fileName));
      deleted += 1;
    }
    this.emit({ type: 'iodata_cleared', ts: Date.now(), deleted });
    return deleted;
  }

  getMacro(db, macroName) {
    const row = db.prepare(`
      SELECT name, comment, source, enabled
      FROM system_macros
      WHERE name = ?
      LIMIT 1
    `).get(String(macroName || '').trim());
    if (!row) throw new Error(`Macro "${macroName}" not found.`);
    if (Number(row.enabled || 0) === 0) throw new Error(`Macro "${macroName}" is disabled.`);
    return row;
  }

  buildBindings(payload, syncId, sessionId) {
    const bindings = {
      sync_id: syncId,
      session_id: sessionId,
      ioid: normalizeIoDataKey(sessionId)
    };
    for (const key of Object.keys(payload || {})) {
      const normalized = String(key || '').trim().toLowerCase();
      if (normalized === 'macro' || RESERVED_MACRO_BINDINGS.has(normalized)) continue;
      bindings[key] = sqliteValueToText(payload[key]);
    }
    return bindings;
  }

  runSqliteMacro(db, source, bindings) {
    const statements = splitSqlStatements(source);
    if (!statements.length) throw new Error('Macro source is empty.');
    let resultRows = [];
    let affectedRows = 0;
    const tx = db.transaction(() => {
      for (const statement of statements) {
        const compiled = compileNamedSql(statement, bindings);
        const prepared = db.prepare(compiled.sql);
        if (isQueryStatement(statement)) {
          resultRows = prepared.all(compiled.params);
        } else {
          const result = prepared.run(compiled.params);
          if (isDmlStatement(statement)) affectedRows += Number(result && result.changes || 0);
        }
      }
    });
    tx();
    return {
      rows: toResultRows(resultRows),
      changed: statements.some((statement) => !isQueryStatement(statement)),
      hasDml: statements.some(isDmlStatement),
      affectedRows,
      hasExplicitRows: Array.isArray(resultRows) && resultRows.length > 0
    };
  }

  executeMacro(sessionId, syncId, payload) {
    const macroName = String(payload && payload.macro || '').trim();
    if (!macroName) throw new Error('Macro name is required in the "macro" field.');
    const filePath = this.getIoDataFilePath(sessionId);
    if (!fs.existsSync(filePath)) throw new Error(`IoData database for ${normalizeIoDataKey(sessionId)} was not found.`);
    const db = new Database(filePath);
    try {
      const macro = this.getMacro(db, macroName);
      const bindings = this.buildBindings(payload, syncId, sessionId);
      const result = this.runSqliteMacro(db, macro.source, bindings);
      if (result.changed) {
        this.emit({ type: 'iodata_changed', sessionId, syncId, macro: macro.name, source: 'macro', ts: Date.now() });
      }
      return result.rows;
    } finally {
      db.close();
    }
  }

  getSimulatorIdentity() {
    return {
      email: String(process.env.SIM_USER_EMAIL || 'developer@rosa.local').trim(),
      username: String(process.env.SIM_USER_NAME || 'ROSA Developer').trim(),
      phone: String(process.env.SIM_USER_PHONE || '0912345123').trim()
    };
  }

  assertPublicPageEnabled(row) {
    if (!Number(row && row.enabled || 0)) {
      throw new PublicPageError(403, 'PAGE_DISABLED', `Page "${row && row.page_id || ''}" is disabled.`);
    }
  }

  assertPublicPageIdentity(row) {
    const identity = this.getSimulatorIdentity();
    if (Number(row.require_email || 0) && !identity.email) {
      throw new PublicPageError(409, 'EMAIL_REQUIRED', 'Simulator identity email is required for this page.');
    }
    if (Number(row.require_phone || 0) && !identity.phone) {
      throw new PublicPageError(409, 'PHONE_REQUIRED', 'Simulator identity phone is required for this page.');
    }
    return identity;
  }

  readSystemPage(ioid, pageId, options = {}) {
    const normalizedIoid = normalizePublicIoid(ioid);
    const normalizedPageId = normalizePageId(pageId);
    const filePath = this.getIoDataFilePath(normalizedIoid);
    if (!fs.existsSync(filePath)) {
      throw new PublicPageError(404, 'IODATA_NOT_FOUND', `IoData database for ${normalizedIoid} was not found.`);
    }
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    try {
      const table = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'system_pages'
        LIMIT 1
      `).get();
      if (!table) throw new PublicPageError(404, 'SYSTEM_PAGES_NOT_FOUND', 'system_pages table was not found.');

      const columns = new Set(this.getTableColumns(db, 'system_pages').map((column) => column.name));
      const htmlSelect = options.includeHtml && columns.has('html') ? 'html' : "'' AS html";
      const titleSelect = columns.has('title') ? 'title' : "'' AS title";
      const metaSelect = columns.has('meta') ? 'meta' : "'' AS meta";
      const requireEmailSelect = columns.has('require_email') ? 'require_email' : '0 AS require_email';
      const requirePhoneSelect = columns.has('require_phone') ? 'require_phone' : '0 AS require_phone';
      const syncSelect = columns.has('sync_id') ? 'sync_id' : "'' AS sync_id";
      const enabledSelect = columns.has('enabled') ? 'enabled' : '1 AS enabled';
      const row = db.prepare(`
        SELECT page_id, ${htmlSelect}, ${requireEmailSelect}, ${requirePhoneSelect},
               ${syncSelect}, ${enabledSelect}, ${titleSelect}, ${metaSelect}
        FROM system_pages
        WHERE page_id = ?
        LIMIT 1
      `).get(normalizedPageId);
      if (!row || !row.page_id) {
        throw new PublicPageError(404, 'PAGE_NOT_FOUND', `Page "${normalizedPageId}" was not found.`);
      }
      return {
        page_id: String(row.page_id || ''),
        html: String(row.html || ''),
        require_email: Number(row.require_email || 0),
        require_phone: Number(row.require_phone || 0),
        sync_id: String(row.sync_id || this.defaultSyncId || '').trim(),
        enabled: Number(row.enabled || 0),
        title: String(row.title || ''),
        meta: String(row.meta || '')
      };
    } finally {
      db.close();
    }
  }

  getPublicPageContext(ioid, pageId, options = {}) {
    const normalizedIoid = normalizePublicIoid(ioid);
    const normalizedPageId = normalizePageId(pageId);
    const page = this.readSystemPage(normalizedIoid, normalizedPageId, { includeHtml: !!options.includeHtml });
    this.assertPublicPageEnabled(page);
    const identity = this.assertPublicPageIdentity(page);
    const publicApi = parsePublicPageApiConfig(page);
    return {
      ioid: normalizedIoid,
      pageId: normalizedPageId,
      page,
      identity,
      publicApi,
      publicSessionId: publicSessionIdForIoid(normalizedIoid)
    };
  }

  renderPublicPage(ioid, pageId) {
    const context = this.getPublicPageContext(ioid, pageId, { includeHtml: true });
    if (!context.page.html.trim()) {
      throw new PublicPageError(404, 'PAGE_HTML_EMPTY', `HTML for page "${context.pageId}" is empty.`);
    }
    const pageMeta = safeJsonObject(context.page.meta);
    const rendered = String(context.page.html || '')
      .replaceAll('__ROSA_IOT_PAGE_META__', htmlScriptJson(pageMeta))
      .replaceAll('__ROSA_IOT_PAGE_CONTEXT__', htmlScriptJson({
        ioid: context.ioid,
        pageId: context.pageId,
        title: context.page.title
      }));
    return { html: rendered, context };
  }

  getPublicPageReadContext(ioid, pageId) {
    const context = this.getPublicPageContext(ioid, pageId);
    if (!context.publicApi.fields.length) {
      throw new PublicPageError(403, 'PUBLIC_FIELDS_NOT_CONFIGURED', 'Public telemetry fields are not configured for this page.');
    }
    return context;
  }

  parsePublicMacroBody(body, maxBodyBytes) {
    const approxBody = JSON.stringify(body || {});
    if (Buffer.byteLength(approxBody, 'utf8') > maxBodyBytes) {
      throw new PublicPageError(413, 'BODY_TOO_LARGE', `Request body exceeds ${maxBodyBytes} bytes.`);
    }
    if (!isRecord(body)) throw new PublicPageError(400, 'INVALID_BODY', 'JSON body must be an object.');
    const unknown = Object.keys(body).filter((key) => !['macro', 'params'].includes(key));
    if (unknown.length) {
      throw new PublicPageError(400, 'UNKNOWN_FIELD', `Unsupported field(s): ${unknown.join(', ')}.`);
    }
    return {
      macro: normalizeMacroName(body.macro),
      params: body.params
    };
  }

  executePublicPageMacro(ioid, pageId, body) {
    const context = this.getPublicPageContext(ioid, pageId);
    const parsedBody = this.parsePublicMacroBody(body, context.publicApi.maxBodyBytes);
    const macroSpec = context.publicApi.macros.get(parsedBody.macro);
    if (!macroSpec) {
      throw new PublicPageError(403, 'MACRO_NOT_PUBLIC', `Macro "${parsedBody.macro}" is not allowed for this public page.`);
    }
    const params = normalizePublicPageParams(parsedBody.params, macroSpec, context.publicApi.context);
    const payload = {
      macro: macroSpec.name,
      ...context.publicApi.context,
      ...params,
      email: context.identity.email,
      username: context.identity.username,
      phone: context.identity.phone
    };
    const rows = this.executeMacro(context.ioid, context.page.sync_id, payload);
    return {
      ok: true,
      macro: macroSpec.name,
      rows,
      chargedCost: 0
    };
  }

  readSystemCommand(ioid, cmdId) {
    const normalizedIoid = normalizePublicIoid(ioid);
    const normalizedCmdId = normalizePageId(cmdId);
    const filePath = this.getIoDataFilePath(normalizedIoid);
    if (!fs.existsSync(filePath)) {
      throw new PublicPageError(404, 'IODATA_NOT_FOUND', `IoData database for ${normalizedIoid} was not found.`);
    }
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    try {
      const table = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'system_cmds'
        LIMIT 1
      `).get();
      if (!table) throw new PublicPageError(404, 'SYSTEM_CMDS_NOT_FOUND', 'system_cmds table was not found.');
      const row = db.prepare(`
        SELECT cmd_id, command_template, require_email, require_phone, sync_id, params_schema, enabled
        FROM system_cmds
        WHERE cmd_id = ?
        LIMIT 1
      `).get(normalizedCmdId);
      if (!row || !row.cmd_id) {
        throw new PublicPageError(404, 'CMD_NOT_FOUND', `Command "${normalizedCmdId}" was not found.`);
      }
      if (!Number(row.enabled || 0)) {
        throw new PublicPageError(403, 'CMD_DISABLED', `Command "${normalizedCmdId}" is disabled.`);
      }
      return {
        cmd_id: String(row.cmd_id || ''),
        command_template: String(row.command_template || ''),
        require_email: Number(row.require_email || 0),
        require_phone: Number(row.require_phone || 0),
        sync_id: String(row.sync_id || this.defaultSyncId || '').trim(),
        params_schema: String(row.params_schema || '').trim(),
        enabled: Number(row.enabled || 0)
      };
    } finally {
      db.close();
    }
  }

  executeSystemCommand(ioid, cmdId, body) {
    const normalizedIoid = normalizePublicIoid(ioid);
    if (!isRecord(body)) throw new PublicPageError(400, 'INVALID_BODY', 'JSON body must be an object.');
    for (const key of Object.keys(body)) {
      if (isReservedParamKey(key)) {
        throw new PublicPageError(400, 'SENSITIVE_PARAM_REJECTED', `Parameter "${key}" is not accepted.`);
      }
    }
    const row = this.readSystemCommand(normalizedIoid, cmdId);
    const identity = this.getSimulatorIdentity();
    if (Number(row.require_email || 0) && !identity.email) {
      throw new PublicPageError(409, 'EMAIL_REQUIRED', 'Simulator identity email is required for this command.');
    }
    if (Number(row.require_phone || 0) && !identity.phone) {
      throw new PublicPageError(409, 'PHONE_REQUIRED', 'Simulator identity phone is required for this command.');
    }
    const schema = parseParamsSchema(row.params_schema);
    const params = normalizeCommandParams(body, schema);
    const command = resolveCommandTemplate(row.command_template, identity, params);
    this.handleLocalCommand(normalizedIoid, command);
    return {
      ok: true,
      command,
      chargedCost: 0,
      gateway: {
        status: 200,
        text: 'OK'
      },
      simulated: true
    };
  }

  listCommandLog(limit = 100) {
    return this.db.prepare(`
      SELECT id, ioid, command, created_at
      FROM command_log
      ORDER BY id DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(500, Number(limit) || 100)));
  }

  clearCommandLog() {
    const result = this.db.prepare(`DELETE FROM command_log`).run();
    this.emit({ type: 'command_log_cleared', ts: Date.now(), deleted: result.changes });
    return result.changes;
  }

  recordCommand(ioid, command) {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO command_log (ioid, command, created_at)
      VALUES (?, ?, ?)
    `).run(ioid, String(command || ''), now);
    this.emit({ type: 'command', ioid, command: String(command || ''), ts: now });
  }

  applyCommandTelemetry(ioid, command) {
    const sessionId = `${ioid}@simulate`;
    const text = String(command || '').trim();
    let match = text.match(/^D1(O[\w.-]+)$/i);
    if (match) {
      this.setTelemetry(sessionId, { [match[1]]: 'ON' });
      return;
    }
    match = text.match(/^D2(O[\w.-]+)$/i);
    if (match) {
      this.setTelemetry(sessionId, { [match[1]]: 'OFF' });
      return;
    }
    match = text.match(/^N3\s*,\s*(\d+)\s*,\s*"?\s*(ON|OFF)\s*"?/i);
    if (match) {
      const index = String(Number(match[1])).padStart(2, '0');
      this.setTelemetry(sessionId, { [`O1${index}`]: match[2].toUpperCase() });
      return;
    }
    match = text.match(/^\s*([#A-Za-z0-9_.-]+)\s*=\s*([\s\S]+)$/);
    if (match) {
      const field = match[1].trim();
      const value = match[2].trim();
      this.setTelemetry(sessionId, { [field]: field.startsWith('#') ? `${field}=${value}` : value });
    }
  }

  handleLocalCommand(ioid, command) {
    this.recordCommand(ioid, command);
    this.applyCommandTelemetry(ioid, command);
    return 'OK';
  }

  listGenerators() {
    return this.db.prepare(`
      SELECT id, session_id AS sessionId, field, mode, value_text AS valueText,
             min_value AS minValue, max_value AS maxValue, digits, interval_ms AS intervalMs,
             write_timeseries AS writeTimeseries, enabled, updated_at AS updatedAt
      FROM generators
      ORDER BY id DESC
    `).all();
  }

  normalizeGeneratorMode(mode) {
    const normalized = String(mode || 'fixed').trim().toLowerCase();
    if (normalized === 'random-integer') return 'random-number';
    if (normalized === 'text') return 'fixed';
    if (normalized === 'random-number' || normalized === 'toggle' || normalized === 'fixed') return normalized;
    return 'fixed';
  }

  normalizeGeneratorInput(input) {
    const intervalInput = Number(input.intervalMs);
    return {
      sessionId: String(input.sessionId || 'IO123abcd@simulate').trim(),
      field: String(input.field || '').trim(),
      mode: this.normalizeGeneratorMode(input.mode),
      valueText: String(input.valueText == null ? '' : input.valueText),
      minValue: hasInputNumber(input.minValue) ? Number(input.minValue) : null,
      maxValue: hasInputNumber(input.maxValue) ? Number(input.maxValue) : null,
      digits: Math.max(0, Math.min(6, Math.round(Number(input.digits) || 1))),
      intervalMs: Math.max(250, Math.round(Number.isFinite(intervalInput) && intervalInput > 0 ? intervalInput : randomGeneratorIntervalMs())),
      writeTimeseries: input.writeTimeseries === false || Number(input.writeTimeseries) === 0 ? 0 : 1,
      enabled: input.enabled === true || Number(input.enabled) === 1 ? 1 : 0
    };
  }

  insertGeneratorRow(row, now = Date.now()) {
    const result = this.db.prepare(`
      INSERT INTO generators (session_id, field, mode, value_text, min_value, max_value, digits, interval_ms, write_timeseries, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(row.sessionId, row.field, row.mode, row.valueText, row.minValue, row.maxValue, row.digits, row.intervalMs, row.writeTimeseries, row.enabled, now);
    return this.getGenerator(result.lastInsertRowid);
  }

  generatorExists(sessionId, field) {
    return Boolean(this.db.prepare(`
      SELECT 1
      FROM generators
      WHERE session_id = ?
        AND lower(field) = lower(?)
      LIMIT 1
    `).get(String(sessionId || '').trim(), String(field || '').trim()));
  }

  upsertGenerator(input) {
    const now = Date.now();
    const id = Number(input.id || 0);
    const row = this.normalizeGeneratorInput(input);
    if (!row.field) throw new Error('Field is required.');
    if (id > 0) {
      this.db.prepare(`
        UPDATE generators
        SET session_id = ?, field = ?, mode = ?, value_text = ?, min_value = ?, max_value = ?,
            digits = ?, interval_ms = ?, write_timeseries = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `).run(row.sessionId, row.field, row.mode, row.valueText, row.minValue, row.maxValue, row.digits, row.intervalMs, row.writeTimeseries, row.enabled, now, id);
      return this.getGenerator(id);
    }
    return this.insertGeneratorRow(row, now);
  }

  bulkInsertMissingGenerators(inputs) {
    const inserted = [];
    const skipped = [];
    const seen = new Set();
    for (const input of Array.isArray(inputs) ? inputs : []) {
      const row = this.normalizeGeneratorInput(input || {});
      if (!row.field) continue;
      const key = row.sessionId + '\n' + row.field.toLowerCase();
      if (seen.has(key) || this.generatorExists(row.sessionId, row.field)) {
        skipped.push({ sessionId: row.sessionId, field: row.field });
        seen.add(key);
        continue;
      }
      inserted.push(this.insertGeneratorRow(row));
      seen.add(key);
    }
    return { inserted, skipped };
  }

  deleteGenerator(id) {
    this.db.prepare(`DELETE FROM generators WHERE id = ?`).run(Number(id));
  }

  clearGeneratorsAndTelemetry() {
    const generators = this.db.prepare(`DELETE FROM generators`).run().changes;
    const telemetry = this.db.prepare(`DELETE FROM telemetry_latest`).run().changes;
    const timeseries = this.db.prepare(`DELETE FROM timeseries_rows`).run().changes;
    this.emit({ type: 'telemetry_cleared', ts: Date.now(), generators, telemetry, timeseries });
    return { generators, telemetry, timeseries };
  }

  setGeneratorEnabled(id, enabled) {
    this.db.prepare(`UPDATE generators SET enabled = ?, updated_at = ? WHERE id = ?`).run(enabled ? 1 : 0, Date.now(), Number(id));
  }

  getGenerator(id) {
    return this.db.prepare(`
      SELECT id, session_id AS sessionId, field, mode, value_text AS valueText,
             min_value AS minValue, max_value AS maxValue, digits, interval_ms AS intervalMs,
             write_timeseries AS writeTimeseries, enabled
      FROM generators
      WHERE id = ?
    `).get(Number(id));
  }

  generateValue(generator) {
    const mode = String(generator.mode || 'fixed');
    if (mode === 'random-number' || mode === 'random-integer') {
      const min = Number.isFinite(Number(generator.minValue)) ? Number(generator.minValue) : 0;
      const max = Number.isFinite(Number(generator.maxValue)) ? Number(generator.maxValue) : 100;
      const low = Math.min(min, max);
      const high = Math.max(min, max);
      const value = low + Math.random() * (high - low);
      return value.toFixed(Math.max(0, Math.min(6, Number(generator.digits) || 1)));
    }
    if (mode === 'toggle') {
      const latest = this.getLatestState(generator.sessionId, [generator.field]);
      const current = latest && latest.payload ? String(latest.payload[generator.field] || '').toUpperCase() : '';
      return current === 'ON' ? 'OFF' : 'ON';
    }
    return String(generator.valueText == null ? '' : generator.valueText);
  }

  tickGenerator(id) {
    const generator = this.getGenerator(id);
    if (!generator) return null;
    const value = this.generateValue(generator);
    this.setTelemetry(generator.sessionId, { [generator.field]: value }, { writeTimeseries: Number(generator.writeTimeseries || 0) === 1 });
    return { id: generator.id, sessionId: generator.sessionId, field: generator.field, value };
  }
}

module.exports = {
  SimulatorStore,
  PublicPageError,
  normalizeIoDataKey,
  parseFieldsParam
};
