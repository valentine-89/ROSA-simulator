"use strict";
const Database = require('./dependencies.cjs')('better-sqlite3');
const C = require('./contract.cjs');
function assertDatabaseBackendQuota(db, maximum = 100) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='system_backends'").get() &&
      db.prepare('SELECT COUNT(*) n FROM system_backends').get().n > maximum)
    throw C.fail('BACKEND_LIMIT', `Database vượt giới hạn ${maximum} backend/thiết bị.`, 409);
}
function validateBackendImport(bytes, maximum = 100) {
  const image=Buffer.from(bytes);
  // A self-contained WAL export has no sidecar in memory. Inspect its copied
  // pages in rollback-journal mode; never change the uploaded bytes.
  if(image.length>=100 && image.subarray(0,16).equals(Buffer.from('SQLite format 3\0'))) {
    image[18]=1; image[19]=1;
  }
  const db = new Database(image, { readonly: true });
  try { assertDatabaseBackendQuota(db, maximum); } finally { db.close(); }
}
module.exports = { assertDatabaseBackendQuota, validateBackendImport };
