"use strict";

// Preview-only exact sample decoding. Keep HTML seeking as a fallback and as
// the per-source pixel-parity oracle before enabling this path for a file.
function create(effect,THREE,root) {
  let bunny=null,disposed=false,queue=Promise.resolve();
  const sources=new Map(),resources=new Map();
  const stats={decoded:0,reused:0,verified:0,rejected:0,decodeMs:0};
  function loadBunny(){
    if(!bunny){const module={exports:{}};new Function("module","exports",effect._zoidiumGetAsset("text","/plugins/mp4-export/vendor/mediabunny-1.62.0.cjs"))(module,module.exports);bunny=module.exports;}
    return bunny;
  }
  function closeSource(source){source.peek?.close();source.iterator?.return().catch(()=>{});for(const entry of source.frames) {entry.texture.dispose();entry.frame.close();}source.input.dispose();}
  async function open(item){
    const url=item.media.url;let source=sources.get(url);
    if(source)return source;
    const b=loadBunny(),file=item.media.file instanceof Blob?item.media.file:await(await fetch(url)).blob();
    if(disposed)return null;
    const input=new b.Input({formats:b.ALL_FORMATS,source:new b.BlobSource(file)}),track=await input.getPrimaryVideoTrack();
    if(!track||!await track.canDecode()){input.dispose();return null;}
    source={input,sink:new b.VideoSampleSink(track),frames:[],verified:new WeakSet(),failed:false};
    sources.set(url,source);
    if(sources.size>8){const [key,old]=sources.entries().next().value;if(old!==source){sources.delete(key);closeSource(old);}}
    return source;
  }
  function textureFor(frame,original){
    Object.defineProperty(frame,"width",{value:frame.displayWidth});Object.defineProperty(frame,"height",{value:frame.displayHeight});
    const texture=new THREE.Texture(frame);
    for(const key of ["flipY","premultiplyAlpha","encoding","format","type","minFilter","magFilter","wrapS","wrapT"])if(original[key]!==undefined)texture[key]=original[key];
    texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
  }
  async function sampleAt(source,time){
    // Keep the codec alive and let its bounded queue decode ahead during
    // forward playback. Random seeks restart from the requested keyframe.
    if(!source.iterator||time<source.streamTime||time>source.streamTime+.5||source.peek?.timestamp>time+1e-10){
      source.peek?.close();source.peek=null;await source.iterator?.return();
      source.iterator=source.sink.samples(time);source.streamTime=time;
    }
    let sample=source.peek;source.peek=null;
    if(!sample){const step=await source.iterator.next();if(step.done)return null;sample=step.value;}
    for(;;){const step=await source.iterator.next();
      if(step.done){source.streamTime=time;return sample;}
      if(step.value.timestamp>time+1e-10){source.peek=step.value;source.streamTime=time;return sample;}
      sample.close();sample=step.value;
    }
  }
  function compare(renderer,native,decoded,w,h){
    let r=resources.get(renderer);
    if(!r){const pass=ZoidiumPluginApis.gl.createCopyPass(THREE);pass.material.blending=THREE.NoBlending;r={pass,target:null};resources.set(renderer,r);}
    if(!r.target||r.target.width!==w||r.target.height!==h){r.target?.dispose();r.target=ZoidiumPluginApis.gl.createRenderTarget(THREE,w,h,{format:THREE.RGBAFormat,type:THREE.UnsignedByteType,depthBuffer:false,stencilBuffer:false});}
    const bytes=new Uint8Array(w*h*4),other=new Uint8Array(bytes.length);
    r.pass.renderToScreen=false;r.pass.uniforms.uvScale.value.set(1,1);r.pass.uniforms.uvOffset.value.set(0,0);r.pass.uniforms.opacity.value=1;
    r.pass.render(renderer,r.target,{texture:native},true);renderer.readRenderTargetPixels(r.target,0,0,w,h,bytes);
    r.pass.render(renderer,r.target,{texture:decoded},true);renderer.readRenderTargetPixels(r.target,0,0,w,h,other);
    return bytes.every((v,i)=>v===other[i]);
  }
  async function run({item,time,isolated,context,renderer}){
    if(disposed||context?.exportPolicy||!renderer||typeof VideoDecoder==="undefined")return null;
    context?.resourcePolicy?.assertMedia?.(item.media);
    let source;
    try{
      source=await open(item);if(!source||source.failed)return null;
      const verifying=!source.verified.has(renderer);
      if(verifying)await isolated.decodeFrame(time,context);
      const video=isolated.el;
      const clamped=Math.min(Math.max(0,time),Number.isFinite(video.duration)?Math.max(0,video.duration-1e-7):Infinity);
      const target=globalThis.ZoidiumVideoSeekPolicy?.seekTime(video,clamped)??clamped;
      // A decoded image belongs to its presentation interval, not only the
      // request that first fetched it. Project FPS can exceed source FPS.
      let entry=source.frames.find(f=>f.pts<=target+1e-10&&target<f.end-1e-10);
      if(entry){
        if(verifying){if(!compare(renderer,isolated.texture,entry.texture,entry.frame.displayWidth,entry.frame.displayHeight)){source.failed=true;stats.rejected++;return null;}source.verified.add(renderer);stats.verified++;}
        stats.reused++;source.frames.splice(source.frames.indexOf(entry),1);source.frames.push(entry);return {texture:entry.texture};
      }
      const start=performance.now(),sample=await sampleAt(source,target);stats.decodeMs=performance.now()-start;
      if(!sample)return null;
      if(sample.rotation||sample.flip){sample.close();source.failed=true;stats.rejected++;return null;}
      const pts=sample.timestamp,end=source.peek?.timestamp??(sample.timestamp+sample.duration);
      const frame=sample.toVideoFrame();sample.close();
      const texture=textureFor(frame,isolated.texture);entry={time:target,pts,end,frame,texture};
      if(disposed){texture.dispose();frame.close();return null;}
      if(verifying){
        if(!compare(renderer,isolated.texture,texture,frame.displayWidth,frame.displayHeight)){
          texture.dispose();frame.close();source.failed=true;stats.rejected++;return null;
        }
        source.verified.add(renderer);stats.verified++;
      }
      source.frames.push(entry);stats.decoded++;
      while(source.frames.length>4){const old=source.frames.shift();old.texture.dispose();old.frame.close();}
      return {texture};
    }catch(error){if(source)source.failed=true;stats.rejected++;context?.exportPolicy?.check?.();return null;}
  }
  return {
    stats,
    decode(params){const task=()=>run(params),pending=queue.then(task);queue=pending.catch(()=>{});return pending;},
    dispose(){disposed=true;for(const source of sources.values())closeSource(source);sources.clear();for(const r of resources.values()){r.target?.dispose();ZoidiumPluginApis.gl.disposePass(r.pass);}resources.clear();},
  };
}
module.exports={create};
