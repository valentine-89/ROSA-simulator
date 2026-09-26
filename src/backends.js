const fs=require('fs'),path=require('path'),crypto=require('crypto');
const C=require('../packages/rosa-backend/index.cjs');const {DatabasePool}=require('../packages/rosa-backend/database.cjs');
const settings={timeoutSeconds:180,memoryMb:10,cpuPrice:1,servicePrice:0.001,maxConcurrent:20,maxBackendsPerDevice:100,scheduleMinHours:1};
function createBackendApi(sim){
  const dbPool=new DatabasePool(4);
  const service=new C.BackendService({settings:()=>settings,statePath:path.join(sim.stateDir,'backends.sqlite'),iodataDir:sim.iodataDir,simulation:true,runner:{mode:'local',poolCount:2,poolMemoryMb:512},sdk:async({run,definition,method,args,operationId,store})=>{
    const cost=method==='db.report'?run.service_price*10:method==='iot.command'?run.service_price*5:method==='db.macro'?run.service_price:0;
    const prior=store.beginOperation(run.id,operationId,method==='db.report'?'db_report':'db_exec',cost);if(prior){if(prior.status==='done')return JSON.parse(prior.result);throw C.fail('OPERATION_UNCERTAIN','Thao tác đã gửi.');}
    try{let result;if(method.startsWith('db.')){
      const params=C.json(args[1]||{});for(const k of Object.keys(params))if(['sync_id','syncid','session_id','sessionid','ioid'].includes(k.toLowerCase()))throw C.fail('RESERVED_PARAM','Không được ghi đè ngữ cảnh backend.');
      const value=await dbPool.execute({file:store.file(run.ioid),name:args[0],operationId,deadline:run.deadline,report:method==='db.report',bindings:{...params,ioid:run.ioid,session_id:run.ioid,sync_id:run.sync_id}});result=value.rows;if(value.changed)sim.emit({type:'iodata_changed',sessionId:run.ioid,macro:args[0],ts:Date.now()});
    }else{const declared=definition.permissions.devices[args[0]],device={...declared,ioid:declared.ioid==='self'?run.ioid:declared.ioid},session=device.ioid+'@simulate';
      if(method==='iot.latest')result=sim.getLatestState(session,device.fields||[])?.payload||{};
      else if(method==='iot.timeseries'){const query=args[1]||{},to=Number(query.to||Date.now()),from=Number(query.from||to-3600000);if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to||to-from>31*86400000)throw C.fail('INVALID_RANGE','Khoảng thời gian tối đa 31 ngày.');result=sim.queryTimeseries(session,from,to,device.fields||[]);}
      else{const cmd=sim.readSystemCommand(device.ioid,args[1]);if(cmd.page_only||cmd.require_email||cmd.require_phone)throw C.fail('COMMAND_FORBIDDEN','Lệnh yêu cầu ngữ cảnh trang/người dùng.',403);const params=sim.normalizeBackendCommandParams(args[2]||{},cmd.params_schema);const text=String(cmd.command_template).replace(/<<([A-Za-z_][A-Za-z0-9_]*)>>/g,(_m,k)=>{if(!(k in params))throw C.fail('MISSING_PARAM','Thiếu '+k);return params[k];});if(!text.trim()||text.length>4096||/[\r\n\0]/.test(text))throw C.fail('INVALID_COMMAND','Lệnh không hợp lệ.');sim.handleLocalCommand(device.ioid,text);result={accepted:true};}
    }C.json(result,262144);store.endOperation(operationId,result);return result;}catch(e){store.failOperation(operationId,e);throw e;}
  }});
  const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  const sameOrigin=req=>{if(req.headers.origin!=='http://'+req.headers.host)throw C.fail('ORIGIN_FORBIDDEN','Nguồn request không hợp lệ.',403);};
  const body=async(req,max=400000)=>{let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw C.fail('BODY_TOO_LARGE','Request quá lớn.',413);chunks.push(chunk);}try{return C.json(JSON.parse(Buffer.concat(chunks).toString()||'{}'),max);}catch(e){throw C.fail(e.code||'INVALID_JSON',e.message);}};
  const editorIoid=req=>{const token=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('rosa_backend_session='))?.split('=')[1];return token?service.store.sessionIoid(token):C.ioid(sim.defaultSessionId.split('@')[0]);};
  const valueFor=(row,privateView)=>{const v=service.store.view(row);if(!privateView){delete v.logs;if(v.error)delete v.error.stack;}return v;};
  return {service,close(){dbPool.close();service.close();},async handle(req,res,url){
    const asset=url.pathname.match(/^\/backend\/(editor\.(html|css|js)|page-sdk\.js|guide\.html)$/);
    if(req.method==='GET'&&(asset||url.pathname==='/backend')){const file=asset?asset[1]:'editor.html';res.writeHead(200,{'Content-Type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'../public/backend',file)));return true;}
    const external=url.pathname.match(/^\/bw\/([^/]+)\/([^/]+)$/),page=url.pathname.match(/^\/api\/iot-page-backend\/([^/]+)\/([^/]+)$/);
    if(url.pathname!=='/api/backends'&&!external&&!page)return false;
    try{
      if(url.pathname==='/api/backends'){
        if(req.method==='GET'){const ioid=editorIoid(req),id=url.searchParams.get('runId');if(id){const row=service.store.raw(id);if(row.ioid!==ioid)throw C.fail('NOT_FOUND','Không tìm thấy lượt chạy.',404);json(res,200,valueFor(row,true));}else json(res,200,{ioid,simulation:true,settings,scheduling:service.store.schedulingStatus(),backends:service.store.list(ioid)});return true;}
        sameOrigin(req);const b=await body(req);
        if(b.action==='connect'){const ioid=C.ioid(String(b.sessionId).split('@')[0]);res.setHeader('Set-Cookie','rosa_backend_session='+service.store.session(ioid)+'; HttpOnly; SameSite=Strict; Path=/');json(res,200,{ok:true,ioid});return true;}
        const ioid=editorIoid(req);let value;
        if(b.action==='check')value=C.analyze(b.source,b.syntaxOnly===true);
        else if(b.action==='save'){service.store.save(ioid,b.definition);value={ok:true};}
        else if(b.action==='schedule')value=service.store.setSchedule(ioid,C.name(b.name),b.schedule,b.expectedScheduleRevision);
        else if(b.action==='advanceSchedule'){if(!Number.isSafeInteger(b.hours)||b.hours<1||b.hours>8760)throw C.fail('INVALID_INTERVAL','Số giờ không hợp lệ.');service.store.db.prepare('INSERT INTO backend_schedule_clock VALUES(1,?) ON CONFLICT(id) DO UPDATE SET offset_ms=offset_ms+excluded.offset_ms').run(b.hours*3600000);while(service.store.scanSchedules()===100){}service.pump();value={now:service.store.scheduleNow(),scheduling:service.store.schedulingStatus()};}
        else if(b.action==='configure')value=service.store.configure(ioid,C.name(b.name),{...b.config,syncId:'SIM_SYNC'});
        else if(b.action==='publish')value=service.store.publish(ioid,b.name);
        else if(b.action==='run'){const d=C.definition(service.store.draft(ioid,b.name));value=service.store.submit({ioid,name:b.name,input:b.input,requestKey:b.requestId,scope:'editor',definition:d,settings,test:true});service.pump();}
        else throw C.fail('INVALID_ACTION','Thao tác không hợp lệ.');json(res,b.action==='run'?202:200,value);return true;
      }
      let ioid,name,scope,input,key,id;
      if(external){ioid=C.ioid(decodeURIComponent(external[1]));name=C.name(decodeURIComponent(external[2]));scope='external';C.authenticate(req.headers,service.store.config(ioid,name));if(req.method==='GET')id=url.searchParams.get('runId');else if(req.method==='POST'){input=await body(req,65536);key=req.headers['idempotency-key']||crypto.randomUUID();}else throw C.fail('METHOD_NOT_ALLOWED','Dùng GET hoặc POST.',405);}
      else{sameOrigin(req);ioid=C.ioid(decodeURIComponent(page[1]));const pageId=decodeURIComponent(page[2]);const ctx=sim.getPublicPageContext(ioid,pageId);const b=await body(req,65536);name=C.name(b.name);const allowed=JSON.parse(ctx.page.meta||'{}').publicApi?.backends;if(!Array.isArray(allowed)||!allowed.includes(name))throw C.fail('BACKEND_FORBIDDEN','Trang không được gọi backend này.',403);scope='page:'+pageId;input=b.input;key=b.requestId;id=b.runId;}
      if(id){const row=service.store.raw(id);if(row.ioid!==ioid||row.name!==name||row.scope!==scope)throw C.fail('NOT_FOUND','Không tìm thấy lượt chạy.',404);json(res,200,valueFor(row,false));}
      else{const value=service.store.submit({ioid,name,input,requestKey:key,scope,definition:service.store.published(ioid,name),settings});service.pump();json(res,202,{...value,statusUrl:`/bw/${ioid}/${name}?runId=${value.runId}`});}
    }catch(e){json(res,e.status||500,{error:e.code||'BACKEND_FAILED',message:e.message});}return true;
  }};
}
module.exports={createBackendApi};
