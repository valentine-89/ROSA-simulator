(function(){
  "use strict";
  var state={config:null,values:Object.create(null),rows:[],historyMinutes:1440,connection:"connecting",stream:null,reconnect:0};
  function id(v){return document.getElementById(v)}
  function esc(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
  function text(v,f){v=String(v==null?"":v).trim();return v||String(f||"")}
  function num(v){if(v===null||v===undefined||v==="")return null;var n=Number(v);return Number.isFinite(n)?n:null}
  function on(v){return /^(1|true|on|open|connected|charging|fault|alarm)$/i.test(String(v==null?"":v).trim())}
  function key(v){return String(v||"").toLowerCase()}
  function hydrate(raw){var c=window.ROSA_SIMULATOR_CONTEXT||{};return String(raw||"").replace(/<<sessionid>>/gi,text(c.sessionId,"IO123abcd@simulate")).replace(/<<syncid>>/gi,text(c.syncId,"SIM_SYNC"))}
  function parse(){try{return JSON.parse(hydrate(id("ev-charging-config").textContent))}catch(e){return null}}
  function read(field){return state.values[key(field)]}
  function setValues(payload){if(!payload||typeof payload!=="object")return;Object.keys(payload).forEach(function(k){state.values[key(k)]=payload[k]})}
  function allFields(){var out=[],c=state.config;Object.keys(c.fields||{}).forEach(function(k){out.push(c.fields[k])});(c.chargers||[]).forEach(function(ch){Object.keys(ch.fields||{}).forEach(function(k){out.push(ch.fields[k])})});return out.filter(function(v,i,a){return v&&a.indexOf(v)===i})}
  function chartFields(){return[state.config.fields.gridPower,state.config.fields.solarPower].filter(Boolean)}
  function apiUrl(type){var c=state.config,q=new URLSearchParams(),now=Date.now();q.set("fields",(type==="iotimeseries"?chartFields():allFields()).join(","));if(type==="iotimeseries"){q.set("from",String(now-state.historyMinutes*60000));q.set("to",String(now))}return"/api/"+encodeURIComponent(c.sessionId)+"/"+encodeURIComponent(c.syncId)+"/"+type+"?"+q}
  function streamUrl(){var q=new URLSearchParams();q.set("fields",allFields().join(","));return"/api/"+encodeURIComponent(state.config.sessionId)+"/stream?"+q}
  function commandUrl(){var s=state.config.sessionId,p=s.indexOf("@");return p>0?"https://iot.ioeasy.com/cmd/"+encodeURIComponent(s.slice(0,p))+"?apiKey="+encodeURIComponent(s.slice(p+1)):""}
  function fmt(v,d,u){return v===null?"--":v.toLocaleString("vi-VN",{minimumFractionDigits:d,maximumFractionDigits:d})+(u||"")}
  function money(v){try{return new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND",maximumFractionDigits:0}).format(v||0)}catch(e){return Math.round(v||0).toLocaleString("vi-VN")+" ₫"}}
  function chargerState(ch){var f=ch.fields||{},connected=on(read(f.connected)),charging=on(read(f.charging)),fault=on(read(f.fault)),power=num(read(f.power)),energy=num(read(f.energySession)),soc=num(read(f.soc)),duration=num(read(f.duration)),temperature=num(read(f.temperature)),hot=temperature!==null&&temperature>state.config.temperatureWarnC;return{connected:connected,charging:charging,fault:fault,hot:hot,power:power,energy:energy,soc:soc,duration:duration,temperature:temperature}}
  function renderKpis(){var c=state.config,checks=c.chargers.map(chargerState),charging=checks.filter(function(x){return x.charging}).length,available=checks.filter(function(x){return!x.connected&&!x.fault}).length,grid=num(read(c.fields.gridPower)),solar=num(read(c.fields.solarPower)),energy=num(read(c.fields.energyToday)),revenue=num(read(c.fields.revenueToday)),sessions=num(read(c.fields.sessionsToday)),load=(grid||0)+(solar||0),over=grid!==null&&grid>c.stationPowerLimitKw;id("ev-kpis").innerHTML=[
    ["Công suất trạm",grid===null&&solar===null?"--":fmt(load,1," kW"),charging+" điểm đang sạc",over],
    ["Điện năng hôm nay",fmt(energy,1," kWh"),sessions===null?"Chưa có dữ liệu phiên":Math.round(sessions)+" phiên sạc",false],
    ["Doanh thu hôm nay",revenue===null?(energy===null?"--":money(energy*c.electricityRate)):money(revenue),c.electricityRate.toLocaleString("vi-VN")+" ₫/kWh",false],
    ["Điểm sạc sẵn sàng",available+" / "+c.chargers.length,checks.filter(function(x){return x.fault||x.hot}).length+" điểm cần kiểm tra",false]
  ].map(function(k){return'<article class="ev-kpi"><span>'+k[0]+'</span><strong data-state="'+(k[3]?'danger':'normal')+'">'+k[1]+'</strong><small>'+k[2]+'</small></article>'}).join("")}
  function renderFlow(){var c=state.config,grid=num(read(c.fields.gridPower)),solar=num(read(c.fields.solarPower)),total=(grid||0)+(solar||0),limit=Math.max(1,c.stationPowerLimitKw),rows=[{name:"Nguồn lưới",value:grid,accent:"#2563eb"},{name:"Điện mặt trời",value:solar,accent:"#22c55e"},{name:"Tổng cấp cho trạm",value:grid===null&&solar===null?null:total,accent:"#f59e0b"}];id("ev-flow").innerHTML=rows.map(function(r){var pct=r.value===null?0:Math.min(100,r.value/limit*100);return'<div class="ev-flow-row" style="--accent:'+r.accent+'"><span>'+r.name+'</span><div class="ev-track"><i style="width:'+pct+'%"></i></div><strong>'+fmt(r.value,1," kW")+'</strong></div>'}).join("");id("ev-limit-note").textContent="Giới hạn lưới "+fmt(c.stationPowerLimitKw,0," kW")}
  function chargerHtml(ch){var a=chargerState(ch),status=a.fault?"LỖI":a.hot?"QUÁ NHIỆT":a.charging?"ĐANG SẠC":a.connected?"ĐÃ KẾT NỐI":"SẴN SÀNG",stateName=a.fault||a.hot?"fault":a.charging?"charging":"idle",soc=a.soc===null?0:Math.max(0,Math.min(100,a.soc)),canStart=a.connected&&!a.charging&&!a.fault&&!a.hot,canStop=a.charging;return'<article class="ev-charger" data-state="'+stateName+'" style="--accent:'+esc(ch.accent||"#2563eb")+'"><div class="ev-charger-head"><div><h3>'+esc(ch.name)+'</h3><p>'+esc(ch.type)+' · '+fmt(num(ch.ratedPowerKw),0," kW")+'</p></div><span class="ev-state" data-state="'+stateName+'">'+status+'</span></div><div class="ev-power"><div><strong>'+fmt(a.power,1," kW")+'</strong><span> công suất hiện tại</span></div><span>'+fmt(a.energy,1," kWh")+' phiên này</span></div><div><div class="ev-soc-head"><span>Mức pin xe</span><strong>'+fmt(a.soc,0,"%")+'</strong></div><div class="ev-soc-track"><i style="width:'+soc+'%"></i></div></div><div class="ev-details"><div class="ev-detail"><span>Thời gian</span><strong>'+fmt(a.duration,0," phút")+'</strong></div><div class="ev-detail"><span>Nhiệt độ</span><strong data-state="'+(a.hot?'danger':'normal')+'">'+fmt(a.temperature,1,"°C")+'</strong></div><div class="ev-detail"><span>Kết nối</span><strong>'+(a.connected?"Có xe":"Trống")+'</strong></div></div><div class="ev-actions"><button class="ev-button primary" data-command="start" data-charger="'+esc(ch.name)+'" '+(canStart?"":"disabled")+'>Bắt đầu sạc</button><button class="ev-button" data-command="stop" data-charger="'+esc(ch.name)+'" '+(canStop?"":"disabled")+'>Dừng sạc</button></div></article>'}
  function renderChargers(){var c=state.config,checks=c.chargers.map(chargerState),charging=checks.filter(function(x){return x.charging}).length,faults=checks.filter(function(x){return x.fault||x.hot}).length;id("ev-chargers").innerHTML=c.chargers.map(chargerHtml).join("");id("ev-summary").textContent=charging+" đang sạc · "+faults+" cần kiểm tra"}
  function rowsFor(field){return state.rows.filter(function(r){return key(r.field)===key(field)})}
  function renderChart(){
    var c=state.config,sets=[
      {field:c.fields.gridPower,color:"#2563eb"},
      {field:c.fields.solarPower,color:"#22c55e"}
    ],all=[],host=id("ev-chart-paths"),ns="http://www.w3.org/2000/svg";
    sets.forEach(function(s){all=all.concat(rowsFor(s.field))});
    while(host.firstChild)host.removeChild(host.firstChild);
    if(!all.length){
      var empty=document.createElementNS(ns,"text");
      empty.setAttribute("x","340");
      empty.setAttribute("y","116");
      empty.setAttribute("text-anchor","middle");
      empty.setAttribute("fill","currentColor");
      empty.setAttribute("font-size","13");
      empty.setAttribute("font-weight","700");
      empty.textContent="Đang tích lũy dữ liệu công suất...";
      host.appendChild(empty);
      return;
    }
    var x0=Math.min.apply(null,all.map(function(r){return r.ts})),
      x1=Math.max.apply(null,all.map(function(r){return r.ts})),
      y1=Math.max.apply(null,all.map(function(r){return r.value}));
    if(x1===x0)x1=x0+1;
    if(y1<=0)y1=1;
    sets.forEach(function(s){
      var rows=rowsFor(s.field);
      if(!rows.length)return;
      var points=rows.map(function(r){
        return{x:24+(r.ts-x0)/(x1-x0)*632,y:182-r.value/y1*140};
      });
      var path=document.createElementNS(ns,"path");
      path.setAttribute("d",points.map(function(p,i){return(i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1)}).join(" "));
      path.setAttribute("stroke",s.color);
      path.setAttribute("fill","none");
      path.setAttribute("stroke-width","3");
      path.setAttribute("stroke-linecap","round");
      path.setAttribute("stroke-linejoin","round");
      path.setAttribute("vector-effect","non-scaling-stroke");
      host.appendChild(path);
      var last=points[points.length-1],dot=document.createElementNS(ns,"circle");
      dot.setAttribute("cx",last.x.toFixed(1));
      dot.setAttribute("cy",last.y.toFixed(1));
      dot.setAttribute("r","4");
      dot.setAttribute("fill",s.color);
      dot.setAttribute("stroke-width","2");
      dot.setAttribute("vector-effect","non-scaling-stroke");
      host.appendChild(dot);
    });
  }
  function renderStatus(){var c=state.config,messages=[];if(on(read(c.fields.emergency)))messages.push("Đã kích hoạt dừng khẩn cấp");var grid=num(read(c.fields.gridPower));if(grid!==null&&grid>c.stationPowerLimitKw)messages.push("Công suất lưới vượt giới hạn");c.chargers.forEach(function(ch){var a=chargerState(ch);if(a.fault)messages.push(ch.name+": báo lỗi thiết bị");if(a.hot)messages.push(ch.name+": nhiệt độ đầu nối cao")});if(state.connection==="offline")messages.push("Mất kết nối bộ điều khiển trạm");var alert=id("ev-alert");alert.hidden=!messages.length;alert.textContent=messages.length?"⚠ "+messages.join("  •  "):"";id("ev-live-dot").setAttribute("data-state",state.connection==="online"?"online":state.connection==="offline"?"offline":"connecting");id("ev-live-text").textContent=state.connection==="online"?"Đang trực tuyến":state.connection==="offline"?"Mất kết nối":"Đang kết nối"}
  function render(){if(!state.config)return;renderKpis();renderFlow();renderChargers();renderChart();renderStatus()}
  function applyRows(rows){var wanted=chartFields().map(key);(rows||[]).forEach(function(r){var row={field:r.field,ts:Number(r.ts),value:Number(r.value)};if(wanted.indexOf(key(row.field))>=0&&Number.isFinite(row.ts)&&Number.isFinite(row.value))state.rows.push(row)});var cutoff=Date.now()-state.historyMinutes*60000;state.rows=state.rows.filter(function(r){return r.ts>=cutoff}).slice(-720)}
  function fetchJson(url){return fetch(url,{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).catch(function(){return null})}
  function bootstrap(){return Promise.all([fetchJson(apiUrl("iotelemetry")),fetchJson(apiUrl("iotimeseries"))]).then(function(parts){setValues(parts[0]&&parts[0].c2&&parts[0].c2.payload||{});state.rows=[];applyRows(parts[1]&&parts[1].c2&&parts[1].c2.rows||[]);render()})}
  function connect(){if(typeof EventSource==="undefined")return;try{var source=new EventSource(streamUrl());state.stream=source;source.onopen=function(){state.connection="online";render()};source.onmessage=function(e){try{var d=JSON.parse(e.data);state.connection="online";if(d.type==="telemetry")setValues(d.payload);else if(d.type==="timeseries")applyRows(d.rows);render()}catch(x){}};source.onerror=function(){source.close();state.stream=null;state.connection="offline";render();clearTimeout(state.reconnect);state.reconnect=setTimeout(connect,3000)}}catch(e){state.connection="offline";render()}}
  function reloadHistory(){state.rows=[];fetchJson(apiUrl("iotimeseries")).then(function(p){applyRows(p&&p.c2&&p.c2.rows||[]);renderChart()})}
  function toast(message,type){var n=document.createElement("div");n.className="ev-toast "+(type||"");n.textContent=message;id("ev-toasts").appendChild(n);setTimeout(function(){n.remove()},3000)}
  function sendCommand(ch,action){var cmd=ch.commands&&ch.commands[action],url=commandUrl();if(!cmd||!url)return Promise.reject(new Error("missing"));var resolver=window.AIBridgeCommandTemplate,p=resolver&&resolver.resolveCommandTemplate?resolver.resolveCommandTemplate(cmd):Promise.resolve(cmd);return p.then(function(value){return fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cmd:value})}).then(function(r){if(!r.ok)throw new Error("failed")})})}
  function bind(){document.addEventListener("click",function(e){var b=e.target.closest("[data-command]");if(!b)return;var ch=state.config.chargers.filter(function(x){return x.name===b.getAttribute("data-charger")})[0],action=b.getAttribute("data-command");if(!ch)return;if(!window.confirm((action==="start"?"Bắt đầu":"Dừng")+" phiên sạc tại "+ch.name+"?"))return;b.disabled=true;sendCommand(ch,action).then(function(){toast("Đã gửi lệnh tới "+ch.name+".")}).catch(function(){toast("Không gửi được lệnh tới "+ch.name+".","error")}).finally(function(){b.disabled=false})})}
  function theme(){var p=id("theme-picker"),t=id("theme-picker-toggle"),m=id("theme-picker-menu");function open(v){p.classList.toggle("is-open",v);t.setAttribute("aria-expanded",v?"true":"false")}t.onclick=function(e){e.stopPropagation();open(!p.classList.contains("is-open"))};m.onclick=function(e){var b=e.target.closest("[data-theme-option]");if(!b)return;var v=b.getAttribute("data-theme-option");document.documentElement.setAttribute("data-theme",v);try{localStorage.setItem("sample-dashboard-theme",v)}catch(x){}m.querySelectorAll("button").forEach(function(n){n.classList.toggle("is-active",n===b)});open(false)};document.addEventListener("click",function(e){if(!p.contains(e.target))open(false)})}
  function init(){var c=parse();if(!c){id("ev-summary").textContent="Cấu hình template không hợp lệ.";return}c.chargers=Array.isArray(c.chargers)?c.chargers:[];c.stationPowerLimitKw=Number(c.stationPowerLimitKw)||220;c.temperatureWarnC=Number(c.temperatureWarnC)||65;c.electricityRate=Number(c.electricityRate)||0;state.config=c;state.historyMinutes=Number(c.historyMinutes)||1440;id("ev-title").textContent=text(c.title,"Trạm sạc xe điện");id("ev-subtitle").textContent=text(c.subtitle,"");id("ev-range").value=String(state.historyMinutes);id("ev-range").onchange=function(){state.historyMinutes=Number(this.value)||1440;reloadHistory()};function clock(){id("ev-clock").textContent=new Date().toLocaleTimeString("vi-VN")}clock();setInterval(clock,1000);bind();theme();render();bootstrap().finally(connect)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
