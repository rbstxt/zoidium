// Zoidium Core — temporal preview drawing (split from temporal-sampler.js).
// Binds prepared media, draws one prepared preview frame, and reuses an exact
// adjustment input. Loads after temporal-sampler.js.
(function temporalPreviewPart(global) {
  "use strict";

  var registry = global.__zoidiumTemporalParts || (global.__zoidiumTemporalParts = {});
  if (typeof module === "object" && module.exports) {
    require("./temporal-math.js");
    require("./temporal-layers.js");
    require("./temporal-sampler.js");
  }

  function bindSampleTextures(mediaSamples) {
    const restored = [];
    for (const sample of mediaSamples) {
      const item = sample.item;
      const owner = item.obj?.threeObj || item.clip?.object;
      const key = item.obj ? "map" : "texture";
      if (!owner) continue;
      restored.push({ owner, key, texture: owner[key] });
      owner[key] = sample.texture;
    }
    return () => {
      // The same material can occur in several schedules. Unwind bindings in
      // reverse order so its original current-frame texture wins.
      for (let index = restored.length - 1; index >= 0; index -= 1) {
        const entry = restored[index];
        entry.owner[entry.key] = entry.texture;
      }
    };
  }

  // During preview an adjustment sampler above lower tracks already captured
  // the exact current input for its analysis. Drawing those layers again and
  // copying their result cannot change it, so the pass reuses the capture.
  // The input is copied before the adjustment effects run; a prior displayed
  // color frame is never substituted. Export and unsupported layer structures
  // keep the ordinary path.
  function reusePreparedAdjustmentInput(viewport, runtime, frame) {
    if (PZ.zoidium?.debugDisablePreparedInputReuse) return () => {};
    const math = registry.math;
    const layers = registry.layers;
    const sampler = registry.sampler;
    const root = viewport.compositor;
    const sequence = root?._sequence;
    for (const track of sequence?.videoTracks || []) {
      if (track.enabled === false || global.ZoidiumTrackSwitches?.excludedBySolo(track, sequence.videoTracks)) continue;
      const clip = track.getCurrentClip?.(frame);
      const layer = clip?.object;
      if (!layers.isAdjustmentLayer(layer)) continue;
      const effect = layer.effects?.[0];
      const descriptor = effect?._zoidiumFrameSampler;
      if (!descriptor || PZ.zoidium?.effectBypass?.bypassed(effect)) continue;
      const local = frame - math.finiteNumber(clip.start, 0);
      const request = descriptor.getRequest(effect, local);
      if (!request?.enabled || !request.reuseCurrentInput) continue;
      const prepared = runtime.prepared.get(effect);
      const stage = layers.findFrameSamplerStage(sequence, effect, frame);
      if (!prepared || !stage || stage.effectIndex !== 0 || prepared.depth !== 1 ||
        prepared.scope || Math.abs(prepared.projectFrame - frame) > math.EPSILON ||
        prepared.samples.length !== 2) continue;
      const sample = prepared.samples[1];
      const target = sample.target;
      if (Math.abs(sample.frame - frame) > math.EPSILON ||
        sample.stamp !== target.inputStamp ||
        target.width !== root.readBuffer.width || target.height !== root.readBuffer.height ||
        target.viewport.z !== target.width || target.viewport.w !== target.height ||
        prepared.revision !== sampler.frameSamplerInputKey(sequence, root, stage, prepared.scope,
          request.preserveInputRGB)) continue;
      const skipped = new Set(sequence.videoTracks.slice(0, stage.trackIndex)
        .filter(track => track.enabled !== false && !global.ZoidiumTrackSwitches?.excludedBySolo(track, sequence.videoTracks))
        .map(candidate => candidate.getCurrentClip?.(frame)?.object)
        .filter(Boolean));
      const renderLayer = root.renderLayer;
      const renderEffects = root.renderEffects;
      root.renderLayer = function temporalReusedLayer(object) {
        if (!skipped.has(object)) return renderLayer.apply(this, arguments);
      };
      root.renderEffects = function temporalReusedEffects(effects) {
        if (effects === layer.effects) {
          const pass = this.copyPass;
          const screen = pass.renderToScreen;
          pass.renderToScreen = false;
          try {
            sampler.copyRenderTarget(this, this.readBuffer, target, 1, 1, true);
          } finally {
            pass.renderToScreen = screen;
          }
          runtime.reusedCurrentInputs = (runtime.reusedCurrentInputs || 0) + 1;
        }
        return renderEffects.apply(this, arguments);
      };
      return () => {
        root.renderLayer = renderLayer;
        root.renderEffects = renderEffects;
      };
    }
    return () => {};
  }

  function renderPreparedPreview(viewport, runtime, frame) {
    const math = registry.math;
    const layers = registry.layers;
    const sampler = registry.sampler;
    const sequence = viewport.compositor._sequence;
    const liveFrame = math.finiteNumber(viewport.editor?.playback?.currentFrame, frame);
    const restoreTextures = bindSampleTextures(runtime.previewMedia || []);
    let restoreInput = () => {};
    try {
      sequence.update(frame);
      restoreInput = reusePreparedAdjustmentInput(viewport, runtime, frame);
      viewport.compositor.renderSequence(frame);
      viewport.lastFrame = frame;
    } finally {
      restoreInput();
      restoreTextures();
      sequence.update(liveFrame);
      if (!layers.usesSingleEvaluation(sequence)) {
        for (const track of sequence.videoTracks || []) {
          const layer = track.getCurrentClip?.(frame)?.object;
          const stamp = layer?.__zoidiumTemporalEvaluationStamp;
          const state = typeof PZ !== "undefined" ? PZ.zoidium?.temporal : null;
          const localFrame = liveFrame - math.finiteNumber(layers.getClipForLayer(layer)?.start, 0);
          if (layer && (!stamp || stamp.frame !== localFrame ||
            stamp.epoch !== state?.evaluationEpoch)) {
            sampler.restoreLayerAtContextFrame(layer, liveFrame);
          }
        }
      }
    }
  }

  registry.preview = {
    bindSampleTextures,
    reusePreparedAdjustmentInput,
    renderPreparedPreview,
  };
  if (registry.sampler) {
    registry.sampler.bindSampleTextures = bindSampleTextures;
    registry.sampler.reusePreparedAdjustmentInput = reusePreparedAdjustmentInput;
    registry.sampler.renderPreparedPreview = renderPreparedPreview;
  }
  if (typeof module === "object" && module.exports) module.exports = registry.preview;
})(typeof globalThis !== "undefined" ? globalThis : this);
