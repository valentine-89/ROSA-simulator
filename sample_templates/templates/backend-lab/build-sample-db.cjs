const fs=require('node:fs'),path=require('node:path');const Database=require('better-sqlite3');
const file=path.resolve(process.argv[2]||path.join(__dirname,'sample.sqlite'));if(fs.existsSync(file))throw new Error('File đã tồn tại. Chọn một file output mới để giữ dữ liệu.');
const db=new Database(file);try{db.transaction(()=>{
  db.exec(`CREATE TABLE inventory(sku TEXT PRIMARY KEY,title TEXT,quantity INTEGER);
    INSERT INTO inventory VALUES('SP001','Cảm biến nhiệt độ',12),('SP002','Relay',8);
    CREATE TABLE system_macros(name TEXT PRIMARY KEY,comment TEXT,source TEXT,enabled INTEGER DEFAULT 1);
    CREATE TABLE system_backends(name TEXT PRIMARY KEY,definition TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE system_pages(page_id TEXT PRIMARY KEY,title TEXT,html TEXT,meta TEXT,require_email INTEGER DEFAULT 0,require_phone INTEGER DEFAULT 0,sync_id TEXT,enabled INTEGER DEFAULT 1);
    CREATE TABLE system_cmds(cmd_id TEXT PRIMARY KEY,command_template TEXT,params_schema TEXT,require_email INTEGER DEFAULT 0,require_phone INTEGER DEFAULT 0,sync_id TEXT,enabled INTEGER DEFAULT 1,page_only INTEGER DEFAULT 0);`);
  db.prepare('INSERT INTO system_macros(name,comment,source) VALUES(?,?,?)').run('stock-find','Tra tồn kho','SELECT sku,title,quantity FROM inventory WHERE sku=:sku');
  db.prepare('INSERT INTO system_macros(name,comment,source) VALUES(?,?,?)').run('stock-report','Tổng tồn kho','SELECT SUM(quantity)::BIGINT AS quantity FROM inventory');
  const permissions={macros:['stock-find'],reports:['stock-report'],devices:{device:{ioid:'self',read:true,fields:['O101','temperature'],commands:['switch']}}};
  const definition={name:'kiem-tra-ton-kho',description:'Tra tồn kho và đọc trạng thái thiết bị',source:fs.readFileSync(path.join(__dirname,'backend.mjs'),'utf8'),inputSchema:{type:'object',properties:{sku:{type:'string',minLength:1,maxLength:40}},required:['sku'],additionalProperties:false},outputSchema:{type:'object',properties:{rows:{type:'array',items:{type:'object'}},state:{type:'object'}},required:['rows','state'],additionalProperties:false},permissions,contractVersion:1};
  db.prepare('INSERT INTO system_backends VALUES(?,?,?)').run(definition.name,JSON.stringify(definition),0);
  db.prepare('INSERT INTO system_pages(page_id,title,html,meta,sync_id) VALUES(?,?,?,?,?)').run('backend-stock','Kho thử nghiệm',fs.readFileSync(path.join(__dirname,'page.html'),'utf8'),JSON.stringify({publicApi:{backends:['kiem-tra-ton-kho']}}),'<<syncid>>');
  db.prepare('INSERT INTO system_cmds(cmd_id,command_template,params_schema,sync_id) VALUES(?,?,?,?)').run('switch','N3,1,"<<state>>"',JSON.stringify({state:{type:'string',required:true,enum:['ON','OFF']}}),'<<syncid>>');
}).immediate();}finally{db.close();}console.log(file);
