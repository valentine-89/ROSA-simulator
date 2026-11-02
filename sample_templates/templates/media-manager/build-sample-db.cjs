'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { install } = require('./definition.cjs');
const file = path.resolve(process.argv[2] || path.join(__dirname, 'sample.sqlite'));
if (fs.existsSync(file)) throw Error('File đã tồn tại. Chọn file output mới để giữ dữ liệu.');
const db = new DatabaseSync(file);
try { db.exec('BEGIN IMMEDIATE'); install(db); db.exec('COMMIT'); }
finally { db.close(); }
console.log('Created ' + file);
