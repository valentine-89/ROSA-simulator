const root=new URL('.',import.meta.url).pathname;
function source(cameraId) {
  return `export default async (input, rosa) => {
  const [camera] = await rosa.db.macro('warehouse-schedule-get', {camera_id:${JSON.stringify(cameraId)}});
  if (!camera || !camera.enabled || camera.mode === 'off') return {skipped:true};
  const hour = new Date(Date.now() + 7 * 3600000).getUTCHours();
  if (camera.mode === 'window') {
    const inside = camera.start_hour < camera.end_hour
      ? hour >= camera.start_hour && hour < camera.end_hour
      : hour >= camera.start_hour || hour < camera.end_hour;
    if (!inside) return {skipped:true,reason:'outside_window'};
  }
  return await rosa.page.command(camera.page_id, camera.command_id, {camera_id:camera.camera_id});
}`;
}
export async function mount(form, camera, cfg, macro) {
  if(!document.getElementById('camera-schedule-style')) {
    const style=document.createElement('link');style.id='camera-schedule-style';style.rel='stylesheet';style.href=root+'camera-schedules.css';document.head.appendChild(style);
  }
  const box=document.createElement('div');box.className='camera-schedule-controls';
  box.innerHTML='<label class="check"><input type="checkbox" data-auto-enabled>Tự động mỗi giờ</label><select data-auto-mode aria-label="Thời gian tự động"><option value="all">Cả ngày</option><option value="window">Khung giờ</option></select><span data-auto-window hidden><select data-auto-start aria-label="Giờ bắt đầu"></select><span>–</span><select data-auto-end aria-label="Giờ kết thúc"></select><small>UTC+7</small></span>';
  const enabled=box.querySelector('[data-auto-enabled]'),mode=box.querySelector('[data-auto-mode]'),start=box.querySelector('[data-auto-start]'),end=box.querySelector('[data-auto-end]');
  enabled.disabled=true;mode.disabled=true;
  for(let h=0;h<24;h++)start.add(new Option(String(h).padStart(2,'0')+':00',String(h)));
  for(let h=1;h<=24;h++)end.add(new Option(String(h).padStart(2,'0')+':00',String(h)));
  let saved=camera?(await macro('warehouse-schedule-get',{camera_id:camera.camera_id}))[0]:null;
  if(camera&&!saved)throw Error('Thiếu cấu hình lịch camera.');
  enabled.checked=!!saved&&saved.mode!=='off';enabled.disabled=false;mode.value=saved?.mode==='window'?'window':'all';start.value=String(saved?.start_hour??6);end.value=String(saved?.end_hour??18);
  form.querySelector('#add-map').closest('.panel-heading').before(box);
  const render=()=>{mode.disabled=!enabled.checked;box.querySelector('[data-auto-window]').hidden=!enabled.checked||mode.value!=='window';};enabled.onchange=render;mode.onchange=render;render();
  const ioid=cfg.databaseSessionId.split('@')[0];
  async function backend(body) {
    const response=await fetch('/api/backends'+(body?'':'?ioid='+encodeURIComponent(ioid)),{method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify({...body,ioid}):undefined});
    const result=await response.json();if(!response.ok)throw Error(result.message||'Không lưu được lịch backend.');return result;
  }
  return {async save(cameraId,cameraEnabled) {
    const selected=enabled.checked&&cameraEnabled?mode.value:'off';
    if(selected==='window'&&start.value===end.value)throw Error('Giờ bắt đầu và kết thúc phải khác nhau.');
    saved=(await macro('warehouse-schedule-get',{camera_id:cameraId}))[0];
    if(!saved)throw Error('Không tìm thấy cấu hình lịch camera.');
    if(selected==='off'&&saved.mode==='off')return;
    await backend({action:'connect',sessionId:cfg.databaseSessionId});
    const inventory=await backend();
    if(inventory.ioid!==ioid)throw Error('Phiên thiết bị đã thay đổi.');
    if(selected!=='off'&&inventory.settings.scheduleMinHours>1)throw Error('Chu kỳ tối thiểu trong /manage lớn hơn 1 giờ.');
    const existing=inventory.backends.find(item=>item.name===saved.backend_name);
    if(existing?.config.syncId&&existing.config.syncId!==(inventory.simulation?'SIM_SYNC':cfg.syncId))throw Error('Backend đang dùng SyncID khác.');
    if(selected!=='off') {
      const definition={name:saved.backend_name,description:'Kiểm kê camera tự động theo giờ Việt Nam',source:source(cameraId),
        inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema:{type:'object'},
        permissions:{macros:['warehouse-schedule-get'],reports:[],devices:{},pages:{[saved.page_id]:[saved.command_id]}}};
      if(existing&&existing.source!==definition.source)throw Error('Backend đã được chỉnh sửa riêng. Hãy kiểm tra trong Backend trước khi bật lịch.');
      if(!existing)await backend({action:'save',definition});
      await backend({action:'configure',name:saved.backend_name,config:{...existing?.config,syncId:cfg.syncId,enabled:true}});
      await backend({action:'publish',name:saved.backend_name});
    }
    if(existing||selected!=='off')await backend({action:'schedule',name:saved.backend_name,expectedScheduleRevision:existing?.schedule?.revision||0,schedule:{enabled:selected!=='off',intervalHours:1}});
    await macro('warehouse-schedule-save',{camera_id:cameraId,mode:selected,start_hour:Number(start.value),end_hour:Number(end.value),expected_revision:saved.revision});
  }};
}
export {source};
