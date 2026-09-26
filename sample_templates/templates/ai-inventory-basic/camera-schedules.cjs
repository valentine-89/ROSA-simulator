'use strict';
const automaticPages = `
INSERT INTO system_pages(page_id,html,require_email,require_phone,sync_id,enabled,title,meta)
 SELECT 'warehouse-auto-'||c.camera_id,p.html,0,1,c.sync_id,CASE WHEN c.enabled=1 AND s.mode<>'off' THEN 1 ELSE 0 END,c.area_name,
 json_object('hideLink',json('true'),'publicApi',json_patch(json_object(
   'context',json_object('camera_id',c.camera_id),
   'commandTarget',json_object('type','ai-count','cameraParam','camera_id','callbackMacro','warehouse-ai-count-result'),
   'allowedCommands',json_array('warehouse-auto-count-'||c.camera_id),
   'backendCommands',json_object('warehouse-auto-count-'||c.camera_id,json_array(s.backend_name))),
   CASE WHEN s.mode='window' THEN json_object('backendWindow',json_object('offsetMinutes',420,'startHour',s.start_hour,'endHour',s.end_hour)) ELSE json('{}') END))
 FROM system_ai_cameras c JOIN warehouse_camera_schedules s USING(camera_id) JOIN system_pages p ON p.page_id='warehouse'
 WHERE c.camera_id=NEW.camera_id
 ON CONFLICT(page_id) DO UPDATE SET html=excluded.html,sync_id=excluded.sync_id,enabled=excluded.enabled,title=excluded.title,meta=excluded.meta;
INSERT INTO system_cmds(cmd_id,command_template,require_email,require_phone,sync_id,enabled,page_only,params_schema)
 SELECT 'warehouse-auto-count-'||c.camera_id,'ai-count',0,1,c.sync_id,CASE WHEN c.enabled=1 AND s.mode<>'off' THEN 1 ELSE 0 END,1,
 json_object('camera_id',json_object('type','string','required',json('true'),'enum',json_array(c.camera_id)),
   'request_id',json_object('type','string','required',json('true'),'maxLength',36,'pattern','^[0-9a-fA-F-]{36}$'))
 FROM system_ai_cameras c JOIN warehouse_camera_schedules s USING(camera_id) WHERE c.camera_id=NEW.camera_id
 ON CONFLICT(cmd_id) DO UPDATE SET sync_id=excluded.sync_id,enabled=excluded.enabled,params_schema=excluded.params_schema;`;

function install(db) {
  return db.transaction(()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS warehouse_camera_schedules(
      camera_id TEXT PRIMARY KEY,backend_name TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL DEFAULT 'off' CHECK(mode IN ('off','all','window')),
      start_hour INTEGER NOT NULL DEFAULT 6 CHECK(start_hour BETWEEN 0 AND 23),
      end_hour INTEGER NOT NULL DEFAULT 18 CHECK(end_hour BETWEEN 0 AND 24),revision INTEGER NOT NULL DEFAULT 0);
      CREATE TRIGGER IF NOT EXISTS warehouse_schedule_new_camera AFTER INSERT ON system_ai_cameras BEGIN
        INSERT OR IGNORE INTO warehouse_camera_schedules(camera_id,backend_name) VALUES(NEW.camera_id,'warehouse-auto-'||lower(hex(randomblob(12)))); END;
      CREATE TRIGGER IF NOT EXISTS warehouse_schedule_camera_changed AFTER UPDATE ON system_ai_cameras BEGIN
        UPDATE warehouse_camera_schedules SET camera_id=camera_id WHERE camera_id=NEW.camera_id; END;
      CREATE TRIGGER IF NOT EXISTS warehouse_schedule_insert AFTER INSERT ON warehouse_camera_schedules BEGIN ${automaticPages} END;
      CREATE TRIGGER IF NOT EXISTS warehouse_schedule_update AFTER UPDATE ON warehouse_camera_schedules BEGIN ${automaticPages} END;
      INSERT OR IGNORE INTO warehouse_camera_schedules(camera_id,backend_name)
        SELECT camera_id,'warehouse-auto-'||lower(hex(randomblob(12))) FROM system_ai_cameras;`);
    const write=db.prepare('INSERT INTO system_macros(name,source,enabled) VALUES(?,?,1) ON CONFLICT(name) DO UPDATE SET source=excluded.source,enabled=1');
    write.run('warehouse-schedule-get',`SELECT s.*,c.enabled,'warehouse-auto-'||c.camera_id page_id,'warehouse-auto-count-'||c.camera_id command_id
      FROM warehouse_camera_schedules s JOIN system_ai_cameras c USING(camera_id) WHERE c.camera_id=:camera_id AND c.sync_id=:sync_id;`);
    write.run('warehouse-schedule-save',`DROP TABLE IF EXISTS temp._schedule_guard;
      CREATE TEMP TABLE _schedule_guard(valid INTEGER NOT NULL CHECK(valid=1));
      INSERT INTO _schedule_guard SELECT CASE WHEN :mode IN ('off','all','window')
        AND CAST(:start_hour AS INTEGER) BETWEEN 0 AND 23 AND CAST(:end_hour AS INTEGER) BETWEEN 0 AND 24
        AND (:mode<>'window' OR CAST(:start_hour AS INTEGER)<>CAST(:end_hour AS INTEGER))
        AND EXISTS(SELECT 1 FROM warehouse_camera_schedules s JOIN system_ai_cameras c USING(camera_id)
          WHERE c.camera_id=:camera_id AND c.sync_id=:sync_id AND s.revision=CAST(:expected_revision AS INTEGER)) THEN 1 ELSE 0 END;
      UPDATE warehouse_camera_schedules SET mode=:mode,start_hour=CAST(:start_hour AS INTEGER),end_hour=CAST(:end_hour AS INTEGER),revision=revision+1
        WHERE camera_id=:camera_id; DROP TABLE _schedule_guard;
      SELECT revision FROM warehouse_camera_schedules WHERE camera_id=:camera_id;`);
    return {cameras:db.prepare('SELECT COUNT(*) n FROM warehouse_camera_schedules').get().n};
  }).immediate();
}
module.exports={install};
