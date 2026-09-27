'use strict';
const pages=`
INSERT INTO system_pages(page_id,html,require_email,require_phone,sync_id,enabled,title,meta)
 SELECT 'warehouse-motion-'||c.camera_id,p.html,0,1,c.sync_id,c.enabled*e.enabled,c.area_name,
 json_object('hideLink',json('true'),'publicApi',json_object(
   'context',json_object('camera_id',c.camera_id),
   'commandTarget',json_object('type','ai-count','cameraParam','camera_id','callbackMacro','warehouse-ai-count-result','queueLatest',json('true'),'queueSeconds',300),
   'allowedCommands',json_array('warehouse-motion-count-'||c.camera_id),
   'backendCommands',json_object('warehouse-motion-count-'||c.camera_id,json_array(e.backend_name))))
 FROM system_ai_cameras c JOIN warehouse_camera_events e USING(camera_id) JOIN system_pages p ON p.page_id='warehouse'
 WHERE c.camera_id=NEW.camera_id
 ON CONFLICT(page_id) DO UPDATE SET html=excluded.html,sync_id=excluded.sync_id,enabled=excluded.enabled,title=excluded.title,meta=excluded.meta;
INSERT INTO system_cmds(cmd_id,command_template,require_email,require_phone,sync_id,enabled,page_only,params_schema)
 SELECT 'warehouse-motion-count-'||c.camera_id,'ai-count',0,1,c.sync_id,c.enabled*e.enabled,1,
 json_object('camera_id',json_object('type','string','required',json('true'),'enum',json_array(c.camera_id)),
 'request_id',json_object('type','string','required',json('true'),'maxLength',36,'pattern','^[0-9a-fA-F-]{36}$'))
 FROM system_ai_cameras c JOIN warehouse_camera_events e USING(camera_id) WHERE c.camera_id=NEW.camera_id
 ON CONFLICT(cmd_id) DO UPDATE SET sync_id=excluded.sync_id,enabled=excluded.enabled,params_schema=excluded.params_schema;`;
function install(db) {
  return db.transaction(()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS warehouse_camera_events(camera_id TEXT PRIMARY KEY,backend_name TEXT NOT NULL UNIQUE,
      vision_camera_id TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)));
      CREATE TRIGGER IF NOT EXISTS warehouse_motion_new AFTER INSERT ON system_ai_cameras BEGIN
        INSERT OR IGNORE INTO warehouse_camera_events(camera_id,backend_name) VALUES(NEW.camera_id,'warehouse-motion-'||lower(hex(randomblob(12)))); END;
      CREATE TRIGGER IF NOT EXISTS warehouse_motion_camera_changed AFTER UPDATE ON system_ai_cameras BEGIN
        UPDATE warehouse_camera_events SET enabled=CASE WHEN NEW.api_key<>OLD.api_key THEN 0 ELSE enabled END WHERE camera_id=NEW.camera_id; END;
      CREATE TRIGGER IF NOT EXISTS warehouse_motion_insert AFTER INSERT ON warehouse_camera_events BEGIN ${pages} END;
      CREATE TRIGGER IF NOT EXISTS warehouse_motion_update AFTER UPDATE ON warehouse_camera_events BEGIN ${pages} END;
      INSERT OR IGNORE INTO warehouse_camera_events(camera_id,backend_name) SELECT camera_id,'warehouse-motion-'||lower(hex(randomblob(12))) FROM system_ai_cameras;`);
    const write=db.prepare('INSERT INTO system_macros(name,source,enabled) VALUES(?,?,1) ON CONFLICT(name) DO UPDATE SET source=excluded.source,enabled=1');
    write.run('warehouse-motion-get',`SELECT e.*,c.enabled camera_enabled,'warehouse-motion-'||c.camera_id page_id,
      'warehouse-motion-count-'||c.camera_id command_id FROM warehouse_camera_events e JOIN system_ai_cameras c USING(camera_id)
      WHERE c.camera_id=:camera_id AND c.sync_id=:sync_id;`);
    write.run('warehouse-motion-save',`UPDATE warehouse_camera_events SET enabled=CASE WHEN :enabled='1' THEN 1 ELSE 0 END,vision_camera_id=:vision_camera_id
      WHERE camera_id=:camera_id AND EXISTS(SELECT 1 FROM system_ai_cameras c WHERE c.camera_id=:camera_id AND c.sync_id=:sync_id);
      SELECT enabled FROM warehouse_camera_events WHERE camera_id=:camera_id;`);
  }).immediate();
}
module.exports={install};
