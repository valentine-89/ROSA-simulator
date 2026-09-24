(function(){'use strict';
  window.rosa=window.rosa||{};
  window.rosa.backend={run:async function(name,input,options){
    options=options||{};
    var context=document.getElementById('rosa-backend-context');
    var value=context?JSON.parse(context.textContent||'{}'):{};
    if(!value.ioid||!value.pageId)throw new Error('Thiếu ngữ cảnh trang IoT.');
    var requestId=options.requestId||crypto.randomUUID(),runId;
    var endpoint='/api/iot-page-backend/'+encodeURIComponent(value.ioid)+'/'+encodeURIComponent(value.pageId);
    try { for(;;){
      var response=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(runId?{name:name,runId:runId}:{name:name,input:input||{},requestId:requestId}),signal:options.signal});
      var run=await response.json();if(!response.ok)throw Object.assign(new Error(run.message||run.error),{requestId:requestId,runId:runId});
      runId=run.runId;if(run.status==='succeeded')return run.result;if(run.status==='failed')throw Object.assign(new Error(run.error?.message||'Backend thất bại.'),{code:run.error?.code,runId:runId,requestId:requestId});
      await new Promise(function(resolve){setTimeout(resolve,1000);});
    }} catch(error) { error.requestId=requestId; error.runId=runId; throw error; }
  }};
})();
