const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const runtime = read('dashboard-runtime.js');
const valid = vm.runInNewContext('(' + runtime.split('\n').find(line => line.includes('function validSettingValue(')).trim() + ')');
const db = new Database(path.join(__dirname, 'sample.sqlite'), {readonly:true});
try {
  assert.deepEqual(db.prepare("SELECT cmd_id FROM system_cmds WHERE cmd_id LIKE 'biomass-set-%' ORDER BY cmd_id").all().map(x => x.cmd_id),
    ['biomass-set-1005','biomass-set-1007','biomass-set-1008']);
  for (const key of ['1007','1008']) {
    const row = db.prepare('SELECT * FROM system_cmds WHERE cmd_id=?').get('biomass-set-' + key);
    const rule = JSON.parse(row.params_schema).value;
    const pattern = new RegExp(rule.pattern);
    for (const value of ['16,23,28,33,36,41,48,56','0,10,16,32,35,40,47,56','0,0,0,0,0,0,0,0','56,56,56,56,56,56,56,56']) {
      assert.ok(pattern.test(value));
      assert.ok(valid({list:true}, value));
      assert.equal(row.command_template.replace('<<value>>', value), 'D4#' + key + ',"' + value + '"D5N20');
    }
    for (const value of ['', '0,1,2,3,4,5,6','0,1,2,3,4,5,6,7,8','-1,1,2,3,4,5,6,7','57,1,2,3,4,5,6,7','1.5,1,2,3,4,5,6,7','0,1,2,3,4,5,6,7D1O1']) {
      assert.equal(pattern.test(value), false);
      assert.equal(valid({list:true}, value), false);
    }
  }
  assert.ok(read('dashboard_vi.html').includes('bb-credit-burned'));
  assert.ok(!read('dashboard_vi.html').includes('bb-credit-remaining'));
  assert.ok(read('refuel_page.html').includes('Phút còn lại:'));
  const programs = JSON.parse(read('IO2729MB1-compact-v2.iodata')).io_programs.flatMap(g => g.io_n_list);
  assert.equal(programs.find(p => p.n_id === '20').n_content,
    'D23,#801,,"telemetry",#101,#894,#1003,#1005,#1007,#1008,#105,#106,#1022');
  console.log('Eight-level settings, command quoting and UI contract passed');
} finally { db.close(); }
