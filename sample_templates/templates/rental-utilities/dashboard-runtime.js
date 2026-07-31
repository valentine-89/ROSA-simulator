(function () {
  "use strict";
  var state = { config: null, rooms: [], values: Object.create(null), streams: [], reconnect: [], filter: "all", online: 0, totalSessions: 0 };
  var colors = ["#f59e0b", "#0ea5e9", "#8b5cf6", "#22c55e", "#ef4444", "#14b8a6"];

  function byId(id) { return document.getElementById(id); }
  function esc(value) { return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function text(value, fallback) { var v = String(value == null ? "" : value).trim(); return v || String(fallback || ""); }
  function number(value, fallback) { var n = Number(value); return Number.isFinite(n) ? n : Number(fallback || 0); }
  function hydrate(raw) {
    var ctx = window.ROSA_SIMULATOR_CONTEXT || {};
    return String(raw || "").replace(/<<sessionid>>/gi, text(ctx.sessionId, "IO123abcd@simulate")).replace(/<<syncid>>/gi, text(ctx.syncId, "SIM_SYNC"));
  }
  function parseConfig() {
    try { return JSON.parse(hydrate(byId("rental-utilities-config").textContent)); }
    catch (error) { return null; }
  }
  function normalizeRoom(room, index) {
    var raw = room && typeof room === "object" ? room : {};
    var fields = raw.fields || {}, commands = raw.commands || {};
    return {
      code: text(raw.code, "P" + (index + 1)), tenant: text(raw.tenant, "Phòng trống"), sessionId: text(raw.sessionId, ""), rent: number(raw.rent, 0), electricStart: number(raw.electricStart, 0), waterStart: number(raw.waterStart, 0),
      fields: { electricity:text(fields.electricity,""), water:text(fields.water,""), power:text(fields.power,""), paid:text(fields.paid,""), relay:text(fields.relay,"") },
      commands: { on:text(commands.on,""), off:text(commands.off,"") }, accent: text(raw.accent, colors[index % colors.length])
    };
  }
  function key(sessionId, field) { return String(sessionId || "") + "\n" + String(field || "").toLowerCase(); }
  function get(room, name) { return state.values[key(room.sessionId, room.fields[name])]; }
  function set(sessionId, field, value) { if (field) state.values[key(sessionId, field)] = value; }
  function numeric(value) { var m = String(value == null ? "" : value).match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : 0; }
  function isOn(value) { return /^(1|true|on|closed|paid)$/i.test(String(value == null ? "" : value).trim()); }
  function money(value) { try { return new Intl.NumberFormat("vi-VN", { style:"currency", currency:"VND", maximumFractionDigits:0 }).format(Math.max(0,number(value,0))); } catch (e) { return Math.round(value).toLocaleString("vi-VN") + " ₫"; } }
  function decimal(value, digits) { return number(value,0).toLocaleString("vi-VN", { minimumFractionDigits:digits, maximumFractionDigits:digits }); }
  function monthLabel() { return new Date().toLocaleDateString("vi-VN", { month:"2-digit", year:"numeric" }); }
  function fieldList(room) { return Object.keys(room.fields).map(function(k){return room.fields[k];}).filter(Boolean); }
  function sessionGroups() {
    var groups = Object.create(null);
    state.rooms.forEach(function(room){ if(!room.sessionId)return; if(!groups[room.sessionId])groups[room.sessionId]=Object.create(null); fieldList(room).forEach(function(f){groups[room.sessionId][f]=true;}); });
    return groups;
  }
  function telemetryUrl(sessionId, fields) { if(!sessionId||!state.config.syncId)return ""; var q=new URLSearchParams();q.set("fields",fields.join(","));return "/api/"+encodeURIComponent(sessionId)+"/"+encodeURIComponent(state.config.syncId)+"/iotelemetry?"+q; }
  function streamUrl(sessionId, fields) { var q=new URLSearchParams();q.set("fields",fields.join(","));return "/api/"+encodeURIComponent(sessionId)+"/stream?"+q; }
  function commandUrl(sessionId) { var s=String(sessionId||""),p=s.indexOf("@");return p>0?"https://iot.ioeasy.com/cmd/"+encodeURIComponent(s.slice(0,p))+"?apiKey="+encodeURIComponent(s.slice(p+1)):""; }
  function applyPayload(sessionId, payload) { if(!payload||typeof payload!=="object")return;Object.keys(payload).forEach(function(field){set(sessionId,field,payload[field]);});render(); }
  function fetchSnapshot(sessionId, fields) { var url=telemetryUrl(sessionId,fields);if(!url)return Promise.resolve();return fetch(url,{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(p){var data=p&&p.c2&&p.c2.payload;if(data)applyPayload(sessionId,data);}).catch(function(){}); }
  function connect(sessionId, fields, index) {
    if(typeof EventSource==="undefined")return;var url=streamUrl(sessionId,fields),source;
    try{source=new EventSource(url);state.streams[index]=source;source.onopen=function(){state.online=Math.min(state.totalSessions,state.online+1);renderConnection();};source.onmessage=function(event){try{var data=JSON.parse(event.data);if(data.type==="telemetry")applyPayload(sessionId,data.payload);}catch(e){}};source.onerror=function(){source.close();state.streams[index]=null;state.online=Math.max(0,state.online-1);renderConnection();clearTimeout(state.reconnect[index]);state.reconnect[index]=setTimeout(function(){connect(sessionId,fields,index);},3000);};}catch(e){}
  }
  function roomBill(room) {
    var electricity=Math.max(0,numeric(get(room,"electricity"))-room.electricStart),water=Math.max(0,numeric(get(room,"water"))-room.waterStart);
    var electricCost=electricity*state.config.electricRate,waterCost=water*state.config.waterRate,total=room.rent+electricCost+waterCost+state.config.serviceFee;
    return { electricity:electricity, water:water, electricCost:electricCost, waterCost:waterCost, total:total, power:numeric(get(room,"power")), paid:isOn(get(room,"paid")), relay:isOn(get(room,"relay")) };
  }
  function roomHtml(room,index) {
    var bill=roomBill(room),hidden=state.filter==="paid"&&!bill.paid||state.filter==="unpaid"&&bill.paid;
    return '<article class="ru-room" data-room="'+index+'" data-paid="'+bill.paid+'" style="--room-accent:'+esc(room.accent)+'"'+(hidden?' hidden':'')+'><div class="ru-room-head"><div class="ru-room-title"><h3>'+esc(room.code)+'</h3><p>'+esc(room.tenant)+'</p></div><div class="ru-status" data-paid="'+bill.paid+'">'+(bill.paid?'✓ Đã thanh toán':'● Chưa thanh toán')+'</div></div><div class="ru-meter-grid"><div class="ru-meter"><span>Điện tháng này</span><strong>'+decimal(bill.electricity,1)+' kWh</strong></div><div class="ru-meter"><span>Nước tháng này</span><strong>'+decimal(bill.water,1)+' m³</strong></div><div class="ru-meter"><span>Công suất</span><strong>'+decimal(bill.power,0)+' W</strong></div></div><div class="ru-cost"><div class="ru-cost-row"><span>Tiền phòng</span><strong>'+money(room.rent)+'</strong></div><div class="ru-cost-row"><span>Tiền điện</span><strong>'+money(bill.electricCost)+'</strong></div><div class="ru-cost-row"><span>Tiền nước</span><strong>'+money(bill.waterCost)+'</strong></div><div class="ru-cost-row"><span>Phí dịch vụ</span><strong>'+money(state.config.serviceFee)+'</strong></div><div class="ru-cost-row ru-cost-total"><span>Tổng dự kiến</span><strong>'+money(bill.total)+'</strong></div></div><div class="ru-room-foot"><div class="ru-power"><span>Nguồn điện phòng</span><strong>'+(bill.relay?'Đang bật':'Đang tắt')+'</strong></div><button class="ru-switch" type="button" data-power="'+index+'" data-state="'+(bill.relay?'on':'off')+'" aria-label="Điều khiển điện '+esc(room.code)+'"></button></div></article>';
  }
  function renderKpis() {
    var bills=state.rooms.map(roomBill),unpaid=bills.filter(function(b){return !b.paid;}).length,total=bills.reduce(function(s,b){return s+b.total;},0),electric=bills.reduce(function(s,b){return s+b.electricity;},0),water=bills.reduce(function(s,b){return s+b.water;},0);
    byId("ru-kpis").innerHTML=[
      ["🏠","Phòng đang thuê",state.rooms.length+" phòng",unpaid+" phòng chưa thu"],
      ["⚡","Điện tháng này",decimal(electric,1)+" kWh",money(electric*state.config.electricRate)],
      ["💧","Nước tháng này",decimal(water,1)+" m³",money(water*state.config.waterRate)],
      ["₫","Doanh thu dự kiến",money(total),"Hạn thu ngày "+state.config.dueDay]
    ].map(function(k){return '<article class="ru-kpi"><div class="ru-kpi-head"><span>'+k[1]+'</span><span class="ru-kpi-icon">'+k[0]+'</span></div><div class="ru-kpi-value">'+k[2]+'</div><div class="ru-kpi-note">'+k[3]+'</div></article>';}).join("");
    byId("ru-summary-text").textContent=state.rooms.length+" phòng · "+unpaid+" phòng chưa thanh toán";
  }
  function renderConnection() { var online=state.online>0,dot=byId("ru-live-dot"),label=byId("ru-live-text");dot.setAttribute("data-state",online?"online":"offline");label.textContent=online?"Đang trực tuyến":"Mất kết nối"; }
  function render() { if(!state.config)return;renderKpis();byId("ru-room-grid").innerHTML=state.rooms.length?state.rooms.map(roomHtml).join(""):'<div class="ru-empty">Chưa có phòng nào được cấu hình.</div>';renderConnection(); }
  function toast(message,type){var node=document.createElement("div");node.className="ru-toast "+(type||"");node.textContent=message;byId("ru-toast-stack").appendChild(node);setTimeout(function(){node.remove();},3200);}
  function runCommand(room,command) { var url=commandUrl(room.sessionId);if(!url||!command)return Promise.reject(new Error("missing command"));var resolver=window.AIBridgeCommandTemplate;var promise=resolver&&resolver.resolveCommandTemplate?resolver.resolveCommandTemplate(command):Promise.resolve(command);return promise.then(function(cmd){return fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cmd:cmd})}).then(function(r){if(!r.ok)throw new Error("command failed");});}); }
  function bindActions() {
    document.addEventListener("click",function(event){var filter=event.target.closest("[data-filter]");if(filter){state.filter=filter.getAttribute("data-filter");document.querySelectorAll("[data-filter]").forEach(function(b){b.classList.toggle("is-active",b===filter);});render();return;}var button=event.target.closest("[data-power]");if(!button)return;var room=state.rooms[Number(button.getAttribute("data-power"))];if(!room)return;var next=button.getAttribute("data-state")!=="on",command=next?room.commands.on:room.commands.off;button.disabled=true;runCommand(room,command).then(function(){set(room.sessionId,room.fields.relay,next?"ON":"OFF");toast("Đã gửi lệnh đến "+room.code);render();}).catch(function(){button.disabled=false;toast("Không gửi được lệnh điều khiển.","error");});});
  }
  function bindTheme() { var picker=byId("theme-picker"),toggle=byId("theme-picker-toggle"),menu=byId("theme-picker-menu");function open(value){picker.classList.toggle("is-open",value);toggle.setAttribute("aria-expanded",value?"true":"false");}toggle.onclick=function(event){event.stopPropagation();open(!picker.classList.contains("is-open"));};menu.onclick=function(event){var b=event.target.closest("[data-theme-option]");if(!b)return;var theme=b.getAttribute("data-theme-option");document.documentElement.setAttribute("data-theme",theme);try{localStorage.setItem("sample-dashboard-theme",theme);}catch(e){}menu.querySelectorAll("button").forEach(function(x){x.classList.toggle("is-active",x===b);});open(false);};document.addEventListener("click",function(e){if(!picker.contains(e.target))open(false);}); }
  function init() {
    var config=parseConfig();if(!config){byId("ru-room-grid").innerHTML='<div class="ru-empty">Cấu hình template không hợp lệ.</div>';return;}
    state.config={ title:text(config.title,"Điện nước nhà trọ"),subtitle:text(config.subtitle,""),syncId:text(config.syncId,""),electricRate:number(config.electricRate,3500),waterRate:number(config.waterRate,15000),serviceFee:number(config.serviceFee,100000),dueDay:Math.max(1,Math.min(28,Math.round(number(config.dueDay,5)))) };
    state.rooms=(Array.isArray(config.rooms)?config.rooms:[]).map(normalizeRoom);byId("ru-title").textContent=state.config.title;byId("ru-subtitle").textContent=state.config.subtitle;byId("ru-month").textContent=monthLabel();render();bindActions();bindTheme();var groups=sessionGroups(),sessions=Object.keys(groups);state.totalSessions=sessions.length;sessions.forEach(function(sessionId,index){var fields=Object.keys(groups[sessionId]);fetchSnapshot(sessionId,fields).finally(function(){connect(sessionId,fields,index);});});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
