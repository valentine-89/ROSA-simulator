(function () {
  'use strict';
  const root = document.getElementById('inventory-root');
  const contextNode = document.getElementById('inventory-page-context');
  const publicPage = Boolean(contextNode);
  const cfg = JSON.parse(document.getElementById(publicPage ? 'inventory-page-context' : 'inventory-config').textContent);
  const session = cfg.databaseSessionId || '';
  const ioid = publicPage ? cfg.ioid : session.split('@')[0];
  let cameras = [], selected = '', offset = 0, loadVersion = 0, leaving = false, requestId = '';
  const byId = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => value ? new Date(value).toLocaleString('vi-VN') : '—';
  const delta = value => value == null ? 'Lần đầu' : (value > 0 ? '+' : '') + value;
  const labels = {applied:'Đã cập nhật',needs_review:'Cần kiểm tra',stale:'Cấu hình đã đổi',failed:'Đếm lỗi',partial:'Kết quả chưa đủ',busy:'Camera đang bận',unknown:'Chưa xác định'};
  function status(text, error) { byId('status').textContent=text; byId('status').className=error?'error':''; }
  async function jsonRequest(url, body) {
    const r = await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d = await r.json();
    if (!r.ok || d.ok === false || d.c1 === 'FAIL') throw new Error(d.message || d.error || 'Không thể xử lý yêu cầu.');
    return d;
  }
  async function macro(name, params = {}) {
    if(!publicPage&&['warehouse-latest','warehouse-history','warehouse-event'].includes(name))name+='-admin';
    const url = publicPage ? '/api/iot-page-macro/'+encodeURIComponent(ioid)+'/'+encodeURIComponent(cfg.pageId)
      : '/api/'+encodeURIComponent(session)+'/'+encodeURIComponent(cfg.syncId)+'/data';
    const d = await jsonRequest(url,publicPage?{macro:name,params}:Object.assign({macro:name},params));
    return d.rows || [];
  }
  function renderShell() {
    root.innerHTML='<header><h1>'+esc(cfg.title||'Kho AI cơ bản')+'</h1><div class="toolbar">'+(publicPage?'<button id="update" class="primary" disabled>Cập nhật</button>':'<button id="add">+ Camera</button><button id="edit" disabled>Cài đặt</button><button id="refresh">↻ Tải lại</button><a id="qr-link" target="_blank" rel="noopener">Trang QR</a>')+'</div></header><nav id="tabs" class="tabs" role="tablist" aria-label="Camera"></nav><div id="status" role="status"></div><section id="latest" class="panel"><div class="empty">Đang tải…</div></section><section class="panel"><h2>Lịch sử kiểm kê</h2><div class="scroll"><table><thead><tr><th>Thời điểm</th><th>Trạng thái</th><th class="number">Tổng</th><th class="number">Thay đổi</th></tr></thead><tbody id="history"></tbody></table></div><button id="more" hidden>Xem thêm</button></section><dialog id="detail"><div class="toolbar"><h2>Chi tiết kiểm kê</h2><button id="close-detail">Đóng</button></div><div id="detail-body"></div></dialog>';
    byId('close-detail').onclick=()=>byId('detail').close();
    byId('more').onclick=()=>loadHistory(true).catch(e=>status(e.message,true));
    byId('tabs').onclick=e=>{const b=e.target.closest('[data-camera]');if(b&&!leaving)select(b.dataset.camera);};
    byId('history').onclick=e=>{const tr=e.target.closest('[data-event]');if(tr)showEvent(tr.dataset.event);};
    if(publicPage) byId('update').onclick=update;
    else {
      byId('add').onclick=()=>editCamera(); byId('edit').onclick=()=>editCamera(cameras.find(c=>c.camera_id===selected));
      byId('refresh').onclick=()=>load().catch(e=>status(e.message,true));
      byId('qr-link').href='/iot-page/'+encodeURIComponent(ioid)+'/warehouse';
      byId('qr-link').onclick=e=>{e.preventDefault();byId('detail-body').innerHTML=window.BiomassQr.svg(byId('qr-link').href,260);byId('detail').showModal();};
    }
  }
  function snapshot(row) {
    if(!row) return '<div class="empty">Chưa có lần kiểm kê thành công.</div>';
    let items=[];try{items=JSON.parse(row.items||'[]');}catch{}
    let image='';try {const u=new URL(row.image_url);if(u.protocol==='https:')image=u.href;}catch{}
    return '<div class="muted">'+esc(date(row.captured_at))+'</div><div class="snapshot"><div>'+ (image?'<a href="'+esc(image)+'" target="_blank" rel="noopener"><img src="'+esc(image)+'" alt="Ảnh kiểm kê" loading="lazy"></a>':'<div class="empty">Không có ảnh</div>')+'</div><div><table><thead><tr><th>Sản phẩm</th><th class="number">Tồn</th><th class="number">Thay đổi</th></tr></thead><tbody>'+items.map(i=>'<tr><td>'+esc(i.name)+'<div class="muted">'+esc(i.sku)+'</div></td><td class="number">'+esc(i.quantity)+'</td><td class="number '+(i.delta<0?'negative':'delta')+'">'+esc(delta(i.delta))+'</td></tr>').join('')+'</tbody></table></div></div>';
  }
  async function load() {
    cameras=await macro(publicPage?'warehouse-cameras':'warehouse-cameras-admin');
    selected=cameras.some(c=>c.camera_id===selected)?selected:(cameras[0]?.camera_id||'');
    if(!publicPage) byId('edit').disabled=!selected;
    await select(selected);
  }
  async function select(id) {
    selected=id; requestId=''; offset=0; const version=++loadVersion;
    byId('tabs').innerHTML=cameras.map(c=>'<button role="tab" aria-selected="'+(c.camera_id===id)+'" data-camera="'+esc(c.camera_id)+'">'+esc(c.area_name)+(c.enabled===0?' · Tắt':'')+'</button>').join('');
    byId('history').innerHTML=''; byId('more').hidden=true;
    if(publicPage)byId('update').disabled=!id||leaving;
    if(!id){byId('latest').innerHTML='<div class="empty">Chưa có camera.</div>';return;}
    status('Đang tải…');
    try { const [rows] = await Promise.all([macro('warehouse-latest',{camera_id:id}),loadHistory(false,version)]);
      if(version!==loadVersion)return; byId('latest').innerHTML=snapshot(rows[0]);status('');
    } catch(e){if(version===loadVersion)status(e.message,true);}
  }
  async function loadHistory(append, version=loadVersion) {
    const rows=await macro('warehouse-history',{camera_id:selected,offset:append?offset:0});
    if(version!==loadVersion)return;
    const html=rows.map(e=>'<tr data-event="'+esc(e.request_id)+'"><td>'+esc(date(e.captured_at||Number(e.requested_at)))+'</td><td><span class="badge">'+esc(labels[e.status]||e.status)+'</span></td><td class="number">'+esc(e.quantity??'—')+'</td><td class="number">'+esc(e.quantity==null?'—':delta(e.delta))+'</td></tr>').join('');
    if(append)byId('history').insertAdjacentHTML('beforeend',html);else byId('history').innerHTML=html||'<tr><td colspan="4" class="empty">Chưa có lịch sử.</td></tr>';
    offset=(append?offset:0)+rows.length;byId('more').hidden=rows.length<30;
  }
  async function showEvent(id) {
    try {const rows=await macro('warehouse-event',{camera_id:selected,request_id:id});if(!rows[0])return;
      byId('detail-body').innerHTML='<p>'+esc(labels[rows[0].status]||rows[0].status)+'</p>'+snapshot(rows[0]);byId('detail').showModal();
    }catch(e){status(e.message,true);}
  }
  async function update() {
    if(leaving||!selected)return; byId('update').disabled=true;
    requestId=requestId||crypto.randomUUID(); status('Đang gửi yêu cầu…');
    try {
      const d=await jsonRequest('/api/iot-cmd/'+encodeURIComponent(ioid)+'/warehouse-count?pageId='+encodeURIComponent(cfg.pageId),{camera_id:selected,request_id:requestId});
      leaving=true; root.innerHTML='<div class="notice" role="status">'+esc(d.message||'Đã nhận yêu cầu. Vui lòng quét lại QR sau để xem kết quả.')+'</div>';
      setTimeout(()=>{window.close();location.replace('/iot-page');},1800);
    }catch(e){status(e.message,true);byId('update').disabled=false;}
  }
  function editCamera(camera) {
    let dialog=byId('camera-editor');if(dialog)dialog.remove();
    dialog=document.createElement('dialog');dialog.id='camera-editor';
    dialog.innerHTML='<form id="camera-form"><div class="toolbar"><h2>'+(camera?'Cài đặt camera':'Thêm camera')+'</h2><button type="button" id="cancel-camera">Đóng</button></div><div class="fields"><label>Khu vực<input name="area_name" required maxlength="120" value="'+esc(camera?.area_name||'')+'"></label><label>API key<input name="api_key" type="password" autocomplete="new-password" maxlength="512" '+(camera?'placeholder="Để trống để giữ nguyên"':'required')+'></label></div><h2>Sản phẩm</h2><table class="map"><thead><tr><th>Mã Vision</th><th>Mã sản phẩm</th><th>Tên sản phẩm</th><th></th></tr></thead><tbody id="map-rows"></tbody></table><div class="toolbar"><button type="button" id="add-map">+ Sản phẩm</button><label class="check"><input name="enabled" type="checkbox" '+(camera?.enabled===0?'':'checked')+'>Hoạt động</label></div><div id="camera-error" role="alert"></div><div class="actions"><button class="primary" type="submit">Lưu camera</button></div></form>';
    root.appendChild(dialog);
    function addMap(m={}) {byId('map-rows').insertAdjacentHTML('beforeend','<tr><td><input data-map="code" aria-label="Mã Vision" required maxlength="160" placeholder="type1" value="'+esc(m.code||'')+'"></td><td><input data-map="sku" aria-label="Mã sản phẩm" required maxlength="96" placeholder="SP01" value="'+esc(m.sku||'')+'"></td><td><input data-map="name" aria-label="Tên sản phẩm" required maxlength="160" value="'+esc(m.name||'')+'"></td><td><button type="button" data-remove aria-label="Xóa sản phẩm">×</button></td></tr>');}
    let mapping=[];try{mapping=JSON.parse(camera?.product_map||'[]');}catch{};(mapping.length?mapping:[{}]).forEach(addMap);
    byId('add-map').onclick=()=>addMap();byId('cancel-camera').onclick=()=>dialog.close();
    byId('map-rows').onclick=e=>{if(e.target.closest('[data-remove]'))e.target.closest('tr').remove();};
    byId('camera-form').onsubmit=async e=>{
      e.preventDefault();const form=e.target;const submit=form.querySelector('[type=submit]');submit.disabled=true;
      try {
        const productMap=Array.from(byId('map-rows').rows).map(tr=>Object.fromEntries(Array.from(tr.querySelectorAll('[data-map]')).map(n=>[n.dataset.map,n.value.trim()])));
        if(!productMap.length||new Set(productMap.map(m=>m.code)).size!==productMap.length||new Set(productMap.map(m=>m.sku)).size!==productMap.length)throw new Error('Mỗi sản phẩm cần một mã Vision và mã sản phẩm riêng.');
        await macro('warehouse-camera-save',{camera_id:camera?.camera_id||crypto.randomUUID(),area_name:form.elements.area_name.value.trim(),api_key:form.elements.api_key.value.trim(),enabled:form.elements.enabled.checked?1:0,product_map:JSON.stringify(productMap)});
        dialog.close();await load();
      } catch(err) {byId('camera-error').textContent=err.message;} finally {submit.disabled=false;}
    };dialog.showModal();
  }
  if(publicPage) window.addEventListener('pageshow',e=>{if(e.persisted)location.replace('/iot-page');});
  try{const theme=localStorage.getItem('sample-dashboard-theme');if(theme)document.documentElement.dataset.theme=theme;}catch{}
  renderShell();load().catch(e=>status(e.message,true));
})();
