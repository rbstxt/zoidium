"use strict";

// CM3's point-size shader consumes render-pixel width. Its original callback
// supplies canvas size even when drawing into a larger compositor target.
function install(PZ,sequence){
  const prototype=PZ.object3d?.particles?.prototype,key="__zoidiumNativeParticleViewport";
  if(!prototype)return {release(){}};
  let state=prototype[key];
  if(!state){
    state={references:0,points:new Map(),load:prototype.load};
    state.patch=object=>{
      const points=object.threeObj;
      if(!points||points[key])return;
      const original=points.onBeforeRender;
      const wrapped=function(renderer){
        original?.apply(this,arguments);
        const target=renderer.getRenderTarget?.(),uniform=this.material?.uniforms?.resolution;
        if(!target||!uniform?.value?.set)return;
        const viewport=target.viewport;
        uniform.value.set(viewport?viewport.z:target.width,viewport?viewport.w:target.height);
      };
      points.onBeforeRender=wrapped;points[key]=true;
      state.points.set(new WeakRef(points),{original,wrapped});
    };
    state.wrappedLoad=function(){const result=state.load.apply(this,arguments);state.patch(this);return result;};
    prototype.load=state.wrappedLoad;prototype[key]=state;
  }
  state.references++;
  const visited=new Set(),visit=value=>{
    if(!value||typeof value!=="object"||visited.has(value))return;visited.add(value);
    if(value instanceof PZ.object3d.particles)state.patch(value);
    if(Array.isArray(value)||(Number.isInteger(value.length)&&typeof value.splice==="function")){
      for(let i=0;i<value.length;i++)visit(value[i]);return;
    }
    for(const child of value.children||[])visit(child);
  };
  visit(sequence);
  let released=false;
  return {release(){
    if(released)return;released=true;if(--state.references)return;
    if(prototype.load===state.wrappedLoad)prototype.load=state.load;
    for(const [ref,record]of state.points){const points=ref.deref();if(!points)continue;
      if(points.onBeforeRender===record.wrapped)points.onBeforeRender=record.original;
      delete points[key];
    }
    state.points.clear();delete prototype[key];
  }};
}
module.exports={install};
