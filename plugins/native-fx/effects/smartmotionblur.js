"use strict";

const smartMotionBlurEffect=this;
const smartMotionBlurGetAsset=this._zoidiumGetAsset?.bind(this);
if(!smartMotionBlurGetAsset) throw new Error("[Zoidium] Smart Motion Blur requires bundled assets.");
const smartMotionBlurRequire=ZoidiumPluginApis.modules.createRequire(smartMotionBlurGetAsset,{
  root:"./plugins/native-fx/smart-motion-blur/",
});
const smartMotionBlurMath=smartMotionBlurRequire("./math.js");
const smartMotionBlurPipeline=smartMotionBlurRequire("./pipeline.js");

ZoidiumPluginApis.defineFrameSampler.call(this,{
  displayName:smartMotionBlurMath.DISPLAY_NAME,
  properties:smartMotionBlurMath.properties(PZ.property.type),
  getRequest(effect,frame) {
    const settings=smartMotionBlurMath.readSettings(effect.properties,frame);
    return {enabled:settings.amount>0 && settings.sensitivity>0,frames:smartMotionBlurMath.offsets(settings.analysis)};
  },
  lifecycle:{
    load(data) {
      this._smartMotionBlur=smartMotionBlurPipeline.create(THREE,ZoidiumPluginApis.gl,smartMotionBlurGetAsset);
      this.pass={enabled:true,needsSwap:true,clear:false,renderToScreen:false,
        uniforms:{uvScale:{value:new THREE.Vector2(1,1)}},
        render(renderer,writeBuffer,readBuffer) {
          const effect=smartMotionBlurEffect;
          const frame=effect._zoidiumFrameSamplerFrame || 0;
          const clip=effect.parentLayer?.tryGetParentOfType?.(PZ.clip);
          const currentFrame=frame+(clip?.start || 0);
          const settings=smartMotionBlurMath.readSettings(effect.properties,frame);
          const samples=PZ.zoidium.temporal.resolveFrameSamples(effect) || [];
          let project=effect.parentLayer?.properties?.resolution?.get?.(frame);
          if(!Array.isArray(project) || !(project[0]>0 && project[1]>0)) {
            project=effect.parentProject?.sequence?.properties?.resolution?.get?.(frame);
          }
          if(!Array.isArray(project) || !(project[0]>0 && project[1]>0)) project=[readBuffer.width,readBuffer.height];
          const scale=effect.pass.uniforms.uvScale.value;
          // This explicit testing switch is not serialized or quality-dependent.
          const forcePacked=PZ.zoidium.debugForceSmartMotionBlurRGBA8===true;
          effect._smartMotionBlur.render(renderer,writeBuffer,readBuffer,samples,currentFrame,project,
            [scale.x,scale.y],settings,forcePacked);
        },
      };
      this.properties.load(data?.properties);
    },
    update() {},
    async prepare() {},
    resize() {}, // Allocation is keyed by physical input size and active UV region at render time.
    unload() {
      this._smartMotionBlur?.dispose();
      this._smartMotionBlur=null;this.pass=null;
    },
  },
});

// CM3 does not pass the sequence through a layer's ordinary prepare method.
const smartMotionBlurPrepare=this.prepare;
this.prepare=function(frame,context) {
  if(!context?.sequence) context=Object.assign({},context,{sequence:this.parentProject.sequence});
  return smartMotionBlurPrepare.call(this,frame,context);
};
