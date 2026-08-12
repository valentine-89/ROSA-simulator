const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const source = path.join(__dirname, 'sample.sqlite');
const temp = path.join(os.tmpdir(), `rosa-biomass-${process.pid}-${Date.now()}.sqlite`);
fs.copyFileSync(source, temp);

const db = new Database(temp);
const runtimeSource = fs.readFileSync(path.join(__dirname, 'dashboard-runtime.js'), 'utf8');

// Match ROSA's named-binding compilation so comments and literals are tested
// against the same parameter behavior as the production macro runner.
function compileNamedSql(sql, bindings) {
  const params = [];
  const compiledSql = sql.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
    params.push(Object.prototype.hasOwnProperty.call(bindings, name) ? bindings[name] : null);
    return '?';
  });
  return { sql: compiledSql, params };
}

function runMacro(name, bindings) {
  const row = db.prepare('SELECT source FROM system_macros WHERE name = ? AND enabled = 1').get(name);
  if (!row) throw new Error(`Missing macro ${name}`);
  let rows = [];
  const transaction = db.transaction(() => {
    for (const statement of String(row.source).split(';').map((item) => item.trim()).filter(Boolean)) {
      const compiled = compileNamedSql(statement, bindings);
      const prepared = db.prepare(compiled.sql);
      if (/^(SELECT|WITH|PRAGMA)\b/i.test(statement)) rows = prepared.all(compiled.params);
      else prepared.run(compiled.params);
    }
  });
  transaction();
  return rows;
}

try {
  for (const key of ['1005','1006','1007','1008','1009','1010','1011','1012','1013','1014','1015','1016']) {
    if (!runtimeSource.includes(`key: "${key}"`)) throw new Error(`Dashboard setting #${key} is missing`);
  }
  if (!runtimeSource.includes('"CHỜ TẮT"') || !runtimeSource.includes('bb-setting-group-title')) {
    throw new Error('Shutdown mode or compact setting groups are missing from dashboard runtime');
  }
  const pages = db.prepare('SELECT page_id, require_email, meta FROM system_pages ORDER BY page_id').all();
  if (pages.length !== 3 || pages.find((row) => row.page_id === 'biomass-fleet-admin')?.require_email !== 1) {
    throw new Error('Public/admin page policy is invalid');
  }
  const statusMeta = JSON.parse(pages.find((row) => row.page_id === 'biomass-status').meta);
  if (!statusMeta.publicApi.fields.includes('c5') || statusMeta.publicApi.fields.length !== 20 || statusMeta.publicApi.stream !== true) {
    throw new Error('Nullable temperature or realtime telemetry is missing');
  }
  for (const page of pages) {
    const publicApi = JSON.parse(page.meta).publicApi || {};
    for (const macro of Object.values(publicApi.macros || {})) {
      if (macro.params && Object.prototype.hasOwnProperty.call(macro.params, 'ioid')) {
        throw new Error('Public page macro must not redeclare reserved ioid');
      }
    }
  }
  if (db.prepare('SELECT COUNT(*) AS count FROM system_cmds').get().count !== 12) {
    throw new Error('Expected twelve compact-v2 setting commands');
  }
  const startSecondarySchema = JSON.parse(db.prepare('SELECT params_schema FROM system_cmds WHERE cmd_id = ?').get('biomass-set-1010').params_schema);
  const shutdownDelaySchema = JSON.parse(db.prepare('SELECT params_schema FROM system_cmds WHERE cmd_id = ?').get('biomass-set-1016').params_schema);
  if (JSON.stringify(startSecondarySchema.value.enum) !== JSON.stringify([0, 20]) || shutdownDelaySchema.value.max !== 3600) {
    throw new Error('New ignition/shutdown setting validation is invalid');
  }

  const context = { session_id: 'IO2729MB1@redacted', sync_id: 'test', ioid: 'IO2729MB1' };
  runMacro('IO-biomass-meter', { ...context, c1: '12', c2: '1' });
  runMacro('IO-biomass-meter', { ...context, c1: '12', c2: '5' });
  const shutdownMeter = db.prepare('SELECT burned_minutes, mode FROM biomass_device_meter WHERE ioid = ?').get('IO2729MB1');
  if (shutdownMeter.burned_minutes !== 12 || shutdownMeter.mode !== 5) throw new Error('Shutdown mode persistence failed');
  runMacro('IO-biomass-meter', { ...context, c1: '7', c2: '0' });
  const meter = db.prepare('SELECT burned_minutes, mode FROM biomass_device_meter WHERE ioid = ?').get('IO2729MB1');
  if (meter.burned_minutes !== 12 || meter.mode !== 0) throw new Error('Meter monotonicity failed');

  runMacro('IO-biomass-gps', { ...context, c1: '10.7769', c2: '106.7009' });
  runMacro('IO-biomass-gps', { ...context, c1: '0', c2: '0' });
  const burner = db.prepare('SELECT latitude, longitude, coordinate_source FROM biomass_burners WHERE ioid = ?').get('IO2729MB1');
  if (burner.latitude !== 10.7769 || burner.longitude !== 106.7009 || burner.coordinate_source !== 'gps') {
    throw new Error('GPS cache/fallback failed');
  }

  const list = runMacro('biomass-fleet-list', { ...context, search: '', page_size: '50', offset: '0' });
  if (list.length !== 1 || list[0].ioid !== 'IO2729MB1') throw new Error('Fleet list failed');
  const device = runMacro('biomass-fleet-device', { ...context, burner_id: 'IO2729MB1' });
  if (device.length !== 1 || device[0].ioid !== 'IO2729MB1') throw new Error('Fleet device read failed');
  console.log('biomass compact-v2 smoke test passed');
} finally {
  db.close();
  fs.rmSync(temp, { force: true });
}
