const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Database = require('better-sqlite3');

const source = path.join(__dirname, 'sample.sqlite');
const temp = path.join(os.tmpdir(), `rosa-biomass-${process.pid}-${Date.now()}.sqlite`);
fs.copyFileSync(source, temp);
const db = new Database(temp);

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

function testSetupPage() {
  const source = fs.readFileSync(path.join(__dirname, 'setup_biomass_vi.js'), 'utf8');
  const fields = new Map();
  const body = {};
  Object.defineProperty(body, 'innerHTML', {
    set(value) {
      this.value = String(value);
      for (const match of this.value.matchAll(/<input id="([^"]+)"/g)) fields.set(match[1], { value: '' });
    },
    get() { return this.value || ''; }
  });
  let handlers = null;
  vm.runInNewContext(source, {
    document: { body, getElementById: (id) => fields.get(id) || null },
    DashboardSetupBridge: { start: (value) => { handlers = value; } }
  });
  if (!handlers) throw new Error('Biomass setup bridge did not start');
  if (/IOID fleet|Định danh capability ROSA/.test(body.innerHTML)) throw new Error('Technical biomass identifiers leaked into setup UI');
  handlers.onInit({
    config: {
      fleetIoid: 'IO2729MB1@expanded-api-key',
      fleetViewPageId: 'unsafe-view',
      fleetAdminPageId: 'unsafe-admin',
      deviceStatusPageId: 'unsafe-status'
    },
    context: { sessionId: 'IO2729MB1@redacted', ioid: 'IO2729MB1' }
  });
  const config = handlers.onCollect();
  if (config.fleetIoid !== 'IO2729MB1') throw new Error('Setup did not normalize the active fleet IOID');
  if (config.fleetViewPageId !== 'biomass-fleet-view'
      || config.fleetAdminPageId !== 'biomass-fleet-admin'
      || config.deviceStatusPageId !== 'biomass-status') {
    throw new Error('Setup did not enforce fixed biomass capability page IDs');
  }
}

const context = { session_id: 'IO2729MB1@redacted', sync_id: 'test', ioid: 'IO2729MB1' };
function createBatch(quantity, suffix, minutes = 300) {
  const rows = runMacro('biomass-fuel-lot-create-batch', {
    ...context,
    client_request_id: `BATCH-REQUEST-${suffix}-${quantity}`,
    description: `Gỗ nén ${suffix}`,
    minutes_per_lot: String(minutes),
    quantity: String(quantity)
  });
  if (rows.length !== quantity || rows.some((row) => row.status !== 'OK')) {
    throw new Error(`Batch ${quantity} returned ${rows.length} rows`);
  }
  return rows;
}

try {
  testSetupPage();
  const runtimeSource = fs.readFileSync(path.join(__dirname, 'dashboard-runtime.js'), 'utf8');
  const dashboardSource = fs.readFileSync(path.join(__dirname, 'dashboard_vi.html'), 'utf8');
  const refuelSource = fs.readFileSync(path.join(__dirname, 'refuel-runtime.js'), 'utf8');
  const qrSource = fs.readFileSync(path.join(__dirname, 'qrcode-runtime.js'), 'utf8');
  for (const key of ['1005','1006','1007','1008','1009','1010','1011','1012','1013','1014','1015','1016','1017','1018']) {
    if (!runtimeSource.includes(`key: "${key}"`)) throw new Error(`Dashboard setting #${key} is missing`);
  }
  for (const token of ['biomass-fuel-lot-create-batch', 'biomass-purchased-minutes-set', 'downloadCsv', 'BiomassQr']) {
    if (!runtimeSource.includes(token)) throw new Error(`Dashboard feature ${token} is missing`);
  }
  for (const obsolete of ['Chờ thiết bị đồng bộ', 'bb-settings-open', 'data-map-ioid', 'item.programVersion || "--"', 'Quạt sơ / thứ', 'primaryFanPct', 'secondaryFanPct', 'data.serverTime || Date.now()']) {
    if (dashboardSource.includes(obsolete) || runtimeSource.includes(obsolete)) throw new Error(`Obsolete dashboard control or label remains: ${obsolete}`);
  }
  if (!runtimeSource.includes('https://rosa.technology') || !dashboardSource.includes('"publicBaseUrl":"https://rosa.technology"')) {
    throw new Error('Production refuel base URL is missing');
  }
  for (const token of ['sessionStorage', 'window.close()', 'client_request_id', 'pendingKey', 'br-success-view']) {
    if (!refuelSource.includes(token)) throw new Error(`Refuel safety ${token} is missing`);
  }
  for (const marker of [
    'AI-BRIDGE-EDITABLE HTML LAYOUT: START',
    'AI-BRIDGE-EDITABLE HTML LAYOUT: END',
    'AI-BRIDGE-EDITABLE DASHBOARD CONFIG: START',
    'AI-BRIDGE-EDITABLE DASHBOARD CONFIG: END',
    'AI-BRIDGE-LOCKED RUNTIME SCRIPT: START',
    'AI-BRIDGE-LOCKED RUNTIME SCRIPT: END'
  ]) {
    if (!dashboardSource.includes(marker)) throw new Error(`Dashboard marker ${marker} is missing`);
  }
  if (!qrSource.includes('global.BiomassQr') || /(?:fetch|src\s*=)\s*\(?["']https?:\/\//.test(qrSource)) throw new Error('Local QR runtime is invalid');

  const pages = db.prepare('SELECT page_id, require_email, meta, html FROM system_pages ORDER BY page_id').all();
  if (pages.length !== 4 || pages.find((row) => row.page_id === 'biomass-fleet-admin')?.require_email !== 1) {
    throw new Error('System page policy is invalid');
  }
  const statusMeta = JSON.parse(pages.find((row) => row.page_id === 'biomass-status').meta);
  if (statusMeta.publicApi.fields.length !== 21 || statusMeta.publicApi.fields.includes('c3') || statusMeta.publicApi.fields.includes('c4') || !statusMeta.publicApi.fields.includes('c21') || !statusMeta.publicApi.fields.includes('c23')) {
    throw new Error('Public telemetry field policy is invalid');
  }
  if (!dashboardSource.includes('"activeStaleMinutes":20') || !dashboardSource.includes('"idleStaleMinutes":40')) throw new Error('Device stale thresholds are invalid');
  if (!dashboardSource.includes('dashboard-runtime.js?v=2026.08.20.1')) throw new Error('Dashboard runtime cache version is stale');
  const refuelPage = pages.find((row) => /^[0-9a-f]{32}$/.test(row.page_id));
  const parsedRefuelMeta = JSON.parse(refuelPage.meta);
  if (parsedRefuelMeta.hideLink !== true) throw new Error('Refuel page does not enable the standard ROSA hidden-link flow');
  const refuelMeta = parsedRefuelMeta.publicApi;
  if (refuelMeta.rateLimit.limit !== 20 || refuelMeta.maxBodyBytes !== 1024 || refuelMeta.context.burner_id !== 'IO2729MB1') {
    throw new Error('Refuel page scope or rate limit is invalid');
  }
  if (!refuelPage.html.includes('refuel-runtime.js') || /@[^<\s/]+\/[A-Za-z0-9]{12,}/.test(refuelPage.html)) {
    throw new Error('Refuel page missing runtime or leaking credentials');
  }
  for (const page of pages) {
    const publicApi = JSON.parse(page.meta).publicApi || {};
    for (const macro of Object.values(publicApi.macros || {})) {
      if (macro.params && Object.prototype.hasOwnProperty.call(macro.params, 'ioid')) throw new Error('Reserved ioid param leaked');
    }
  }

  const initial = runMacro('IO-biomass-meter', { ...context, c1: 'IO2729MB1', c2: '12', c3: '5' })[0];
  if (initial.c1 !== 'OK' || initial.c2 !== 0) throw new Error('Meter response contract failed');
  const regression = runMacro('IO-biomass-meter', { ...context, c1: 'IO2729MB1', c2: '7', c3: '0' })[0];
  if (regression.c1 !== 'METER_REGRESSION' || regression.c2 !== 0) throw new Error('Meter regression contract failed');
  if (runMacro('IO-biomass-meter', { ...context, c1: 'IO-NOT-REGISTERED', c2: '1', c3: '0' })[0].c1 !== 'UNKNOWN_DEVICE') {
    throw new Error('Unknown meter device was accepted');
  }

  for (const [value, label] of [[500, 'up'], [20, 'down'], [0, 'zero'], [2147483647, 'max']]) {
    const result = runMacro('biomass-purchased-minutes-set', { ...context, burner_id: 'IO2729MB1', purchased_minutes: String(value) })[0];
    if (result.status !== 'OK' || result.purchased_minutes !== value) throw new Error(`Manual credit ${label} failed`);
  }
  if (runMacro('biomass-purchased-minutes-set', { ...context, burner_id: 'IO-NOPE', purchased_minutes: '10' })[0].status !== 'NOT_FOUND') {
    throw new Error('Manual credit accepted unknown burner');
  }
  runMacro('biomass-purchased-minutes-set', { ...context, burner_id: 'IO2729MB1', purchased_minutes: '0' });

  const batch1 = createBatch(1, 'one');
  createBatch(100, 'hundred');
  createBatch(500, 'five-hundred');
  const allCodes = db.prepare('SELECT code FROM biomass_fuel_lots').all().map((row) => row.code);
  if (new Set(allCodes).size !== 601 || allCodes.some((code) => !/^[A-Z0-9]{6}$/.test(code))) {
    throw new Error('Generated fuel-lot codes are not globally unique six-character codes');
  }

  const code = batch1[0].code;
  const first = runMacro('biomass-refuel-redeem', { ...context, burner_id: 'IO2729MB1', lot_code: code, client_request_id: 'REDEEM-REQUEST-0001' })[0];
  if (first.status !== 'OK' || first.added_minutes !== 300 || first.purchased_minutes !== 300) throw new Error('First redeem failed');
  const retry = runMacro('biomass-refuel-redeem', { ...context, burner_id: 'IO2729MB1', lot_code: code, client_request_id: 'REDEEM-REQUEST-0001' })[0];
  if (retry.status !== 'OK' || retry.purchased_minutes !== 300) throw new Error('Idempotent redeem retry failed');
  const duplicate = runMacro('biomass-refuel-redeem', { ...context, burner_id: 'IO2729MB1', lot_code: code, client_request_id: 'REDEEM-REQUEST-0002' })[0];
  if (duplicate.status !== 'ALREADY_USED' || duplicate.purchased_minutes !== 300) throw new Error('Duplicate redeem was not rejected');
  if (runMacro('biomass-refuel-redeem', { ...context, burner_id: 'IO2729MB1', lot_code: 'BAD@@@', client_request_id: 'REDEEM-REQUEST-0003' })[0].status !== 'INVALID') {
    throw new Error('Invalid fuel code was not rejected');
  }

  const newBurner = runMacro('biomass-fleet-create', { ...context, burner_id: 'IO2729TEST', name: 'Lò test', location: '', latitude: '', longitude: '' })[0];
  if (!/^[0-9a-f]{32}$/.test(newBurner.refuel_page_id) || newBurner.refuel_page_id === refuelPage.page_id) throw new Error('New burner random refuel page id failed');
  const createdPage = db.prepare('SELECT meta FROM system_pages WHERE page_id = ?').get(newBurner.refuel_page_id);
  if (!createdPage || JSON.parse(createdPage.meta).publicApi.context.burner_id !== 'IO2729TEST') throw new Error('New burner page context failed');

  runMacro('IO-biomass-gps', { ...context, c1: 'IO2729MB1', c2: '10.7769', c3: '106.7009' });
  const burner = db.prepare('SELECT latitude,longitude,coordinate_source FROM biomass_burners WHERE ioid=?').get('IO2729MB1');
  if (burner.latitude !== 10.7769 || burner.longitude !== 106.7009 || burner.coordinate_source !== 'gps') throw new Error('GPS cache failed');

  console.log('biomass compact-v2.6 smoke test passed');
} finally {
  db.close();
  fs.rmSync(temp, { force: true });
}
