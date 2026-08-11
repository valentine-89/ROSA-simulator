const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const source = path.join(__dirname, 'sample.sqlite');
const temp = path.join(os.tmpdir(), `rosa-biomass-${process.pid}-${Date.now()}.sqlite`);
fs.copyFileSync(source, temp);

const db = new Database(temp);

function runMacro(name, bindings) {
  const row = db.prepare('SELECT source FROM system_macros WHERE name = ? AND enabled = 1').get(name);
  if (!row) throw new Error(`Missing macro ${name}`);
  let rows = [];
  const transaction = db.transaction(() => {
    for (const statement of String(row.source).split(';').map((item) => item.trim()).filter(Boolean)) {
      const prepared = db.prepare(statement);
      if (/^(SELECT|WITH|PRAGMA)\b/i.test(statement)) rows = prepared.all(bindings);
      else prepared.run(bindings);
    }
  });
  transaction();
  return rows;
}

try {
  const pages = db.prepare('SELECT page_id, require_email, meta FROM system_pages ORDER BY page_id').all();
  if (pages.length !== 3 || pages.find((row) => row.page_id === 'biomass-fleet-admin')?.require_email !== 1) {
    throw new Error('Public/admin page policy is invalid');
  }
  const statusMeta = JSON.parse(pages.find((row) => row.page_id === 'biomass-status').meta);
  if (!statusMeta.publicApi.fields.includes('c5') || statusMeta.publicApi.fields.length !== 17 || statusMeta.publicApi.stream !== true) {
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
  if (db.prepare('SELECT COUNT(*) AS count FROM system_cmds').get().count !== 9) {
    throw new Error('Expected nine compact-v2 setting commands');
  }

  const context = { session_id: 'IO2729MB1@redacted', sync_id: 'test', ioid: 'IO2729MB1' };
  runMacro('IO-biomass-meter', { ...context, c1: '12', c2: '1' });
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
