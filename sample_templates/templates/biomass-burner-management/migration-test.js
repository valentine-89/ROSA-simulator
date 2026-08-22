const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('./migrate-production');

const target = path.join(os.tmpdir(), `biomass-migrate-${process.pid}-${Date.now()}.sqlite`);
const db = new Database(target);
db.exec(`
  CREATE TABLE biomass_burners (
    ioid TEXT PRIMARY KEY,name TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',
    latitude REAL NOT NULL DEFAULT 21.35,longitude REAL NOT NULL DEFAULT 105.72,
    coordinate_source TEXT NOT NULL DEFAULT 'default',refuel_page_id TEXT UNIQUE,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
  );
  CREATE TABLE biomass_device_meter (
    ioid TEXT PRIMARY KEY,burned_minutes INTEGER NOT NULL DEFAULT 0,mode INTEGER NOT NULL DEFAULT 0,reported_at INTEGER NOT NULL
  );
  CREATE TABLE system_macros (name TEXT PRIMARY KEY,comment TEXT NOT NULL,source TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE system_pages (page_id TEXT PRIMARY KEY,html TEXT NOT NULL,require_email INTEGER NOT NULL DEFAULT 0,require_phone INTEGER NOT NULL DEFAULT 0,sync_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,title TEXT NOT NULL DEFAULT '',meta TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE system_cmds (cmd_id TEXT PRIMARY KEY,command_template TEXT NOT NULL,require_email INTEGER NOT NULL DEFAULT 0,require_phone INTEGER NOT NULL DEFAULT 0,sync_id TEXT NOT NULL,params_schema TEXT,enabled INTEGER NOT NULL DEFAULT 1);
  INSERT INTO biomass_burners VALUES ('IO2729MB1','Lò thật','Đà Nẵng',16.03143,108.189156,'manual','biomass-refuel-io2729mb1',100,200);
  INSERT INTO biomass_device_meter VALUES ('IO2729MB1',2543,0,300);
  INSERT INTO system_pages VALUES ('biomass-fleet-admin','old',1,0,'SYNC-PRODUCTION',1,'old','{}');
  INSERT INTO system_pages VALUES ('biomass-refuel-io2729mb1','old-refuel',0,0,'SYNC-PRODUCTION',1,'old-refuel','{}');
`);
db.close();

try {
  migrate(target, { credentials: { IO2729MB1: 'production-key' } });
  const firstPass = new Database(target, { readonly: true });
  const firstPageId = firstPass.prepare('SELECT refuel_page_id FROM biomass_burners WHERE ioid=?').get('IO2729MB1').refuel_page_id;
  firstPass.close();
  const firstRevisionDb = new Database(target, { readonly: true });
  const firstRevision = firstRevisionDb.prepare(`SELECT revision FROM system_iot_batch_sources WHERE source_id='biomass-fleet'`).get().revision;
  firstRevisionDb.close();
  migrate(target, { credentials: { IO2729MB1: 'production-key' } });
  const migrated = new Database(target, { readonly: true });
  const burner = migrated.prepare('SELECT * FROM biomass_burners WHERE ioid=?').get('IO2729MB1');
  const meter = migrated.prepare('SELECT * FROM biomass_device_meter WHERE ioid=?').get('IO2729MB1');
  const page = migrated.prepare('SELECT * FROM system_pages WHERE page_id=?').get(burner.refuel_page_id);
  if (burner.name !== 'Lò thật' || burner.latitude !== 16.03143 || burner.longitude !== 108.189156) throw new Error('Migration changed burner metadata');
  if (!/^[0-9a-f]{32}$/.test(burner.refuel_page_id) || burner.refuel_page_id !== firstPageId) throw new Error('Migration did not preserve one random 32-character page id');
  if (meter.burned_minutes !== 2543 || meter.purchased_minutes !== 0) throw new Error('Migration changed meter history');
  const pageMeta = page && JSON.parse(page.meta);
  if (!page || page.sync_id !== 'SYNC-PRODUCTION' || pageMeta.publicApi.context.burner_id !== 'IO2729MB1' || pageMeta.hideLink !== true) throw new Error('Migration did not create a scoped hidden-link refuel page');
  if (migrated.prepare('SELECT COUNT(*) count FROM system_pages WHERE page_id=?').get('biomass-refuel-io2729mb1').count !== 0) throw new Error('Migration retained legacy refuel page id');
  if (migrated.prepare('SELECT COUNT(*) count FROM biomass_fuel_lots').get().count !== 0) throw new Error('Migration inserted demo fuel lots');
  const batchDevice = migrated.prepare(`SELECT api_key FROM system_iot_batch_devices WHERE source_id='biomass-fleet' AND ioid=?`).get('IO2729MB1');
  const batchSource = migrated.prepare(`SELECT fields_json,revision FROM system_iot_batch_sources WHERE source_id='biomass-fleet'`).get();
  if (batchDevice?.api_key !== 'production-key' || JSON.parse(batchSource.fields_json).length !== 20) throw new Error('Migration did not configure batch telemetry');
  if (batchSource.revision !== firstRevision) throw new Error('Repeated migration changed batch revision without a data change');
  if (migrated.prepare(`SELECT COUNT(*) count FROM system_pages WHERE page_id='biomass-status'`).get().count !== 0) throw new Error('Legacy per-device telemetry page remains');
  migrated.close();
  console.log('biomass production migration idempotency test passed');
} finally {
  fs.rmSync(target, { force: true });
}
