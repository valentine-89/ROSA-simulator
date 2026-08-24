#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SimulatorStore, PublicPageError } = require('../src/store');

function expectCode(callback, code) {
  let caught = null;
  try {
    callback();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof PublicPageError, `Expected PublicPageError ${code}`);
  assert.strictEqual(caught.code, code);
}

const rootDir = path.resolve(__dirname, '..');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rosa-page-command-'));
const store = new SimulatorStore({
  rootDir,
  stateDir,
  templateRoot: path.join(rootDir, 'sample_templates'),
  defaultSessionId: 'IO2729MB1@good-key',
  defaultSyncId: 'SIM_SYNC'
});

try {
  const sampleDb = path.join(
    rootDir,
    'sample_templates',
    'templates',
    'biomass-burner-management',
    'sample.sqlite'
  );
  store.replaceIoDataFile('IO2729MB1@good-key', sampleDb, { syncId: 'SIM_SYNC' });
  store.setTelemetry('IO2729MB1@good-key', { c1: 0 });

  expectCode(
    () => store.executeSystemCommand('IO2729MB1', 'biomass-refuel', { lot_code: 'ABC123', minutes: 30 }),
    'PAGE_REQUIRED'
  );

  const pageId = 'd4f8a92c6b1e47a0bd395f82c713e064';
  const result = store.executeSystemCommand(
    'IO2729MB1',
    'biomass-refuel',
    { lot_code: 'ABC123', minutes: 30 },
    pageId
  );
  assert.strictEqual(result.ioid, 'IO2729MB1');
  assert.strictEqual(result.databaseIoid, 'IO2729MB1');
  assert.strictEqual(result.pageId, pageId);
  assert.strictEqual(result.gatewayText, 'OK');
  const log = store.listCommandLog(1)[0];
  assert.strictEqual(log.ioid, 'IO2729MB1');
  assert.strictEqual(log.command, 'N26,"ABC123",30');

  store.db.prepare(`
    UPDATE device_registry
    SET api_key = 'different-key'
    WHERE ioid = 'IO2729MB1'
  `).run();
  expectCode(
    () => store.executeSystemCommand(
      'IO2729MB1',
      'biomass-refuel',
      { lot_code: 'ABC123', minutes: 30 },
      pageId
    ),
    'DEVICE_KEY_REJECTED'
  );

  console.log('page-bound command credential test passed');
} finally {
  store.db.close();
  fs.rmSync(stateDir, { recursive: true, force: true });
}
