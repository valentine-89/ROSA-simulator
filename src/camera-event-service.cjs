'use strict';
const Database=require('better-sqlite3');
const {pageCommandGrant}=require('../packages/rosa-backend/page-command.cjs');
const C=require('../packages/rosa-backend/contract.cjs');

class CameraEventService {
  constructor({file,store,visionUrl='https://vision.ioeasy.com',publicUrl='https://rosa.technology',fetch=globalThis.fetch}) {
    Object.assign(this,{file,store,visionUrl:visionUrl.replace(/\/$/,''),publicUrl:publicUrl.replace(/\/$/,''),fetch});
  }
  camera(ioid,syncId,cameraId) {
    const db=new Database(this.file(C.ioid(ioid)),{readonly:true,fileMustExist:true});
    try {
      const camera=db.prepare('SELECT * FROM system_ai_cameras WHERE camera_id=? AND sync_id=?').get(cameraId,syncId);
      if(!camera?.api_key)throw C.fail('CAMERA_NOT_FOUND','Không tìm thấy camera hoặc API key.',404);
      return camera;
    } finally {db.close();}
  }
  url(ioid,name) {return `${this.publicUrl}/bw/${C.ioid(ioid)}/${C.name(name)}`;}
  async request(camera,path,method='GET',body) {
    const url=new URL(this.visionUrl+path);url.searchParams.set('apikey',camera.api_key);
    const response=await this.fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const raw=await response.text();
    if(Buffer.byteLength(raw)>262144)throw C.fail('VISION_RESPONSE','Phản hồi Vision quá lớn.',502);
    let value;try{value=JSON.parse(raw);}catch{throw C.fail('VISION_RESPONSE','Vision trả phản hồi không hợp lệ.',502);}
    if(!response.ok)throw C.fail('VISION_REJECTED',`Vision từ chối yêu cầu (${response.status}).`,response.status);
    return value;
  }
  async read(ioid,syncId,cameraId,name) {
    const camera=this.camera(ioid,syncId,cameraId),value=await this.request(camera,'/api/settings');
    return {camera_id:value.id,motion:value.config?.motion,connection:value.connection,
      events:value.events,expected_url:this.url(ioid,name),
      config_url:`${this.visionUrl}/config?apikey=${encodeURIComponent(camera.api_key)}`};
  }
  async unregister(ioid,syncId,cameraId) {
    return this.request(this.camera(ioid,syncId,cameraId),'/api/camera/events','PUT',{url:''});
  }
  async register(ioid,syncId,cameraId,{name,token}) {
    const camera=this.camera(ioid,syncId,cameraId),config=this.store.config(ioid,C.name(name));
    if(!camera.enabled||!config.enabled||!config.externalEnabled||config.authType!=='bearer'||config.syncId!==syncId||!C.secretMatches(token,config.keyHash))
      throw C.fail('BACKEND_FORBIDDEN','Backend chưa được cấp quyền nhận sự kiện.',403);
    const definition=this.store.published(ioid,name);
    const db=new Database(this.file(ioid),{readonly:true,fileMustExist:true});
    let granted=false;
    try {
      for(const [pageId,commands] of Object.entries(definition.permissions.pages||{}))for(const commandId of commands) {
        const {api,command}=pageCommandGrant(db,{pageId,commandId,backendName:name,syncId});
        const schema=JSON.parse(command.params_schema||'{}');
        if(api.commandTarget?.type==='ai-count'&&schema[api.commandTarget.cameraParam||'camera_id']?.enum?.includes(cameraId))granted=true;
      }
    } finally {db.close();}
    if(!granted)throw C.fail('CAMERA_FORBIDDEN','Backend chưa được trang cấp quyền đếm camera này.',403);
    return this.request(camera,'/api/camera/events','PUT',{url:this.url(ioid,name),token});
  }
}
module.exports={CameraEventService};
