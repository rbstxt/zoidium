"use strict";
const math = require("./math.js");
const utilities = require("./gl.js");
const solver = require("./flow.js");
const reconstruction = require("./reconstruction.js");

function create(THREE, api, getAsset) {
  const gl=utilities.create(THREE,api,getAsset);
  const flow=solver.create(gl), blur=reconstruction.create(gl);
  const copy=gl.pass("copy",{uImage:null,uScale:[1,1]});
  const difference=gl.pass("difference",{uCurrent:null,uOther:null,uSourceSize:[1,1],uActiveSize:[1,1]});
  const reduce=gl.pass("reduce",{uImage:null,uSourceSize:[1,1],uAverage:0});
  let signature=null, chain, first, storage, allocatedRenderer;
  const bytes=new Uint8Array(4);
  const diagnostics={storage:null,maxSpeed:0,sceneCut:false,static:false,samples:0};
  function allocate(renderer,input,uvScale,forcePacked) {
    const processing=[Math.max(1,Math.round(input.width*uvScale[0])),Math.max(1,Math.round(input.height*uvScale[1]))];
    const key=JSON.stringify([input.width,input.height,...processing,forcePacked]);
    if(key===signature && renderer===allocatedRenderer) return processing;
    gl.clearTargets();
    storage=gl.selectStorage(renderer,forcePacked);
    flow.allocate(...processing);blur.allocate(...processing);
    first=gl.target(Math.ceil(processing[0]/2),Math.ceil(processing[1]/2));
    chain=[];
    let size=[first.width,first.height];
    while(size[0]>1 || size[1]>1) {
      size=size.map(n=>Math.ceil(n/2));
      chain.push(gl.target(...size));
    }
    signature=key;allocatedRenderer=renderer;diagnostics.storage=storage;
    return processing;
  }
  function reduction(renderer,input,average) {
    let source=input;
    // Confidence is half resolution and fits the same first reduction target.
    const targets=chain;
    for(const target of targets) {
      if(source.width===1 && source.height===1) break;
      gl.draw(renderer,reduce,target,{uImage:source.texture,uSourceSize:[source.width,source.height],uAverage:average?1:0});
      source=target;
    }
    renderer.readRenderTargetPixels(source,0,0,1,1,bytes);
    return Array.from(bytes);
  }
  function identical(renderer,current,other,input,processing) {
    gl.draw(renderer,difference,first,{uCurrent:current,uOther:other,
      uSourceSize:[input.width,input.height],uActiveSize:processing});
    return reduction(renderer,first,false)[0]===0;
  }
  function render(renderer,output,input,neighbors,currentFrame,project,uvScale,settings,forcePacked) {
    return gl.preserve(renderer,()=>{
      const copyInput=()=>gl.draw(renderer,copy,output,{uImage:input.texture,uScale:uvScale});
      const pair=math.neighbors(neighbors,currentFrame);
      diagnostics.sceneCut=false;diagnostics.static=false;diagnostics.maxSpeed=0;
      diagnostics.samples=0;diagnostics.fields=null;diagnostics.confidence=null;diagnostics.flowSize=null;
      if(!settings.amount || !settings.sensitivity || (!pair.previous && !pair.next)) return copyInput();
      const processing=allocate(renderer,input,uvScale,forcePacked);
      const available=[pair.previous,pair.next];
      const active=available.filter(Boolean);
      diagnostics.static=active.every(tap=>identical(renderer,input.texture,tap.texture,input,processing));
      if(diagnostics.static) return copyInput();
      flow.buildPyramid(renderer,input.texture,0,[input.width,input.height],uvScale);
      const fields=[null,null],confidence=[null,null],deltas=[1,1];
      const stats=[];
      for(let i=0;i<2;i++) {
        const tap=available[i];
        if(!tap) continue;
        const delta=Math.abs(tap.frame-currentFrame);
        deltas[i]=delta;
        flow.buildPyramid(renderer,tap.texture,i+1,[input.width,input.height],uvScale);
        fields[i]=flow.solve(renderer,0,i+1,i*2,settings,project,delta);
        const reverse=flow.solve(renderer,i+1,0,i*2+1,settings,project,delta);
        const conf=flow.analyze(renderer,i,fields[i],reverse,project,delta);
        confidence[i]=conf.texture;
        stats.push(reduction(renderer,conf,true));
      }
      // A missing clip-boundary direction mirrors the available velocity.
      if(!fields[0]) {fields[0]=fields[1];confidence[0]=confidence[1];deltas[0]=-deltas[1];}
      if(!fields[1]) {fields[1]=fields[0];confidence[1]=confidence[0];deltas[1]=-deltas[0];}
      diagnostics.sceneCut=stats.some(s=>s[0]/255>0.35 || (s[0]/255>0.12 && s[1]/255>0.6));
      if(diagnostics.sceneCut) return copyInput();
      diagnostics.maxSpeed=Math.max(...stats.map(s=>s[2]/255*256));
      diagnostics.samples=math.sampleCount(settings.amount,diagnostics.maxSpeed,settings.quality);
      blur.render(renderer,output,input.texture,fields,confidence,deltas,flow.size,flow.current,
        processing,project,uvScale,settings,diagnostics.maxSpeed,[(pair.previous||pair.next).texture,(pair.next||pair.previous).texture]);
      // Exposed scratch handles support direct, CM3-free GPU accuracy tests.
      diagnostics.fields=fields;diagnostics.flowSize=flow.size;diagnostics.confidence=confidence;
    });
  }
  return {render,diagnostics,dispose:()=>{gl.dispose();signature=null;allocatedRenderer=null;}};
}
module.exports={create};
