'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../../..'),output=path.join(root,'output/media-effects');fs.mkdirSync(output,{recursive:true});
const current=fs.readFileSync(path.join(__dirname,'dashboard.html'),'utf8');
const beforeFile=path.join(output,'before.html'),before=fs.existsSync(beforeFile)?fs.readFileSync(beforeFile,'utf8'):null;
const streams=new Set();
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/show'){
  const style=url.searchParams.get('style')||'ani1',source=url.searchParams.get('before')&&before?before:current;
  const config={sessionId:'IOqa@key',syncId:'sync',historyMs:0,field:'media',defaultSignal:'text@'+style+':CHÀO MỪNG QUÝ KHÁCH\nKhông gian của những trải nghiệm'};
  res.setHeader('Content-Type','text/html');return res.end(source.replace(/(<script type="application\/json" id="ai-bridge-media-only-config">)[\s\S]*?(<\/script>)/,'$1'+JSON.stringify(config)+'$2'));
 }
 if(url.pathname.endsWith('/stream')){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write('data: {"type":"telemetry","payload":{}}\n\n');streams.add(res);req.on('close',()=>streams.delete(res));return;}
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end('{"c1":"ok","c2":{"payload":{}}}');}
  const rel=url.pathname.replace(/^\/sample_dashboards\//,'/'+'sample_templates'+'/templates/').slice(1),file=path.resolve(root,rel);
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file));
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:720}}),errors=[];
  ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await ctx.addInitScript(()=>{
   window.fxProbe={frames:[],paints:0};window.qaHidden=false;
   Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.qaHidden});
   const raf=window.requestAnimationFrame,clear=CanvasRenderingContext2D.prototype.clearRect;
   CanvasRenderingContext2D.prototype.clearRect=function(...args){if(this.canvas.isConnected){window.fxProbe.paints++;window.fxProbe.inFrame=true;}return clear.apply(this,args);};
   window.requestAnimationFrame=function(fn){return raf.call(window,t=>{window.fxProbe.inFrame=false;const start=performance.now();fn(t);if(window.fxProbe.inFrame)window.fxProbe.frames.push(performance.now()-start);});};
  });
  const page=await ctx.newPage(),perf=await ctx.newCDPSession(page);await perf.send('Performance.enable');
  const results=[];
  for(let i=1;i<=10;i++){
   await page.goto(origin+'/show?style=ani'+i);await page.waitForSelector('.fx-canvas');await sleep(1100);
   await page.screenshot({path:path.join(output,'ani'+i+'.png')});
   await page.setViewportSize({width:3840,height:2160});await perf.send('Emulation.setCPUThrottlingRate',{rate:4});await sleep(150);
   await page.evaluate(()=>{fxProbe.frames=[];fxProbe.paints=0;});const metrics0=(await perf.send('Performance.getMetrics')).metrics;
   const started=Date.now();await sleep(1500);const elapsed=(Date.now()-started)/1000;
   const data=await page.evaluate(()=>({frames:fxProbe.frames,paints:fxProbe.paints,canvas:[...document.querySelectorAll('.fx-canvas')].map(c=>[c.width,c.height]),filters:[...document.querySelectorAll('.backdrop,.fx-canvas')].map(e=>getComputedStyle(e).filter)}));
   const metrics1=(await perf.send('Performance.getMetrics')).metrics;
   const metric=(list,name)=>list.find(m=>m.name===name).value;
   const costs=data.frames.sort((a,b)=>a-b),p95=costs[Math.floor(costs.length*.95)]||0;
   assert.equal(data.canvas.length,1);assert(data.canvas[0][0]*data.canvas[0][1]<=960*540);assert(data.paints/elapsed<=25.5);assert(p95<20,'Effect draw budget exceeded');assert(data.filters.every(f=>f==='none'));
   results.push({style:'ani'+i,canvas:data.canvas[0],fps:Number((data.paints/elapsed).toFixed(1)),drawP95Ms:Number(p95.toFixed(2)),mainThreadPercent:Number(((metric(metrics1,'TaskDuration')-metric(metrics0,'TaskDuration'))/elapsed*100).toFixed(1))});
   await perf.send('Emulation.setCPUThrottlingRate',{rate:1});await page.setViewportSize({width:1280,height:720});
  }
  await page.evaluate(()=>{window.qaHidden=true;document.dispatchEvent(new Event('visibilitychange'));fxProbe.paints=0;});await sleep(250);assert.equal(await page.evaluate(()=>fxProbe.paints),0);
  await page.evaluate(()=>{window.qaHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await page.emulateMedia({reducedMotion:'reduce'});await sleep(100);await page.evaluate(()=>{fxProbe.paints=0});await sleep(250);assert.equal(await page.evaluate(()=>fxProbe.paints),0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{window.textBefore=document.querySelector('.text-box');window.canvasBefore=document.querySelector('.fx-canvas')});
  for(const s of streams)s.write('data: '+JSON.stringify({type:'telemetry',payload:{media:'text@ani10:CHÀO MỪNG QUÝ KHÁCH\nKhông gian của những trải nghiệm'}})+'\n\n');
  await sleep(150);assert(await page.evaluate(()=>textBefore===document.querySelector('.text-box')&&canvasBefore===document.querySelector('.fx-canvas')));
  await page.setViewportSize({width:540,height:960});await page.screenshot({path:path.join(output,'portrait.png')});
   assert.equal(await page.locator('.text-box').evaluate(e=>getComputedStyle(e).textShadow),'none');
   await page.evaluate(()=>{document.querySelector('.text-box').textContent=('Nội dung dài cần vừa vùng hiển thị. ').repeat(55);window.dispatchEvent(new Event('resize'));});await sleep(150);
   assert(await page.locator('.text-box').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=23&&r.right<=innerWidth-23&&r.top>=23&&r.bottom<=innerHeight-23&&r.top+e.scrollHeight<=innerHeight-23;}),'Long text must fit inside the padded portrait layout');
  await page.evaluate(()=>{for(let n=0;n<30;n++)MediaOnlyEffects.mount(document.getElementById('fx-layer'),'ani'+(n%10+1));});assert.equal(await page.locator('.fx-canvas').count(),1);
  await page.evaluate(()=>{MediaOnlyEffects.mount(document.getElementById('fx-layer'),'ani5',{static:true});fxProbe.paints=0;});await sleep(250);assert.equal(await page.evaluate(()=>fxProbe.paints),0);
  if(before){await page.setViewportSize({width:1280,height:720});await page.goto(origin+'/show?style=ani7&before=1');await sleep(1100);await page.screenshot({path:path.join(output,'before-ani7.png')});}
  const gallery=await ctx.newPage();await gallery.setViewportSize({width:1280,height:1900});
  const names=['Hải lưu','Dạ tiệc','Sakura','Kiến trúc','Ánh kim','Chân trời','Quỹ đạo','Mưa kính','Vườn đêm','Hình học'];
  await gallery.goto(origin+'/show?style=black');await gallery.setContent('<html><body style="margin:0;background:#edf0f2;font:16px Arial"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px">'+names.map((name,i)=>'<div><div style="padding:7px">ani'+(i+1)+' · '+name+'</div><img style="width:100%;display:block" src="'+origin+'/output/media-effects/ani'+(i+1)+'.png"></div>').join('')+'</div></body></html>');
  await gallery.locator('img').last().waitFor();await gallery.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));await gallery.screenshot({path:path.join(output,'contact-sheet.png'),fullPage:true});
   assert.deepEqual(errors,[]);const report={ok:true,cpuThrottle:4,viewport:[3840,2160],styles:results,checks:['bounded-canvas','frame-budget','no-fullscreen-blur','hidden-stops','reduced-motion-stops','duplicate-text-keeps-animation','light-theme-no-shadow','long-portrait-text-fits','one-loop-after-30-switches','static-video-background'],browserErrors:errors};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();for(const s of streams)s.end();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
