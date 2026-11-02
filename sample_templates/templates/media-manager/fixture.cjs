'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const definition = require('./definition.cjs');
const root = path.resolve(__dirname, '../../..');
function transpile(source, mocks = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => mocks[name] || {}, console, Buffer, URL });
  return module.exports;
}
const source = fs.readFileSync(path.join(root, 'lib/ioDataManager.ts'), 'utf8');
const sql = transpile(source.slice(source.indexOf('function splitSqlStatements('), source.indexOf('function toResultRows(')) + '\nexport { splitSqlStatements, compileNamedSql, isQueryStatement };');
const publicApi = transpile(fs.readFileSync(path.join(root, 'lib/iotPagePublicApi.ts'), 'utf8'), { './iotPageRenderer': { normalizePageMetaJson: JSON.parse } });
const INPUT = { screen_id: 'a'.repeat(32), revision: 0, name: 'Cửa trước', prefix: 'frontdoor', default_signal: 'text@black:Chào mừng', allowed_macros: '[]', enabled: 1, display_login: 0, sync_id: 'FIXTURE-BILLING' };
function fixture() {
  const db = new DatabaseSync(':memory:'); definition.install(db);
  function run(name, params = {}) {
    const macro = db.prepare('SELECT source FROM system_macros WHERE name=? AND enabled=1').get(name);
    if (!macro) throw Error('Macro missing');
    let rows = [];
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of sql.splitSqlStatements(macro.source)) {
        const compiled = sql.compileNamedSql(statement, Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
        const prepared = db.prepare(compiled.sql);
        if (sql.isQueryStatement(statement)) rows = prepared.all(...compiled.params); else prepared.run(...compiled.params);
      }
      db.exec('COMMIT'); return rows;
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  return { db, run, save: (params = {}) => run('media-screen-save', { ...INPUT, ...params }), pages: () => db.prepare('SELECT * FROM system_pages ORDER BY page_id').all() };
}
module.exports = { fixture, INPUT, root, publicApi };
