"use strict";
// Scoped UI and compositor support for S_Glow. No serialized layer sizes change.
module.exports.install=function(effect,PZ,THREE,apis){
  const proto=PZ.compositor.prototype,key="__sglowSupport8";
  let state=proto[key];
  if(!state){
    state={effects:new Set(),layer:proto.renderLayer};proto[key]=state;
    if(PZ.ui?.edit?.prototype?.generateListItem){
      const ui=PZ.ui.edit.prototype;state.ui=ui;state.row=ui.generateListItem;
      state.style=document.createElement("style");
      state.style.textContent=".sglow-checkbox { appearance: none; -webkit-appearance: none; flex: 0 0 auto; width: 15px; height: 15px; margin: 0; padding: 0; border: 1px solid var(--zui-border-filter); border-radius: 2px; background: var(--zui-bg-input); cursor: pointer; position: relative; }\n.sglow-checkbox:checked { background: var(--zui-accent); border-color: var(--zui-accent); }\n.sglow-checkbox:checked::after { content: \"\"; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px; border: solid var(--zui-text-bright); border-width: 0 2px 2px 0; transform: rotate(45deg); }\n.sglow-checkbox:focus-visible { outline: 2px solid var(--zui-value); outline-offset: 1px; }\n.sglow-checkbox:disabled { opacity: .5; cursor: default; }";
      document.head.appendChild(state.style);
      state.rowHook=function(list,object,index){
        const row=state.row.apply(this,arguments);
        if(object instanceof PZ.property && state.effects.has(object.parentObject)){
          const tip=object.definition.description;
          if(tip){row.title=tip;const label=row.firstElementChild?.querySelector("span");if(label)label.title=tip;}
          if(object===object.parentObject.properties.expandBorders){
            const select=row.querySelector("select"),box=row.querySelector(".editbox");
            if(select&&box){
              const input=document.createElement("input");input.type="checkbox";input.className="sglow-checkbox";
              input.setAttribute("aria-label","Expand Borders");input.title=tip;
              input.onchange=function(){
                PZ.ui.controls.editStart.call(this,object);
                try{object.set(input.checked?1:0,box.pz_frame);}
                finally{PZ.ui.controls.editFinish.call(this,object);}
              };
              select.hidden=true;box.appendChild(input);
              box.pz_update=frame=>{input.checked=Number(object.get(frame))===1;input.disabled=!!(object.animated&&object.expression);};
              // Native row subscribed before replacement; keep its update function.
              select.selectedIndex=object.get()||0;
              const nativeUpdate=box.pz_update;
              box.pz_update=frame=>{nativeUpdate(frame);};
              input.checked=Number(object.get())===1;

            }
          }
        }
        if(state.effects.has(object)&&!this.options.hideAllListItemButtons){
          const reset=this.generateButton("reset"),history=this.editor.history,address=object.getAddress();
          reset.title="Reset all S_Glow settings";
          reset.setAttribute("aria-label",reset.title);
          const restore=data=>{
            const target=this.editor.project.addressLookup(address);
            const previous=JSON.parse(JSON.stringify(target.properties));
            target.applySettingsSnapshot(data);
            history.pushCommand(restore,previous);
          };
          reset.onclick=event=>{
            event.stopPropagation();history.startOperation();
            try{restore(undefined);history.finishOperation();}
            catch(error){history.discardOperation();throw error;}
          };
          row.children[1].classList.add("actions");
          row.children[1].appendChild(reset);
        }
        return row;
      };
      ui.generateListItem=state.rowHook;
    }
    state.layerHook=function(layer){
      const all=[];
      const collect=items=>{for(const item of items||[]){
        if(item instanceof PZ.effect.group){if(item.enabled)collect(item.objects);}
        else if(item.pass?.enabled)all.push(item);
      }};
      collect(layer.effects);
      const expanding=all.filter(item=>state.effects.has(item)&&item.cached?.expandBorders===1);
      if(!expanding.length)return state.layer.apply(this,arguments);
      const owner=expanding[0],compositor=this,quad=layer.composite.quad;
      const savedScale=quad.scale.clone(),savedBefore=quad.onBeforeRender;
      const ownComposite=Object.getOwnPropertyDescriptor(this,"compositeScene");
      const composite=this.compositeScene,wrapped=[];
      let originalRead,originalWrite,active=false,composed=false;
      const frames=[];
      const begin=(renderer,read)=>{
        const native=layer.properties.resolution.get(),scale=owner.pass.uniforms.uvScale.value;
        const sw=Math.round(read.width*scale.x),sh=Math.round(read.height*scale.y);
        let nx=0,ny=0;
        for(const item of expanding){
          const p=item.cached,c=Math.max(p.widthRed??1,p.widthGreen??1.2,p.widthBlue??1.4);
          nx+=Math.min(3*Math.max(0,Math.floor(native[0]/2)-1),(p.glowWidth??96)*(p.widthX??1)*c);
          ny+=Math.min(3*Math.max(0,Math.floor(native[1]/2)-1),(p.glowWidth??96)*(p.widthY??1)*c);
        }
        const nativePadX=Math.ceil(nx)+4,nativePadY=Math.ceil(ny)+4;
        const px=Math.ceil(nativePadX*sw/native[0]),py=Math.ceil(nativePadY*sh/native[1]);
        const w=sw+2*px,h=sh+2*py,max=renderer.capabilities.maxTextureSize;
        if(w>max||h>max)throw new Error("S_Glow Expand Borders exceeds the GPU texture limit. Reduce the glow width or input size.");
        let resources=owner.borderResources;
        if(!resources){
          const targets=[read.clone(),read.clone()];
          const mat=new THREE.ShaderMaterial({
            uniforms:{source:{value:null},scale:{value:new THREE.Vector2()},size:{value:new THREE.Vector2()},pad:{value:new THREE.Vector2()}},
            vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
            fragmentShader:"precision highp float;varying vec2 vUv;uniform sampler2D source;uniform vec2 scale,size,pad;void main(){vec2 uv=(vUv-pad)/(vec2(1.)-2.*pad);if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))gl_FragColor=vec4(0.);else gl_FragColor=texture2D(source,uv*scale);}",
            depthTest:false,depthWrite:false,blending:THREE.NoBlending});
          const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.PlaneBufferGeometry(2,2),mat);
          scene.add(mesh);
          resources=owner.borderResources={targets,mat,scene,camera:new THREE.Camera(),dispose(){for(const t of targets)t.dispose();mat.dispose();mesh.geometry.dispose();}};
        }
        for(const t of resources.targets){if(t.width!==w||t.height!==h)t.setSize(w,h);t.viewport.set(0,0,w,h);}
        const u=resources.mat.uniforms;u.source.value=read.texture;u.scale.value.copy(scale);u.pad.value.set(px/w,py/h);
        const oldColor=renderer.getClearColor().clone(),oldAlpha=renderer.getClearAlpha();
        try{renderer.setClearColor(0,0);renderer.render(resources.scene,resources.camera,resources.targets[0],true);}
        finally{renderer.setClearColor(oldColor,oldAlpha);}
        originalRead=compositor.readBuffer;originalWrite=compositor.writeBuffer;
        compositor.readBuffer=resources.targets[0];compositor.writeBuffer=resources.targets[1];
        for(const item of all){if(state.effects.has(item)){
          frames.push([item,item.expandedFrame]);
          item.expandedFrame={sourceW:sw,sourceH:sh,padX:px,padY:py,nativePadX,nativePadY,scaleX:sw/native[0],scaleY:sh/native[1]};
        }}
        quad.scale.x*=w/sw;quad.scale.y*=h/sh;
        quad.onBeforeRender=function(){
          savedBefore?.apply(this,arguments);this.material.uniforms?.uvScale?.value.set(1,1);
        };
        active=true;
      };
      const compositeHook=function(){
        if(active){this.readBuffer=originalRead;this.writeBuffer=originalWrite;composed=true;}
        return composite.apply(this,arguments);
      };
      this.compositeScene=compositeHook;
      try{
        for(const item of all){
          const pass=item.pass,render=pass.render;
          const hook=function(renderer,write,read,...rest){
            if(!active&&item===owner)begin(renderer,read);
            if(active){pass.uniforms.uvScale?.value.set(1,1);write=compositor.writeBuffer;read=compositor.readBuffer;}
            return render.call(this,renderer,write,read,...rest);
          };
          pass.render=hook;wrapped.push([pass,render,hook]);
        }
        return state.layer.apply(this,arguments);
      }finally{
        if(active&&!composed){this.readBuffer=originalRead;this.writeBuffer=originalWrite;}
        if(this.compositeScene===compositeHook){if(ownComposite)Object.defineProperty(this,"compositeScene",ownComposite);else delete this.compositeScene;}
        for(const [pass,render,hook] of wrapped)if(pass.render===hook)pass.render=render;
        for(const [item,frame] of frames)item.expandedFrame=frame;
        quad.scale.copy(savedScale);quad.onBeforeRender=savedBefore;
      }
    };
    proto.renderLayer=state.layerHook;
    state.releaseSequence=module.exports.installSequence(state,PZ,THREE);
  }
  state.effects.add(effect);
  effect._sglowEnsureSequence=()=>state.ensureSequence?.();
  return ()=>{
    state.effects.delete(effect);
    delete effect._sglowEnsureSequence;
    if(!state.effects.size){
      if(proto.renderLayer===state.layerHook)proto.renderLayer=state.layer;
      if(state.ui&&state.ui.generateListItem===state.rowHook)state.ui.generateListItem=state.row;
      state.releaseSequence?.();
      state.style?.remove();
      delete proto[key];
    }
  };
};



// All nonlinear glow/noise operations use one native pixel grid. Preview size
// only changes the final area reduction, not the noise sampling or clipping.
module.exports.matchPreview=function(effect,THREE,render){
  return function(renderer,write,read){
    const reference=effect.getReferenceResolution(read.width,read.height);
    const frame=effect.expandedFrame,uv=effect.pass.uniforms.uvScale.value;
    const px=frame?(frame.nativePadX??Math.round(frame.padX/frame.scaleX)):0;
    const py=frame?(frame.nativePadY??Math.round(frame.padY/frame.scaleY)):0;
    const w=Math.max(1,Math.round(reference[0]+2*px)),h=Math.max(1,Math.round(reference[1]+2*py));
    if(read.width===w&&read.height===h&&uv.x===1&&uv.y===1&&(!frame||frame.scaleX===1&&frame.scaleY===1))return render(renderer,write,read);
    if(w>renderer.capabilities.maxTextureSize||h>renderer.capabilities.maxTextureSize)throw new Error("S_Glow native processing size exceeds the GPU texture limit.");
    let resources=effect.previewResources;
    if(!resources){
      const material=new THREE.ShaderMaterial({
        uniforms:{source:{value:null},scale:{value:new THREE.Vector2(1,1)},offset:{value:new THREE.Vector2()},footprint:{value:new THREE.Vector2()},steps:{value:new THREE.Vector2(1,1)}},
        vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
        fragmentShader:`precision highp float;varying vec2 vUv;uniform sampler2D source;
        uniform vec2 scale,offset,footprint,steps;
        void main(){vec4 sum=vec4(0.);for(int y=0;y<8;y++){if(float(y)>=steps.y)break;
        for(int x=0;x<8;x++){if(float(x)>=steps.x)break;
        vec2 delta=(vec2(float(x)+.5,float(y)+.5)/steps-.5)*footprint;
        sum+=texture2D(source,(vUv+delta)*scale+offset);}}
        gl_FragColor=sum/(steps.x*steps.y);}`,
        depthTest:false,depthWrite:false,blending:THREE.NoBlending});
      const scene=new THREE.Scene(),mesh=new THREE.Mesh(new THREE.PlaneBufferGeometry(2,2),material);scene.add(mesh);
      const targets=[read.clone(),write.clone()];
      resources=effect.previewResources={targets,material,scene,camera:new THREE.Camera(),dispose(){for(const target of targets)target.dispose();material.dispose();mesh.geometry.dispose();}};
    }
    const [input,output]=resources.targets;
    for(const [target,type] of [[input,read.texture.type],[output,write.texture.type]]){
      if(target.texture.type!==type){target.dispose();target.texture.type=type;}
      if(target.width!==w||target.height!==h)target.setSize(w,h);
      target.viewport.set(0,0,w,h);
    }
    const u=resources.material.uniforms,savedUV=uv.clone(),savedColor=renderer.getClearColor().clone(),savedAlpha=renderer.getClearAlpha();
    try{
      renderer.setClearColor(0,0);u.source.value=read.texture;
      u.scale.value.copy(savedUV);u.offset.value.set(0,0);u.footprint.value.set(0,0);u.steps.value.set(1,1);
      if(frame){
        u.scale.value.set(w/reference[0]*frame.sourceW/read.width,h/reference[1]*frame.sourceH/read.height);
        u.offset.value.set((frame.padX-px*frame.sourceW/reference[0])/read.width,(frame.padY-py*frame.sourceH/reference[1])/read.height);
        effect.expandedFrame={...frame,sourceW:reference[0],sourceH:reference[1],padX:px,padY:py,scaleX:1,scaleY:1};
      }
      renderer.render(resources.scene,resources.camera,input,true);
      uv.set(1,1);render(renderer,output,input);
      const dw=write.viewport?.z||write.width,dh=write.viewport?.w||write.height;
      u.source.value=output.texture;u.scale.value.set(1,1);u.offset.value.set(0,0);
      u.footprint.value.set(1/dw,1/dh);
      u.steps.value.set(Math.min(8,Math.max(1,Math.ceil(w/dw))),Math.min(8,Math.max(1,Math.ceil(h/dh))));
      renderer.render(resources.scene,resources.camera,write,true);
    }finally{
      uv.copy(savedUV);effect.expandedFrame=frame;renderer.setClearColor(savedColor,savedAlpha);
    }
  };
};

// Process the source and upstream effects at project resolution as well. A
// post-effect upscale cannot recover detail already lost by the compositor.
module.exports.installSequence=function(state,PZ){
  const proto=PZ.compositor.prototype,original=proto.renderSequence,unload=proto.unload,setSize=proto.setSize;
  const requested=new Map(),resizing=new WeakSet();
  const contains=layer=>{
    const effects=items=>Array.from(items||[]).some(item=>state.effects.has(item)||typeof PZ.effect.group==="function"&&item instanceof PZ.effect.group&&effects(item.objects));
    return effects(layer?.effects)||Array.from(layer?.objects||[]).some(contains);
  };
  const nativeSize=c=>{
    if(c.__zoidiumRenderSettings)return null;
    const seq=c._sequence,size=seq?.properties?.resolution?.get();
    if(!Array.isArray(size)||!size.every(n=>Number.isFinite(n)&&n>0))return null;
    if(!Array.from(seq.videoTracks||[]).some(t=>t.enabled!==false&&(contains(t.layer)||Array.from(t.clips||[]).some(clip=>contains(clip.object)))))return null;
    if(Math.max(...size)>c.renderer.capabilities.maxTextureSize)throw new Error("S_Glow project resolution exceeds the GPU texture limit.");
    return size.map(Math.round);
  };
  const ensure=c=>{
    const size=nativeSize(c);if(!size||c.readBuffer.width===size[0]&&c.readBuffer.height===size[1])return;
    if(!requested.has(c))requested.set(c,[c.readBuffer.width,c.readBuffer.height]);
    resizing.add(c);try{setSize.call(c,...size);}finally{resizing.delete(c);}
  };
  state.ensureSequence=()=>{
    for(const effect of state.effects){
      let seq;try{seq=effect.parentProject?.sequence;}catch(_error){continue;}
      for(const c of PZ.zoidium?.temporal?.compositorsBySequence?.get(seq)||[])ensure(c);
    }
  };
  const hook=function(){ensure(this);return original.apply(this,arguments);};
  const resizeHook=function(w,h){
    const size=nativeSize(this);if(size)requested.set(this,[w,h]);
    resizing.add(this);try{return setSize.call(this,...(size||[w,h]));}finally{resizing.delete(this);}
  };
  const unloadHook=function(){if(!resizing.has(this))requested.delete(this);return unload.apply(this,arguments);};
  proto.renderSequence=hook;proto.unload=unloadHook;proto.setSize=resizeHook;
  return ()=>{
    state.ensureSequence=null;
    if(proto.renderSequence===hook)proto.renderSequence=original;
    if(proto.unload===unloadHook)proto.unload=unload;
    if(proto.setSize===resizeHook)proto.setSize=setSize;
    for(const [c,size]of requested){resizing.add(c);try{setSize.call(c,...size);}finally{resizing.delete(c);}}
    requested.clear();
  };
};
