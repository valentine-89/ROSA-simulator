(function () {
  'use strict';
  const root = document.getElementById('inventory-root');
  const contextNode = document.getElementById('inventory-page-context');
  const publicPage = Boolean(contextNode);
  const cfg = JSON.parse(document.getElementById(publicPage ? 'inventory-page-context' : 'inventory-config').textContent);
  const pageMeta = publicPage ? JSON.parse(document.getElementById('inventory-page-meta').textContent) : null;
  const iotMode = (publicPage ? pageMeta.publicApi.warehouseMode : cfg.warehouseMode) === 'iot';
  const session = cfg.databaseSessionId || '';
  const ioid = publicPage ? cfg.ioid : session.split('@')[0];
  let cameras = [], selected = '', selectedEvent = '', offset = 0, loadVersion = 0, eventVersion = 0, leaving = false, requestId = '';
  const byId = id => document.getElementById(id);
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => value ? new Date(value).toLocaleString('vi-VN') : '—';
  const delta = value => value == null ? 'Lần đầu' : (value > 0 ? '+' : '') + value;
  const labels = {applied:'Đã cập nhật',needs_review:'Cần kiểm tra',stale:'Cấu hình đã đổi',failed:'Đếm lỗi',partial:'Kết quả chưa đủ',busy:'Camera đang bận',unknown:'Chưa xác định'};
  const settingsIcon='<span aria-hidden="true">⚙︎</span>';
  const copyIcon='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>';
  // Copied from monitoring-aquaculture-ponds; appearance comes entirely from dashboard-themes.css.
  const themePickerHtml = `<div class="theme-picker" id="theme-picker">
    <button class="theme-picker-toggle" type="button" id="theme-picker-toggle" aria-label="Chọn giao diện"
      aria-haspopup="true" aria-expanded="false">&#127912;</button>
    <div class="theme-picker-menu" id="theme-picker-menu" role="menu" aria-label="Tùy chọn giao diện">
      <button class="theme-menu-button" type="button" data-theme-option="neumorphism"
        role="menuitemradio">Neumorphism</button>
      <button class="theme-menu-button" type="button" data-theme-option="aurora-ui" role="menuitemradio">Aurora
        UI</button>
      <button class="theme-menu-button" type="button" data-theme-option="modern-flat" role="menuitemradio">Modern
        Flat</button>
      <button class="theme-menu-button" type="button" data-theme-option="glassmorphism"
        role="menuitemradio">Glassmorphism</button>
      <button class="theme-menu-button" type="button" data-theme-option="cyberpunk"
        role="menuitemradio">Cyberpunk</button>
      <button class="theme-menu-button" type="button" data-theme-option="neo-brutalism" role="menuitemradio">Neo
        Brutalism</button>
      <button class="theme-menu-button" type="button" data-theme-option="bento-grid" role="menuitemradio">Bento
        Grid</button>
    </div>
  </div>`;
  let themePickerToggle, themePickerMenu;
  function status(text, error) { byId('status').textContent=text; byId('status').className=error?'error':''; }
  async function jsonRequest(url, body) {
    const r = await fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d = await r.json();
    if (!r.ok || d.ok === false || d.c1 === 'FAIL') throw new Error(d.message || d.error || 'Không thể xử lý yêu cầu.');
    return d;
  }
  async function macro(name, params = {}) {
    if(publicPage) { params={...params}; delete params.camera_id; }
    if(!publicPage&&['warehouse-latest','warehouse-history','warehouse-event'].includes(name))name+='-admin';
    const url = publicPage ? '/api/iot-page-macro/'+encodeURIComponent(ioid)+'/'+encodeURIComponent(cfg.pageId)
      : '/api/'+encodeURIComponent(session)+'/'+encodeURIComponent(cfg.syncId)+'/data';
    const d = await jsonRequest(url,publicPage?{macro:name,params}:Object.assign({macro:name},params));
    return Array.isArray(d) ? d : (Array.isArray(d.rows) ? d.rows : []);
  }
  function renderShell() {
    const title=cfg.title==='Kho AI cơ bản'?'Quản lý kho':(cfg.title||'Quản lý kho');
    document.title=publicPage?'Kiểm kê kho':title;
    document.body.classList.toggle('employee',publicPage);
    const tabs='<nav id="tabs" class="tabs" role="tablist" aria-label="Camera"></nav>';
    if(publicPage) {
      root.innerHTML='<header><span class="eyebrow">KIỂM KÊ KHO</span><h1 id="area-title">Kiểm kê kho</h1></header>'+tabs+'<div id="status" role="status"></div><section id="latest"><div class="empty">Đang tải…</div></section><div class="update-action"><button id="update" class="primary" disabled>Cập nhật</button></div><section id="employee-photo"></section>';
      byId('update').onclick=update;
    } else {
      root.innerHTML='<header class="admin-header"><div><h1>'+esc(title)+'</h1></div><div class="toolbar"><button id="add">+ Camera</button><button id="refresh" aria-label="Tải lại">↻ Tải lại</button></div></header><div id="status" role="status"></div><div class="warehouse-grid"><section class="panel history-panel"><div class="history-heading"><h2>Camera & lịch sử</h2><label class="check"><input id="hide-errors" type="checkbox">Ẩn lỗi</label></div>'+tabs+'<div class="scroll history-scroll"><table><thead><tr><th>Thời điểm</th><th>Trạng thái</th><th class="number">Tổng</th><th class="number">±</th></tr></thead><tbody id="history"></tbody></table></div><button id="more" hidden>Xem thêm</button></section><section class="panel image-panel" aria-label="Ảnh và sản phẩm kiểm kê"><div id="latest"><div class="empty">Chọn lần kiểm kê để xem ảnh.</div></div></section><section class="panel stock-panel"><h2>Tổng tồn kho</h2><div id="stock"><div class="empty">Đang tải…</div></div></section></div>';
      byId('hide-errors').onchange=()=>select(selected);
      byId('more').onclick=()=>loadHistory(true).catch(e=>status(e.message,true));
      byId('history').onclick=e=>{const tr=e.target.closest('[data-event]');if(tr)showEvent(tr.dataset.event);};
      byId('history').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){const tr=e.target.closest('[data-event]');if(tr){e.preventDefault();showEvent(tr.dataset.event);}}};
      byId('add').onclick=()=>editCamera();
      byId('refresh').onclick=()=>load().catch(e=>status(e.message,true));
      root.insertAdjacentHTML('beforeend',themePickerHtml);
      themePickerToggle=byId('theme-picker-toggle');themePickerMenu=byId('theme-picker-menu');
      document.addEventListener('click', function (event) {
        var themeOption = event.target && typeof event.target.closest === 'function' ? event.target.closest('[data-theme-option]') : null;
        if (themeOption) {
          setTheme(String(themeOption.getAttribute('data-theme-option') || 'neumorphism'));
          closeThemePickerMenu();
          return;
        }
        var themeToggle = event.target && typeof event.target.closest === 'function' ? event.target.closest('#theme-picker-toggle') : null;
        if (themeToggle) {
          if (themePickerMenu.classList.contains('is-open')) closeThemePickerMenu();
          else openThemePickerMenu();
          return;
        }
        if (!themePickerMenu.contains(event.target)) closeThemePickerMenu();
      });


    }
    byId('tabs').onclick=e=>{
      const edit=e.target.closest('[data-edit-camera]');
      if(edit&&!publicPage){editCamera(cameras.find(c=>c.camera_id===edit.dataset.editCamera));return;}
      const b=e.target.closest('[data-camera]');if(b&&!leaving)select(b.dataset.camera);
    };
  }
      function setTheme(nextTheme) {
        document.documentElement.setAttribute("data-theme", nextTheme);
        try { window.localStorage.setItem("sample-dashboard-theme", nextTheme); } catch (error) {}
        Array.prototype.forEach.call(themePickerMenu.querySelectorAll("[data-theme-option]"), function (button) {
          var isActive = String(button.getAttribute("data-theme-option") || "") === nextTheme;
          button.setAttribute("aria-pressed", isActive ? "true" : "false");
          button.setAttribute("aria-checked", isActive ? "true" : "false");
        });
      }

      function closeThemePickerMenu() {
        themePickerMenu.classList.remove("is-open");
        themePickerToggle.setAttribute("aria-expanded", "false");
      }

      function openThemePickerMenu() {
        themePickerMenu.classList.add("is-open");
        themePickerToggle.setAttribute("aria-expanded", "true");
      }

  function itemsOf(row) {try{return JSON.parse(row?.items||'[]');}catch{return [];}}
  function photo(row) {
    let image='';try {const u=new URL(row.image_url);if(u.protocol==='https:')image=u.href;}catch{}
    return image?'<a class="photo" href="'+esc(image)+'" target="_blank" rel="noopener"><img src="'+esc(image)+'" alt="Ảnh kiểm kê" loading="lazy"></a>':'<div class="empty">Chưa có ảnh</div>';
  }
  function snapshot(row) {
    if(!row)return '<div class="empty">Chưa có lần kiểm kê.</div>';
    return photo(row)+'<ul class="snapshot-products" aria-label="Sản phẩm kiểm kê">'+itemsOf(row).map(i=>'<li><span class="product-name">'+esc(i.name)+'<small class="muted">'+esc(i.sku)+'</small></span><span class="product-count"><strong aria-label="Số lượng: '+esc(i.quantity)+'">'+esc(i.quantity)+'</strong>'+(i.delta==null?'':'<small class="muted" aria-label="Thay đổi: '+esc(delta(i.delta))+'">('+esc(delta(i.delta))+')</small>')+'</span></li>').join('')+'</ul>';
  }
  function employeeSnapshot(row) {
    byId('latest').innerHTML=row?'<div class="employee-items">'+itemsOf(row).map(i=>'<div class="employee-item"><span>'+esc(i.name)+'</span><strong>'+esc(i.quantity)+'</strong></div>').join('')+'</div><p class="updated-time">'+esc(date(row.captured_at))+'</p>':'<div class="empty">Chưa có số lượng kiểm kê.</div>';
    byId('employee-photo').innerHTML=row?photo(row):'';
  }
  async function loadStock() {
    const rows=await macro('warehouse-stock');
    byId('stock').innerHTML=rows.length?'<table><thead><tr><th>Sản phẩm</th><th class="number">Số lượng</th></tr></thead><tbody>'+rows.map(i=>'<tr><td><strong class="stock-name">'+esc(i.name)+'</strong><div class="muted">'+esc(i.sku)+'</div></td><td class="number"><strong class="stock-quantity">'+esc(i.quantity??'—')+'</strong>'+(i.counted_areas<i.areas?'<div class="muted">'+esc(i.counted_areas)+'/'+esc(i.areas)+' khu vực</div>':'')+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">Chưa có sản phẩm.</div>';
  }
  async function load() {
    cameras=await macro(publicPage?'warehouse-camera':'warehouse-cameras-admin');
    selected=cameras.some(c=>c.camera_id===selected)?selected:(cameras[0]?.camera_id||'');
    await Promise.all([select(selected),...(!publicPage?[loadStock()]:[])]);
  }
  async function select(id) {
    selected=id; selectedEvent=''; requestId=''; offset=0; const version=++loadVersion;eventVersion++;
    byId('tabs').innerHTML=cameras.map(c=>'<span class="camera-tab'+(c.camera_id===id?' is-selected':'')+'" role="presentation"><button role="tab" aria-selected="'+(c.camera_id===id)+'" data-camera="'+esc(c.camera_id)+'">'+esc(c.area_name)+(c.enabled===0?' · Tắt':'')+'</button>'+(!publicPage?'<button type="button" class="camera-settings icon-button" data-edit-camera="'+esc(c.camera_id)+'" aria-label="Cài đặt camera '+esc(c.area_name)+'" title="Cài đặt camera">'+settingsIcon+'</button>':'')+'</span>').join('');
    if(publicPage){byId('update').disabled=!id||leaving;byId('area-title').textContent=cameras.find(c=>c.camera_id===id)?.area_name||'Kiểm kê kho';byId('tabs').hidden=cameras.length<2;byId('employee-photo').innerHTML='';}
    else{byId('history').innerHTML='';byId('more').hidden=true;}
    byId('latest').innerHTML='<div class="empty">'+(id?'Đang tải…':'Chưa có camera.')+'</div>';
    if(!id){status('');return;}
    status('Đang tải…');
    try {
      if(publicPage){const rows=await macro('warehouse-latest',{camera_id:id});if(version!==loadVersion)return;employeeSnapshot(rows[0]);}
      else await loadHistory(false,version);
      if(version===loadVersion)status('');
    } catch(e){if(version===loadVersion)status(e.message,true);}
  }
  async function loadHistory(append, version=loadVersion) {
    const rows=await macro('warehouse-history',{camera_id:selected,offset:append?offset:0,hide_errors:byId('hide-errors').checked?1:0});
    if(version!==loadVersion)return;
    const html=rows.map(e=>'<tr tabindex="0" aria-selected="false" data-event="'+esc(e.request_id)+'"><td>'+esc(date(e.captured_at||Number(e.requested_at)))+'<div class="staff-phone muted">'+esc(e.actor||'')+'</div></td><td><span class="badge" title="'+esc(e.error||'')+'">'+esc(e.error==='IMAGE_TOO_DARK'?'Ảnh quá tối':labels[e.status]||e.status)+'</span></td><td class="number">'+esc(e.quantity??'—')+'</td><td class="number">'+esc(e.quantity==null?'—':delta(e.delta))+'</td></tr>').join('');
    if(append)byId('history').insertAdjacentHTML('beforeend',html);else byId('history').innerHTML=html||'<tr><td colspan="4" class="empty">Chưa có lịch sử.</td></tr>';
    offset=(append?offset:0)+rows.length;byId('more').hidden=rows.length<30;
    if(!append){if(rows[0])await showEvent(rows[0].request_id,version);else byId('latest').innerHTML='<div class="empty">Chưa có lần kiểm kê.</div>';}
  }
  async function showEvent(id, version=loadVersion) {
    const detailVersion=++eventVersion;selectedEvent=id;
    byId('history').querySelectorAll('[data-event]').forEach(tr=>tr.setAttribute('aria-selected',String(tr.dataset.event===id)));
    byId('latest').innerHTML='<div class="empty">Đang tải ảnh…</div>';
    try {const rows=await macro('warehouse-event',{camera_id:selected,request_id:id});if(version!==loadVersion||detailVersion!==eventVersion||selectedEvent!==id)return;
      byId('latest').innerHTML=snapshot(rows[0]);
    }catch(e){if(version===loadVersion&&detailVersion===eventVersion){byId('latest').innerHTML='<div class="empty">Không tải được lần kiểm kê này.</div>';status(e.message,true);}}
  }
  async function update() {
    if(leaving||!selected)return; byId('update').disabled=true;
    requestId=requestId||crypto.randomUUID(); status('Đang gửi yêu cầu…');
    try {
      const d=await jsonRequest('/api/iot-cmd/'+encodeURIComponent(ioid)+'/'+encodeURIComponent(pageMeta.publicApi.allowedCommands[0])+'?pageId='+encodeURIComponent(cfg.pageId),{camera_id:selected,request_id:requestId});
      leaving=true; root.innerHTML='<div class="notice" role="status">'+esc(d.message||'Đã nhận yêu cầu. Vui lòng quét lại QR sau để xem kết quả.')+'</div>';
      setTimeout(()=>{window.close();location.replace('/iot-page');},1800);
    }catch(e){status(e.message,true);byId('update').disabled=false;}
  }
  function cameraUrl(id) {const link=document.createElement('a');link.href='/iot-page/'+encodeURIComponent(ioid)+'/warehouse-'+encodeURIComponent(id);return link.href;}
  async function copyQr(id,button) {
    const url=cameraUrl(id);
    try {
      try {await navigator.clipboard.writeText(url);} catch (_) {
        const input=document.createElement('textarea');input.value=url;button.parentElement.appendChild(input);input.select();
        const copied=document.execCommand('copy');input.remove();if(!copied)throw Error('copy');
      }
      button.innerHTML='✓';button.title='Đã sao chép';button.setAttribute('aria-label','Đã sao chép');
    } catch (_) {button.title='Không thể sao chép';button.setAttribute('aria-label','Không thể sao chép');}
  }
  function editCamera(camera) {
    let dialog=byId('camera-editor');if(dialog)dialog.remove();
    dialog=document.createElement('dialog');dialog.id='camera-editor';
    const qr=camera?'<div class="camera-qr"><a id="camera-qr-link" href="'+esc(cameraUrl(camera.camera_id))+'" target="_blank" rel="noopener" aria-label="Mở trang nhân viên '+esc(camera.area_name)+'" title="Mở trang nhân viên">'+window.BiomassQr.svg(cameraUrl(camera.camera_id),160)+'</a><button type="button" id="camera-copy-qr" class="icon-button" aria-label="Sao chép link QR" title="Sao chép link QR">'+copyIcon+'</button></div>':'';
    dialog.innerHTML='<form id="camera-form"><div class="panel-heading"><h2>'+(camera?'Cài đặt camera':'Thêm camera')+'</h2><button type="button" id="cancel-camera" class="icon-button" aria-label="Đóng">×</button></div><div class="camera-overview'+(camera?' has-qr':'')+'"><div class="fields"><label>Khu vực<input name="area_name" required maxlength="120" value="'+esc(camera?.area_name||'')+'"></label><label>API key<input name="api_key" type="password" autocomplete="new-password" maxlength="512" '+(camera?'placeholder="Để trống để giữ nguyên"':'required')+'></label></div>'+qr+'</div><div class="panel-heading"><h2>Sản phẩm</h2><button type="button" id="add-map">+ Sản phẩm</button></div><table class="map"><thead><tr><th>Mã Vision</th><th>Mã sản phẩm</th><th>Tên sản phẩm</th><th></th></tr></thead><tbody id="map-rows"></tbody></table><div id="camera-error" role="alert"></div><div class="camera-footer"><label class="check"><input name="enabled" type="checkbox" '+(camera?.enabled===0?'':'checked')+'>Hoạt động</label><button class="primary" type="submit">Lưu camera</button></div></form>';
    root.appendChild(dialog);
    if(iotMode) dialog.querySelector('.fields').insertAdjacentHTML('beforeend','<label>Chương trình IO<input name="io_command" required pattern="N[0-9]{1,4}" maxlength="5" value="'+esc(camera?.io_command||'N20')+'"></label>');
    if(camera){
      byId('camera-copy-qr').onclick=e=>copyQr(camera.camera_id,e.currentTarget);
    }
    function addMap(m={}) {byId('map-rows').insertAdjacentHTML('beforeend','<tr><td><input data-map="code" aria-label="Mã Vision" required maxlength="160" placeholder="type1" value="'+esc(m.code||'')+'"></td><td><input data-map="sku" aria-label="Mã sản phẩm" required maxlength="96" placeholder="SP01" value="'+esc(m.sku||'')+'"></td><td><input data-map="name" aria-label="Tên sản phẩm" required maxlength="160" value="'+esc(m.name||'')+'"></td><td><button type="button" data-remove aria-label="Xóa sản phẩm">×</button></td></tr>');}
    let mapping=[];try{mapping=JSON.parse(camera?.product_map||'[]');}catch{};(mapping.length?mapping:[{}]).forEach(addMap);
    byId('add-map').onclick=()=>addMap();byId('cancel-camera').onclick=()=>dialog.close();
    byId('map-rows').onclick=e=>{if(e.target.closest('[data-remove]'))e.target.closest('tr').remove();};
    byId('camera-form').onsubmit=async e=>{
      e.preventDefault();const form=e.target;const submit=form.querySelector('[type=submit]');submit.disabled=true;
      try {
        const productMap=Array.from(byId('map-rows').rows).map(tr=>Object.fromEntries(Array.from(tr.querySelectorAll('[data-map]')).map(n=>[n.dataset.map,n.value.trim()])));
        if(!productMap.length||new Set(productMap.map(m=>m.code)).size!==productMap.length||new Set(productMap.map(m=>m.sku)).size!==productMap.length)throw new Error('Mỗi sản phẩm cần một mã Vision và mã sản phẩm riêng.');
        const cameraId=camera?.camera_id||crypto.randomUUID();
        await macro('warehouse-camera-save',{camera_id:cameraId,area_name:form.elements.area_name.value.trim(),api_key:form.elements.api_key.value.trim(),enabled:form.elements.enabled.checked?1:0,product_map:JSON.stringify(productMap),...(iotMode?{io_command:form.elements.io_command.value.trim()}: {})});
        selected=cameraId;dialog.close();await load();
      } catch(err) {byId('camera-error').textContent=err.message;} finally {submit.disabled=false;}
    };dialog.showModal();
  }
  if(publicPage) window.addEventListener('pageshow',e=>{if(e.persisted)location.replace('/iot-page');});
  renderShell();
  if(!publicPage){
    try {var savedTheme=window.localStorage.getItem('sample-dashboard-theme');if(savedTheme)document.documentElement.setAttribute('data-theme',savedTheme);}catch{}
    setTheme(document.documentElement.getAttribute('data-theme') || 'neumorphism');
  }
  load().catch(e=>status(e.message,true));
})();
