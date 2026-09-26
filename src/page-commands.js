const fs=require('fs'),path=require('path'),crypto=require('crypto');
const Database=require('../packages/rosa-backend/dependencies.cjs')('better-sqlite3');
const {pageCommandGrant}=require('../packages/rosa-backend/page-command.cjs');
function backendPageCommand(sim,run,args,operationId){
  const [pageId,commandId,params={}]=args;
  if(Object.keys(params).some(k=>['phone','email','username','syncid','sync_id','api_key','apikey','request_id'].includes(k.toLowerCase())))throw Error('Không được ghi đè danh tính hoặc payer.');
  const db=new Database(sim.getIoDataFilePath(run.ioid),{fileMustExist:true});
  try {
    const {api}=pageCommandGrant(db,{pageId,commandId,backendName:run.name,syncId:run.sync_id});
    const cmd=sim.readSystemCommand(run.ioid,commandId);
    if(api.commandTarget?.type!=='ai-count'){
      if(/<<(phone|email|username)>>/i.test(cmd.command_template))throw Error('Command cần người thực hiện.');
      const value=sim.normalizeBackendCommandParams(params,cmd.params_schema);
      const command=String(cmd.command_template).replace(/<<([A-Za-z_][A-Za-z0-9_]*)>>/g,(_,k)=>value[k]);
      sim.handleLocalCommand(run.ioid,command);return {ok:true,simulated:true};
    }
    const hex=crypto.createHash('sha256').update(run.id+':'+operationId).digest('hex');
    const requestId=hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
    const values=sim.normalizeBackendCommandParams({...params,request_id:requestId},cmd.params_schema);
    const camera=db.prepare('SELECT * FROM system_ai_cameras WHERE camera_id=? AND sync_id=? AND enabled=1').get(values.camera_id,run.sync_id);
    if(!camera)throw Error('Camera không thuộc SyncID này.');
    const macro=api.commandTarget.callbackMacro||camera.callback_macro;
    if(!db.prepare("SELECT 1 FROM system_service_macros WHERE name=? AND service='ai-count'").get(macro))throw Error('AI callback không hợp lệ.');
    const mockFile=path.join(sim.stateDir,'mock-camera-counts.json');
    const mocks=fs.existsSync(mockFile)?JSON.parse(fs.readFileSync(mockFile,'utf8')):{};
    const counts=mocks[run.ioid]?.[camera.camera_id]||{};
    const mapping=JSON.parse(camera.product_map);
    const result={request_id:requestId,status:'succeeded',cost:0,captured_at:new Date().toISOString(),image_saved:1,image_url:null,
      simulated:true,items:mapping.map(item=>({code:item.code,quantity:Number.isSafeInteger(counts[item.code])&&counts[item.code]>=0?counts[item.code]:0}))};
    sim.executeMacro(run.ioid,run.sync_id,{macro,request_id:requestId,camera_id:camera.camera_id,camera_revision:camera.revision,area_name:camera.area_name,
      actor:'backend:'+run.name,requested_at:Date.now(),mapping,result});
    return {ok:true,status:'succeeded',request_id:requestId,simulated:true};
  } finally {db.close();}
}
module.exports={backendPageCommand};
