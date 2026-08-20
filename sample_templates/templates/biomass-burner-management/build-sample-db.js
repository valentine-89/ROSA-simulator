const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Template boundary: compose only standard ROSA system_macros, system_pages,
// telemetry/data and system_cmds. Never add a biomass route or c1 action to core.
const output = path.join(__dirname, 'sample.sqlite');
const refuelHtml = fs.readFileSync(path.join(__dirname, 'refuel_page.html'), 'utf8');
fs.rmSync(output, { force: true });
const db = new Database(output);

db.exec(`
  PRAGMA journal_mode = DELETE;
  PRAGMA foreign_keys = ON;
  CREATE TABLE biomass_burners (
    ioid TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
    latitude REAL NOT NULL DEFAULT 21.35, longitude REAL NOT NULL DEFAULT 105.72,
    coordinate_source TEXT NOT NULL DEFAULT 'default' CHECK (coordinate_source IN ('default','manual','gps')),
    refuel_page_id TEXT NOT NULL UNIQUE CHECK (length(refuel_page_id)=32 AND refuel_page_id NOT GLOB '*[^0-9a-f]*'), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE biomass_device_meter (
    ioid TEXT PRIMARY KEY, burned_minutes INTEGER NOT NULL DEFAULT 0 CHECK (burned_minutes >= 0),
    purchased_minutes INTEGER NOT NULL DEFAULT 0 CHECK (purchased_minutes BETWEEN 0 AND 2147483647),
    mode INTEGER NOT NULL DEFAULT 0 CHECK (mode BETWEEN 0 AND 5), reported_at INTEGER NOT NULL
  );
  CREATE TABLE biomass_fuel_batches (
    batch_id TEXT PRIMARY KEY, client_request_id TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 120),
    minutes_per_lot INTEGER NOT NULL CHECK (minutes_per_lot BETWEEN 1 AND 1000000),
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 500), created_at INTEGER NOT NULL
  );
  CREATE TABLE biomass_fuel_lots (
    code TEXT PRIMARY KEY CHECK (length(code)=6 AND code NOT GLOB '*[^A-Z0-9]*'),
    batch_id TEXT NOT NULL REFERENCES biomass_fuel_batches(batch_id) ON DELETE RESTRICT,
    description TEXT NOT NULL, purchased_minutes INTEGER NOT NULL CHECK (purchased_minutes BETWEEN 1 AND 1000000),
    created_at INTEGER NOT NULL, redeemed_at INTEGER, redeemed_ioid TEXT,
    redeemed_request_id TEXT UNIQUE, credited_at INTEGER
  );
  CREATE INDEX idx_biomass_fuel_lots_created ON biomass_fuel_lots(created_at DESC,code);
  CREATE INDEX idx_biomass_fuel_lots_redeemed ON biomass_fuel_lots(redeemed_at,redeemed_ioid);
  CREATE TABLE biomass_setting_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ioid TEXT NOT NULL, setting_key TEXT NOT NULL,
    requested_value INTEGER NOT NULL, state TEXT NOT NULL CHECK (state IN ('confirmed','failed')),
    actor TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_biomass_setting_audit_device_time ON biomass_setting_audit(ioid,created_at DESC);
  CREATE TABLE biomass_page_templates (page_type TEXT PRIMARY KEY, html TEXT NOT NULL, meta_template TEXT NOT NULL);
  CREATE TABLE system_macros (name TEXT PRIMARY KEY, comment TEXT NOT NULL, source TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE system_pages (
    page_id TEXT PRIMARY KEY, html TEXT NOT NULL, require_email INTEGER NOT NULL DEFAULT 0,
    require_phone INTEGER NOT NULL DEFAULT 0, sync_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    title TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE system_cmds (
    cmd_id TEXT PRIMARY KEY, command_template TEXT NOT NULL, require_email INTEGER NOT NULL DEFAULT 0,
    require_phone INTEGER NOT NULL DEFAULT 0, sync_id TEXT NOT NULL, params_schema TEXT, enabled INTEGER NOT NULL DEFAULT 1
  );
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
        substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',((random() & 9223372036854775807)%36)+1,1) AS code
      FROM sequence
    )
    SELECT code,NEW.batch_id,NEW.description,NEW.minutes_per_lot,NEW.created_at FROM candidates
    WHERE NOT EXISTS (SELECT 1 FROM biomass_fuel_lots x WHERE x.code=candidates.code) LIMIT NEW.quantity;
    SELECT CASE WHEN (SELECT COUNT(*) FROM biomass_fuel_lots WHERE batch_id=NEW.batch_id)<>NEW.quantity
      THEN RAISE(ABORT,'BATCH_CODE_GENERATION_FAILED') END;
  END;
`);

const refuelMetaTemplate = JSON.stringify({
  pageType: 'biomass-refuel',
  // Standard ROSA hidden-link session removes the full QR target from the
  // address bar after the public page opens.
  hideLink: true,
  publicApi: {
    stream: false, maxBodyBytes: 1024, rateLimit: { limit: 20, windowMs: 60000 },
    context: { burner_id: '__BURNER_ID__' },
    macros: {
      'biomass-refuel-state': { params: {} },
      'biomass-refuel-redeem': { params: {
        lot_code: { type: 'string', required: true, pattern: '^[A-Z0-9]{6}$' },
        client_request_id: { type: 'string', required: true, maxLength: 80, pattern: '^[A-Za-z0-9._:-]{12,80}$' }
      } }
    }
  }
});
db.prepare('INSERT INTO biomass_page_templates(page_type,html,meta_template) VALUES (?,?,?)').run('refuel',refuelHtml,refuelMetaTemplate);

const now = 1786400000000;
const initialRefuelPageId = 'd4f8a92c6b1e47a0bd395f82c713e064';
db.prepare(`INSERT INTO biomass_burners(ioid,name,location,latitude,longitude,coordinate_source,refuel_page_id,created_at,updated_at)
 VALUES ('IO2729MB1','','',21.35,105.72,'default',?, ?,?)`).run(initialRefuelPageId,now,now);
db.prepare(`INSERT INTO biomass_device_meter(ioid,burned_minutes,purchased_minutes,mode,reported_at)
 VALUES ('IO2729MB1',0,0,0,?)`).run(now);

const addMacro = db.prepare('INSERT INTO system_macros(name,comment,source,enabled) VALUES (?,?,?,1)');
addMacro.run('biomass-fleet-summary','Fleet summary from the shared compact-v2 database.',`
SELECT COUNT(*) AS total, COALESCE(SUM(m.burned_minutes),0) AS burned_minutes,
       COALESCE(SUM(m.purchased_minutes),0) AS purchased_minutes
FROM biomass_burners b LEFT JOIN biomass_device_meter m ON m.ioid=b.ioid;
`);
addMacro.run('biomass-fleet-list','Paged fleet metadata and purchased-minute snapshot.',`
WITH input AS (
 SELECT trim(COALESCE(:search,'')) search_text,
        MAX(1,MIN(100,CAST(COALESCE(NULLIF(:page_size,''),'50') AS INTEGER))) page_size,
        MAX(0,CAST(COALESCE(NULLIF(:offset,''),'0') AS INTEGER)) row_offset
), filtered AS (
 SELECT b.*,COALESCE(m.burned_minutes,0) burned_minutes,COALESCE(m.purchased_minutes,0) purchased_minutes,
        MAX(COALESCE(m.purchased_minutes,0)-COALESCE(m.burned_minutes,0),0) remaining_minutes,
        COALESCE(m.mode,0) stored_mode,m.reported_at
 FROM biomass_burners b LEFT JOIN biomass_device_meter m ON m.ioid=b.ioid,input i
 WHERE i.search_text='' OR b.ioid LIKE '%'||i.search_text||'%' OR b.name LIKE '%'||i.search_text||'%'
    OR b.location LIKE '%'||i.search_text||'%'
), numbered AS (SELECT filtered.*,COUNT(*) OVER () total_rows FROM filtered)
SELECT * FROM numbered ORDER BY ioid LIMIT (SELECT page_size FROM input) OFFSET (SELECT row_offset FROM input);
`);
addMacro.run('biomass-fleet-map','Minimal fleet map and purchased-minute snapshot.',`
SELECT b.ioid,b.name,b.location,b.latitude,b.longitude,b.coordinate_source,b.refuel_page_id,b.updated_at,
       COALESCE(m.burned_minutes,0) burned_minutes,COALESCE(m.purchased_minutes,0) purchased_minutes,
       MAX(COALESCE(m.purchased_minutes,0)-COALESCE(m.burned_minutes,0),0) remaining_minutes
FROM biomass_burners b LEFT JOIN biomass_device_meter m ON m.ioid=b.ioid ORDER BY b.ioid;
`);
addMacro.run('biomass-fleet-device','One fleet device metadata and credit row.',`
SELECT b.*,COALESCE(m.burned_minutes,0) burned_minutes,COALESCE(m.purchased_minutes,0) purchased_minutes,
       MAX(COALESCE(m.purchased_minutes,0)-COALESCE(m.burned_minutes,0),0) remaining_minutes
FROM biomass_burners b LEFT JOIN biomass_device_meter m ON m.ioid=b.ioid WHERE b.ioid=:burner_id LIMIT 1;
`);
addMacro.run('biomass-fleet-create','Register a compact-v2 burner and create its public refuel page atomically.',`
INSERT INTO biomass_burners(ioid,name,location,latitude,longitude,coordinate_source,refuel_page_id,created_at,updated_at)
VALUES (:burner_id,COALESCE(:name,''),COALESCE(:location,''),
 CASE WHEN trim(COALESCE(:latitude,''))='' THEN 21.35 ELSE CAST(:latitude AS REAL) END,
 CASE WHEN trim(COALESCE(:longitude,''))='' THEN 105.72 ELSE CAST(:longitude AS REAL) END,
 CASE WHEN trim(COALESCE(:latitude,''))='' OR trim(COALESCE(:longitude,''))='' THEN 'default' ELSE 'manual' END,
 lower(hex(randomblob(16))),CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000);
INSERT INTO biomass_device_meter(ioid,burned_minutes,purchased_minutes,mode,reported_at)
VALUES (:burner_id,0,0,0,CAST(strftime('%s','now') AS INTEGER)*1000);
INSERT INTO system_pages(page_id,html,require_email,require_phone,sync_id,enabled,title,meta)
SELECT b.refuel_page_id,t.html,0,0,'<<syncid>>',1,'Nạp nhiên liệu '||:burner_id,
       replace(meta_template,'__BURNER_ID__',:burner_id)
FROM biomass_page_templates t JOIN biomass_burners b ON b.ioid=:burner_id WHERE t.page_type='refuel';
SELECT ioid,refuel_page_id FROM biomass_burners WHERE ioid=:burner_id;
`);
addMacro.run('biomass-fleet-update','Update burner metadata and manual coordinates.',`
UPDATE biomass_burners SET name=COALESCE(:name,''),location=COALESCE(:location,''),
 latitude=CASE WHEN trim(COALESCE(:latitude,''))='' THEN latitude ELSE CAST(:latitude AS REAL) END,
 longitude=CASE WHEN trim(COALESCE(:longitude,''))='' THEN longitude ELSE CAST(:longitude AS REAL) END,
 coordinate_source=CASE WHEN trim(COALESCE(:latitude,''))='' OR trim(COALESCE(:longitude,''))='' THEN coordinate_source ELSE 'manual' END,
 updated_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE ioid=:burner_id;
SELECT :burner_id ioid WHERE changes()>0;
`);
addMacro.run('biomass-fleet-delete','Delete burner and disable its refuel page while retaining redeemed lot history.',`
UPDATE system_pages SET enabled=0 WHERE page_id=(SELECT refuel_page_id FROM biomass_burners WHERE ioid=:burner_id);
DELETE FROM biomass_device_meter WHERE ioid=:burner_id;
DELETE FROM biomass_burners WHERE ioid=:burner_id;
SELECT :burner_id ioid WHERE changes()>0;
`);
addMacro.run('biomass-fleet-cache-gps','Persist a valid GPS fix observed through standard telemetry.',`
UPDATE biomass_burners SET latitude=CAST(:latitude AS REAL),longitude=CAST(:longitude AS REAL),coordinate_source='gps',
 updated_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE ioid=:burner_id;
SELECT :burner_id ioid WHERE changes()>0;
`);
addMacro.run('biomass-purchased-minutes-set','Set purchased_minutes directly for one burner; no audit is created.',`
UPDATE biomass_device_meter SET purchased_minutes=CAST(:purchased_minutes AS INTEGER)
WHERE ioid=:burner_id AND CAST(:purchased_minutes AS INTEGER) BETWEEN 0 AND 2147483647;
SELECT CASE WHEN changes()>0 THEN 'OK' ELSE 'NOT_FOUND' END status,:burner_id ioid,
 COALESCE((SELECT purchased_minutes FROM biomass_device_meter WHERE ioid=:burner_id),0) purchased_minutes;
`);
addMacro.run('biomass-fuel-lot-create-batch','Create 1-500 six-character fuel-lot codes in one transaction.',`
INSERT OR IGNORE INTO biomass_fuel_batches(batch_id,client_request_id,description,minutes_per_lot,quantity,created_at)
VALUES ('BATCH-'||lower(hex(randomblob(12))),:client_request_id,trim(:description),CAST(:minutes_per_lot AS INTEGER),
 CAST(:quantity AS INTEGER),CAST(strftime('%s','now') AS INTEGER)*1000);
SELECT CASE WHEN b.description=trim(:description) AND b.minutes_per_lot=CAST(:minutes_per_lot AS INTEGER)
 AND b.quantity=CAST(:quantity AS INTEGER) THEN 'OK' ELSE 'REQUEST_CONFLICT' END status,
 l.code,l.description,l.purchased_minutes,l.created_at,l.batch_id
FROM biomass_fuel_batches b JOIN biomass_fuel_lots l ON l.batch_id=b.batch_id
WHERE b.client_request_id=:client_request_id ORDER BY l.code;
`);
addMacro.run('biomass-fuel-lot-list','Paged fuel-lot administration list.',`
WITH input AS (
 SELECT upper(trim(COALESCE(:search,''))) search_text,lower(trim(COALESCE(:status,'all'))) status_filter,
 MAX(1,MIN(100,CAST(COALESCE(NULLIF(:page_size,''),'50') AS INTEGER))) page_size,
 MAX(0,CAST(COALESCE(NULLIF(:offset,''),'0') AS INTEGER)) row_offset
), filtered AS (
 SELECT l.* FROM biomass_fuel_lots l,input i
 WHERE (i.search_text='' OR l.code LIKE '%'||i.search_text||'%' OR upper(l.description) LIKE '%'||i.search_text||'%'
 OR upper(COALESCE(l.redeemed_ioid,'')) LIKE '%'||i.search_text||'%')
 AND (i.status_filter='all' OR (i.status_filter='unused' AND l.redeemed_at IS NULL)
 OR (i.status_filter='redeemed' AND l.redeemed_at IS NOT NULL))
), numbered AS (SELECT filtered.*,COUNT(*) OVER () total_rows FROM filtered)
SELECT * FROM numbered ORDER BY created_at DESC,code LIMIT (SELECT page_size FROM input) OFFSET (SELECT row_offset FROM input);
`);
addMacro.run('biomass-refuel-state','Public refuel-page state scoped by trusted burner_id context.',`
SELECT b.ioid burner_id,b.name,b.location,COALESCE(m.burned_minutes,0) burned_minutes,
 COALESCE(m.purchased_minutes,0) purchased_minutes,
 MAX(COALESCE(m.purchased_minutes,0)-COALESCE(m.burned_minutes,0),0) remaining_minutes
FROM biomass_burners b LEFT JOIN biomass_device_meter m ON m.ioid=b.ioid WHERE b.ioid=:burner_id LIMIT 1;
`);
addMacro.run('biomass-refuel-redeem','Atomically redeem one global fuel-lot code for the trusted burner context.',`
UPDATE biomass_fuel_lots SET redeemed_at=CAST(strftime('%s','now') AS INTEGER)*1000,
 redeemed_ioid=:burner_id,redeemed_request_id=:client_request_id
WHERE code=upper(trim(:lot_code)) AND redeemed_at IS NULL
 AND upper(trim(:lot_code)) NOT GLOB '*[^A-Z0-9]*' AND length(upper(trim(:lot_code)))=6
 AND EXISTS (SELECT 1 FROM biomass_burners WHERE ioid=:burner_id)
 AND EXISTS (SELECT 1 FROM biomass_device_meter m WHERE m.ioid=:burner_id
   AND m.purchased_minutes<=2147483647-biomass_fuel_lots.purchased_minutes);
UPDATE biomass_device_meter SET purchased_minutes=purchased_minutes+(
 SELECT purchased_minutes FROM biomass_fuel_lots WHERE code=upper(trim(:lot_code)) AND redeemed_ioid=:burner_id
 AND redeemed_request_id=:client_request_id AND credited_at IS NULL)
WHERE ioid=:burner_id AND EXISTS (SELECT 1 FROM biomass_fuel_lots WHERE code=upper(trim(:lot_code))
 AND redeemed_ioid=:burner_id AND redeemed_request_id=:client_request_id AND credited_at IS NULL);
UPDATE biomass_fuel_lots SET credited_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE code=upper(trim(:lot_code)) AND redeemed_ioid=:burner_id
 AND redeemed_request_id=:client_request_id AND credited_at IS NULL;
SELECT CASE
 WHEN length(upper(trim(:lot_code)))<>6 OR upper(trim(:lot_code)) GLOB '*[^A-Z0-9]*' THEN 'INVALID'
 WHEN NOT EXISTS (SELECT 1 FROM biomass_fuel_lots WHERE code=upper(trim(:lot_code))) THEN 'NOT_FOUND'
 WHEN EXISTS (SELECT 1 FROM biomass_fuel_lots WHERE code=upper(trim(:lot_code)) AND redeemed_ioid=:burner_id
  AND redeemed_request_id=:client_request_id AND credited_at IS NOT NULL) THEN 'OK'
 WHEN EXISTS (SELECT 1 FROM biomass_fuel_lots WHERE code=upper(trim(:lot_code)) AND redeemed_at IS NOT NULL) THEN 'ALREADY_USED'
 ELSE 'CREDIT_LIMIT' END status,
 COALESCE((SELECT purchased_minutes FROM biomass_fuel_lots WHERE code=upper(trim(:lot_code))
  AND redeemed_ioid=:burner_id AND redeemed_request_id=:client_request_id),0) added_minutes,
 COALESCE((SELECT purchased_minutes FROM biomass_device_meter WHERE ioid=:burner_id),0) purchased_minutes;
`);
addMacro.run('biomass-setting-audit','Record the result of a standard system_cmds setting request.',`
INSERT INTO biomass_setting_audit(ioid,setting_key,requested_value,state,actor,created_at)
VALUES (:burner_id,:setting_key,CAST(:value AS INTEGER),:state,COALESCE(:email,''),CAST(strftime('%s','now') AS INTEGER)*1000);
SELECT last_insert_rowid() id;
`);
addMacro.run('IO-biomass-meter','Shared fleet meter: c1=IOID,c2=burned,c3=mode; response c1=status,c2=purchased.',`
UPDATE biomass_device_meter SET burned_minutes=MAX(burned_minutes,CAST(:c2 AS INTEGER)),mode=CAST(:c3 AS INTEGER),
 reported_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE ioid=trim(:c1) AND trim(COALESCE(:c2,''))<>'' AND trim(:c2) NOT GLOB '*[^0-9]*'
 AND trim(COALESCE(:c3,'')) IN ('0','1','2','3','4','5');
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM biomass_burners WHERE ioid=trim(:c1)) THEN 'UNKNOWN_DEVICE'
 WHEN trim(COALESCE(:c2,''))='' OR trim(:c2) GLOB '*[^0-9]*'
  OR trim(COALESCE(:c3,'')) NOT IN ('0','1','2','3','4','5') THEN 'INVALID'
 WHEN CAST(:c2 AS INTEGER)<(SELECT burned_minutes FROM biomass_device_meter WHERE ioid=trim(:c1)) THEN 'METER_REGRESSION'
 ELSE 'OK' END c1,COALESCE((SELECT purchased_minutes FROM biomass_device_meter WHERE ioid=trim(:c1)),0) c2;
`);
addMacro.run('IO-biomass-gps','Cache valid GPS via standard data; c1=IOID,c2=lat,c3=lng.',`
UPDATE biomass_burners SET latitude=CAST(:c2 AS REAL),longitude=CAST(:c3 AS REAL),coordinate_source='gps',
 updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE ioid=trim(:c1) AND trim(COALESCE(:c2,''))<>'' AND trim(COALESCE(:c3,''))<>''
 AND CAST(:c2 AS REAL) BETWEEN -90 AND 90 AND CAST(:c3 AS REAL) BETWEEN -180 AND 180
 AND NOT (CAST(:c2 AS REAL)=0 AND CAST(:c3 AS REAL)=0);
SELECT CASE WHEN changes()>0 THEN 'OK' ELSE 'IGNORED' END c1;
`);

// Compact-v2 production telemetry is a dense c1..c20 contract without fan or temperature slots.
const telemetryFields=Array.from({length:20},(_,index)=>`c${index+1}`);
const readMacros={
 'biomass-fleet-summary':{params:{}},
 'biomass-fleet-list':{params:{search:{type:'string',maxLength:100},page_size:{type:'integer',min:1,max:100},offset:{type:'integer',min:0,max:1000000}}},
 'biomass-fleet-map':{params:{}},
 'biomass-fleet-device':{params:{burner_id:{type:'string',required:true,pattern:'^[A-Za-z0-9._-]{3,64}$'}}}
};
const writeMacros={
 'biomass-fleet-create':{params:{burner_id:{type:'string',required:true,pattern:'^[A-Za-z0-9._-]{3,64}$'},name:{type:'string',maxLength:120},location:{type:'string',maxLength:240},latitude:{type:'number',min:-90,max:90},longitude:{type:'number',min:-180,max:180}}},
 'biomass-fleet-update':{params:{burner_id:{type:'string',required:true,pattern:'^[A-Za-z0-9._-]{3,64}$'},name:{type:'string',maxLength:120},location:{type:'string',maxLength:240},latitude:{type:'number',min:-90,max:90},longitude:{type:'number',min:-180,max:180}}},
 'biomass-fleet-delete':{params:{burner_id:{type:'string',required:true,pattern:'^[A-Za-z0-9._-]{3,64}$'}}},
 'biomass-fleet-cache-gps':{params:{burner_id:{type:'string',required:true,pattern:'^[A-Za-z0-9._-]{3,64}$'},latitude:{type:'number',required:true,min:-90,max:90},longitude:{type:'number',required:true,min:-180,max:180}}},
 'biomass-purchased-minutes-set':{params:{burner_id:{type:'string',required:true,pattern:'^[A-Za-z0-9._-]{3,64}$'},purchased_minutes:{type:'integer',required:true,min:0,max:2147483647}}},
 'biomass-fuel-lot-create-batch':{params:{client_request_id:{type:'string',required:true,maxLength:80,pattern:'^[A-Za-z0-9._:-]{12,80}$'},description:{type:'string',required:true,minLength:1,maxLength:120},minutes_per_lot:{type:'integer',required:true,min:1,max:1000000},quantity:{type:'integer',required:true,min:1,max:500}}},
 'biomass-fuel-lot-list':{params:{search:{type:'string',maxLength:120},status:{type:'string',enum:['all','unused','redeemed']},page_size:{type:'integer',min:1,max:100},offset:{type:'integer',min:0,max:1000000}}},
 'biomass-setting-audit':{params:{burner_id:{type:'string',required:true,pattern:'^[A-Za-z0-9._-]{3,64}$'},setting_key:{type:'string',required:true,enum:['1005','1006','1007','1008','1009','1010','1011','1012','1013','1014','1015','1016','1017','1018']},value:{type:'integer',required:true,min:0,max:3600},state:{type:'string',required:true,enum:['confirmed','failed']}}}
};
const pageHtml='<!doctype html><html lang="vi"><meta charset="utf-8"><title>Biomass compact-v2</title><main>Biomass compact-v2</main></html>';
const addPage=db.prepare(`INSERT INTO system_pages(page_id,html,require_email,require_phone,sync_id,enabled,title,meta) VALUES (?,?,?,0,'<<syncid>>',1,?,?)`);
addPage.run('biomass-status',pageHtml,0,'Biomass status',JSON.stringify({publicApi:{fields:telemetryFields,stream:true}}));
addPage.run('biomass-fleet-view',pageHtml,0,'Biomass fleet view',JSON.stringify({publicApi:{macros:readMacros,rateLimit:{limit:300,windowMs:60000}}}));
addPage.run('biomass-fleet-admin',pageHtml,1,'Biomass fleet admin',JSON.stringify({publicApi:{macros:writeMacros,rateLimit:{limit:120,windowMs:60000}}}));
const template=db.prepare('SELECT html,meta_template FROM biomass_page_templates WHERE page_type=?').get('refuel');
addPage.run(initialRefuelPageId,template.html,0,'Nạp nhiên liệu IO2729MB1',template.meta_template.replace('__BURNER_ID__','IO2729MB1'));

const settingDefs=[
 {key:'1005',schema:{type:'integer',required:true,min:30,max:180}},{key:'1006',schema:{type:'integer',required:true,min:0,max:30}},
 {key:'1007',schema:{type:'integer',required:true,min:20,max:100}},{key:'1008',schema:{type:'integer',required:true,min:20,max:100}},
 {key:'1009',schema:{type:'integer',required:true,min:20,max:100}},{key:'1010',schema:{type:'integer',required:true,min:0,max:100}},
 {key:'1011',schema:{type:'integer',required:true,min:20,max:100}},{key:'1012',schema:{type:'integer',required:true,min:20,max:100}},
 {key:'1013',schema:{type:'integer',required:true,min:20,max:100}},{key:'1014',schema:{type:'integer',required:true,min:20,max:100}},
 {key:'1015',schema:{type:'integer',required:true,min:20,max:100}},{key:'1016',schema:{type:'integer',required:true,min:60,max:3600}},
 {key:'1017',schema:{type:'integer',required:true,min:0,max:100}},{key:'1018',schema:{type:'integer',required:true,min:0,max:100}}
];
const addCommand=db.prepare(`INSERT INTO system_cmds(cmd_id,command_template,require_email,require_phone,sync_id,params_schema,enabled) VALUES (?,?,1,0,'<<syncid>>',?,1)`);
for(const {key,schema} of settingDefs)addCommand.run(`biomass-set-${key}`,`D4#${key},<<value>>D5N20`,JSON.stringify({value:schema}));
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log(output);
