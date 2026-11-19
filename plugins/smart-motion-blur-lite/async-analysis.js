"use strict";

// Execute the existing estimator unchanged in a dedicated worker. The result
// belongs to two exact captured inputs; it is never a previous-frame shortcut.
function createWorker(getAsset, root) {
  const names=["estimator.js","fast-filter.js","fast-score.js"];
  const modules=names.map(name=>JSON.stringify("./"+name)+":function(require,module,exports){\n"+
    getAsset("text",root+name)+"\n}").join(",\n");
  const source='"use strict";const factories={'+modules+'},loaded={};'+
    'function require(name){if(loaded[name])return loaded[name].exports;const module={exports:{}};loaded[name]=module;factories[name](require,module,module.exports);return module.exports;}'+
    'const estimator=require("./estimator.js").createSmoothEstimator();'+
    'onmessage=({data:m})=>{try{const size=m.width*m.height*4,current=new Uint8Array(m.pixels,0,size),previous=new Uint8Array(m.pixels,size,size);const start=performance.now();const field=estimator.estimate(current,previous,m.width,m.height,m.sensitivity,m.nativeWidth,m.nativeHeight);postMessage({id:m.id,width:field.width,height:field.height,data:field.data.buffer,ms:performance.now()-start},[field.data.buffer]);}catch(e){postMessage({id:m.id,error:String(e.stack||e)});}};';
  const url=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));
  let worker;try{worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
  let next=0,stopped=false;const pending=new Map();
  const fail=error=>{for(const job of pending.values()){clearTimeout(job.timer);job.reject(error);}pending.clear();};
  worker.onmessage=({data:m})=>{const job=pending.get(m.id);if(!job)return;pending.delete(m.id);clearTimeout(job.timer);
    if(m.error)job.reject(new Error(m.error));else job.resolve({data:new Float32Array(m.data),width:m.width,height:m.height,workerMs:m.ms});};
  worker.onerror=event=>{stopped=true;fail(new Error(event.message||"ZSMB analysis worker failed"));worker.terminate();};
  return {
    estimate(pixels,width,height,sensitivity,nativeWidth=width,nativeHeight=height){
      if(stopped)return Promise.reject(new Error("ZSMB analysis worker is stopped"));
      const id=++next;return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending.delete(id);reject(new Error("ZSMB analysis timed out"));},30000);
        pending.set(id,{resolve,reject,timer});worker.postMessage({id,pixels:pixels.buffer,width,height,sensitivity,nativeWidth,nativeHeight},[pixels.buffer]);
      });
    },
    dispose(){stopped=true;worker.terminate();fail(new Error("ZSMB analysis disposed"));},
  };
}

// WebGL 1 has no pixel pack buffers. Its completion query can still move the
// wait out of readPixels and let the browser service UI while GPU work finishes.
async function waitForGPU(gl,check) {
  if(typeof gl.fenceSync==="function"){
    const sync=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
    try{for(const start=performance.now();;){check();const state=gl.clientWaitSync(sync,0,0);
      if(state===gl.ALREADY_SIGNALED||state===gl.CONDITION_SATISFIED)return;
      if(state===gl.WAIT_FAILED||performance.now()-start>10000)throw new Error("ZSMB GPU wait failed");
      await new Promise(resolve=>setTimeout(resolve,0));
    }}finally{gl.deleteSync(sync);}
  }
  const ext=gl.getExtension("EXT_disjoint_timer_query");
  if(!ext||ext.getQueryEXT(ext.TIME_ELAPSED_EXT,ext.CURRENT_QUERY_EXT))return;
  const query=ext.createQueryEXT();ext.beginQueryEXT(ext.TIME_ELAPSED_EXT,query);ext.endQueryEXT(ext.TIME_ELAPSED_EXT);gl.flush();
  try{for(const start=performance.now();;){check();
    if(ext.getQueryObjectEXT(query,ext.QUERY_RESULT_AVAILABLE_EXT))return;
    if(performance.now()-start>10000)throw new Error("ZSMB GPU wait timed out");
    await new Promise(resolve=>setTimeout(resolve,0));
  }}finally{ext.deleteQueryEXT(query);}
}

function create(effect,THREE,PZ,root) {
  let worker=null,atlas=null,queue=Promise.resolve(),generation=0,disposed=false;
  const pass=ZoidiumPluginApis.gl.createCopyPass(THREE);pass.material.blending=THREE.NoBlending;
  const stats={jobs:0,reused:0,workerMs:0,readbackMs:0};
  let result=null;
  let analyzingFrame=null;
  const check=(context,expected)=>{context?.exportPolicy?.check?.();
    if(disposed||generation!==expected)throw new DOMException("ZSMB analysis invalidated","AbortError");
    if(analyzingFrame!==null&&(Number(effect.properties.sensitivity.get(analyzingFrame))<=0||Number(effect.properties.enabled.get(analyzingFrame))<.5))
      throw new DOMException("ZSMB analysis superseded by bypass","AbortError");};
  const same=(a,b)=>a&&b&&a.previous===b.previous&&a.current===b.current&&a.renderer===b.renderer&&
    a.w===b.w&&a.h===b.h&&a.sensitivity===b.sensitivity;
  function token(renderer,samples,sensitivity){
    if(samples?.length!==2)return null;
    const previous=samples[0],current=samples[1],target=current.target;
    if(!previous.stamp||!current.stamp||previous.stamp!==previous.target.inputStamp||current.stamp!==target.inputStamp)return null;
    const w=target.viewport?.z||target.width,h=target.viewport?.w||target.height;
    return {previous:previous.stamp,current:current.stamp,renderer,w,h,sensitivity};
  }
  async function run(frame,context,settings){
    const plan=settings.plan;
    if(disposed||!plan||plan.exact||!settings.enabled||!settings.sensitivity||!settings.strength||(frame<1&&frame!==0&&settings.trackFrame!==1))return;
    const compositor=context?.frameSamplerRoot||context?.compositor;
    const host=PZ.zoidium?.temporal?.frameSamplerRuntimes?.get(compositor);
    const prepared=host?.prepared?.get(effect),renderer=compositor?.renderer;
    const key=token(renderer,prepared?.samples,settings.sensitivity);
    if(!key||key.w<6||key.h<6||plan.width>key.w||plan.height>key.h)return;
    if(same(key,result?.token)&&result.level===plan.level&&result.width===plan.width&&result.height===plan.height){stats.reused++;return;}
    analyzingFrame=frame;
    const epoch=generation,samples=prepared.samples.slice(),aw=plan.width,ah=plan.height;
    check(context,epoch);
    worker ||= createWorker(effect._zoidiumGetAsset.bind(effect),root);
    if(!atlas||atlas.width!==aw||atlas.height!==ah*2){atlas?.dispose();atlas=ZoidiumPluginApis.gl.createRenderTarget(THREE,aw,ah*2,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,stencilBuffer:false});}
    atlas.scissorTest=true;pass.renderToScreen=false;pass.uniforms.opacity.value=1;pass.uniforms.uvOffset.value.set(0,0);
    // Current comes first, exactly as in the established synchronous atlas.
    for(const [index,sample]of [[0,samples[1]],[1,samples[0]]]){
      atlas.viewport.set(0,index*ah,aw,ah);atlas.scissor.set(0,index*ah,aw,ah);
      pass.uniforms.uvScale.value.set(key.w/sample.target.width,key.h/sample.target.height);
      pass.render(renderer,atlas,sample.target,true);
    }
    await waitForGPU(renderer.context,()=>check(context,epoch));check(context,epoch);
    const pixels=new Uint8Array(aw*ah*8),start=performance.now();renderer.readRenderTargetPixels(atlas,0,0,aw,ah*2,pixels);stats.readbackMs=performance.now()-start;
    const field=await worker.estimate(pixels,aw,ah,settings.sensitivity,key.w,key.h);check(context,epoch);
    // The same scalar scaling and Float32 stores as the draw-time path.
    const sx=(key.w-1)/(aw-1),sy=(key.h-1)/(ah-1);
    for(let i=0;i<field.data.length;i+=4){field.data[i]*=sx;field.data[i+1]*=sy;}
    if(same(key,token(renderer,samples,settings.sensitivity))){result={token:key,level:plan.level,width:plan.width,height:plan.height,field};stats.jobs++;stats.workerMs=field.workerMs;}
  }
  return {
    stats,
    prepare(frame,context,settings){const task=()=>run(frame,context,settings);const pending=queue.then(task);queue=pending.catch(()=>{});return pending;},
    field(renderer,samples,sensitivity,w,h,plan){const key=token(renderer,samples,sensitivity);
      return plan&&!plan.exact&&same(key,result?.token)&&key.w===w&&key.h===h&&
        result.level===plan.level&&result.width===plan.width&&result.height===plan.height?result.field:null;},
    invalidate(){generation++;result=null;},
    dispose(){disposed=true;generation++;result=null;worker?.dispose();atlas?.dispose();ZoidiumPluginApis.gl.disposePass(pass);},
  };
}
module.exports={create};
