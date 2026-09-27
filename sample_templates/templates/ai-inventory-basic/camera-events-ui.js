export function source(cameraId) {
  return `export default async (input, rosa) => {
  const [camera] = await rosa.db.macro('warehouse-motion-get', {camera_id:${JSON.stringify(cameraId)}});
  if (!camera || !camera.enabled || !camera.camera_enabled || camera.vision_camera_id !== input.camera_id) return {skipped:true};
  const age = Date.now() / 1000 - input.timestamp;
  if (age < -60 || age > 300) return {skipped:true};
  return await rosa.page.command(camera.page_id, camera.command_id, {camera_id:camera.camera_id});
}`;
}
export async function mount(form,camera,cfg,macro,onSettings) {
  const box=document.createElement('div');box.className='camera-event-controls';
  const status=document.createElement('span');status.setAttribute('role','status');
  const button=document.createElement('button');button.type='button';button.textContent='Đăng ký sự kiện';button.disabled=true;
  const remove=document.createElement('button');remove.type='button';remove.textContent='Hủy đăng ký';remove.hidden=true;
  const actions=document.createElement('div');actions.className='camera-event-actions';actions.append(button,remove);
  box.append(status,actions);form.querySelector('#add-map').closest('.panel-heading').before(box);
  if(!camera){status.textContent='Lưu camera để đăng ký';return;}
  status.textContent='Đang đọc camera…';
  const ioid=cfg.databaseSessionId.split('@')[0];
  async function backend(body) {
    const response=await fetch('/api/backends'+(body?'':'?ioid='+encodeURIComponent(ioid)),{method:body?'POST':'GET',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:body?JSON.stringify({...body,ioid}):undefined});
    const value=await response.json();if(!response.ok)throw Error(value.message||'Không đọc được backend.');return value;
  }
  let settings,saved;
  try {
    saved=(await macro('warehouse-motion-get',{camera_id:camera.camera_id}))[0];
    if(!saved)throw Error('Chưa cài luồng sự kiện camera.');
    await backend({action:'connect',sessionId:cfg.databaseSessionId});
    const url='/api/ai-cameras/'+encodeURIComponent(camera.camera_id)+'/events?'+new URLSearchParams({ioid,syncId:cfg.syncId,name:saved.backend_name});
    const response=await fetch(url,{credentials:'same-origin'});settings=await response.json();
    if(!response.ok)throw Error(settings.message||'Không đọc được camera.');
    if(!settings.events||typeof settings.events.url!=='string')throw Error('Vision chưa cung cấp đăng ký sự kiện.');
    if(!form.isConnected)return;
    onSettings(settings);
    const key=form.querySelector('[name=api_key]');
    let busy=false;
    function render(){
      const registered=settings.events.url===settings.expected_url;
      status.textContent=(registered?'Đã đăng ký':settings.events.url?'Đã đăng ký nơi khác':'Chưa đăng ký')+
        (settings.motion?.enabled?(settings.motion.mode==='settled'?' · Sau ổn định':' · Khi thay đổi'):' · Phát hiện đang tắt');
      button.textContent=registered?'Đã đăng ký':settings.events.url?'Đăng ký thay thế':'Đăng ký sự kiện';
      button.hidden=registered;
      button.disabled=busy||!camera.enabled||!!key.value.trim();
      remove.hidden=!settings.events.url;
      remove.disabled=busy||!!key.value.trim();
    }
    key.addEventListener('input',render);render();
    button.onclick=async()=>{
      busy=true;render();
      try {
        const current=await backend(),existing=current.backends.find(item=>item.name===saved.backend_name);
        const definition={name:saved.backend_name,description:'Đếm camera khi nhận sự kiện Vision',source:source(camera.camera_id),
          inputSchema:{type:'object',required:['camera_id','timestamp','mode'],additionalProperties:false,
            properties:{camera_id:{type:'string',maxLength:96},timestamp:{type:'integer',minimum:1},mode:{type:'string',enum:['immediate','settled']}}},
          outputSchema:{type:'object'},permissions:{macros:['warehouse-motion-get'],reports:[],devices:{},pages:{[saved.page_id]:[saved.command_id]}}};
        if(existing&&existing.source!==definition.source)throw Error('Backend đã được sửa riêng. Hãy kiểm tra trong Backend.');
        if(!existing)await backend({action:'save',definition});
        const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
        await backend({action:'configure',name:saved.backend_name,config:{syncId:cfg.syncId,enabled:true,externalEnabled:true,authType:'bearer',apiKey:token}});
        await macro('warehouse-motion-save',{camera_id:camera.camera_id,vision_camera_id:settings.camera_id,enabled:'1'});
        await backend({action:'publish',name:saved.backend_name});
        const response=await fetch(url,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:saved.backend_name,token})});
        const result=await response.json();if(!response.ok)throw Error(result.message||'Không đăng ký được camera.');
        settings.events=result;form.querySelector('#camera-error').textContent='';
      } catch(error){if(form.isConnected)form.querySelector('#camera-error').textContent=error.message;}
      finally{busy=false;if(form.isConnected)render();}
    };
    remove.onclick=async()=>{
      busy=true;render();
      try {
        const response=await fetch(url,{method:'DELETE',credentials:'same-origin'});
        const result=await response.json();if(!response.ok)throw Error(result.message||'Không hủy được đăng ký.');
        settings.events=result;
        await macro('warehouse-motion-save',{camera_id:camera.camera_id,vision_camera_id:settings.camera_id,enabled:'0'});
        if(form.isConnected)form.querySelector('#camera-error').textContent='';
      } catch(error){if(form.isConnected)form.querySelector('#camera-error').textContent=error.message;}
      finally{busy=false;if(form.isConnected)render();}
    };
  } catch(error) {if(form.isConnected){status.textContent='Không đọc được đăng ký';form.querySelector('#camera-error').textContent=error.message;}}
}
