const fs=require('fs'),path=require('path'),Database=require('better-sqlite3');const C=require('../packages/rosa-backend/contract.cjs');
let count=0;const root=path.resolve(__dirname,'../sample_templates/templates');
for(const entry of fs.readdirSync(root)){const dir=path.join(root,entry);if(!fs.statSync(dir).isDirectory())continue;for(const file of fs.readdirSync(dir)){if(!file.endsWith('.sqlite'))continue;const db=new Database(path.join(dir,file),{readonly:true,fileMustExist:true});try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='system_backends'").get())continue;
  const names=new Set();for(const row of db.prepare('SELECT name,definition FROM system_backends').all()){
    const d=C.definition(JSON.parse(row.definition));if(d.name!==row.name)throw new Error('Tên backend không khớp: '+file);names.add(d.name);
    for(const n of [...d.permissions.macros,...d.permissions.reports])if(!db.prepare('SELECT 1 FROM system_macros WHERE name=? AND enabled<>0').get(n))throw new Error(`Macro thiếu: ${n}`);
    for(const device of Object.values(d.permissions.devices))if(device.ioid==='self')for(const n of device.commands)if(!db.prepare('SELECT 1 FROM system_cmds WHERE cmd_id=? AND enabled<>0').get(n))throw new Error('Command thiếu: '+n);
    count++;
  }
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='system_pages'").get())for(const page of db.prepare('SELECT page_id,meta FROM system_pages').all())for(const n of JSON.parse(page.meta||'{}').publicApi?.backends||[])if(!names.has(n))throw new Error(`Trang ${page.page_id} gọi backend không tồn tại: ${n}`);
}finally{db.close();}}}
console.log(`Validated ${count} backend definitions, schemas and capabilities.`);
