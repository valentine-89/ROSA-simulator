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

class SimulatorStore {
  constructor(options) {
    this.rootDir = options.rootDir;
    this.stateDir = options.stateDir;
    this.templateRoot = options.templateRoot;
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

  replaceIoDataFile(sessionId, sourcePath) {
    if (!fs.existsSync(sourcePath)) throw new Error('Sample database file not found.');
    const target = this.getIoDataFilePath(sessionId);
    ensureDir(path.dirname(target));
    fs.copyFileSync(sourcePath, target);
    return { ioid: normalizeIoDataKey(sessionId), size: fs.statSync(target).size };
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
  normalizeIoDataKey,
  parseFieldsParam
};
