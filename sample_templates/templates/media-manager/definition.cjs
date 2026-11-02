'use strict';
const fs = require('node:fs');
const path = require('node:path');

const schema = `
CREATE TABLE system_macros(name TEXT PRIMARY KEY,comment TEXT,source TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE system_pages(page_id TEXT PRIMARY KEY,html TEXT NOT NULL,require_email INTEGER NOT NULL DEFAULT 0,require_phone INTEGER NOT NULL DEFAULT 0,sync_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,title TEXT NOT NULL DEFAULT '',meta TEXT NOT NULL DEFAULT '');
CREATE TABLE system_cmds(cmd_id TEXT PRIMARY KEY,command_template TEXT NOT NULL,require_email INTEGER NOT NULL DEFAULT 0,require_phone INTEGER NOT NULL DEFAULT 0,sync_id TEXT NOT NULL,params_schema TEXT,enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE media_screen_templates(role TEXT PRIMARY KEY,html TEXT NOT NULL);
CREATE TABLE media_screens(
 screen_id TEXT PRIMARY KEY CHECK(length(screen_id)=32 AND screen_id NOT GLOB '*[^a-f0-9]*'),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
 prefix TEXT NOT NULL COLLATE NOCASE CHECK(length(prefix)<=48 AND prefix NOT GLOB '*[^A-Za-z0-9_-]*'),
 default_signal TEXT NOT NULL CHECK(length(default_signal) BETWEEN 1 AND 2000),
 allowed_macros TEXT NOT NULL CHECK(json_valid(allowed_macros) AND json_type(allowed_macros)='array'),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 display_login INTEGER NOT NULL CHECK(display_login IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at INTEGER NOT NULL
);
CREATE TABLE media_screen_guard(ok INTEGER NOT NULL CHECK(ok=1));
`;
const field = `CASE WHEN prefix='' THEN 'media' ELSE prefix||'_media' END`;
const displayId = `'media-display-'||screen_id`;
const controlId = `'media-control-'||screen_id`;
const guard = expression => `INSERT INTO media_screen_guard SELECT (${expression}); DELETE FROM media_screen_guard;`;
const ownership = `NOT EXISTS(SELECT 1 FROM system_pages p WHERE p.page_id IN ('media-display-'||:screen_id,'media-control-'||:screen_id) AND (NOT EXISTS(SELECT 1 FROM media_screens WHERE screen_id=:screen_id) OR COALESCE(json_extract(p.meta,'$.mediaScreen.id'),'')<>:screen_id))`;
const revision = `(CAST(:revision AS INTEGER)=0 AND NOT EXISTS(SELECT 1 FROM media_screens WHERE screen_id=:screen_id)) OR EXISTS(SELECT 1 FROM media_screens WHERE screen_id=:screen_id AND revision=CAST(:revision AS INTEGER))`;
const select = `SELECT *,${field} AS field,${displayId} AS display_page_id,${controlId} AS control_page_id FROM media_screens`;
const meta = role => `json_object('editorMode','raw','mediaScreen',json_object('id',screen_id,'role','${role}','name',name,'prefix',prefix,'field','media','defaultSignal',default_signal,'historyMs',0),'publicApi',json_object('fields',json_array(${field}),'writeFields',${role === 'control' ? `json_array(${field})` : 'json_array()'},'context',json_object('screen_id',screen_id),'macros',${role === 'display' ? 'json(allowed_macros)' : "json_array('media-screen-get')"}))`;
const savePages = ['display', 'control'].map(role => `
INSERT INTO system_pages(page_id,html,require_email,require_phone,sync_id,enabled,title,meta)
SELECT 'media-${role}-'||screen_id,t.html,0,0,:sync_id,s.enabled,name||' · ${role === 'control' ? 'Điều khiển' : 'Hiển thị'}',${meta(role)}
FROM media_screens s JOIN media_screen_templates t ON t.role='${role}' WHERE screen_id=:screen_id
ON CONFLICT(page_id) DO UPDATE SET html=excluded.html,require_email=excluded.require_email,require_phone=excluded.require_phone,sync_id=excluded.sync_id,enabled=excluded.enabled,title=excluded.title,meta=excluded.meta;`).join('\n');
const managerParams = {
  screen_id: { type: 'string', required: true, pattern: '^[a-f0-9]{32}$' },
  revision: { type: 'integer', required: true, min: 0 },
  name: { type: 'string', required: true, minLength: 1, maxLength: 100 },
  prefix: { type: 'string', required: true, maxLength: 48, pattern: '^[A-Za-z0-9_-]*$' },
  default_signal: { type: 'string', required: true, maxLength: 2000 },
  allowed_macros: { type: 'string', required: true, maxLength: 2600 },
  enabled: { type: 'integer', required: true, min: 0, max: 1 },
  display_login: { type: 'integer', required: true, min: 0, max: 0 }
};
const managerMeta = JSON.stringify({ editorMode: 'raw', mediaManager: true, publicApi: { maxBodyBytes: 8192, macros: {
  'media-screens-list': {},
  'media-screen-save': { params: managerParams },
  'media-screen-delete': { params: { screen_id: managerParams.screen_id, revision: managerParams.revision } }
} } });
const macros = [
  { name: 'media-manager-publish', source: `
${guard(`length(:manager_id)=32 AND :manager_id NOT GLOB '*[^a-f0-9]*'`)}
${guard(`NOT EXISTS(SELECT 1 FROM system_pages WHERE page_id='media-manager-'||:manager_id AND COALESCE(json_extract(meta,'$.mediaManager'),0)<>1)`)}
INSERT INTO system_pages(page_id,html,require_email,require_phone,sync_id,enabled,title,meta)
SELECT 'media-manager-'||:manager_id,html,0,0,:sync_id,1,:title,(SELECT html FROM media_screen_templates WHERE role='manager-meta') FROM media_screen_templates WHERE role='manager'
ON CONFLICT(page_id) DO UPDATE SET html=excluded.html,sync_id=excluded.sync_id,title=excluded.title,meta=excluded.meta,require_email=0,require_phone=0;
SELECT 'media-manager-'||:manager_id AS page_id;` },
  { name: 'media-screens-list', source: `${select} ORDER BY name COLLATE NOCASE,screen_id;` },
  { name: 'media-screen-get', source: `${select} WHERE screen_id=:screen_id;` },
  { name: 'media-screen-save', source: `
${guard(revision)}
${guard(ownership)}
${guard(`(SELECT count(*) FROM media_screen_templates WHERE role IN ('display','control'))=2`)}
${guard(`json_valid(:allowed_macros) AND json_type(:allowed_macros)='array' AND json_array_length(:allowed_macros)<=20`)}
${guard(`NOT EXISTS(SELECT 1 FROM json_each(:allowed_macros) WHERE type<>'text' OR length(value) NOT BETWEEN 1 AND 128 OR value GLOB '*[^A-Za-z0-9._:-]*')`)}
INSERT INTO media_screens(screen_id,name,prefix,default_signal,allowed_macros,enabled,display_login,revision,updated_at)
VALUES(:screen_id,trim(:name),trim(:prefix),:default_signal,:allowed_macros,CAST(:enabled AS INTEGER),CAST(:display_login AS INTEGER),1,unixepoch())
ON CONFLICT(screen_id) DO UPDATE SET name=excluded.name,prefix=excluded.prefix,default_signal=excluded.default_signal,allowed_macros=excluded.allowed_macros,enabled=excluded.enabled,display_login=excluded.display_login,revision=media_screens.revision+1,updated_at=excluded.updated_at;
${savePages}
${select} WHERE screen_id=:screen_id;` },
  { name: 'media-screen-delete', source: `
${guard(`EXISTS(SELECT 1 FROM media_screens WHERE screen_id=:screen_id AND revision=CAST(:revision AS INTEGER))`)}
${guard(ownership)}
DELETE FROM system_pages WHERE page_id IN ('media-display-'||:screen_id,'media-control-'||:screen_id) AND json_extract(meta,'$.mediaScreen.id')=:screen_id;
DELETE FROM media_screens WHERE screen_id=:screen_id;
SELECT :screen_id AS deleted;` }
].map(m => ({ ...m, comment: 'Media screens: public links grant only the capabilities configured for each page.' }));

function displayHtml() {
  const original = fs.readFileSync(path.join(__dirname, '../media-only/dashboard.html'), 'utf8');
  // Use exactly the existing renderer. Public config/context are injected by ROSA;
  // no private session, key or payer is copied into a public page.
  return original.replace(/(<script type="application\/json" id="ai-bridge-media-only-config">)[\s\S]*?(<\/script>)/,
    '$1{}$2\n<script id="media-page-meta" type="application/json">__ROSA_IOT_PAGE_META__</script>\n<script id="media-page-context" type="application/json">__ROSA_IOT_PAGE_CONTEXT__</script>');
}
function install(db) {
  db.exec(schema);
  const insert = db.prepare('INSERT INTO system_macros(name,comment,source) VALUES(?,?,?)');
  for (const m of macros) insert.run(m.name, m.comment, m.source);
  db.prepare('INSERT INTO media_screen_templates VALUES(?,?)').run('display', displayHtml());
  db.prepare('INSERT INTO media_screen_templates VALUES(?,?)').run('control', fs.readFileSync(path.join(__dirname, 'control.html'), 'utf8'));
  db.prepare('INSERT INTO media_screen_templates VALUES(?,?)').run('manager', managerHtml());
  db.prepare('INSERT INTO media_screen_templates VALUES(?,?)').run('manager-meta', managerMeta);
}
function managerHtml() {
  return fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8')
    .replace(/(<script id="media-manager-config" type="application\/json">)[\s\S]*?(<\/script>)/, '$1{}$2\n<script id="media-page-meta" type="application/json">__ROSA_IOT_PAGE_META__</script>\n<script id="media-page-context" type="application/json">__ROSA_IOT_PAGE_CONTEXT__</script>');
}
module.exports = { schema, macros, install, displayHtml, managerHtml };
