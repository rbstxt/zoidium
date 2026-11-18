"use strict";
// Independent reconstruction. The estimator operates on images, never clocks.
const effect=this,root="/plugins/smart-motion-blur-lite/";
const number=(key,frame,fallback,min,max)=>{let v;try{v=Number(effect._smbDebugSettings?.[key]??effect.properties[key]?.get(frame));}catch(_error){v=fallback;}return Math.min(max,Math.max(min,Number.isFinite(v)?v:fallback));};
const numeric=(name,value,min,max,step=.05)=>({dynamic:true,name,type:PZ.property.type.NUMBER,value,min,max,step,decimals:3});
const uniform=value=>({value}),v2=()=>uniform(new THREE.Vector2(1,1));
function settings(frame){return {enabled:number("enabled",frame,1,0,1)>=.5,trackFrame:Math.round(number("trackFrame",frame,0,0,1)),sensitivity:number("sensitivity",frame,.7,0,1),strength:number("amount",frame,.5,0,10),radius:1270,debugVectors:0};}
function projectResolution(){
  try{const size=effect.parentProject?.sequence?.properties?.resolution?.get?.();if(Array.isArray(size)&&size[0]>0&&size[1]>0)return size;}catch(_error){}
  return null;
}
function modeFor(width,height,full,exporting){
  const project=projectResolution();
  return effect._smbChooseMode?effect._smbChooseMode({width,height,fullWidth:full?.[0],fullHeight:full?.[1],projectWidth:project?.[0],projectHeight:project?.[1],exporting}):"full";
}
function fullSize(compositor){
  const canvas=compositor?.renderer?.domElement;
  if(!canvas)return null;
  const width=parseFloat(canvas.style?.width)||canvas.clientWidth;
  const height=parseFloat(canvas.style?.height)||canvas.clientHeight;
  const ratio=(typeof window!=="undefined"&&window.devicePixelRatio)||1;
  if(!(width>0)||!(height>0))return null;
  return [Math.round(width*ratio),Math.round(height*ratio)];
}
// The sampler request is prepared before the frame draws, so it follows the
// last known render size. draw() recomputes the mode from the buffer it gets.
function trackMode(width,height,exporting,full){
  if(exporting){effect._smbExporting=true;effect._smbMode="full";}
  else if(width>0&&height>0){effect._smbExporting=false;effect._smbMode=modeFor(width,height,full,false);}
  return effect._smbMode;
}
function renderContext(){
  try{const contexts=PZ.zoidium?.temporal?.contexts,context=contexts?.[contexts.length-1];if(context?.compositor)return context;}catch(_error){}
  return null;
}
function drawingForExport(context){
  if(context)return Boolean(context.exportPolicy);
  return effect._smbExporting===true;
}
// An older build patched PZ.compositor.prototype to force project-resolution
// previews. Restoring it on load makes an in-place plugin update return to
// Player+'s sizes without waiting for a page reload.
const LEGACY_PATCH="__zoidiumSmbLiteNative";
function removeLegacyResolutionPatch(){
  let proto,state;
  try{proto=PZ.compositor?.prototype;state=proto?.[LEGACY_PATCH];}catch(_error){return false;}
  if(!proto||!state)return false;
  try{
    if(proto.setSize===state.sizeHook)proto.setSize=state.setSize;
    if(proto.renderSequence===state.renderHook)proto.renderSequence=state.renderSequence;
    if(proto.unload===state.unloadHook)proto.unload=state.unload;
    delete proto[LEGACY_PATCH];
    for(const [root,requested] of state.roots||[]){
      try{state.setSize.call(root,...requested);}catch(_error){}
    }
  }catch(_error){}
  return true;
}
function createRuntime(){
  const material=new THREE.ShaderMaterial({vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",fragmentShader:effect._zoidiumGetAsset("text",root+"shaders/reconstruct.glsl"),uniforms:{tCurrent:uniform(null),tFlow:uniform(null),uvScale:v2(),resolution:v2(),levelSize:v2(),strength:uniform(.5)},blending:THREE.NoBlending,premultipliedAlpha:true,depthTest:false,depthWrite:false});
  const analysisCopy=ZoidiumPluginApis.gl.createCopyPass(THREE);analysisCopy.material.blending=THREE.NoBlending;
  return {reconstruct:new THREE.ShaderPass(material),analysisCopy,analysisTargets:null,analysisAtlas:null,pairedStorage:null,texture:null,current:null,previous:null,cache:null};
}
function clearTargets(runtime){runtime.analysisAtlas?.dispose();runtime.analysisAtlas=null;runtime.pairedStorage=null;for(const target of runtime.analysisTargets||[])target.dispose();runtime.analysisTargets=null;runtime.texture?.dispose();runtime.texture=null;runtime.cache=null;runtime.inputToken=null;runtime.current=runtime.previous=null;}
function equal(a,b){if(!a||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function readImage(renderer,target,storage){
  if(target.texture.type!==THREE.UnsignedByteType)throw new Error("Motion reference input must be an RGBA8 compositor target");
  if(!storage||storage.length!==target.width*target.height*4)storage=new Uint8Array(target.width*target.height*4);
  renderer.readRenderTargetPixels(target,0,0,target.width,target.height,storage);return storage;
}
function crop(bytes,sourceW,w,h){if(sourceW===w&&bytes.length===w*h*4)return bytes;const result=new Uint8Array(w*h*4);for(let y=0;y<h;y++)result.set(bytes.subarray(y*sourceW*4,(y*sourceW+w)*4),y*w*4);return result;}
function uploadField(runtime,field){
  let texture=runtime.texture;
  if(!texture||texture.image.width!==field.width||texture.image.height!==field.height){
    texture?.dispose();texture=new THREE.DataTexture(field.data,field.width,field.height,THREE.RGBAFormat,THREE.FloatType);
    texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.flipY=false;runtime.texture=texture;
  }else texture.image.data=field.data;
  texture.needsUpdate=true;
}
function draw(renderer,write,read){
  const runtime=effect._smbLite,c=effect._smbSettings||settings(0),uv=effect.pass.uniforms.uvScale.value;
  const copy=()=>{const p=effect._smbCopy;p.renderToScreen=effect.pass.renderToScreen;p.uniforms.uvScale.value.copy(uv);p.uniforms.uvOffset.value.set(0,0);p.uniforms.opacity.value=1;p.render(renderer,write,read,true);};
  if(!runtime||!c.enabled||!c.sensitivity||!c.strength)return copy();
  const samples=PZ.zoidium?.temporal?.resolveFrameSamples?.(effect)||[],previous=samples[0]?.target;
  if(!previous)return copy();
  const w=Math.max(1,Math.round(read.width*uv.x)),h=Math.max(1,Math.round(read.height*uv.y));
  if(w<6||h<6||previous.width<w||previous.height<h)return copy();
  const context=renderContext(),mode=trackMode(read.width,read.height,drawingForExport(context),fullSize(context?.compositor)),half=mode==="half";
  const factor=half?8:1,aw=Math.max(6,Math.floor(w/factor)),ah=Math.max(6,Math.floor(h/factor));
  // resolveFrameSamples validates the host's complete input revision before
  // returning a stamped sample. Within that revision the same exact current
  // frame has the same input. Reuse only its field, never an old color frame.
  const sample=samples[0],frame=effect._zoidiumFrameSamplerFrame,token=runtime.inputToken;
  const reusable=PZ.zoidium?.debugDisableFrameSamplerInputReuse!==true&&sample?.stamp&&
    sample.stamp===previous.inputStamp&&Number.isFinite(frame)&&runtime.texture&&runtime.cache&&
    token&&token.stamp===sample.stamp&&token.target===previous&&token.frame===frame&&
    token.w===w&&token.h===h&&token.factor===factor&&token.sensitivity===c.sensitivity&&
    token.uvX===uv.x&&token.uvY===uv.y&&token.renderer===renderer;
  const asyncField=effect._smbAsync?.field(renderer,samples,c.sensitivity,w,h,mode);
  if(asyncField){
    if(runtime.cache?.field!==asyncField){uploadField(runtime,asyncField);runtime.cache={w,h,factor,sensitivity:c.sensitivity,field:asyncField};}
    runtime.inputToken=null;
  }else if(!reusable){
  if(half&&effect._smbAsync)effect._smbAsync.stats.fallbacks=(effect._smbAsync.stats.fallbacks||0)+1;
  let analysisRead=read,analysisPrevious=previous;
  if(half){
    if(!runtime.analysisAtlas||runtime.analysisAtlas.width!==aw||runtime.analysisAtlas.height!==ah*2){
      runtime.analysisAtlas?.dispose();
      runtime.analysisAtlas=ZoidiumPluginApis.gl.createRenderTarget(THREE,aw,ah*2,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:false,stencilBuffer:false});
    }
    // Two identically sized viewports preserve the original copy shader's UV
    // interpolation. Scissored clears protect the other image in the atlas.
    const atlas=runtime.analysisAtlas;atlas.scissorTest=true;
    const pass=runtime.analysisCopy;pass.renderToScreen=false;pass.uniforms.uvOffset.value.set(0,0);pass.uniforms.opacity.value=1;
    atlas.viewport.set(0,0,aw,ah);atlas.scissor.set(0,0,aw,ah);
    pass.uniforms.uvScale.value.copy(uv);pass.render(renderer,atlas,read,true);
    atlas.viewport.set(0,ah,aw,ah);atlas.scissor.set(0,ah,aw,ah);
    pass.uniforms.uvScale.value.set(w/previous.width,h/previous.height);pass.render(renderer,atlas,previous,true);
    runtime.pairedStorage=readImage(renderer,atlas,runtime.pairedStorage);
    const bytes=aw*ah*4;runtime.current=runtime.pairedStorage.subarray(0,bytes);runtime.previous=runtime.pairedStorage.subarray(bytes);
  }
  const iw=half?aw:w,ih=half?ah:h;
  if(!half){runtime.current=readImage(renderer,analysisRead,runtime.current);runtime.previous=readImage(renderer,analysisPrevious,runtime.previous);}
  const current=crop(runtime.current,half?aw:analysisRead.width,iw,ih),prior=crop(runtime.previous,half?aw:analysisPrevious.width,iw,ih),cache=runtime.cache;
  if(!cache||cache.w!==w||cache.h!==h||cache.factor!==factor||cache.sensitivity!==c.sensitivity||!equal(cache.current,current)||!equal(cache.previous,prior)){
    const field=(half?effect._smbHalfEstimator:effect._smbEstimator).estimate(current,prior,iw,ih,c.sensitivity,w,h);
    if(half){const sx=(w-1)/(iw-1),sy=(h-1)/(ih-1);for(let i=0;i<field.data.length;i+=4){field.data[i]*=sx;field.data[i+1]*=sy;}}
    uploadField(runtime,field);
    const savedCurrent=cache?.current?.length===current.length?cache.current:new Uint8Array(current.length);
    const savedPrevious=cache?.previous?.length===prior.length?cache.previous:new Uint8Array(prior.length);
    savedCurrent.set(current);savedPrevious.set(prior);
    runtime.cache={w,h,factor,sensitivity:c.sensitivity,current:savedCurrent,previous:savedPrevious,field};
  }
  runtime.inputToken={stamp:sample?.stamp,target:previous,frame,w,h,factor,sensitivity:c.sensitivity,uvX:uv.x,uvY:uv.y,renderer};
  }
  // The reduced path keeps the established smooth field; only its analysis
  // resolution follows the render size. Both paths reconstruct the full image.
  const p=runtime.reconstruct,u=p.uniforms;u.tCurrent.value=read.texture;u.tFlow.value=runtime.texture;u.uvScale.value.copy(uv);u.resolution.value.set(w,h);u.levelSize.value.set(runtime.cache.field.width,runtime.cache.field.height);u.strength.value=c.strength;
  p.renderToScreen=effect.pass.renderToScreen;p.render(renderer,write,null,true);
}

ZoidiumPluginApis.defineFrameSampler.call(effect, {
  displayName: "ZSMB (beta 1.0)",
  properties: {
    qualityPresetVersion: {visible:false,name:"Quality preset version",type:PZ.property.type.NUMBER,value:1},
    // Kept only so older projects load and save with the same property set.
    quality: { visible:false,dynamic:true,name:"Quality",type:PZ.property.type.OPTION,value:1,items:"Full quality;1/2 quality",description:"Not used. Motion analysis follows the render size that Player+ sets." },
    enabled: { dynamic: true, name: "Enabled", type: PZ.property.type.OPTION, value: 1, items: "off;on", description: "Turn added motion blur on or off. Off passes through the current image without changing source timing." },
    trackFrame: { dynamic:true,name:"Track Frame",type:PZ.property.type.OPTION,value:0,items:"Previous;Next",description:"Choose the adjacent frame used for motion tracking. Previous compares against the preceding frame; Next compares against the following frame. Previous uses Next at frame 0 only. This does not shift the displayed source frame." },
    amount: { ...numeric("Blur Amount", 0.5, 0, 10, 0.5), decimals: 2, description: "Controls trail length after motion tracking. 0 adds no blur; the default 0.5 approximates a 180-degree shutter. Larger values produce longer trails. Identical neighboring frames may produce no added blur." },
    sensitivity: { ...numeric("Motion Sensitivity", 0.7, 0, 100, 1), scaleFactor: 0.01, dragstep: 0.1, decimals: 2, description: "Controls motion estimation separately from trail length. Lower it to reduce false motion or background smearing; raise it when large movements are missed. 0 bypasses blur. Default: 70. A reduced preview uses a faster, approximate response." },
  },
  getRequest(_effect, frame) {
    const c = settings(frame),half=effect._smbMode==="half";
    const offset=c.trackFrame===1||frame===0?1:-1;
    return { enabled: c.enabled && c.sensitivity > 0 && (offset>0||frame>=1) && (c.debugVectors > 0 || (c.strength > 0 && c.radius > 0)), preserveInputRGB: true, lockCurrentFrame: true, reuseCurrentInput:half, frames: half?[offset,0]:[offset],decodeMedia:half?effect._smbDecodeMedia:null };
  },
  lifecycle: {
    load(data) {
      removeLegacyResolutionPatch();
      effect._smbMode="full";effect._smbExporting=false;
      effect._smbCopy = ZoidiumPluginApis.gl.createCopyPass(THREE);
      effect._smbCopy.material.blending = THREE.NoBlending;
      const requireEstimator=ZoidiumPluginApis.modules.createRequire(effect._zoidiumGetAsset.bind(effect),{root});
      effect._smbChooseMode=requireEstimator("./analysis-mode.js").chooseAnalysisMode;
      effect._smbEstimator=requireEstimator("./estimator.js").createEstimator();
      effect._smbTooltips=requireEstimator("./tooltips.js").install(PZ,effect);
      effect._smbHalfEstimator=requireEstimator("./estimator.js").createSmoothEstimator();
      effect._smbParticles=requireEstimator("./native-particles.js").install(PZ,effect.parentProject.sequence);
      if(typeof Worker!=="undefined")effect._smbAsync=requireEstimator("./async-analysis.js").create(effect,THREE,PZ,root);
      if(typeof VideoDecoder!=="undefined"){
        effect._smbVideo=requireEstimator("./video-decoder.js").create(effect,THREE,root);
        effect._smbDecodeMedia=params=>effect._smbVideo?.decode(params);
      }
      try { effect._smbLite = createRuntime(); } catch (error) {
        console.warn("ZSMB is unavailable; passing through input.", error);
      }
      effect.pass = {
        enabled: true, needsSwap: true, clear: false, renderToScreen: false,
        uniforms: { uvScale: v2() }, render: draw,
      };
      effect.properties.load(data?.properties);
      if(!effect.properties.quality.animated&&effect.properties.quality.get(0)>1){
        effect.properties.quality.set(1);
      }
      const savedName=data?.properties?.name;
      if(typeof savedName === "string" && /^(?:Smart Motion Blur Lite|ZSMB)(?: v\d+| \(beta [\d.]+\))?$/.test(savedName)) {
        effect.properties.name?.set("ZSMB (beta 1.0)");
      }
    },
    update(frame) { effect._smbSettings = settings(frame); },
    prepare: async function (frame,context) {
      const compositor=context?.frameSamplerRoot||context?.compositor;
      trackMode(compositor?.readBuffer?.width,compositor?.readBuffer?.height,Boolean(context?.exportPolicy),fullSize(compositor));
      try{await effect._smbAsync?.prepare(frame,context,Object.assign(settings(frame),{mode:effect._smbMode}));}
      catch(error){context?.exportPolicy?.check?.();if(error?.name==="AbortError")return;if(!effect._smbAsyncWarned){effect._smbAsyncWarned=true;console.warn("ZSMB asynchronous analysis unavailable; using the exact synchronous path.",error);}}
    },
    resize() { effect._smbAsync?.invalidate();if (effect._smbLite) clearTargets(effect._smbLite); },
    unload() {
      effect._smbTooltips?.release();effect._smbTooltips=null;
      effect._smbParticles?.release();effect._smbParticles=null;
      effect._smbAsync?.dispose();effect._smbAsync=null;
      effect._smbVideo?.dispose();effect._smbVideo=null;effect._smbDecodeMedia=null;
      const runtime = effect._smbLite;
      if (runtime) {
        clearTargets(runtime);
        ZoidiumPluginApis.gl.disposePass(runtime.reconstruct);
        ZoidiumPluginApis.gl.disposePass(runtime.analysisCopy);
      }
      ZoidiumPluginApis.gl.disposePass(effect._smbCopy);
      effect._smbEstimator = effect._smbHalfEstimator = effect._smbChooseMode = null;
      effect._smbMode = "full";
      effect._smbLite = effect._smbCopy = effect.pass = null;
    },
  },
});

// Match the existing native frame samplers: media preparation needs sequence
// context even when CM3's layer.prepare() omits it.
const prepare = effect.prepare;
effect.prepare = function (frame, context) {
  return prepare.call(this, frame, context?.sequence ? context :
    Object.assign({}, context, { sequence: this.parentProject.sequence }));
};







