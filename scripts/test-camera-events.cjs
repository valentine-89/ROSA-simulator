const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SimulatorStore}=require('../src/store'),{createBackendApi}=require('../src/backends');
const Database=require('../packages/rosa-backend/dependencies.cjs')('better-sqlite3');
for(const mode of ['basic','iot'])test(mode+': registered event reaches standard backend, page command and inventory once',async()=>{
 const root=path.resolve(__dirname,'..'),state=fs.mkdtempSync(path.join(os.tmpdir(),'rosa-camera-events-'));
 const sim=new SimulatorStore({rootDir:root,stateDir:state,templateRoot:path.join(root,'sample_templates/templates'),defaultSessionId:'IOtest@simulate',defaultSyncId:'SIM_SYNC'});
 sim.replaceIoDataFile('IOtest@simulate',path.join(root,'sample_templates/templates/ai-inventory-basic/'+(mode==='iot'?'sample-iot.sqlite':'sample.sqlite')),{syncId:'SIM_SYNC'});
 const db=new Database(sim.getIoDataFilePath('IOtest'));
 db.prepare('INSERT INTO system_ai_cameras(camera_id,area_name,api_key,sync_id,product_map) VALUES(?,?,?,?,?)').run('cam','Area','simulated-camera','SIM_SYNC','[{"code":"type1","sku":"SP1","name":"Box"}]');
 db.exec("UPDATE warehouse_camera_events SET enabled=1,vision_camera_id='cam'");
 const row=db.prepare('SELECT * FROM warehouse_camera_events').get(),name=row.backend_name;
 fs.writeFileSync(path.join(state,'mock-camera-counts.json'),JSON.stringify({IOtest:{cam:{type1:17}}}));
 const api=createBackendApi(sim),server=http.createServer(async(req,res)=>{if(!await api.handle(req,res,new URL(req.url,'http://'+req.headers.host))){res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const send=async(url,method,body,headers={})=>{const response=await fetch(origin+url,{method,headers:{origin,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert(response.ok,JSON.stringify(value));return value;};
 try {
  const {source}=await import('../sample_templates/templates/ai-inventory-basic/camera-events-ui.js');
  await send('/api/backends','POST',{action:'save',definition:{name,source:source('cam'),inputSchema:{type:'object'},outputSchema:{type:'object'},permissions:{macros:['warehouse-motion-get'],reports:[],devices:{},pages:{'warehouse-motion-cam':['warehouse-motion-count-cam']}}}});
  const token='test-webhook-token-0123456789012345';
  await send('/api/backends','POST',{action:'configure',name,config:{syncId:'SIM_SYNC',enabled:true,externalEnabled:true,apiKey:token}});
  await send('/api/backends','POST',{action:'publish',name});
  const registration='/api/ai-cameras/cam/events?ioid=IOtest&syncId=SIM_SYNC&name='+name;
  assert.equal((await send(registration,'GET')).events.url,'');
  await send(registration,'PUT',{name,token});assert.equal((await send(registration,'GET')).events.url,origin+'/bw/IOtest/'+name);
  const input={camera_id:'cam',timestamp:Math.floor(Date.now()/1000),mode:'settled'},headers={Authorization:'Bearer '+token,'Idempotency-Key':'cam:'+input.timestamp};
  const first=await send('/bw/IOtest/'+name,'POST',input,headers);
  assert.equal((await send('/bw/IOtest/'+name,'POST',input,headers)).runId,first.runId);
  let run=first;for(let i=0;i<200&&['queued','running'].includes(run.status);i++){await new Promise(r=>setTimeout(r,30));run=await send('/bw/IOtest/'+name+'?runId='+first.runId,'GET',null,headers);}
  assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(db.prepare('SELECT count(*) n FROM warehouse_events').get().n,1);
  assert.equal(db.prepare('SELECT quantity FROM warehouse_items').get().quantity,17);assert.equal(sim.listCommandLog(10).length,0);
 } finally {api.close();await new Promise(r=>server.close(r));await new Promise(r=>setTimeout(r,300));api.service.store.close();db.close();sim.db.close();require('../packages/rosa-backend/test-cleanup.cjs')(state);}
});
