const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

function migrate(targetPath, options = {}) {
  const resolvedTarget = path.resolve(targetPath);
  const samplePath = path.join(__dirname, 'sample.sqlite');
  if (!fs.existsSync(resolvedTarget)) throw new Error(`Database not found: ${resolvedTarget}`);
  if (!fs.existsSync(samplePath)) throw new Error('Run build-sample-db.js before migration');
  const db = new Database(resolvedTarget);
  const sample = new Database(samplePath, { readonly: true });
  try {
    const result = db.transaction(() => {
      db.pragma('foreign_keys = ON');
      if (!hasColumn(db, 'biomass_burners', 'refuel_page_id')) db.exec('ALTER TABLE biomass_burners ADD COLUMN refuel_page_id TEXT');
      if (!hasColumn(db, 'biomass_device_meter', 'purchased_minutes')) db.exec('ALTER TABLE biomass_device_meter ADD COLUMN purchased_minutes INTEGER NOT NULL DEFAULT 0');
      if (!hasColumn(db, 'system_cmds', 'page_only')) db.exec('ALTER TABLE system_cmds ADD COLUMN page_only INTEGER NOT NULL DEFAULT 0');
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_biomass_burners_refuel_page ON biomass_burners(refuel_page_id);
        CREATE TABLE IF NOT EXISTS system_iot_batch_sources (
          source_id TEXT PRIMARY KEY, fields_json TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
          revision INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS system_iot_batch_devices (
          source_id TEXT NOT NULL REFERENCES system_iot_batch_sources(source_id) ON DELETE CASCADE,
          ioid TEXT NOT NULL, api_key TEXT NOT NULL, fields_json TEXT NOT NULL DEFAULT '[]',
          metadata_json TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(source_id,ioid)
        );
        CREATE INDEX IF NOT EXISTS idx_system_iot_batch_devices_source_ioid ON system_iot_batch_devices(source_id,ioid);
        DROP TRIGGER IF EXISTS system_iot_batch_devices_insert_revision;
        DROP TRIGGER IF EXISTS system_iot_batch_devices_update_revision;
        DROP TRIGGER IF EXISTS system_iot_batch_devices_delete_revision;
        CREATE TRIGGER system_iot_batch_devices_insert_revision AFTER INSERT ON system_iot_batch_devices BEGIN
          UPDATE system_iot_batch_sources SET revision=revision+1,updated_at=NEW.updated_at WHERE source_id=NEW.source_id;
        END;
        CREATE TRIGGER system_iot_batch_devices_update_revision AFTER UPDATE ON system_iot_batch_devices BEGIN
          UPDATE system_iot_batch_sources SET revision=revision+1,updated_at=NEW.updated_at WHERE source_id=NEW.source_id;
        END;
        CREATE TRIGGER system_iot_batch_devices_delete_revision AFTER DELETE ON system_iot_batch_devices BEGIN
          UPDATE system_iot_batch_sources SET revision=revision+1,updated_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE source_id=OLD.source_id;
        END;
        CREATE TABLE IF NOT EXISTS biomass_fuel_batches (
          batch_id TEXT PRIMARY KEY, client_request_id TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 120),
          minutes_per_lot INTEGER NOT NULL CHECK (minutes_per_lot BETWEEN 1 AND 1000000),
          quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 500), created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS biomass_fuel_lots (
          code TEXT PRIMARY KEY CHECK (length(code)=6 AND code NOT GLOB '*[^A-Z0-9]*'),
          batch_id TEXT NOT NULL REFERENCES biomass_fuel_batches(batch_id) ON DELETE RESTRICT,
          description TEXT NOT NULL, purchased_minutes INTEGER NOT NULL CHECK (purchased_minutes BETWEEN 1 AND 1000000),
          created_at INTEGER NOT NULL, redeemed_at INTEGER, redeemed_ioid TEXT,
          redeemed_request_id TEXT UNIQUE, credited_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_biomass_fuel_lots_created ON biomass_fuel_lots(created_at DESC,code);
        CREATE INDEX IF NOT EXISTS idx_biomass_fuel_lots_redeemed ON biomass_fuel_lots(redeemed_at,redeemed_ioid);
        CREATE TABLE IF NOT EXISTS biomass_page_templates (page_type TEXT PRIMARY KEY, html TEXT NOT NULL, meta_template TEXT NOT NULL);
        DROP TRIGGER IF EXISTS biomass_fuel_batch_generate;
        CREATE TRIGGER biomass_fuel_batch_generate AFTER INSERT ON biomass_fuel_batches BEGIN
          INSERT INTO biomass_fuel_lots(code,batch_id,description,purchased_minutes,created_at)
          WITH RECURSIVE sequence(n) AS (
            SELECT 1 UNION ALL SELECT n+1 FROM sequence WHERE n < NEW.quantity*8
          ), candidates AS (
            SELECT DISTINCT
              substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',((random() & 9223372036854775807)%36)+1,1)||
              substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',((random() & 9223372036854775807)%36)+1,1)||
              substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',((random() & 9223372036854775807)%36)+1,1)||
              substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',((random() & 9223372036854775807)%36)+1,1)||
              substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',((random() & 9223372036854775807)%36)+1,1)||
              substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',((random() & 9223372036854775807)%36)+1,1) code
            FROM sequence
          )
          SELECT code,NEW.batch_id,NEW.description,NEW.minutes_per_lot,NEW.created_at FROM candidates
          WHERE NOT EXISTS (SELECT 1 FROM biomass_fuel_lots x WHERE x.code=candidates.code) LIMIT NEW.quantity;
          SELECT CASE WHEN (SELECT COUNT(*) FROM biomass_fuel_lots WHERE batch_id=NEW.batch_id)<>NEW.quantity
            THEN RAISE(ABORT,'BATCH_CODE_GENERATION_FAILED') END;
        END;
      `);

      const currentSync = String(options.syncId || db.prepare(`SELECT sync_id FROM system_pages
        WHERE page_id IN ('biomass-fleet-admin','biomass-fleet-view','biomass-status')
        AND trim(sync_id)<>'' ORDER BY CASE page_id WHEN 'biomass-fleet-admin' THEN 0 ELSE 1 END LIMIT 1`).get()?.sync_id || '').trim();
      if (!currentSync || currentSync.includes('<<')) throw new Error('A production SyncID is required for page migration');

      const pageTemplate = sample.prepare('SELECT page_type,html,meta_template FROM biomass_page_templates WHERE page_type=?').get('refuel');
      const sampleBatchSource = sample.prepare(`SELECT source_id,fields_json,enabled FROM system_iot_batch_sources
        WHERE source_id='biomass-fleet'`).get();
      db.prepare(`INSERT INTO system_iot_batch_sources(source_id,fields_json,enabled,revision,updated_at)
        VALUES (?,?,?,1,CAST(strftime('%s','now') AS INTEGER)*1000)
        ON CONFLICT(source_id) DO UPDATE SET fields_json=excluded.fields_json,enabled=excluded.enabled,
          revision=system_iot_batch_sources.revision+1,updated_at=excluded.updated_at
        WHERE system_iot_batch_sources.fields_json IS NOT excluded.fields_json
           OR system_iot_batch_sources.enabled IS NOT excluded.enabled`)
        .run(sampleBatchSource.source_id, sampleBatchSource.fields_json, sampleBatchSource.enabled);
      const credentials = options.credentials && typeof options.credentials === 'object' ? options.credentials : {};
      const upsertBatchDevice = db.prepare(`INSERT INTO system_iot_batch_devices(
        source_id,ioid,api_key,fields_json,metadata_json,enabled,created_at,updated_at
      ) VALUES ('biomass-fleet',?,?,'[]','{}',1,CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000)
      ON CONFLICT(source_id,ioid) DO UPDATE SET api_key=excluded.api_key,enabled=1,updated_at=excluded.updated_at
      WHERE system_iot_batch_devices.api_key IS NOT excluded.api_key OR system_iot_batch_devices.enabled<>1`);
      for (const burner of db.prepare('SELECT ioid FROM biomass_burners ORDER BY ioid').all()) {
        const apiKey = String(credentials[burner.ioid] || (burner.ioid === 'IO2729MB1' ? options.apiKey || '' : '')).trim();
        if (apiKey) upsertBatchDevice.run(burner.ioid, apiKey);
      }
      db.prepare(`INSERT INTO biomass_page_templates(page_type,html,meta_template) VALUES (?,?,?)
        ON CONFLICT(page_type) DO UPDATE SET html=excluded.html,meta_template=excluded.meta_template`)
        .run(pageTemplate.page_type, pageTemplate.html, pageTemplate.meta_template);

      const upsertMacro = db.prepare(`INSERT INTO system_macros(name,comment,source,enabled) VALUES (?,?,?,?)
        ON CONFLICT(name) DO UPDATE SET comment=excluded.comment,source=excluded.source,enabled=excluded.enabled`);
      for (const row of sample.prepare(`SELECT name,comment,source,enabled FROM system_macros
        WHERE name LIKE 'biomass-%' OR name LIKE 'IO-biomass-%'`).all()) {
        upsertMacro.run(row.name, row.comment, row.source.replaceAll('<<syncid>>', currentSync), row.enabled);
      }

      const upsertPage = db.prepare(`INSERT INTO system_pages(page_id,html,require_email,require_phone,sync_id,enabled,title,meta)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET html=excluded.html,require_email=excluded.require_email,
        require_phone=excluded.require_phone,sync_id=excluded.sync_id,enabled=excluded.enabled,title=excluded.title,meta=excluded.meta`);
      for (const row of sample.prepare(`SELECT * FROM system_pages WHERE page_id IN ('biomass-fleet-view','biomass-fleet-admin')`).all()) {
        upsertPage.run(row.page_id, row.html, row.require_email, row.require_phone, currentSync, row.enabled, row.title, row.meta);
      }
      db.prepare(`DELETE FROM system_pages WHERE page_id='biomass-status'`).run();

      // Retire scalar flame settings; keep unrelated commands and all history.
      db.prepare("DELETE FROM system_cmds WHERE cmd_id GLOB 'biomass-set-*' AND cmd_id NOT IN ('biomass-set-1005','biomass-set-1007','biomass-set-1008')").run();
      const upsertCommand = db.prepare(`INSERT INTO system_cmds(cmd_id,command_template,require_email,require_phone,sync_id,params_schema,enabled,page_only)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(cmd_id) DO UPDATE SET command_template=excluded.command_template,
        require_email=excluded.require_email,require_phone=excluded.require_phone,sync_id=excluded.sync_id,
        params_schema=excluded.params_schema,enabled=excluded.enabled,page_only=excluded.page_only`);
      for (const row of sample.prepare(`SELECT * FROM system_cmds WHERE cmd_id LIKE 'biomass-%'`).all()) {
        upsertCommand.run(row.cmd_id, row.command_template, row.require_email, row.require_phone, currentSync, row.params_schema, row.enabled, row.page_only || 0);
      }

      const legacyRefuelPageIds = db.prepare(`SELECT refuel_page_id FROM biomass_burners
        WHERE refuel_page_id IS NOT NULL AND trim(refuel_page_id)<>''
          AND (length(trim(refuel_page_id))<>32 OR lower(trim(refuel_page_id)) GLOB '*[^0-9a-f]*')`).all();
      db.exec(`UPDATE biomass_burners SET refuel_page_id=lower(hex(randomblob(16)))
        WHERE refuel_page_id IS NULL OR trim(refuel_page_id)=''
          OR length(trim(refuel_page_id))<>32 OR lower(trim(refuel_page_id)) GLOB '*[^0-9a-f]*';`);
      db.exec(`INSERT OR IGNORE INTO biomass_device_meter(ioid,burned_minutes,purchased_minutes,mode,reported_at)
        SELECT ioid,0,0,0,CAST(strftime('%s','now') AS INTEGER)*1000 FROM biomass_burners;`);
      const insertRefuelPage = db.prepare(`INSERT INTO system_pages(page_id,html,require_email,require_phone,sync_id,enabled,title,meta)
        VALUES (?,?,0,0,?,1,?,?) ON CONFLICT(page_id) DO UPDATE SET html=excluded.html,require_email=0,
        require_phone=0,sync_id=excluded.sync_id,enabled=1,title=excluded.title,meta=excluded.meta`);
      for (const burner of db.prepare('SELECT ioid,refuel_page_id FROM biomass_burners').all()) {
        insertRefuelPage.run(burner.refuel_page_id, pageTemplate.html, currentSync,
          `Nạp nhiên liệu ${burner.ioid}`, pageTemplate.meta_template.replaceAll('__BURNER_ID__', burner.ioid));
      }
      const deleteLegacyPage = db.prepare(`DELETE FROM system_pages WHERE page_id=?
        AND page_id NOT IN (SELECT refuel_page_id FROM biomass_burners)`);
      for (const row of legacyRefuelPageIds) deleteLegacyPage.run(row.refuel_page_id);

      return {
        burners: db.prepare('SELECT COUNT(*) count FROM biomass_burners').get().count,
        refuelPages: db.prepare(`SELECT COUNT(*) count FROM system_pages p
          JOIN biomass_burners b ON b.refuel_page_id=p.page_id WHERE p.enabled=1`).get().count,
        fuelLots: db.prepare('SELECT COUNT(*) count FROM biomass_fuel_lots').get().count,
        batchDevices: db.prepare(`SELECT COUNT(*) count FROM system_iot_batch_devices WHERE source_id='biomass-fleet'`).get().count,
        syncId: currentSync
      };
    })();
    return { ...result, target: resolvedTarget };
  } finally {
    sample.close();
    db.close();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const target = args.find((arg) => !arg.startsWith('--'));
  const syncArg = args.find((arg) => arg.startsWith('--sync-id='));
  const apiKeyArg = args.find((arg) => arg.startsWith('--api-key='));
  let credentials = {};
  if (process.env.BIOMASS_BATCH_CREDENTIALS_JSON) {
    credentials = JSON.parse(process.env.BIOMASS_BATCH_CREDENTIALS_JSON);
  }
  if (!target) throw new Error('Usage: node migrate-production.js <database.sqlite> [--sync-id=...]');
  const result = migrate(target, {
    syncId: syncArg ? syncArg.slice('--sync-id='.length) : '',
    apiKey: apiKeyArg ? apiKeyArg.slice('--api-key='.length) : '',
    credentials,
  });
  console.log(JSON.stringify({ ...result, syncId: '[configured]' }));
}

module.exports = { migrate };
