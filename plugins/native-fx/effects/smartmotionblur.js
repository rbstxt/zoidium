"use strict";

const smartMotionBlurEffect = this;
const smartMotionBlurGetAsset = this._zoidiumGetAsset?.bind(this);
if (!smartMotionBlurGetAsset)
  throw new Error("[Zoidium] Smart Motion Blur requires bundled assets.");
const smartMotionBlurRequire = ZoidiumPluginApis.modules.createRequire(
  smartMotionBlurGetAsset,
  {
    root: "./plugins/native-fx/smart-motion-blur/",
  },
);
const smartMotionBlurMath = smartMotionBlurRequire("./math.js");
const smartMotionBlurPipeline = smartMotionBlurRequire("./pipeline.js");
const smartMotionBlurShutter = smartMotionBlurRequire("./shutter.js");
function smartMotionBlurUsesShutter(effect, settings) {
  const Scene = PZ.layer?.scene;
  return smartMotionBlurMath.usesShutterSamples(
    settings, Boolean(Scene && effect.parentLayer instanceof Scene),
  );
}
function smartMotionBlurReduce(renderer, output, samples) {
  if (!smartMotionBlurEffect._smartMotionBlurShutter) {
    smartMotionBlurEffect._smartMotionBlurShutter = smartMotionBlurShutter.create(
      THREE, ZoidiumPluginApis.gl, smartMotionBlurGetAsset,
    );
    smartMotionBlurEffect._smartMotionBlur?.dispose();
    smartMotionBlurEffect._smartMotionBlur = null;
  }
  smartMotionBlurEffect._smartMotionBlurShutter.reduceBatch(renderer, output, samples);
}

ZoidiumPluginApis.defineFrameSampler.call(this, {
  displayName: smartMotionBlurMath.DISPLAY_NAME,
  properties: smartMotionBlurMath.properties(PZ.property.type),
  getRequest(effect, frame) {
    const settings = smartMotionBlurMath.readSettings(effect.properties, frame);
    const shutter = smartMotionBlurUsesShutter(effect, settings);
    return {
      enabled: settings.amount > 0 && settings.sensitivity > 0,
      preserveInputRGB: shutter,
      reduceSamples: shutter ? smartMotionBlurReduce : undefined,
      frames: shutter
        ? smartMotionBlurMath.shutterTimes(settings.amount, smartMotionBlurMath.captureCount(settings.quality))
        : smartMotionBlurMath.offsets(settings.analysis),
    };
  },
  lifecycle: {
    load(data) {
      this._smartMotionBlur = smartMotionBlurPipeline.create(
        THREE,
        ZoidiumPluginApis.gl,
        smartMotionBlurGetAsset,
      );
      this._smartMotionBlurShutter = null;
      this.pass = {
        enabled: true,
        needsSwap: true,
        clear: false,
        renderToScreen: false,
        uniforms: { uvScale: { value: new THREE.Vector2(1, 1) } },
        render(renderer, writeBuffer, readBuffer) {
          const effect = smartMotionBlurEffect;
          const frame = effect._zoidiumFrameSamplerFrame || 0;
          const clip = effect.parentLayer?.tryGetParentOfType?.(PZ.clip);
          const currentFrame = frame + (clip?.start || 0);
          const settings = smartMotionBlurMath.readSettings(
            effect.properties,
            frame,
          );
          const samples = PZ.zoidium.temporal.resolveFrameSamples(effect) || [];
          let project =
            effect.parentLayer?.properties?.resolution?.get?.(frame);
          if (!Array.isArray(project) || !(project[0] > 0 && project[1] > 0)) {
            project =
              effect.parentProject?.sequence?.properties?.resolution?.get?.(
                frame,
              );
          }
          if (!Array.isArray(project) || !(project[0] > 0 && project[1] > 0))
            project = [readBuffer.width, readBuffer.height];
          const scale = effect.pass.uniforms.uvScale.value;
          if (smartMotionBlurUsesShutter(effect, settings) && settings.amount && settings.sensitivity) {
            if (!effect._smartMotionBlurShutter) {
              effect._smartMotionBlurShutter = smartMotionBlurShutter.create(
                THREE, ZoidiumPluginApis.gl, smartMotionBlurGetAsset,
              );
              // Release optical-flow scratch storage after changing modes.
              effect._smartMotionBlur.dispose();
              effect._smartMotionBlur = null;
            }
            effect._smartMotionBlurShutter.render(
              renderer, writeBuffer, readBuffer, samples, [scale.x, scale.y],
            );
            return;
          }
          effect._smartMotionBlurShutter?.dispose();
          effect._smartMotionBlurShutter = null;
          if (!effect._smartMotionBlur) effect._smartMotionBlur = smartMotionBlurPipeline.create(
            THREE, ZoidiumPluginApis.gl, smartMotionBlurGetAsset,
          );
          // This explicit testing switch is not serialized or quality-dependent.
          const forcePacked =
            PZ.zoidium.debugForceSmartMotionBlurRGBA8 === true;
          settings.forceGather =
            PZ.zoidium.debugForceSmartMotionBlurGather === true;
          effect._smartMotionBlur.render(
            renderer,
            writeBuffer,
            readBuffer,
            samples,
            currentFrame,
            project,
            [scale.x, scale.y],
            settings,
            forcePacked,
          );
        },
      };
      this.properties.load(data?.properties);
    },
    update() {},
    async prepare() {},
    resize() {}, // Allocation is keyed by physical input size and active UV region at render time.
    unload() {
      this._smartMotionBlur?.dispose();
      this._smartMotionBlurShutter?.dispose();
      this._smartMotionBlurShutter = null;
      this._smartMotionBlur = null;
      this.pass = null;
    },
  },
});

ZoidiumPluginApis.installFrameSamplerContext(this);
