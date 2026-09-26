const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const C=require('./index.cjs');
const HOUR=3600000;
function fixture(t, overrides={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rosa-schedule-'));
  const settings={timeoutSeconds:180,memoryMb:10,cpuPrice:0.01,servicePrice:0,maxConcurrent:10,maxBackendsPerDevice:100,scheduleMinHours:1,...overrides};
  const options={statePath:path.join(dir,'state.sqlite'),iodataDir:path.join(dir,'iodata'),simulation:true,settings:()=>settings};
  const store=new C.BackendStore(options);
  store.testCleanups=[];
  t.after(async()=>{for(const cleanup of store.testCleanups)await cleanup();store.close();require('./test-cleanup.cjs')(dir);});
  return {store,settings,options};
}
function backend(store,name='example',ioid='IOtest',extra={}) {
  const d=C.definition({name,source:'export default () => ({ok:true})',inputSchema:{type:'object'},outputSchema:{type:'object'},permissions:{macros:[],reports:[],devices:{}},...extra});
  store.save(ioid,d);store.configure(ioid,name,{syncId:'SIM_SYNC',enabled:true});store.publish(ioid,name);return d;
}
function enable(store,name='example',ioid='IOtest',hours=1) {
  return store.setSchedule(ioid,name,{enabled:true,intervalHours:hours},store.schedule(ioid,name).revision);
}
function direct(store,settings,d,key,ioid='IOtest') {
  return store.submit({ioid,name:d.name,input:{},requestKey:key,scope:'editor',definition:d,settings});
}
test('device quota counts drafts, permits updates, independently counts devices and rejects oversized imports',t=>{
  const {store}=fixture(t,{maxBackendsPerDevice:2});
  const d=backend(store,'one');backend(store,'two');
  assert.throws(()=>backend(store,'three'),{code:'BACKEND_LIMIT'});
  store.save('IOtest',{...d,description:'updated'});backend(store,'one','IOother');
  const db=store.data('IOtest');
  const bytes=db.serialize();db.close();
  assert.throws(()=>C.validateBackendImport(bytes,1),{code:'BACKEND_LIMIT'});
  assert.doesNotThrow(()=>C.validateBackendImport(bytes,2));
});
test('schedule validation, revisions and no runtime allocation before admission',t=>{
  const {store}=fixture(t);
  backend(store);
  assert.throws(()=>enable(store,'example','IOtest',1.5),{code:'INVALID_INTERVAL'});
  backend(store,'needs-input','IOtest',{inputSchema:{type:'object',required:['value'],properties:{value:{type:'string'}}}});
  assert.throws(()=>enable(store,'needs-input'),{code:'SCHEDULE_INPUT_REQUIRED'});
  const s=enable(store);
  assert.throws(()=>store.setSchedule('IOtest','example',{enabled:false,intervalHours:1},0),{code:'SCHEDULE_CONFLICT'});
  assert.equal(store.scanSchedules(s.nextAt-1),0);
  assert.equal(store.scanSchedules(s.nextAt),1);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM backend_runs').get().n,0);
  assert.equal(store.available('SIM_SYNC'),1000000);
  assert.equal(store.schedule('IOtest','example').pendingAt,s.nextAt);
  const run=store.claim('worker',10)[0];
  assert.equal(run.scope,'schedule');assert.equal(run.input,'{}');assert.ok(run.deadline>Date.now()+170000);
});
test('global concurrency and 20 percent limit survive distinct coordinators; direct queue has priority',t=>{
  const {store,settings,options}=fixture(t);
  for(let i=0;i<8;i++){backend(store,'timer'+i);const s=enable(store,'timer'+i);store.scanSchedules(s.nextAt);}
  const other=new C.BackendStore(options);store.testCleanups.push(()=>other.close());
  const d=backend(store,'manual');
  for(let i=0;i<12;i++)direct(store,settings,d,'direct-request-'+i);
  const first=store.claim('a',6),second=other.claim('b',6);
  assert.equal(first.length+second.length,10);assert.equal(store.schedulingStatus().scheduledRunning,0);
  assert.equal(other.claim('b',6).length,0);
  for(const r of first)store.complete(r.id,{result:{},cpuMs:0});
  const admitted=other.claim('b',10);
  assert.equal(admitted.filter(r=>r.scope==='editor').length,2);
  assert.equal(admitted.filter(r=>r.scope==='schedule').length,2);
  assert.equal(store.schedulingStatus().scheduledRunning,2);
  assert.equal(store.claim('a',10).length,0);
  settings.maxConcurrent=5;
  assert.equal(other.claim('b',20).length,0);
});
test('empty wallet skips occurrence without charging or allocating; top up permits next occurrence only',t=>{
  const {store}=fixture(t);backend(store);const s=enable(store);store.scanSchedules(s.nextAt);
  store.db.prepare('UPDATE sync_data SET costLimit=0').run();
  assert.deepEqual(store.claim('worker',10),[]);
  assert.equal(store.schedule('IOtest','example').lastStatus,'skipped');
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM backend_runs').get().n,0);
  store.db.prepare('UPDATE sync_data SET costLimit=100').run();
  assert.deepEqual(store.claim('worker',10),[]);
  store.scanSchedules(s.nextAt+HOUR);
  assert.equal(store.claim('worker',10).length,1);
});
test('failures and lost runners never retry the occurrence; restart preserves schedules',t=>{
  const {store,options}=fixture(t);backend(store);const s=enable(store);store.scanSchedules(s.nextAt);
  const r=store.claim('worker',10)[0];store.complete(r.id,{error:{code:'FAILED',message:'failed'},cpuMs:10});
  const other=new C.BackendStore(options);store.testCleanups.push(()=>other.close());
  other.scanSchedules(s.nextAt);
  assert.deepEqual(other.claim('other',10),[]);
  other.scanSchedules(s.nextAt+HOUR);
  const next=other.claim('other',10)[0];assert.notEqual(next.id,r.id);
  store.db.prepare('UPDATE backend_runs SET heartbeat=0 WHERE id=?').run(next.id);store.recover();
  assert.equal(store.raw(next.id).status,'running');
  store.db.prepare('UPDATE backend_runs SET deadline=0 WHERE id=?').run(next.id);store.recover();
  assert.equal(store.raw(next.id).status,'failed');assert.equal(store.raw(next.id).incomplete,1);
  assert.deepEqual(other.claim('other',10),[]);
});
test('missed periods coalesce, active occurrences do not overlap and stop/delete revokes waiting jobs',t=>{
  const {store}=fixture(t);const d=backend(store);const s=enable(store);
  store.scanSchedules(s.nextAt+10*HOUR);
  assert.equal(store.schedule('IOtest','example').skipped,10);
  const r=store.claim('worker',10)[0];
  store.scanSchedules(s.nextAt+11*HOUR);
  assert.deepEqual(store.claim('worker',10),[]);
  store.complete(r.id,{result:{},cpuMs:0});
  store.scanSchedules(s.nextAt+12*HOUR);
  store.configure('IOtest','example',{...store.config('IOtest','example'),enabled:false});
  assert.equal(store.schedule('IOtest','example').pendingAt,null);
  store.remove('IOtest','example',C.hash(d));
  assert.deepEqual(store.claim('worker',10),[]);
});
test('scheduled admission revalidates publication and payer after waiting; device turns are fair',t=>{
  const {store}=fixture(t);
  for(const ioid of ['IOone','IOtwo'])for(let n=0;n<2;n++){backend(store,'timer'+n,ioid);const s=enable(store,'timer'+n,ioid);store.scanSchedules(s.nextAt);}
  const runs=store.claim('worker',10);
  assert.deepEqual(new Set(runs.map(r=>r.ioid)),new Set(['IOone','IOtwo']));
  for(const r of runs)store.complete(r.id,{result:{},cpuMs:0});
  const db=store.data('IOone');db.prepare('DELETE FROM system_backend_versions').run();db.close();
  const remaining=store.claim('worker',10);
  assert.equal(remaining.length,1);assert.equal(remaining[0].ioid,'IOtwo');
});
test('native V8 executes scheduled source, releases slots on failure and bills actual CPU',async t=>{
  const {store,options}=fixture(t);backend(store,'good');backend(store,'bad','IOtest',{source:'export default () => { throw new Error("expected failure"); }'});
  for(const n of ['good','bad']){const s=enable(store,n);store.scanSchedules(s.nextAt);}
  const service=new C.BackendService({...options,runner:{mode:'local',poolCount:1,poolMemoryMb:256},sdk:async()=>({})});
  store.testCleanups.push(async()=>{service.close();await new Promise(r=>setTimeout(r,100));service.store.close();});
  service.pump();
  for(let i=0;i<200 && ['good','bad'].some(n=>!['succeeded','failed'].includes(store.schedule('IOtest',n).lastStatus));i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(store.schedule('IOtest','good').lastStatus,'succeeded');
  assert.equal(store.schedule('IOtest','bad').lastStatus,'failed');
  assert.equal(store.schedulingStatus().running,0);
  assert.ok(store.db.prepare('SELECT costUsed FROM sync_data').get().costUsed>0);
});
test('parallel coordinators atomically share the global cap and scheduled allowance',async t=>{
  const {store,options,settings}=fixture(t);
  for(let i=0;i<12;i++){backend(store,'scheduled'+i);const s=enable(store,'scheduled'+i);store.scanSchedules(s.nextAt);}
  const {spawn}=require('node:child_process');
  const claims=()=>Promise.all(Array.from({length:4},(_,id)=>new Promise((resolve,reject)=>{
    const data={id,module:require.resolve('./index.cjs'),settings,options:{statePath:options.statePath,iodataDir:options.iodataDir,simulation:true}};
    const code='const d='+JSON.stringify(data)+'; const C=require(d.module); const s=new C.BackendStore({...d.options,settings:()=>d.settings}); const rows=s.claim("parallel-"+d.id,50); s.close(); console.log(rows.length);';
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const child=spawn(process.execPath,['-e',code],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='',error='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>error+=d);
    const timeout=setTimeout(()=>{child.kill();reject(new Error('Coordinator claim timed out'));},20000);
    child.once('error',reject);child.once('close',code=>{clearTimeout(timeout);code?reject(new Error(error)):resolve(Number(output.trim()));});
  })));
  assert.equal((await claims()).reduce((a,b)=>a+b,0),2);
  const d=backend(store,'direct');for(let i=0;i<25;i++)direct(store,settings,d,'parallel-direct-'+i);
  assert.equal((await claims()).reduce((a,b)=>a+b,0),8);
  assert.equal(store.schedulingStatus().running,10);assert.equal(store.schedulingStatus().scheduledRunning,2);
});
