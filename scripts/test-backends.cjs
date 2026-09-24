const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SimulatorStore}=require('../src/store');const {createBackendApi}=require('../src/backends');
test('simulator HTTP editor, private IoT page, external auth, schemas and native SDK',async()=>{
  const root=path.resolve(__dirname,'..'),state=fs.mkdtempSync(path.join(os.tmpdir(),'rosa-backend-http-'));
  const sim=new SimulatorStore({rootDir:root,stateDir:state,templateRoot:path.join(root,'sample_templates/templates'),defaultSessionId:'IO123abcd@simulate',defaultSyncId:'SIM_SYNC'});
  sim.replaceIoDataFile('IO123abcd@simulate',path.join(root,'sample_templates/templates/backend-lab/sample.sqlite'),{syncId:'SIM_SYNC'});sim.setTelemetry('IO123abcd@simulate',{temperature:28,O101:'OFF'});
  const api=createBackendApi(sim);const server=http.createServer(async(req,res)=>{if(!await api.handle(req,res,new URL(req.url,'http://'+req.headers.host))){res.statusCode=404;res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  const post=async(body,url='/api/backends',headers={})=>{const r=await fetch(origin+url,{method:'POST',headers:{origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
  const poll=async(value,url='/api/backends?runId=',headers={})=>{for(let i=0;i<100;i++){const r=await fetch(origin+url+value.runId,{headers});value=await r.json();if(!['queued','running'].includes(value.status))return value;await new Promise(r=>setTimeout(r,40));}throw new Error('Run did not finish');};
  try{
    const listing=await(await fetch(origin+'/api/backends')).json();assert.equal(listing.simulation,true);assert.equal(listing.backends.length,1);
    const key='offline-key-123456789012345678901234';let config={syncId:'SIM_SYNC',externalEnabled:true,authType:'bearer',apiKey:key};
    assert.equal((await post({action:'configure',name:'kiem-tra-ton-kho',config})).status,200);assert.equal((await post({action:'publish',name:'kiem-tra-ton-kho'})).status,200);
    const input={sku:'SP001'},external='/bw/IO123abcd/kiem-tra-ton-kho';
    assert.equal((await post(input,external)).status,401);assert.equal((await post({sku:5},external,{Authorization:'Bearer '+key})).status,400);
    for(const authType of ['bearer','api-key','basic']){config={...config,authType,username:'demo'};await post({action:'configure',name:'kiem-tra-ton-kho',config});const headers=authType==='bearer'?{Authorization:'Bearer '+key}:authType==='api-key'?{'X-API-Key':key}:{Authorization:'Basic '+Buffer.from('demo:'+key).toString('base64')};headers['Idempotency-Key']='test-key-'+authType;
      const submitted=await post(input,external,headers);assert.equal(submitted.status,202);const done=await poll(submitted.value,external+'?runId=',headers);assert.equal(done.status,'succeeded',JSON.stringify(done));assert.equal(done.result.rows[0].quantity,12);assert.equal(Number(done.result.state.temperature),28);assert.ok(done.cpuMs>0);assert.equal((await post(input,external,headers)).value.runId,done.runId);
    }
    const page='/api/iot-page-backend/IO123abcd/backend-stock';let result=await post({name:'kiem-tra-ton-kho',input,requestId:'page-request-01'},page);assert.equal(result.status,202);
    while(['queued','running'].includes(result.value.status)){await new Promise(r=>setTimeout(r,40));result=await post({name:'kiem-tra-ton-kho',runId:result.value.runId},page);}assert.equal(result.value.result.rows[0].sku,'SP001');assert.equal(result.value.logs,undefined);
    const d=listing.backends[0];d.source='export default async (input, rosa) => ({rows:await rosa.db.report("stock-report"),state:await rosa.iot.command("device","switch",{state:"ON"})})';d.outputSchema={type:'object'};
    await post({action:'save',definition:d});const trial=await post({action:'run',name:d.name,input,requestId:'trial-command-01'});const done=await poll(trial.value);assert.equal(done.status,'succeeded',JSON.stringify(done));assert.equal(done.result.rows[0].quantity,'20');assert.equal(sim.listCommandLog(1)[0].command,'N3,1,"ON"');
    assert.equal((await post({action:'check',source:'export default () => process.env'})).value.ok,false);
    assert.match(sim.renderPublicPage('IO123abcd','backend-stock').html,/backend\/page-sdk.js/);
  }finally{api.close();await new Promise(r=>server.close(r));await new Promise(r=>setTimeout(r,300));api.service.store.close();sim.db.close();assert.ok(state.startsWith(path.join(os.tmpdir(),'rosa-backend-http-')));require('../packages/rosa-backend/test-cleanup.cjs')(state);}
});
