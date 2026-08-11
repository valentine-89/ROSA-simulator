const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Template boundary: this database is built entirely from standard ROSA
// system_macros, system_pages and system_cmds. Do not add a biomass API route
// or a biomass c1 action to ROSA core.
const output = path.join(__dirname, 'sample.sqlite');
fs.rmSync(output, { force: true });
const db = new Database(output);

db.exec(`
  PRAGMA journal_mode = DELETE;
  PRAGMA foreign_keys = ON;

  CREATE TABLE biomass_burners (
    ioid TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    latitude REAL NOT NULL DEFAULT 21.35,
    longitude REAL NOT NULL DEFAULT 105.72,
    coordinate_source TEXT NOT NULL DEFAULT 'default' CHECK (coordinate_source IN ('default', 'manual', 'gps')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE biomass_device_meter (
    ioid TEXT PRIMARY KEY,
    burned_minutes INTEGER NOT NULL DEFAULT 0 CHECK (burned_minutes >= 0),
    mode INTEGER NOT NULL DEFAULT 0 CHECK (mode BETWEEN 0 AND 4),
    reported_at INTEGER NOT NULL
  );

  CREATE TABLE biomass_setting_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ioid TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    requested_value INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('confirmed', 'failed')),
    actor TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_biomass_setting_audit_device_time ON biomass_setting_audit(ioid, created_at DESC);

  CREATE TABLE system_macros (
    name TEXT PRIMARY KEY,
    comment TEXT NOT NULL,
    source TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE system_pages (
    page_id TEXT PRIMARY KEY,
    html TEXT NOT NULL,
    require_email INTEGER NOT NULL DEFAULT 0,
    require_phone INTEGER NOT NULL DEFAULT 0,
    sync_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL DEFAULT '',
    meta TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE system_cmds (
    cmd_id TEXT PRIMARY KEY,
    command_template TEXT NOT NULL,
    require_email INTEGER NOT NULL DEFAULT 0,
    require_phone INTEGER NOT NULL DEFAULT 0,
    sync_id TEXT NOT NULL,
    params_schema TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
  );
`);

// Keep the committed sample byte-reproducible across ROSA and simulator.
const now = 1786400000000;
db.prepare(`INSERT INTO biomass_burners(ioid, name, location, latitude, longitude, coordinate_source, created_at, updated_at)
  VALUES ('IO2729MB1', '', '', 21.35, 105.72, 'default', ?, ?)`).run(now, now);
db.prepare(`INSERT INTO biomass_device_meter(ioid, burned_minutes, mode, reported_at)
  VALUES ('IO2729MB1', 0, 0, ?)`).run(now);

const addMacro = db.prepare('INSERT INTO system_macros(name, comment, source, enabled) VALUES (?, ?, ?, 1)');

addMacro.run('biomass-fleet-summary', 'Fleet metadata summary. Live status comes from standard telemetry.', `
SELECT COUNT(*) AS total
FROM biomass_burners;
`);

addMacro.run('biomass-fleet-list', 'Paged fleet metadata list.', `
WITH input AS (
  SELECT TRIM(COALESCE(:search, '')) AS search_text,
         MAX(1, MIN(100, CAST(COALESCE(NULLIF(:page_size, ''), '50') AS INTEGER))) AS page_size,
         MAX(0, CAST(COALESCE(NULLIF(:offset, ''), '0') AS INTEGER)) AS row_offset
), filtered AS (
  SELECT b.* FROM biomass_burners b, input i
  WHERE i.search_text = ''
     OR b.ioid LIKE '%' || i.search_text || '%'
     OR b.name LIKE '%' || i.search_text || '%'
     OR b.location LIKE '%' || i.search_text || '%'
), numbered AS (
  SELECT filtered.*, COUNT(*) OVER () AS total_rows FROM filtered
)
SELECT * FROM numbered
ORDER BY ioid
LIMIT (SELECT page_size FROM input)
OFFSET (SELECT row_offset FROM input);
`);

addMacro.run('biomass-fleet-map', 'Minimal fleet map metadata.', `
SELECT ioid, name, location, latitude, longitude, coordinate_source, updated_at
FROM biomass_burners
ORDER BY ioid;
`);

addMacro.run('biomass-fleet-device', 'One fleet device metadata row.', `
SELECT ioid, name, location, latitude, longitude, coordinate_source, created_at, updated_at
FROM biomass_burners
WHERE ioid = :burner_id
LIMIT 1;
`);

addMacro.run('biomass-fleet-create', 'Register a compact-v2 burner with default or manual coordinates.', `
INSERT INTO biomass_burners(ioid, name, location, latitude, longitude, coordinate_source, created_at, updated_at)
VALUES (
  :burner_id,
  COALESCE(:name, ''),
  COALESCE(:location, ''),
  CASE WHEN TRIM(COALESCE(:latitude, '')) = '' THEN 21.35 ELSE CAST(:latitude AS REAL) END,
  CASE WHEN TRIM(COALESCE(:longitude, '')) = '' THEN 105.72 ELSE CAST(:longitude AS REAL) END,
  CASE WHEN TRIM(COALESCE(:latitude, '')) = '' OR TRIM(COALESCE(:longitude, '')) = '' THEN 'default' ELSE 'manual' END,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);
SELECT :burner_id AS ioid;
`);

addMacro.run('biomass-fleet-update', 'Update burner metadata and manual coordinates.', `
UPDATE biomass_burners
SET name = COALESCE(:name, ''),
    location = COALESCE(:location, ''),
    latitude = CASE WHEN TRIM(COALESCE(:latitude, '')) = '' THEN latitude ELSE CAST(:latitude AS REAL) END,
    longitude = CASE WHEN TRIM(COALESCE(:longitude, '')) = '' THEN longitude ELSE CAST(:longitude AS REAL) END,
    coordinate_source = CASE WHEN TRIM(COALESCE(:latitude, '')) = '' OR TRIM(COALESCE(:longitude, '')) = '' THEN coordinate_source ELSE 'manual' END,
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE ioid = :burner_id;
SELECT :burner_id AS ioid WHERE changes() > 0;
`);

addMacro.run('biomass-fleet-delete', 'Delete one burner from the fleet registry.', `
DELETE FROM biomass_burners WHERE ioid = :burner_id;
SELECT :burner_id AS ioid WHERE changes() > 0;
`);

addMacro.run('biomass-fleet-cache-gps', 'Persist a valid GPS fix observed through standard telemetry.', `
UPDATE biomass_burners
SET latitude = CAST(:latitude AS REAL),
    longitude = CAST(:longitude AS REAL),
    coordinate_source = 'gps',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE ioid = :burner_id;
SELECT :burner_id AS ioid WHERE changes() > 0;
`);

addMacro.run('biomass-setting-audit', 'Record the result of a standard system_cmds setting request.', `
INSERT INTO biomass_setting_audit(ioid, setting_key, requested_value, state, actor, created_at)
VALUES (:burner_id, :setting_key, CAST(:value AS INTEGER), :state, COALESCE(:email, ''), CAST(strftime('%s','now') AS INTEGER) * 1000);
SELECT last_insert_rowid() AS id;
`);

addMacro.run('IO-biomass-meter', 'Device durable meter sent with the standard c1=data action.', `
INSERT INTO biomass_device_meter(ioid, burned_minutes, mode, reported_at)
VALUES (
  CASE WHEN instr(:session_id, '@') > 0 THEN substr(:session_id, 1, instr(:session_id, '@') - 1) ELSE :session_id END,
  -- The standard device gateway removes c1="data" and the macro name,
  -- then exposes the first two device values as :c1 and :c2.
  MAX(0, CAST(COALESCE(NULLIF(:c1, ''), '0') AS INTEGER)),
  MAX(0, MIN(4, CAST(COALESCE(NULLIF(:c2, ''), '0') AS INTEGER))),
  CAST(strftime('%s','now') AS INTEGER) * 1000
)
ON CONFLICT(ioid) DO UPDATE SET
  burned_minutes = MAX(biomass_device_meter.burned_minutes, excluded.burned_minutes),
  mode = excluded.mode,
  reported_at = excluded.reported_at;
SELECT 'OK' AS c1, burned_minutes AS c2 FROM biomass_device_meter
WHERE ioid = CASE WHEN instr(:session_id, '@') > 0 THEN substr(:session_id, 1, instr(:session_id, '@') - 1) ELSE :session_id END;
`);

addMacro.run('IO-biomass-gps', 'Cache a valid device GPS fix through the standard c1=data action.', `
INSERT OR IGNORE INTO biomass_burners(ioid, name, location, latitude, longitude, coordinate_source, created_at, updated_at)
VALUES (
  CASE WHEN instr(:session_id, '@') > 0 THEN substr(:session_id, 1, instr(:session_id, '@') - 1) ELSE :session_id END,
  '', '', 21.35, 105.72, 'default',
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);
UPDATE biomass_burners
SET latitude = CAST(:c1 AS REAL),
    longitude = CAST(:c2 AS REAL),
    coordinate_source = 'gps',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE ioid = CASE WHEN instr(:session_id, '@') > 0 THEN substr(:session_id, 1, instr(:session_id, '@') - 1) ELSE :session_id END
  AND TRIM(COALESCE(:c1, '')) <> ''
  AND TRIM(COALESCE(:c2, '')) <> ''
  AND CAST(:c1 AS REAL) BETWEEN -90 AND 90
  AND CAST(:c2 AS REAL) BETWEEN -180 AND 180
  AND NOT (CAST(:c1 AS REAL) = 0 AND CAST(:c2 AS REAL) = 0);
SELECT CASE WHEN changes() > 0 THEN 'OK' ELSE 'IGNORED' END AS c1;
`);

// Production D23 emits positional telemetry. This mapping belongs to the
// template only; never add a biomass parser or action to ROSA core.
const telemetryFields = Array.from({ length: 17 }, (_, index) => `c${index + 1}`);
const readMacros = {
  'biomass-fleet-summary': { params: {} },
  'biomass-fleet-list': { params: {
    search: { type: 'string', maxLength: 100 },
    page_size: { type: 'integer', min: 1, max: 100 },
    offset: { type: 'integer', min: 0, max: 1000000 }
  } },
  'biomass-fleet-map': { params: {} },
  'biomass-fleet-device': { params: { burner_id: { type: 'string', required: true, pattern: '^[A-Za-z0-9._-]{3,64}$' } } }
};
const writeMacros = {
  'biomass-fleet-create': { params: {
    burner_id: { type: 'string', required: true, pattern: '^[A-Za-z0-9._-]{3,64}$' },
    name: { type: 'string', maxLength: 120 }, location: { type: 'string', maxLength: 240 },
    latitude: { type: 'number', min: -90, max: 90 },
    longitude: { type: 'number', min: -180, max: 180 }
  } },
  'biomass-fleet-update': { params: {
    burner_id: { type: 'string', required: true, pattern: '^[A-Za-z0-9._-]{3,64}$' },
    name: { type: 'string', maxLength: 120 }, location: { type: 'string', maxLength: 240 },
    latitude: { type: 'number', min: -90, max: 90 },
    longitude: { type: 'number', min: -180, max: 180 }
  } },
  'biomass-fleet-delete': { params: { burner_id: { type: 'string', required: true, pattern: '^[A-Za-z0-9._-]{3,64}$' } } },
  'biomass-fleet-cache-gps': { params: {
    burner_id: { type: 'string', required: true, pattern: '^[A-Za-z0-9._-]{3,64}$' },
    latitude: { type: 'number', required: true, min: -90, max: 90 },
    longitude: { type: 'number', required: true, min: -180, max: 180 }
  } },
  'biomass-setting-audit': { params: {
    burner_id: { type: 'string', required: true, pattern: '^[A-Za-z0-9._-]{3,64}$' },
    setting_key: { type: 'string', required: true, enum: ['1005','1006','1007','1008','1009','1010','1011','1012','1013'] },
    value: { type: 'integer', required: true, min: 30, max: 300 },
    state: { type: 'string', required: true, enum: ['confirmed', 'failed'] }
  } }
};
const pageHtml = '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Biomass compact-v2</title><main>Biomass compact-v2</main></html>';
const addPage = db.prepare(`INSERT INTO system_pages(page_id, html, require_email, require_phone, sync_id, enabled, title, meta)
  VALUES (?, ?, ?, 0, '<<syncid>>', 1, ?, ?)`);
addPage.run('biomass-status', pageHtml, 0, 'Biomass status', JSON.stringify({ publicApi: { fields: telemetryFields, stream: true } }));
addPage.run('biomass-fleet-view', pageHtml, 0, 'Biomass fleet view', JSON.stringify({ publicApi: { macros: readMacros, rateLimit: { limit: 300, windowMs: 60000 } } }));
addPage.run('biomass-fleet-admin', pageHtml, 1, 'Biomass fleet admin', JSON.stringify({ publicApi: { macros: writeMacros, rateLimit: { limit: 120, windowMs: 60000 } } }));

const settingDefs = [
  ['1005', 30, 180], ['1006', 30, 300], ['1007', 30, 100], ['1008', 30, 100],
  ['1009', 30, 100], ['1010', 30, 100], ['1011', 30, 100], ['1012', 30, 100], ['1013', 30, 100]
];
const addCommand = db.prepare(`INSERT INTO system_cmds(cmd_id, command_template, require_email, require_phone, sync_id, params_schema, enabled)
  VALUES (?, ?, 1, 0, '<<syncid>>', ?, 1)`);
for (const [key, min, max] of settingDefs) {
  addCommand.run(
    `biomass-set-${key}`,
    `D4#${key},<<value>>D5N20`,
    JSON.stringify({ value: { type: 'integer', required: true, min, max } })
  );
}

db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log(output);
