const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// Reuse the IoT page/command tables. The disabled base page supplies the HTML.
// This fragment is also used by the upgrade without editing camera revisions.
const cameraPageStatements = [
  `INSERT INTO system_pages(page_id,html,require_email,require_phone,sync_id,enabled,title,meta)
    SELECT 'warehouse-'||c.camera_id,p.html,1,0,c.sync_id,c.enabled,c.area_name,
      json_object('hideLink',json('true'),'publicApi',json_object('stream',json('false'),
        'context',json_object('camera_id',c.camera_id),
        'commandTarget',json_object('type','ai-count','cameraParam','camera_id'),
        'allowedCommands',json_array('warehouse-count-'||c.camera_id),
        'macros',json_object('warehouse-camera',json('{}'),'warehouse-latest',json('{}'))))
    FROM system_ai_cameras c JOIN system_pages p ON p.page_id='warehouse'
    WHERE c.camera_id=:camera_id AND c.sync_id=:sync_id
    ON CONFLICT(page_id) DO UPDATE SET html=excluded.html,require_email=1,require_phone=0,
      sync_id=excluded.sync_id,enabled=excluded.enabled,title=excluded.title,meta=excluded.meta;`,
  `INSERT INTO system_cmds(cmd_id,command_template,require_email,require_phone,sync_id,enabled,page_only,params_schema)
    SELECT 'warehouse-count-'||camera_id,'ai-count',1,0,sync_id,enabled,1,
      json_object('camera_id',json_object('type','string','required',json('true'),'enum',json_array(camera_id)),
        'request_id',json_object('type','string','required',json('true'),'maxLength',36,'pattern','^[0-9a-fA-F-]{36}$'))
    FROM system_ai_cameras WHERE camera_id=:camera_id AND sync_id=:sync_id
    ON CONFLICT(cmd_id) DO UPDATE SET command_template=excluded.command_template,require_email=1,require_phone=0,
      sync_id=excluded.sync_id,enabled=excluded.enabled,page_only=1,params_schema=excluded.params_schema;`
];

function build(file = path.join(__dirname, 'sample.sqlite')) {
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const db = new Database(file);
  db.exec(`
    CREATE TABLE system_pages(page_id TEXT PRIMARY KEY,html TEXT NOT NULL,require_email INTEGER DEFAULT 1,require_phone INTEGER DEFAULT 0,sync_id TEXT NOT NULL,enabled INTEGER DEFAULT 1,title TEXT,meta TEXT);
    CREATE TABLE system_cmds(cmd_id TEXT PRIMARY KEY,command_template TEXT NOT NULL,require_email INTEGER DEFAULT 1,require_phone INTEGER DEFAULT 0,sync_id TEXT NOT NULL,params_schema TEXT,enabled INTEGER DEFAULT 1,page_only INTEGER DEFAULT 1);
    CREATE TABLE system_macros(name TEXT PRIMARY KEY,comment TEXT DEFAULT '',source TEXT NOT NULL,enabled INTEGER DEFAULT 1);
    CREATE TABLE system_service_macros(name TEXT PRIMARY KEY,service TEXT NOT NULL);
    CREATE TABLE system_ai_cameras(camera_id TEXT PRIMARY KEY,area_name TEXT NOT NULL,api_key TEXT NOT NULL,sync_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1,product_map TEXT NOT NULL,callback_macro TEXT NOT NULL DEFAULT 'warehouse-ai-count-result');
    CREATE UNIQUE INDEX camera_key_unique ON system_ai_cameras(api_key) WHERE api_key<>'';
    CREATE TABLE warehouse_events(request_id TEXT PRIMARY KEY,camera_id TEXT NOT NULL,revision INTEGER NOT NULL,area_name TEXT,actor TEXT,requested_at INTEGER,captured_at TEXT,status TEXT NOT NULL,image_url TEXT,cost REAL,error TEXT,result_json TEXT NOT NULL);
    CREATE INDEX warehouse_camera_history ON warehouse_events(camera_id,requested_at DESC);
    CREATE TABLE warehouse_items(request_id TEXT NOT NULL,sku TEXT NOT NULL,name TEXT NOT NULL,quantity INTEGER NOT NULL,delta INTEGER,PRIMARY KEY(request_id,sku));
  `);
  const macro = (name, source) => db.prepare('INSERT INTO system_macros(name,source) VALUES (?,?)').run(name, source.trim());
  macro('warehouse-cameras-admin', `SELECT camera_id,area_name,enabled,revision,product_map,CASE WHEN api_key<>'' THEN 1 ELSE 0 END AS has_key FROM system_ai_cameras WHERE sync_id=:sync_id ORDER BY rowid;`);
  macro('warehouse-camera-save', `
    DROP TABLE IF EXISTS temp._camera_guard;
    CREATE TEMP TABLE _camera_guard(valid INTEGER NOT NULL CHECK(valid=1));
    INSERT INTO _camera_guard SELECT CASE WHEN length(:camera_id) BETWEEN 1 AND 96 AND :camera_id NOT GLOB '*[^A-Za-z0-9._-]*'
      AND length(trim(:area_name)) BETWEEN 1 AND 120 AND length(COALESCE(:api_key,''))<=512
      AND (length(trim(COALESCE(:api_key,'')))>0 OR EXISTS(SELECT 1 FROM system_ai_cameras WHERE camera_id=:camera_id AND sync_id=:sync_id))
      AND NOT EXISTS(SELECT 1 FROM system_ai_cameras WHERE camera_id=:camera_id AND sync_id<>:sync_id)
      AND json_valid(:product_map) AND json_type(:product_map)='array' AND json_array_length(:product_map) BETWEEN 1 AND 100
      AND NOT EXISTS(SELECT 1 FROM json_each(:product_map) WHERE json_type(value,'$.code') IS NOT 'text' OR length(trim(json_extract(value,'$.code'))) NOT BETWEEN 1 AND 160
        OR json_type(value,'$.sku') IS NOT 'text' OR length(trim(json_extract(value,'$.sku'))) NOT BETWEEN 1 AND 96
        OR json_type(value,'$.name') IS NOT 'text' OR length(trim(json_extract(value,'$.name'))) NOT BETWEEN 1 AND 160)
      AND (SELECT count(DISTINCT json_extract(value,'$.code')) FROM json_each(:product_map))=json_array_length(:product_map)
      AND (SELECT count(DISTINCT json_extract(value,'$.sku')) FROM json_each(:product_map))=json_array_length(:product_map)
      THEN 1 ELSE 0 END;
    INSERT INTO system_ai_cameras(camera_id,area_name,api_key,sync_id,enabled,product_map)
      VALUES(:camera_id,trim(:area_name),trim(COALESCE(:api_key,'')),:sync_id,CASE WHEN :enabled='0' THEN 0 ELSE 1 END,:product_map)
      ON CONFLICT(camera_id) DO UPDATE SET area_name=excluded.area_name,api_key=CASE WHEN excluded.api_key='' THEN api_key ELSE excluded.api_key END,
      enabled=excluded.enabled,product_map=excluded.product_map,revision=revision+1;
    DROP TABLE _camera_guard;
    ${cameraPageStatements.join('\n')}
    SELECT camera_id,area_name FROM system_ai_cameras WHERE camera_id=:camera_id AND sync_id=:sync_id;
  `);
  macro('warehouse-cameras', `SELECT camera_id,area_name FROM system_ai_cameras WHERE sync_id=:sync_id AND enabled=1 ORDER BY rowid;`);
  macro('warehouse-camera', `SELECT camera_id,area_name FROM system_ai_cameras WHERE sync_id=:sync_id AND enabled=1 AND camera_id=:camera_id;`);
  macro('warehouse-stock', `WITH areas AS (
    SELECT c.camera_id,c.product_map,(SELECT e.request_id FROM warehouse_events e
      WHERE e.camera_id=c.camera_id AND e.status='applied' AND e.revision=c.revision
      ORDER BY e.requested_at DESC LIMIT 1) AS latest_id
    FROM system_ai_cameras c WHERE c.sync_id=:sync_id AND c.enabled=1
  ), products AS (
    SELECT a.camera_id,a.latest_id,json_extract(m.value,'$.sku') AS sku,json_extract(m.value,'$.name') AS name
    FROM areas a,json_each(a.product_map) m
  ) SELECT p.sku,min(p.name) AS name,sum(i.quantity) AS quantity,count(*) AS areas,count(i.quantity) AS counted_areas
    FROM products p LEFT JOIN warehouse_items i ON i.request_id=p.latest_id AND i.sku=p.sku
    GROUP BY p.sku ORDER BY name,p.sku;`);
  macro('warehouse-latest', `SELECT e.request_id,e.captured_at,e.image_url,e.requested_at,
    (SELECT json_group_array(json_object('sku',i.sku,'name',i.name,'quantity',i.quantity,'delta',i.delta)) FROM warehouse_items i WHERE i.request_id=e.request_id) AS items
    FROM warehouse_events e JOIN system_ai_cameras c ON c.camera_id=e.camera_id
    WHERE c.sync_id=:sync_id AND c.enabled=1 AND e.camera_id=:camera_id AND e.status='applied' ORDER BY e.requested_at DESC LIMIT 1;`);
  macro('warehouse-history', `SELECT e.request_id,e.captured_at,e.requested_at,e.status,e.actor,e.image_url,e.error,
    (SELECT sum(quantity) FROM warehouse_items WHERE request_id=e.request_id) AS quantity,
    (SELECT sum(delta) FROM warehouse_items WHERE request_id=e.request_id) AS delta
    FROM warehouse_events e JOIN system_ai_cameras c ON c.camera_id=e.camera_id
    WHERE c.sync_id=:sync_id AND c.enabled=1 AND e.camera_id=:camera_id
    ORDER BY e.requested_at DESC LIMIT 30 OFFSET max(0,CAST(COALESCE(:offset,0) AS INTEGER));`);
  macro('warehouse-event', `SELECT e.request_id,e.captured_at,e.image_url,e.status,e.error,e.actor,
    (SELECT json_group_array(json_object('sku',i.sku,'name',i.name,'quantity',i.quantity,'delta',i.delta)) FROM warehouse_items i WHERE i.request_id=e.request_id) AS items
    FROM warehouse_events e JOIN system_ai_cameras c ON c.camera_id=e.camera_id
    WHERE c.sync_id=:sync_id AND c.enabled=1 AND e.camera_id=:camera_id AND e.request_id=:request_id;`);
  macro('warehouse-ai-count-result', `
    INSERT OR IGNORE INTO warehouse_events(request_id,camera_id,revision,area_name,actor,requested_at,captured_at,status,image_url,cost,error,result_json)
    SELECT :request_id,:camera_id,CAST(:camera_revision AS INTEGER),:area_name,:actor,CAST(:requested_at AS INTEGER),json_extract(:result,'$.captured_at'),
      CASE WHEN c.revision<>CAST(:camera_revision AS INTEGER) OR c.enabled<>1 THEN 'stale'
        WHEN json_extract(:result,'$.status')<>'succeeded' THEN json_extract(:result,'$.status')
        WHEN json_extract(:result,'$.image_saved')=0 THEN 'needs_review'
        WHEN EXISTS(SELECT 1 FROM json_each(:result,'$.items') item WHERE NOT EXISTS(
          SELECT 1 FROM json_each(:mapping) m WHERE json_extract(m.value,'$.code')=json_extract(item.value,'$.code'))) THEN 'needs_review'
        WHEN EXISTS(SELECT 1 FROM warehouse_events WHERE camera_id=:camera_id AND status='applied' AND requested_at>CAST(:requested_at AS INTEGER)) THEN 'stale'
        ELSE 'applied' END,
      json_extract(:result,'$.image_url'),json_extract(:result,'$.cost'),json_extract(:result,'$.error'),:result
    FROM system_ai_cameras c WHERE c.camera_id=:camera_id AND c.sync_id=:sync_id;
    INSERT OR IGNORE INTO warehouse_items(request_id,sku,name,quantity,delta)
    SELECT :request_id,json_extract(m.value,'$.sku'),json_extract(m.value,'$.name'),
      COALESCE((SELECT sum(json_extract(i.value,'$.quantity')) FROM json_each(:result,'$.items') i WHERE json_extract(i.value,'$.code')=json_extract(m.value,'$.code')),0),
      COALESCE((SELECT sum(json_extract(i.value,'$.quantity')) FROM json_each(:result,'$.items') i WHERE json_extract(i.value,'$.code')=json_extract(m.value,'$.code')),0)
        - (SELECT i.quantity FROM warehouse_items i JOIN warehouse_events e ON e.request_id=i.request_id
           WHERE e.camera_id=:camera_id AND e.revision=CAST(:camera_revision AS INTEGER) AND e.status='applied' AND e.requested_at<CAST(:requested_at AS INTEGER)
           AND i.sku=json_extract(m.value,'$.sku') ORDER BY e.requested_at DESC LIMIT 1)
    FROM json_each(:mapping) m WHERE EXISTS(SELECT 1 FROM warehouse_events WHERE request_id=:request_id AND status='applied');
    SELECT request_id,status FROM warehouse_events WHERE request_id=:request_id;
  `);
  db.prepare('INSERT INTO system_service_macros VALUES (?,?)').run('warehouse-ai-count-result', 'ai-count');
  for (const name of ['warehouse-latest','warehouse-history','warehouse-event']) {
    macro(name+'-admin',db.prepare('SELECT source FROM system_macros WHERE name=?').get(name).source.replace(' AND c.enabled=1',''));
  }
  const cameraParam = { type: 'string', required: true, maxLength: 96, pattern: '^[A-Za-z0-9._-]+$' };
  const meta = { hideLink: true, publicApi: { stream: false, commandTarget: { type: 'ai-count', cameraParam: 'camera_id' },
    allowedCommands: ['warehouse-count'], macros: {
      'warehouse-cameras': {}, 'warehouse-latest': { params: { camera_id: cameraParam } },
      'warehouse-history': { params: { camera_id: cameraParam, offset: { type: 'number', min: 0, max: 1000000 } } },
      'warehouse-event': { params: { camera_id: cameraParam, request_id: { type: 'string', required: true, maxLength: 36 } } }
    } } };
  db.prepare('INSERT INTO system_pages(page_id,html,sync_id,title,meta) VALUES (?,?,?,?,?)').run('warehouse', fs.readFileSync(path.join(__dirname, 'warehouse_page.html'),'utf8'), '<<syncid>>', 'Kho AI', JSON.stringify(meta));
  db.prepare('INSERT INTO system_cmds(cmd_id,command_template,sync_id,params_schema) VALUES (?,?,?,?)').run('warehouse-count','ai-count','<<syncid>>',JSON.stringify({camera_id:cameraParam,request_id:{type:'string',required:true,maxLength:36,pattern:'^[0-9a-fA-F-]{36}$'}}));
  db.prepare("UPDATE system_pages SET enabled=0 WHERE page_id='warehouse'").run();
  db.prepare("UPDATE system_cmds SET enabled=0 WHERE cmd_id='warehouse-count'").run();
  if(db.pragma('integrity_check',{simple:true})!=='ok') throw new Error('Invalid sample database');
  db.close();
}
if (require.main === module) build(process.argv[2]);
module.exports = { build, cameraPageStatements };
